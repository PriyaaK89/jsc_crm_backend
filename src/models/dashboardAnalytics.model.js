// Read-only aggregates for the dashboard charts.
// Every function receives userIds = null (whole company) or the ids the caller may see.
const db = require("../config/db");
const empTargetModel = require("./empTarget.model");

// A cancelled voucher stays in its own table; only ledger_transactions is flagged.
// The list is built once, so this does not look up the ledger table per row.
const notCancelled = (type, idColumn) => `
  (${idColumn} IS NULL OR ${idColumn} NOT IN (
    SELECT lt.reference_id FROM ledger_transactions lt
    WHERE lt.transaction_type = '${type}'
      AND lt.is_cancelled = 1
      AND lt.reference_id IS NOT NULL
  ))`;

const SALE_OWNER = "COALESCE(s.assign_employee_id, s.employee_under_id)";
const ACTIVE_SALE = notCancelled("SALES", "s.id");
const ACTIVE_RECEIPT = notCancelled("RECEIPT", "r.id");
const DEBTOR_GROUP = "Sundry Debtors";

const inScope = (column, userIds) =>
  userIds ? { sql: ` AND ${column} IN (?)`, params: [userIds] } : { sql: "", params: [] };

const num = (value) => Number(value) || 0;
const round = (value) => Math.round(num(value) * 100) / 100;
const percent = (part, whole) => (whole > 0 ? round((part / whole) * 100) : 0);

