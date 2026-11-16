// Business Plan: actual figures read from the existing accounting tables.
// Nothing here writes. Rules match the dashboard analytics:
//   sales       = sales.subtotal (net), cancelled vouchers excluded
//   collection  = receipt_entries.amount for the party ledger
//   outstanding = sales_bill_references.pending_amount
const db = require("../../config/db");

const DEBTOR_GROUP = "Sundry Debtors";

// A cancelled voucher stays in its own table; only ledger_transactions is flagged.
const notCancelled = (type, idColumn) => `
  (${idColumn} IS NULL OR ${idColumn} NOT IN (
    SELECT lt.reference_id FROM ledger_transactions lt
    WHERE lt.transaction_type = '${type}'
      AND lt.is_cancelled = 1
      AND lt.reference_id IS NOT NULL
  ))`;

const ACTIVE_SALE = notCancelled("SALES", "s.id");
const ACTIVE_RECEIPT = notCancelled("RECEIPT", "r.id");
const SALE_OWNER = "COALESCE(s.assign_employee_id, s.employee_under_id)";

const num = (v) => Number(v) || 0;
const round = (v) => Math.round(num(v) * 100) / 100;

// "2026-06-01" -> "2025-06-01" (29 Feb -> 28 Feb)
const minusYear = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  const day = m === 2 && d === 29 ? 28 : d;
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

// ---------------------------------------------------------------------
//  PLAN TOTALS (many plans at once, for lists / dashboard / reports)
//  plans: [{ id, start_date, end_date, assigned_user_id }]
//  A plan with distributor lines is measured on those distributors;
//  a plan without them is measured on the assigned employee's own business.
// ---------------------------------------------------------------------
const getPlanTotals = async (planIds) => {
  const result = new Map(planIds.map((id) => [id, { sales: 0, collection: 0 }]));
  if (!planIds.length) return result;

  const [[distSales], [distColl], [ownSales], [ownColl]] = await Promise.all([
    db.query(
      `SELECT d.plan_id, COALESCE(SUM(s.subtotal), 0) AS amount
       FROM bp_distributor_lines d
       INNER JOIN business_plans p ON p.id = d.plan_id
       INNER JOIN sales s ON s.customer_ledger_id = d.ledger_id
         AND s.sales_date >= p.start_date AND s.sales_date < DATE_ADD(p.end_date, INTERVAL 1 DAY)
       WHERE d.plan_id IN (?) AND ${ACTIVE_SALE}
       GROUP BY d.plan_id`,
      [planIds],
    ),
    db.query(
      `SELECT d.plan_id, COALESCE(SUM(re.amount), 0) AS amount
       FROM bp_distributor_lines d
       INNER JOIN business_plans p ON p.id = d.plan_id
       INNER JOIN receipt_entries re ON re.ledger_id = d.ledger_id
       INNER JOIN receipts r ON r.id = re.receipt_id
         AND r.receipt_date >= p.start_date AND r.receipt_date < DATE_ADD(p.end_date, INTERVAL 1 DAY)
       WHERE d.plan_id IN (?) AND ${ACTIVE_RECEIPT}
       GROUP BY d.plan_id`,
      [planIds],
    ),
    db.query(
      `SELECT p.id AS plan_id, COALESCE(SUM(s.subtotal), 0) AS amount
       FROM business_plans p
       INNER JOIN sales s ON ${SALE_OWNER} = p.assigned_user_id
         AND s.sales_date >= p.start_date AND s.sales_date < DATE_ADD(p.end_date, INTERVAL 1 DAY)
       WHERE p.id IN (?)
         AND NOT EXISTS (SELECT 1 FROM bp_distributor_lines d WHERE d.plan_id = p.id)
         AND ${ACTIVE_SALE}
       GROUP BY p.id`,
      [planIds],
    ),
    db.query(
      `SELECT p.id AS plan_id, COALESCE(SUM(r.total_amount), 0) AS amount
       FROM business_plans p
       INNER JOIN receipts r ON r.employee_under_id = p.assigned_user_id
         AND r.receipt_date >= p.start_date AND r.receipt_date < DATE_ADD(p.end_date, INTERVAL 1 DAY)
       WHERE p.id IN (?)
         AND NOT EXISTS (SELECT 1 FROM bp_distributor_lines d WHERE d.plan_id = p.id)
         AND ${ACTIVE_RECEIPT}
       GROUP BY p.id`,
      [planIds],
    ),
  ]);

  for (const r of [...distSales, ...ownSales]) {
    if (result.has(r.plan_id)) result.get(r.plan_id).sales += num(r.amount);
  }
  for (const r of [...distColl, ...ownColl]) {
    if (result.has(r.plan_id)) result.get(r.plan_id).collection += num(r.amount);
  }
  for (const v of result.values()) {
    v.sales = round(v.sales);
    v.collection = round(v.collection);
  }
  return result;
};

// ---------------------------------------------------------------------
//  PER DISTRIBUTOR (one plan period)
// ---------------------------------------------------------------------
// Map ledger_id -> { sales, collection, outstanding, last_order_date }
const getLedgerActuals = async (ledgerIds, from, to) => {
  const out = new Map(
    ledgerIds.map((id) => [id, { sales: 0, collection: 0, outstanding: 0, last_order_date: null }]),
  );
  if (!ledgerIds.length) return out;

  const [[sales], [coll], [pending], [lastOrder]] = await Promise.all([
    db.query(
      `SELECT s.customer_ledger_id AS ledger_id, COALESCE(SUM(s.subtotal), 0) AS amount
       FROM sales s
       WHERE s.customer_ledger_id IN (?)
         AND s.sales_date >= ? AND s.sales_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND ${ACTIVE_SALE}
       GROUP BY s.customer_ledger_id`,
      [ledgerIds, from, to],
    ),
    db.query(
      `SELECT re.ledger_id, COALESCE(SUM(re.amount), 0) AS amount
       FROM receipt_entries re
       INNER JOIN receipts r ON r.id = re.receipt_id
       WHERE re.ledger_id IN (?)
         AND r.receipt_date >= ? AND r.receipt_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND ${ACTIVE_RECEIPT}
       GROUP BY re.ledger_id`,
      [ledgerIds, from, to],
    ),
    // outstanding is a position as of today
    db.query(
      `SELECT sbr.ledger_id, COALESCE(SUM(sbr.pending_amount), 0) AS amount
       FROM sales_bill_references sbr
       WHERE sbr.ledger_id IN (?) AND sbr.pending_amount > 0
         AND ${notCancelled("SALES", "sbr.sale_id")}
       GROUP BY sbr.ledger_id`,
      [ledgerIds],
    ),
    db.query(
      `SELECT s.customer_ledger_id AS ledger_id, DATE_FORMAT(MAX(s.sales_date), '%Y-%m-%d') AS last_date
       FROM sales s
       WHERE s.customer_ledger_id IN (?) AND ${ACTIVE_SALE}
       GROUP BY s.customer_ledger_id`,
      [ledgerIds],
    ),
  ]);

  for (const r of sales) out.get(r.ledger_id) && (out.get(r.ledger_id).sales = round(r.amount));
  for (const r of coll) out.get(r.ledger_id) && (out.get(r.ledger_id).collection = round(r.amount));
  for (const r of pending) out.get(r.ledger_id) && (out.get(r.ledger_id).outstanding = round(r.amount));
  for (const r of lastOrder) out.get(r.ledger_id) && (out.get(r.ledger_id).last_order_date = r.last_date);
  return out;
};

// Same window one year earlier: Map ledger_id -> sales
const getLedgerPreviousSales = async (ledgerIds, from, to) => {
  const out = new Map(ledgerIds.map((id) => [id, 0]));
  if (!ledgerIds.length) return out;
  const [rows] = await db.query(
    `SELECT s.customer_ledger_id AS ledger_id, COALESCE(SUM(s.subtotal), 0) AS amount
     FROM sales s
     WHERE s.customer_ledger_id IN (?)
       AND s.sales_date >= ? AND s.sales_date < DATE_ADD(?, INTERVAL 1 DAY)
       AND ${ACTIVE_SALE}
     GROUP BY s.customer_ledger_id`,
    [ledgerIds, minusYear(from), minusYear(to)],
  );
  for (const r of rows) out.set(r.ledger_id, round(r.amount));
  return out;
};