// ---------- time buckets ----------
const DAY_MS = 86400000;
const toUtc = (date) => new Date(`${date}T00:00:00Z`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const getGranularity = (from, to) => {
  const days = (toUtc(to) - toUtc(from)) / DAY_MS + 1;
  if (days <= 45) return "day";
  if (days <= 1100) return "month";
  return "year";
};

const BUCKET_FORMAT = { day: "%Y-%m-%d", month: "%Y-%m", year: "%Y" };

const bucketLabel = (key, granularity) => {
  if (granularity === "year") return key;
  const [year, month, day] = key.split("-");
  const name = MONTHS[Number(month) - 1];
  return granularity === "month" ? `${name} ${year.slice(2)}` : `${Number(day)} ${name}`;
};

// Every period in the range, so a day with no records is drawn as zero and not skipped.
const buildBuckets = (from, to, granularity, empty) => {
  const buckets = [];
  const end = toUtc(to);
  const cursor = toUtc(from);
  if (granularity !== "day") cursor.setUTCDate(1);
  if (granularity === "year") cursor.setUTCMonth(0);

  while (cursor <= end) {
    const iso = cursor.toISOString();
    const key = granularity === "day" ? iso.slice(0, 10) : granularity === "month" ? iso.slice(0, 7) : iso.slice(0, 4);
    buckets.push({ bucket: key, label: bucketLabel(key, granularity), ...empty });
    if (granularity === "day") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (granularity === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
  }
  return buckets;
};

const fillBuckets = (rows, from, to, granularity, empty) => {
  const buckets = buildBuckets(from, to, granularity, empty);
  const byKey = new Map(buckets.map((b) => [b.bucket, b]));
  rows.forEach((row) => {
    const target = byKey.get(row.bucket);
    if (!target) return;
    Object.keys(empty).forEach((key) => {
      target[key] = round(row[key]);
    });
  });
  return buckets;
};

// payload_json is longtext and can be double encoded (same handling as the order history).
const orderAmount = (raw) => {
  try {
    let payload = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (typeof payload === "string") payload = JSON.parse(payload);
    return num(payload && payload.total_amount);
  } catch (e) {
    return 0;
  }
};

// ================= SCOPE LIST (employee filter) =================
exports.getEmployees = async (userIds) => {
  const scope = inScope("u.id", userIds);
  const [rows] = await db.query(
    `SELECT u.id, u.name
     FROM users u
     WHERE u.is_active = 1${scope.sql}
     ORDER BY u.name`,
    scope.params
  );
  return rows;
};

// ================= SALES ORDERS =================
exports.getOrders = async ({ from, to, userIds }) => {
  const granularity = getGranularity(from, to);
  const scope = inScope("ta.created_by", userIds);

  const [rows] = await db.query(
    `SELECT DATE_FORMAT(ta.created_at, '${BUCKET_FORMAT[granularity]}') AS bucket,
            ta.status, ta.created_by, u.name AS employee_name, ta.payload_json
     FROM transaction_approvals ta
     LEFT JOIN users u ON u.id = ta.created_by
     WHERE ta.transaction_type = 'SALES'
       AND ta.created_at >= ?
       AND ta.created_at < DATE_ADD(?, INTERVAL 1 DAY)${scope.sql}`,
    [from, to, ...scope.params]
  );

  const empty = { total: 0, approved: 0, pending: 0, returned: 0, rejected: 0, value: 0 };
  const trend = buildBuckets(from, to, granularity, empty);
  const trendByKey = new Map(trend.map((b) => [b.bucket, b]));
  const summary = { ...empty, total_value: 0, approved_value: 0, pending_value: 0 };
  delete summary.value;
  const statusMap = new Map();
  const employeeMap = new Map();

  rows.forEach((row) => {
    const amount = orderAmount(row.payload_json);
    const key = String(row.status || "").toLowerCase();
    const point = trendByKey.get(row.bucket);

    summary.total += 1;
    summary.total_value += amount;
    if (key in empty && key !== "total" && key !== "value") summary[key] += 1;
    if (key === "approved") summary.approved_value += amount;
    if (key === "pending") summary.pending_value += amount;

    if (point) {
      point.total += 1;
      point.value = round(point.value + amount);
      if (key in point && key !== "total" && key !== "value") point[key] += 1;
    }

    const status = statusMap.get(row.status) || { status: row.status, count: 0, value: 0 };
    status.count += 1;
    status.value = round(status.value + amount);
    statusMap.set(row.status, status);

    const employee = employeeMap.get(row.created_by) || {
      id: row.created_by,
      name: row.employee_name || "Unknown",
      total: 0,
      approved: 0,
      pending: 0,
    };
    employee.total += 1;
    if (key === "approved") employee.approved += 1;
    if (key === "pending") employee.pending += 1;
    employeeMap.set(row.created_by, employee);
  });

  summary.total_value = round(summary.total_value);
  summary.approved_value = round(summary.approved_value);
  summary.pending_value = round(summary.pending_value);
  summary.approval_rate = percent(summary.approved, summary.total);
  summary.average_value = summary.total ? round(summary.total_value / summary.total) : 0;

  return {
    granularity,
    summary,
    trend,
    status: [...statusMap.values()].sort((a, b) => b.count - a.count),
    by_employee: [...employeeMap.values()].sort((a, b) => b.total - a.total).slice(0, 8),
  };
};

// ================= APPROVALS (all transaction types) =================
const APPROVAL_STATES = ["approved", "pending", "returned", "rejected"];

exports.getApprovals = async ({ from, to, userIds }) => {
  const granularity = getGranularity(from, to);
  const scope = inScope("ta.created_by", userIds);
  const range = `ta.created_at >= ? AND ta.created_at < DATE_ADD(?, INTERVAL 1 DAY)`;

  const [[rows], [approverRows]] = await Promise.all([
    db.query(
      `SELECT DATE_FORMAT(ta.created_at, '${BUCKET_FORMAT[granularity]}') AS bucket,
              ta.transaction_type, ta.status, COUNT(*) AS count
       FROM transaction_approvals ta
       WHERE ${range}${scope.sql}
       GROUP BY bucket, ta.transaction_type, ta.status`,
      [from, to, ...scope.params]
    ),
    db.query(
      `SELECT ta.current_approver_id AS id, u.name, COUNT(*) AS pending
       FROM transaction_approvals ta
       LEFT JOIN users u ON u.id = ta.current_approver_id
       WHERE ta.status = 'PENDING' AND ${range}${scope.sql}
       GROUP BY ta.current_approver_id, u.name
       ORDER BY pending DESC
       LIMIT 8`,
      [from, to, ...scope.params]
    ),
  ]);

  const empty = { total: 0, approved: 0, pending: 0, returned: 0, rejected: 0 };
  const trend = buildBuckets(from, to, granularity, empty);
  const trendByKey = new Map(trend.map((point) => [point.bucket, point]));
  const summary = { ...empty };
  const typeMap = new Map();

  rows.forEach((row) => {
    const count = num(row.count);
    const key = String(row.status || "").toLowerCase();
    const type = typeMap.get(row.transaction_type) || { transaction_type: row.transaction_type, ...empty };
    const point = trendByKey.get(row.bucket);

    [summary, type, point].forEach((item) => {
      if (!item) return;
      item.total += count;
      if (APPROVAL_STATES.includes(key)) item[key] += count;
    });
    typeMap.set(row.transaction_type, type);
  });

  return {
    granularity,
    summary: {
      ...summary,
      approval_rate: percent(summary.approved, summary.total),
      rejection_rate: percent(summary.rejected, summary.total),
    },
    trend,
    by_type: [...typeMap.values()]
      .map((type) => ({ ...type, approval_rate: percent(type.approved, type.total) }))
      .sort((a, b) => b.total - a.total),
    pending_by_approver: approverRows.map((row) => ({
      id: row.id,
      name: row.name || "Unassigned",
      pending: num(row.pending),
    })),
  };
};

// ================= VISIT TARGETS =================
exports.getVisits = async ({ from, to, userIds }) => {
  const granularity = getGranularity(from, to);
  const visitScope = inScope("v.user_id", userIds);
  const targetScope = inScope("a.employee_id", userIds);

  const [trendRows, outcomeRows, typeRows, targetRows] = await Promise.all([
    db.query(
      `SELECT DATE_FORMAT(v.created_at, '${BUCKET_FORMAT[granularity]}') AS bucket, COUNT(*) AS visits
       FROM visits v
       WHERE v.created_at >= ? AND v.created_at < DATE_ADD(?, INTERVAL 1 DAY)${visitScope.sql}
       GROUP BY bucket`,
      [from, to, ...visitScope.params]
    ),
    db.query(
      `SELECT COALESCE(v.visit_outcome, 'not_recorded') AS outcome_name, COUNT(*) AS count
       FROM visits v
       WHERE v.created_at >= ? AND v.created_at < DATE_ADD(?, INTERVAL 1 DAY)${visitScope.sql}
       GROUP BY outcome_name
       ORDER BY count DESC`,
      [from, to, ...visitScope.params]
    ),
    db.query(
      `SELECT COALESCE(v.visit_type, 'other') AS type_name, COUNT(*) AS count
       FROM visits v
       WHERE v.created_at >= ? AND v.created_at < DATE_ADD(?, INTERVAL 1 DAY)${visitScope.sql}
       GROUP BY type_name
       ORDER BY count DESC`,
      [from, to, ...visitScope.params]
    ),
    // Same rule as getAssignmentProgress: visits of that type inside the assignment's own
    // period. One statement, so no per-assignment round trip.
    db.query(
      `SELECT a.employee_id, u.name AS employee_name, d.visit_type, d.target_value,
              (SELECT COUNT(*) FROM visits v
               WHERE v.user_id = a.employee_id
                 AND v.visit_type = d.visit_type
                 AND v.created_at >= a.period_start
                 AND v.created_at < DATE_ADD(a.period_end, INTERVAL 1 DAY)) AS achieved
       FROM visit_target_assignments a
       INNER JOIN visit_target_assignment_details d ON d.assignment_id = a.id
       INNER JOIN users u ON u.id = a.employee_id
       WHERE a.status IN ('ACTIVE','COMPLETED','EXPIRED')
         AND a.period_start <= ? AND a.period_end >= ?${targetScope.sql}`,
      [to, from, ...targetScope.params]
    ),
  ]);

  const typeMap = new Map();
  const employeeMap = new Map();
  const summary = { target: 0, achieved: 0, pending: 0 };

  targetRows[0].forEach((row) => {
    const target = num(row.target_value);
    const achieved = num(row.achieved);
    const pending = Math.max(target - achieved, 0);

    summary.target += target;
    summary.achieved += achieved;
    summary.pending += pending;

    const type = typeMap.get(row.visit_type) || { visit_type: row.visit_type, target: 0, achieved: 0, pending: 0 };
    type.target += target;
    type.achieved += achieved;
    type.pending += pending;
    typeMap.set(row.visit_type, type);

    const employee = employeeMap.get(row.employee_id) || {
      id: row.employee_id,
      name: row.employee_name,
      target: 0,
      achieved: 0,
      pending: 0,
    };
    employee.target += target;
    employee.achieved += achieved;
    employee.pending += pending;
    employeeMap.set(row.employee_id, employee);
  });

  const withPercent = (item) => ({ ...item, percent: percent(item.achieved, item.target) });

  summary.total_visits = trendRows[0].reduce((sum, row) => sum + num(row.visits), 0);
  summary.percent = percent(summary.achieved, summary.target);

  return {
    granularity,
    summary,
    trend: fillBuckets(trendRows[0], from, to, granularity, { visits: 0 }),
    by_type: [...typeMap.values()].map(withPercent).sort((a, b) => b.target - a.target),
    by_employee: [...employeeMap.values()].map(withPercent).sort((a, b) => b.target - a.target).slice(0, 10),
    outcomes: outcomeRows[0].map((row) => ({ outcome: row.outcome_name, count: num(row.count) })),
    types: typeRows[0].map((row) => ({ visit_type: row.type_name, count: num(row.count) })),
  };
};

// ================= EMPLOYEE TARGETS (shared by sales + collection) =================
// Uses getTargetsByFilters, so the achieved figure always equals the Targets screen.
const getTargetProgress = async ({ from, to, userIds, targetType }) => {
  const rows = await empTargetModel.getTargetsByFilters({
    ...(userIds ? { userIds } : {}),
    targetType,
    startDate: from,
    endDate: to,
  });

  const employeeMap = new Map();
  const summary = { target: 0, achieved: 0, pending: 0, target_count: rows.length };

  rows.forEach((row) => {
    const target = num(row.target_amount);
    const achieved = num(row.achieved_amount);
    const pending = num(row.pending_amount);

    summary.target += target;
    summary.achieved += achieved;
    summary.pending += pending;

    const employee = employeeMap.get(row.user_id) || {
      id: row.user_id,
      name: row.user_name,
      target: 0,
      achieved: 0,
      pending: 0,
    };
    employee.target += target;
    employee.achieved += achieved;
    employee.pending += pending;
    employeeMap.set(row.user_id, employee);
  });

  return {
    summary: {
      target_count: summary.target_count,
      target: round(summary.target),
      achieved: round(summary.achieved),
      pending: round(summary.pending),
      percent: percent(summary.achieved, summary.target),
    },
    by_employee: [...employeeMap.values()]
      .map((item) => ({
        ...item,
        target: round(item.target),
        achieved: round(item.achieved),
        pending: round(item.pending),
        percent: percent(item.achieved, item.target),
      }))
      .sort((a, b) => b.target - a.target)
      .slice(0, 10),
  };
};

// ================= SALES PERFORMANCE =================
exports.getSales = async ({ from, to, userIds }) => {
  const granularity = getGranularity(from, to);
  const scope = inScope(SALE_OWNER, userIds);

  const [[trendRows], targets, [employeeRows]] = await Promise.all([
    db.query(
      `SELECT DATE_FORMAT(s.sales_date, '${BUCKET_FORMAT[granularity]}') AS bucket,
              COUNT(*) AS invoices,
              COALESCE(SUM(s.subtotal), 0) AS net,
              COALESCE(SUM(s.total_amount), 0) AS gross
       FROM sales s
       WHERE s.sales_date >= ? AND s.sales_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND ${ACTIVE_SALE}${scope.sql}
       GROUP BY bucket`,
      [from, to, ...scope.params]
    ),
    getTargetProgress({ from, to, userIds, targetType: "SALE" }),
    db.query(
      `SELECT ${SALE_OWNER} AS id, u.name, COUNT(*) AS invoices, COALESCE(SUM(s.subtotal), 0) AS amount
       FROM sales s
       LEFT JOIN users u ON u.id = ${SALE_OWNER}
       WHERE s.sales_date >= ? AND s.sales_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND ${ACTIVE_SALE}${scope.sql}
       GROUP BY ${SALE_OWNER}, u.name
       ORDER BY amount DESC
       LIMIT 10`,
      [from, to, ...scope.params]
    ),
  ]);

  const net = trendRows.reduce((sum, row) => sum + num(row.net), 0);
  const gross = trendRows.reduce((sum, row) => sum + num(row.gross), 0);
  const invoices = trendRows.reduce((sum, row) => sum + num(row.invoices), 0);

  return {
    granularity,
    summary: {
      ...targets.summary,
      net_sales: round(net),
      gross_sales: round(gross),
      invoices,
      average_invoice: invoices ? round(net / invoices) : 0,
    },
    trend: fillBuckets(trendRows, from, to, granularity, { net: 0, gross: 0, invoices: 0 }),
    by_employee: targets.by_employee,
    employee_sales: employeeRows.map((row) => ({
      id: row.id,
      name: row.name || "Unassigned",
      invoices: num(row.invoices),
      amount: round(row.amount),
    })),
  };
};

// ================= COLLECTIONS =================
const AGEING = [
  { key: "not_due", label: "Not due" },
  { key: "d1_30", label: "1-30 days" },
  { key: "d31_60", label: "31-60 days" },
  { key: "d61_90", label: "61-90 days" },
  { key: "d90_plus", label: "90+ days" },
  { key: "no_due_date", label: "No due date" },
];

exports.getCollections = async ({ from, to, userIds, today }) => {
  const granularity = getGranularity(from, to);
  const receiptScope = inScope("r.employee_under_id", userIds);
  const ledgerScope = inScope("l.employee_under", userIds);

  const [[trendRows], targets, [ageingRows], [partyRows], [employeeRows]] = await Promise.all([
    db.query(
      `SELECT DATE_FORMAT(r.receipt_date, '${BUCKET_FORMAT[granularity]}') AS bucket,
              COUNT(*) AS receipts,
              COALESCE(SUM(r.total_amount), 0) AS collected
       FROM receipts r
       WHERE r.receipt_date >= ? AND r.receipt_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND ${ACTIVE_RECEIPT}${receiptScope.sql}
       GROUP BY bucket`,
      [from, to, ...receiptScope.params]
    ),
    getTargetProgress({ from, to, userIds, targetType: "COLLECTION" }),
    // Outstanding is a position as of today, so the date filter does not apply to it.
    db.query(
      `SELECT CASE
                WHEN sbr.due_date IS NULL THEN 'no_due_date'
                WHEN sbr.due_date >= ? THEN 'not_due'
                WHEN DATEDIFF(?, sbr.due_date) <= 30 THEN 'd1_30'
                WHEN DATEDIFF(?, sbr.due_date) <= 60 THEN 'd31_60'
                WHEN DATEDIFF(?, sbr.due_date) <= 90 THEN 'd61_90'
                ELSE 'd90_plus'
              END AS age_bucket,
              COUNT(*) AS bills,
              COALESCE(SUM(sbr.pending_amount), 0) AS amount
       FROM sales_bill_references sbr
       INNER JOIN ledgers l ON l.id = sbr.ledger_id
       WHERE sbr.pending_amount > 0
         AND ${notCancelled("SALES", "sbr.sale_id")}${ledgerScope.sql}
       GROUP BY age_bucket`,
      [today, today, today, today, ...ledgerScope.params]
    ),
    db.query(
      `SELECT l.id, l.ledger_name AS name,
              COUNT(*) AS bills,
              COALESCE(SUM(sbr.pending_amount), 0) AS amount
       FROM sales_bill_references sbr
       INNER JOIN ledgers l ON l.id = sbr.ledger_id
       WHERE sbr.pending_amount > 0
         AND sbr.due_date < ?
         AND ${notCancelled("SALES", "sbr.sale_id")}${ledgerScope.sql}
       GROUP BY l.id, l.ledger_name
       ORDER BY amount DESC
       LIMIT 5`,
      [today, ...ledgerScope.params]
    ),
    db.query(
      `SELECT r.employee_under_id AS id, u.name, COUNT(*) AS receipts,
              COALESCE(SUM(r.total_amount), 0) AS amount
       FROM receipts r
       LEFT JOIN users u ON u.id = r.employee_under_id
       WHERE r.receipt_date >= ? AND r.receipt_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND ${ACTIVE_RECEIPT}${receiptScope.sql}
       GROUP BY r.employee_under_id, u.name
       ORDER BY amount DESC
       LIMIT 10`,
      [from, to, ...receiptScope.params]
    ),
  ]);

  const ageMap = new Map(ageingRows.map((row) => [row.age_bucket, row]));
  const ageing = AGEING.map(({ key, label }) => ({
    key,
    label,
    amount: round(ageMap.get(key)?.amount),
    bills: num(ageMap.get(key)?.bills),
  }));
  const outstanding = ageing.reduce((sum, row) => sum + row.amount, 0);
  const overdue = ageing
    .filter((row) => row.key.startsWith("d"))
    .reduce((sum, row) => sum + row.amount, 0);
  const collected = trendRows.reduce((sum, row) => sum + num(row.collected), 0);
  const receipts = trendRows.reduce((sum, row) => sum + num(row.receipts), 0);

  return {
    granularity,
    summary: {
      ...targets.summary,
      collected: round(collected),
      receipts,
      outstanding: round(outstanding),
      overdue: round(overdue),
    },
    trend: fillBuckets(trendRows, from, to, granularity, { collected: 0, receipts: 0 }),
    by_employee: targets.by_employee,
    employee_collections: employeeRows.map((row) => ({
      id: row.id,
      name: row.name || "Unassigned",
      receipts: num(row.receipts),
      amount: round(row.amount),
    })),
    ageing,
    overdue_parties: partyRows.map((row) => ({
      id: row.id,
      name: row.name,
      bills: num(row.bills),
      amount: round(row.amount),
    })),
  };
};

// ================= BUSINESS ANALYTICS =================
const MAX_CATEGORIES = 6;

exports.getBusiness = async ({ from, to, userIds }) => {
  const granularity = getGranularity(from, to);
  const saleScope = inScope(SALE_OWNER, userIds);
  const ledgerScope = inScope("l.employee_under", userIds);
  const saleWhere = `s.sales_date >= ? AND s.sales_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND ${ACTIVE_SALE}${saleScope.sql}`;
  const saleParams = [from, to, ...saleScope.params];

  const [[categoryRows], [productRows], [customerRows], [dealerRows], dealerTargets, [[activeRow]]] = await Promise.all([
    db.query(
      `SELECT COALESCE(sc.name, 'Uncategorised') AS name, COALESCE(SUM(si.amount), 0) AS amount
       FROM sales s
       INNER JOIN sales_items si ON si.sale_id = s.id
       INNER JOIN stock_items st ON st.id = si.stock_item_id
       LEFT JOIN stock_categories sc ON sc.id = st.stock_category_id
       WHERE ${saleWhere}
       GROUP BY sc.id, sc.name
       ORDER BY amount DESC`,
      saleParams
    ),
    db.query(
      `SELECT st.id, st.item_name AS name, COALESCE(SUM(si.amount), 0) AS amount
       FROM sales s
       INNER JOIN sales_items si ON si.sale_id = s.id
       INNER JOIN stock_items st ON st.id = si.stock_item_id
       WHERE ${saleWhere}
       GROUP BY st.id, st.item_name
       ORDER BY amount DESC
       LIMIT 8`,
      saleParams
    ),
    db.query(
      `SELECT l.id, l.ledger_name AS name, COUNT(*) AS invoices, COALESCE(SUM(s.subtotal), 0) AS amount
       FROM sales s
       INNER JOIN ledgers l ON l.id = s.customer_ledger_id
       WHERE ${saleWhere}
       GROUP BY l.id, l.ledger_name
       ORDER BY amount DESC
       LIMIT 8`,
      saleParams
    ),
    db.query(
      `SELECT DATE_FORMAT(l.created_at, '${BUCKET_FORMAT[granularity]}') AS bucket, COUNT(*) AS dealers
       FROM ledgers l
       INNER JOIN account_groups ag ON ag.id = l.group_id
       WHERE ag.group_name = ?
         AND l.created_at >= ? AND l.created_at < DATE_ADD(?, INTERVAL 1 DAY)${ledgerScope.sql}
       GROUP BY bucket`,
      [DEBTOR_GROUP, from, to, ...ledgerScope.params]
    ),
    getTargetProgress({ from, to, userIds, targetType: "NEW_DISTRIBUTOR" }),
    db.query(
      `SELECT COUNT(DISTINCT s.customer_ledger_id) AS customers
       FROM sales s
       WHERE ${saleWhere}`,
      saleParams
    ),
  ]);

  // Largest categories keep their own slice; the rest fold into "Other".
  const categories = categoryRows.slice(0, MAX_CATEGORIES).map((row) => ({ name: row.name, amount: round(row.amount) }));
  const others = categoryRows.slice(MAX_CATEGORIES).reduce((sum, row) => sum + num(row.amount), 0);
  if (others > 0) categories.push({ name: "Other", amount: round(others) });

  return {
    granularity,
    summary: {
      new_dealers: dealerRows.reduce((sum, row) => sum + num(row.dealers), 0),
      active_customers: num(activeRow.customers),
      dealer_target: dealerTargets.summary.target,
      dealer_target_achieved: dealerTargets.summary.achieved,
    },
    categories,
    products: productRows.map((row) => ({ id: row.id, name: row.name, amount: round(row.amount) })),
    customers: customerRows.map((row) => ({
      id: row.id,
      name: row.name,
      invoices: num(row.invoices),
      amount: round(row.amount),
    })),
    new_dealers: fillBuckets(dealerRows, from, to, granularity, { dealers: 0 }),
  };
};

exports.getGranularity = getGranularity;
exports.buildBuckets = buildBuckets;