// ---------------------------------------------------------------------
//  PER PRODUCT
//  scope: { ledgerIds } (plan distributors) or { userId } (employee's own sales)
// ---------------------------------------------------------------------
const scopeSql = (scope) =>
  scope.ledgerIds && scope.ledgerIds.length
    ? { sql: "s.customer_ledger_id IN (?)", params: [scope.ledgerIds] }
    : { sql: `${SALE_OWNER} = ?`, params: [scope.userId || 0] };

// Map stock_item_id -> { qty, value }
const getProductActuals = async (itemIds, scope, from, to) => {
  const out = new Map(itemIds.map((id) => [id, { qty: 0, value: 0 }]));
  if (!itemIds.length) return out;
  const sc = scopeSql(scope);
  const [rows] = await db.query(
    `SELECT si.stock_item_id, COALESCE(SUM(si.billed_qty), 0) AS qty, COALESCE(SUM(si.amount), 0) AS value
     FROM sales s
     INNER JOIN sales_items si ON si.sale_id = s.id
     WHERE si.stock_item_id IN (?)
       AND ${sc.sql}
       AND s.sales_date >= ? AND s.sales_date < DATE_ADD(?, INTERVAL 1 DAY)
       AND ${ACTIVE_SALE}
     GROUP BY si.stock_item_id`,
    [itemIds, ...sc.params, from, to],
  );
  for (const r of rows) out.set(r.stock_item_id, { qty: round(r.qty), value: round(r.value) });
  return out;
};

// Map `${ledger_id}:${stock_item_id}` -> { qty, value }  (Matrix)
const getLedgerProductActuals = async (ledgerIds, itemIds, from, to) => {
  const out = new Map();
  if (!ledgerIds.length || !itemIds.length) return out;
  const [rows] = await db.query(
    `SELECT s.customer_ledger_id AS ledger_id, si.stock_item_id,
            COALESCE(SUM(si.billed_qty), 0) AS qty, COALESCE(SUM(si.amount), 0) AS value
     FROM sales s
     INNER JOIN sales_items si ON si.sale_id = s.id
     WHERE s.customer_ledger_id IN (?) AND si.stock_item_id IN (?)
       AND s.sales_date >= ? AND s.sales_date < DATE_ADD(?, INTERVAL 1 DAY)
       AND ${ACTIVE_SALE}
     GROUP BY s.customer_ledger_id, si.stock_item_id`,
    [ledgerIds, itemIds, from, to],
  );
  for (const r of rows) {
    out.set(`${r.ledger_id}:${r.stock_item_id}`, { qty: round(r.qty), value: round(r.value) });
  }
  return out;
};

// ---------------------------------------------------------------------
//  MONTHLY
// ---------------------------------------------------------------------
// Map `${ledger_id}:${YYYY-MM}` -> { sales, collection }
const getLedgerMonthly = async (ledgerIds, from, to) => {
  const out = new Map();
  if (!ledgerIds.length) return out;
  const [[sales], [coll]] = await Promise.all([
    db.query(
      `SELECT s.customer_ledger_id AS ledger_id, DATE_FORMAT(s.sales_date, '%Y-%m') AS ym,
              COALESCE(SUM(s.subtotal), 0) AS amount
       FROM sales s
       WHERE s.customer_ledger_id IN (?)
         AND s.sales_date >= ? AND s.sales_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND ${ACTIVE_SALE}
       GROUP BY s.customer_ledger_id, ym`,
      [ledgerIds, from, to],
    ),
    db.query(
      `SELECT re.ledger_id, DATE_FORMAT(r.receipt_date, '%Y-%m') AS ym,
              COALESCE(SUM(re.amount), 0) AS amount
       FROM receipt_entries re
       INNER JOIN receipts r ON r.id = re.receipt_id
       WHERE re.ledger_id IN (?)
         AND r.receipt_date >= ? AND r.receipt_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND ${ACTIVE_RECEIPT}
       GROUP BY re.ledger_id, ym`,
      [ledgerIds, from, to],
    ),
  ]);
  const cell = (k) => {
    if (!out.has(k)) out.set(k, { sales: 0, collection: 0 });
    return out.get(k);
  };
  for (const r of sales) cell(`${r.ledger_id}:${r.ym}`).sales = round(r.amount);
  for (const r of coll) cell(`${r.ledger_id}:${r.ym}`).collection = round(r.amount);
  return out;
};

// employee's own business per month: Map YYYY-MM -> { sales, collection }
const getEmployeeMonthly = async (userId, from, to) => {
  const out = new Map();
  const [[sales], [coll]] = await Promise.all([
    db.query(
      `SELECT DATE_FORMAT(s.sales_date, '%Y-%m') AS ym, COALESCE(SUM(s.subtotal), 0) AS amount
       FROM sales s
       WHERE ${SALE_OWNER} = ?
         AND s.sales_date >= ? AND s.sales_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND ${ACTIVE_SALE}
       GROUP BY ym`,
      [userId, from, to],
    ),
    db.query(
      `SELECT DATE_FORMAT(r.receipt_date, '%Y-%m') AS ym, COALESCE(SUM(r.total_amount), 0) AS amount
       FROM receipts r
       WHERE r.employee_under_id = ?
         AND r.receipt_date >= ? AND r.receipt_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND ${ACTIVE_RECEIPT}
       GROUP BY ym`,
      [userId, from, to],
    ),
  ]);
  const cell = (k) => {
    if (!out.has(k)) out.set(k, { sales: 0, collection: 0 });
    return out.get(k);
  };
  for (const r of sales) cell(r.ym).sales = round(r.amount);
  for (const r of coll) cell(r.ym).collection = round(r.amount);
  return out;
};

// ---------------------------------------------------------------------
//  LINE ACTUALS FOR MANY PLANS (each line measured in its own plan's dates)
// ---------------------------------------------------------------------
const PLAN_RANGE = (alias, dateCol) =>
  `${alias}.${dateCol} >= p.start_date AND ${alias}.${dateCol} < DATE_ADD(p.end_date, INTERVAL 1 DAY)`;
const PREV_RANGE = (alias, dateCol) =>
  `${alias}.${dateCol} >= DATE_SUB(p.start_date, INTERVAL 1 YEAR)
   AND ${alias}.${dateCol} < DATE_ADD(DATE_SUB(p.end_date, INTERVAL 1 YEAR), INTERVAL 1 DAY)`;

// Map distributor_line_id -> { sales, collection, prev_sales }
const getDistributorLineActuals = async (planIds) => {
  const out = new Map();
  if (!planIds.length) return out;
  const [[sales], [coll], [prev]] = await Promise.all([
    db.query(
      `SELECT d.id, COALESCE(SUM(s.subtotal), 0) AS amount
       FROM bp_distributor_lines d
       INNER JOIN business_plans p ON p.id = d.plan_id
       INNER JOIN sales s ON s.customer_ledger_id = d.ledger_id AND ${PLAN_RANGE("s", "sales_date")}
       WHERE d.plan_id IN (?) AND ${ACTIVE_SALE}
       GROUP BY d.id`,
      [planIds],
    ),
    db.query(
      `SELECT d.id, COALESCE(SUM(re.amount), 0) AS amount
       FROM bp_distributor_lines d
       INNER JOIN business_plans p ON p.id = d.plan_id
       INNER JOIN receipt_entries re ON re.ledger_id = d.ledger_id
       INNER JOIN receipts r ON r.id = re.receipt_id AND ${PLAN_RANGE("r", "receipt_date")}
       WHERE d.plan_id IN (?) AND ${ACTIVE_RECEIPT}
       GROUP BY d.id`,
      [planIds],
    ),
    db.query(
      `SELECT d.id, COALESCE(SUM(s.subtotal), 0) AS amount
       FROM bp_distributor_lines d
       INNER JOIN business_plans p ON p.id = d.plan_id
       INNER JOIN sales s ON s.customer_ledger_id = d.ledger_id AND ${PREV_RANGE("s", "sales_date")}
       WHERE d.plan_id IN (?) AND ${ACTIVE_SALE}
       GROUP BY d.id`,
      [planIds],
    ),
  ]);
  const cell = (id) => {
    if (!out.has(id)) out.set(id, { sales: 0, collection: 0, prev_sales: 0 });
    return out.get(id);
  };
  for (const r of sales) cell(r.id).sales = round(r.amount);
  for (const r of coll) cell(r.id).collection = round(r.amount);
  for (const r of prev) cell(r.id).prev_sales = round(r.amount);
  return out;
};

// sales scope of a plan: its distributors, or the assigned employee when it has none
const PLAN_SALE_SCOPE = `
  ((EXISTS (SELECT 1 FROM bp_distributor_lines dx WHERE dx.plan_id = p.id)
    AND s.customer_ledger_id IN (SELECT dx.ledger_id FROM bp_distributor_lines dx WHERE dx.plan_id = p.id))
   OR (NOT EXISTS (SELECT 1 FROM bp_distributor_lines dx WHERE dx.plan_id = p.id)
    AND ${SALE_OWNER} = p.assigned_user_id))`;

// Map product_line_id -> { qty, value, prev_qty, prev_value }
const getProductLineActuals = async (planIds) => {
  const out = new Map();
  if (!planIds.length) return out;
  const query = (range) =>
    db.query(
      `SELECT pl.id, COALESCE(SUM(si.billed_qty), 0) AS qty, COALESCE(SUM(si.amount), 0) AS value
       FROM bp_product_lines pl
       INNER JOIN business_plans p ON p.id = pl.plan_id
       INNER JOIN sales s ON ${range}
       INNER JOIN sales_items si ON si.sale_id = s.id AND si.stock_item_id = pl.stock_item_id
       WHERE pl.plan_id IN (?) AND ${PLAN_SALE_SCOPE} AND ${ACTIVE_SALE}
       GROUP BY pl.id`,
      [planIds],
    );
  const [[cur], [prev]] = await Promise.all([
    query(PLAN_RANGE("s", "sales_date")),
    query(PREV_RANGE("s", "sales_date")),
  ]);
  const cell = (id) => {
    if (!out.has(id)) out.set(id, { qty: 0, value: 0, prev_qty: 0, prev_value: 0 });
    return out.get(id);
  };
  for (const r of cur) Object.assign(cell(r.id), { qty: round(r.qty), value: round(r.value) });
  for (const r of prev) Object.assign(cell(r.id), { prev_qty: round(r.qty), prev_value: round(r.value) });
  return out;
};

// Map bp_distributor_products.id -> { qty, value, prev_qty }   (Matrix)
const getDistributorProductActuals = async (planIds) => {
  const out = new Map();
  if (!planIds.length) return out;
  const query = (range) =>
    db.query(
      `SELECT dp.id, COALESCE(SUM(si.billed_qty), 0) AS qty, COALESCE(SUM(si.amount), 0) AS value
       FROM bp_distributor_products dp
       INNER JOIN bp_distributor_lines d ON d.id = dp.distributor_line_id
       INNER JOIN business_plans p ON p.id = d.plan_id
       INNER JOIN sales s ON s.customer_ledger_id = d.ledger_id AND ${range}
       INNER JOIN sales_items si ON si.sale_id = s.id AND si.stock_item_id = dp.stock_item_id
       WHERE d.plan_id IN (?) AND ${ACTIVE_SALE}
       GROUP BY dp.id`,
      [planIds],
    );
  const [[cur], [prev]] = await Promise.all([
    query(PLAN_RANGE("s", "sales_date")),
    query(PREV_RANGE("s", "sales_date")),
  ]);
  const cell = (id) => {
    if (!out.has(id)) out.set(id, { qty: 0, value: 0, prev_qty: 0 });
    return out.get(id);
  };
  for (const r of cur) Object.assign(cell(r.id), { qty: round(r.qty), value: round(r.value) });
  for (const r of prev) cell(r.id).prev_qty = round(r.qty);
  return out;
};

// Map ledger_id -> outstanding today
const getLedgerOutstanding = async (ledgerIds) => {
  const out = new Map();
  if (!ledgerIds.length) return out;
  const [rows] = await db.query(
    `SELECT sbr.ledger_id, COALESCE(SUM(sbr.pending_amount), 0) AS amount
     FROM sales_bill_references sbr
     WHERE sbr.ledger_id IN (?) AND sbr.pending_amount > 0
       AND ${notCancelled("SALES", "sbr.sale_id")}
     GROUP BY sbr.ledger_id`,
    [ledgerIds],
  );
  for (const r of rows) out.set(r.ledger_id, round(r.amount));
  return out;
};

// ---------------------------------------------------------------------
//  DEVELOPMENT
// ---------------------------------------------------------------------
// new distributor ledgers opened under the employee in the period, and how
// many of them already have a sale (converted)
const getNewDistributorStats = async (userId, from, to) => {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS created,
            COALESCE(SUM(EXISTS (
              SELECT 1 FROM sales s WHERE s.customer_ledger_id = l.id AND ${ACTIVE_SALE}
            )), 0) AS billed
     FROM ledgers l
     INNER JOIN account_groups ag ON ag.id = l.group_id AND ag.group_name = ?
     WHERE l.employee_under = ?
       AND l.created_at >= ? AND l.created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [DEBTOR_GROUP, userId, from, to],
  );
  const row = rows[0] || {};
  return { created: num(row.created), billed: num(row.billed) };
};

// ---------------------------------------------------------------------
//  COMBINED FIGURES WITHOUT DOUBLE COUNTING (D2)
//  Each plan is measured in its own dates. When several plans are added together
//  (dashboard, employee totals, quarter target sheets) an invoice or a receipt line that
//  falls in two plans (overlapping seasons, same distributor) is counted ONCE.
//  planIds: the plans; from / to (optional): limit to these dates as well.
// ---------------------------------------------------------------------
const IN_SOME_PLAN_SALE = `EXISTS (
    SELECT 1 FROM business_plans p
    WHERE p.id IN (?) AND ${PLAN_RANGE("s", "sales_date")} AND ${PLAN_SALE_SCOPE})`;

const PLAN_RECEIPT_SCOPE = `
  ((EXISTS (SELECT 1 FROM bp_distributor_lines dx WHERE dx.plan_id = p.id)
    AND re.ledger_id IN (SELECT dx.ledger_id FROM bp_distributor_lines dx WHERE dx.plan_id = p.id))
   OR (NOT EXISTS (SELECT 1 FROM bp_distributor_lines dx WHERE dx.plan_id = p.id)
    AND r.employee_under_id = p.assigned_user_id))`;

const IN_SOME_PLAN_RECEIPT = `EXISTS (
    SELECT 1 FROM business_plans p
    WHERE p.id IN (?) AND ${PLAN_RANGE("r", "receipt_date")} AND ${PLAN_RECEIPT_SCOPE})`;

const dateWindow = (alias, col, from, to) =>
  from && to ? { sql: ` AND ${alias}.${col} >= ? AND ${alias}.${col} < DATE_ADD(?, INTERVAL 1 DAY)`, params: [from, to] } : { sql: "", params: [] };

// { sales, collection } for a set of plans, each invoice / receipt line counted once
const getCombinedTotals = async (planIds, { from = null, to = null } = {}) => {
  if (!planIds.length) return { sales: 0, collection: 0 };
  const ws = dateWindow("s", "sales_date", from, to);
  const wr = dateWindow("r", "receipt_date", from, to);
  const [[[sales]], [[coll]]] = await Promise.all([
    db.query(
      `SELECT COALESCE(SUM(s.subtotal), 0) AS amount FROM sales s
       WHERE ${ACTIVE_SALE}${ws.sql} AND ${IN_SOME_PLAN_SALE}`,
      [...ws.params, planIds],
    ),
    db.query(
      `SELECT COALESCE(SUM(re.amount), 0) AS amount
       FROM receipt_entries re INNER JOIN receipts r ON r.id = re.receipt_id
       WHERE ${ACTIVE_RECEIPT}${wr.sql} AND ${IN_SOME_PLAN_RECEIPT}`,
      [...wr.params, planIds],
    ),
  ]);
  return { sales: round(sales && sales.amount), collection: round(coll && coll.amount) };
};

// Map YYYY-MM -> { sales, collection, old_recovery, current_collection } for a set of plans
// between from and to, each invoice / receipt line counted once.
//   old_recovery = receipt amounts ALLOCATED (bill-wise) against sales bills dated before
//                  oldBillsBefore (1 April of the financial year). Unallocated / on-account /
//                  advance receipts are never old recovery.
//   current_collection = collection - old_recovery
const getCombinedMonthly = async (planIds, from, to, oldBillsBefore) => {
  const out = new Map();
  if (!planIds.length) return out;
  const cell = (k) => {
    if (!out.has(k)) out.set(k, { sales: 0, collection: 0, old_recovery: 0, current_collection: 0 });
    return out.get(k);
  };
  const [[sales], [coll], [old]] = await Promise.all([
    db.query(
      `SELECT DATE_FORMAT(s.sales_date, '%Y-%m') AS ym, COALESCE(SUM(s.subtotal), 0) AS amount
       FROM sales s
       WHERE ${ACTIVE_SALE} AND s.sales_date >= ? AND s.sales_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND ${IN_SOME_PLAN_SALE}
       GROUP BY ym`,
      [from, to, planIds],
    ),
    db.query(
      `SELECT DATE_FORMAT(r.receipt_date, '%Y-%m') AS ym, COALESCE(SUM(re.amount), 0) AS amount
       FROM receipt_entries re INNER JOIN receipts r ON r.id = re.receipt_id
       WHERE ${ACTIVE_RECEIPT} AND r.receipt_date >= ? AND r.receipt_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND ${IN_SOME_PLAN_RECEIPT}
       GROUP BY ym`,
      [from, to, planIds],
    ),
    db.query(
      `SELECT DATE_FORMAT(r.receipt_date, '%Y-%m') AS ym, COALESCE(SUM(rbr.reference_amount), 0) AS amount
       FROM receipt_bill_references rbr
       INNER JOIN receipt_entries re ON re.id = rbr.receipt_entry_id
       INNER JOIN receipts r ON r.id = re.receipt_id
       INNER JOIN sales_bill_references sbr ON sbr.id = rbr.sales_bill_reference_id
       INNER JOIN sales so ON so.id = sbr.sale_id
       WHERE ${ACTIVE_RECEIPT} AND r.receipt_date >= ? AND r.receipt_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND so.sales_date < ?
         AND ${IN_SOME_PLAN_RECEIPT}
       GROUP BY ym`,
      [from, to, oldBillsBefore, planIds],
    ),
  ]);
  for (const r of sales) cell(r.ym).sales = round(r.amount);
  for (const r of coll) cell(r.ym).collection = round(r.amount);
  for (const r of old) cell(r.ym).old_recovery = round(r.amount);
  for (const v of out.values()) v.current_collection = round(v.collection - Math.min(v.old_recovery, v.collection));
  return out;
};

// ---------------------------------------------------------------------
//  EMPLOYEE ACTIVITY (verified records)
// ---------------------------------------------------------------------
// Map YYYY-MM -> { new_distributors, new_retailers, distributor_visits, retailer_visits, farmer_visits }
//   new active distributor = Sundry Debtors ledger under the employee whose FIRST invoice is in the month
//   new retailer           = customers row of type 'retailer' created by the employee in the month
//   visits                 = visits records of the employee by visit_type (distributor / retailer / farmer)
const getEmployeeActivityMonthly = async (userId, from, to) => {
  const out = new Map();
  const cell = (k) => {
    if (!out.has(k)) out.set(k, { new_distributors: 0, new_retailers: 0, distributor_visits: 0, retailer_visits: 0, farmer_visits: 0 });
    return out.get(k);
  };
  const [[firsts], [retailers], [visits]] = await Promise.all([
    db.query(
      `SELECT DATE_FORMAT(x.first_date, '%Y-%m') AS ym, COUNT(*) AS c
       FROM (
         SELECT s.customer_ledger_id, MIN(s.sales_date) AS first_date
         FROM sales s
         INNER JOIN ledgers l ON l.id = s.customer_ledger_id
         INNER JOIN account_groups ag ON ag.id = l.group_id AND ag.group_name = ?
         WHERE l.employee_under = ? AND ${ACTIVE_SALE}
         GROUP BY s.customer_ledger_id
       ) x
       WHERE x.first_date >= ? AND x.first_date < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY ym`,
      [DEBTOR_GROUP, userId, from, to],
    ),
    db.query(
      `SELECT DATE_FORMAT(c.created_at, '%Y-%m') AS ym, COUNT(*) AS c
       FROM customers c
       WHERE c.type = 'retailer' AND c.created_by = ?
         AND c.created_at >= ? AND c.created_at < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY ym`,
      [userId, from, to],
    ),
    db.query(
      `SELECT DATE_FORMAT(COALESCE(v.visit_start_time, v.created_at), '%Y-%m') AS ym, v.visit_type, COUNT(*) AS c
       FROM visits v
       WHERE v.user_id = ?
         AND COALESCE(v.visit_start_time, v.created_at) >= ?
         AND COALESCE(v.visit_start_time, v.created_at) < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY ym, v.visit_type`,
      [userId, from, to],
    ),
  ]);
  for (const r of firsts) cell(r.ym).new_distributors = num(r.c);
  for (const r of retailers) cell(r.ym).new_retailers = num(r.c);
  for (const r of visits) {
    const t = String(r.visit_type || "").toLowerCase();
    const k = t === "distributor" ? "distributor_visits" : t === "retailer" ? "retailer_visits" : t === "farmer" ? "farmer_visits" : null;
    if (k) cell(r.ym)[k] += num(r.c);
  }
  return out;
};

// Territory status of an employee at the start of a financial year (target sheet section 2)
//   previous_year_sales   = invoices (net) of his distributors in the previous financial year
//   active_distributors   = his distributors with an invoice in the previous financial year
//   active_retailers      = retailers assigned to him or created by him
//   old_outstanding       = pending amount today of his distributors' bills dated before fyStart
const getTerritoryStatus = async (userId, fyStart) => {
  const prevStart = minusYear(fyStart);
  const [[[prev]], [[ret]], [[out]]] = await Promise.all([
    db.query(
      `SELECT COALESCE(SUM(s.subtotal), 0) AS sales, COUNT(DISTINCT s.customer_ledger_id) AS parties
       FROM sales s
       INNER JOIN ledgers l ON l.id = s.customer_ledger_id
       WHERE l.employee_under = ? AND s.sales_date >= ? AND s.sales_date < ? AND ${ACTIVE_SALE}`,
      [userId, prevStart, fyStart],
    ),
    db.query(
      `SELECT COUNT(*) AS c FROM customers c
       WHERE c.type = 'retailer'
         AND (c.created_by = ? OR EXISTS (SELECT 1 FROM retailer_assignments ra WHERE ra.retailer_id = c.id AND ra.employee_id = ?))`,
      [userId, userId],
    ).catch(() => [[{ c: 0 }]]),
    db.query(
      `SELECT COALESCE(SUM(sbr.pending_amount), 0) AS amount
       FROM sales_bill_references sbr
       INNER JOIN sales so ON so.id = sbr.sale_id
       INNER JOIN ledgers l ON l.id = sbr.ledger_id
       WHERE l.employee_under = ? AND sbr.pending_amount > 0 AND so.sales_date < ?
         AND ${notCancelled("SALES", "sbr.sale_id")}`,
      [userId, fyStart],
    ),
  ]);
  return {
    previous_year_sales: round(prev && prev.sales),
    active_distributors: num(prev && prev.parties),
    active_retailers: num(ret && ret.c),
    old_outstanding: round(out && out.amount),
  };
};

module.exports = {
  ACTIVE_SALE,
  ACTIVE_RECEIPT,
  SALE_OWNER,
  minusYear,
  round,
  getPlanTotals,
  getLedgerActuals,
  getLedgerPreviousSales,
  getProductActuals,
  getLedgerProductActuals,
  getLedgerMonthly,
  getEmployeeMonthly,
  getNewDistributorStats,
  getDistributorLineActuals,
  getProductLineActuals,
  getDistributorProductActuals,
  getLedgerOutstanding,
  getCombinedTotals,
  getCombinedMonthly,
  getEmployeeActivityMonthly,
  getTerritoryStatus,
};
