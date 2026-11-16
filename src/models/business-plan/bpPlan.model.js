// Business Plan: plan header, lines, monthly targets, corrective actions, activity.
const db = require("../../config/db");

const STATUS_LABEL = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under Review",
  ACTIVE: "Active",
  REJECTED: "Rejected",
  CLOSED: "Closed",
};

const APPROVAL_ACTIONS = ["SUBMITTED", "LEVEL_APPROVED", "APPROVED", "REJECTED", "RETURNED", "REOPENED", "CLOSED"];

const num = (v) => Number(v) || 0;

// bpTargets.model requires this file: load it lazily (no circular import at start-up)
const targets = () => require("./bpTargets.model");

// a plan being revised: its last approved targets stay official until the revision is approved
const REVISION_OPEN = "IN_REVISION";
const LIVE_STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACTIVE"];

// ---------------------------------------------------------------------
//  PLAN HEADER
// ---------------------------------------------------------------------
const PLAN_SELECT = `
  SELECT p.id, p.plan_code, p.name, p.financial_year, p.season,
         DATE_FORMAT(p.start_date, '%Y-%m-%d') AS start_date,
         DATE_FORMAT(p.end_date, '%Y-%m-%d') AS end_date,
         p.state_id, gs.state_name, p.territory_id, t.name AS territory_name,
         p.assigned_user_id, au.name AS assigned_user_name, jr.name AS assigned_job_role,
         au.reporting_under AS reporting_manager_id, rm.name AS reporting_manager_name,
         p.plan_type, p.status, p.sales_target, p.collection_target,
         p.annual_sales_target, p.annual_collection_target, p.abs_booking_target, p.abs_advance_target,
         p.revision_no, p.revision_status, p.approved_sales_target, p.approved_collection_target,
         p.new_distributor_target, p.new_retailer_target, p.retailer_contacted,
         p.retailer_qualified, p.retailer_onboarded, p.retailer_ordered,
         p.retailer_expected_business,
         p.approver_id, ap.name AS approver_name,
         DATE_FORMAT(p.submitted_at, '%Y-%m-%d %H:%i:%s') AS submitted_at,
         p.decided_by, dc.name AS decided_by_name,
         DATE_FORMAT(p.decided_at, '%Y-%m-%d %H:%i:%s') AS decided_at,
         p.decision_remark, p.created_by, cb.name AS created_by_name,
         DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
         DATE_FORMAT(p.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
         (SELECT COUNT(*) FROM bp_distributor_lines d WHERE d.plan_id = p.id) AS distributor_count,
         (SELECT COUNT(*) FROM bp_retailer_lines r WHERE r.plan_id = p.id) AS retailer_count,
         (SELECT COUNT(*) FROM bp_product_lines pl WHERE pl.plan_id = p.id) AS product_count,
         (SELECT st.level_no FROM bp_approval_steps st
           WHERE st.entity_type = 'PLAN' AND st.entity_id = p.id AND st.status = 'PENDING'
           ORDER BY st.round_no DESC LIMIT 1) AS pending_level,
         (SELECT COALESCE(su.name, 'Admin / Super Admin') FROM bp_approval_steps st
           LEFT JOIN users su ON su.id = st.approver_id
           WHERE st.entity_type = 'PLAN' AND st.entity_id = p.id AND st.status = 'PENDING'
           ORDER BY st.round_no DESC LIMIT 1) AS pending_with
  FROM business_plans p
  LEFT JOIN geo_states gs ON gs.id = p.state_id
  LEFT JOIN bp_territories t ON t.id = p.territory_id
  LEFT JOIN users au ON au.id = p.assigned_user_id
  LEFT JOIN job_roles jr ON jr.id = au.job_role_id
  LEFT JOIN users rm ON rm.id = au.reporting_under
  LEFT JOIN users ap ON ap.id = p.approver_id
  LEFT JOIN users dc ON dc.id = p.decided_by
  LEFT JOIN users cb ON cb.id = p.created_by`;

const SORT_COLUMNS = {
  created_at: "p.created_at",
  updated_at: "p.updated_at",
  name: "p.name",
  plan_code: "p.plan_code",
  start_date: "p.start_date",
  end_date: "p.end_date",
  sales_target: "p.sales_target",
  collection_target: "p.collection_target",
  status: "p.status",
  financial_year: "p.financial_year",
};

// sales_target / collection_target = the OFFICIAL plan targets (analytics, sheets);
// proposed_* = the working values of the lines (differ only while a revision is open)
const shapePlan = (r) => {
  const inRevision = r.revision_status === REVISION_OPEN && r.approved_sales_target !== null && r.approved_sales_target !== undefined;
  return {
  ...r,
  status_label: inRevision ? `${STATUS_LABEL[r.status] || r.status} (revision)` : STATUS_LABEL[r.status] || r.status,
  in_revision: inRevision,
  revision_no: num(r.revision_no),
  revision_status: r.revision_status || "NONE",
  sales_target: inRevision ? num(r.approved_sales_target) : num(r.sales_target),
  collection_target: inRevision ? num(r.approved_collection_target) : num(r.collection_target),
  proposed_sales_target: num(r.sales_target),
  proposed_collection_target: num(r.collection_target),
  annual_sales_target: num(r.annual_sales_target),
  annual_collection_target: num(r.annual_collection_target),
  abs_booking_target: num(r.abs_booking_target),
  abs_advance_target: num(r.abs_advance_target),
  approved_sales_target: r.approved_sales_target === null || r.approved_sales_target === undefined ? null : num(r.approved_sales_target),
  approved_collection_target: r.approved_collection_target === null || r.approved_collection_target === undefined ? null : num(r.approved_collection_target),
  retailer_expected_business: num(r.retailer_expected_business),
  distributor_count: num(r.distributor_count),
  retailer_count: num(r.retailer_count),
  product_count: num(r.product_count),
  pending_level: r.pending_level === null || r.pending_level === undefined ? null : num(r.pending_level),
  pending_with: r.pending_with || null,
  };
};

// filters: { userIds, search, status, financial_year, season, state_id, territory_id,
//            assigned_user_id, product_id, active_on }
const buildPlanWhere = (f) => {
  const where = ["p.is_deleted = 0"];
  const params = [];
  if (f.userIds) {
    where.push("(p.assigned_user_id IN (?) OR p.created_by IN (?))");
    params.push(f.userIds, f.userIds);
  }
  if (f.search) {
    where.push("(p.name LIKE ? OR p.plan_code LIKE ? OR au.name LIKE ? OR t.name LIKE ?)");
    const s = `%${f.search}%`;
    params.push(s, s, s, s);
  }
  if (f.status && f.status.length) {
    // 'ACTIVE' also covers an approved plan whose revision is open (its approved targets
    // stay in force until the revision is approved)
    if (f.status.includes("ACTIVE")) {
      where.push(`(p.status IN (?) OR (p.revision_status = '${REVISION_OPEN}' AND p.status IN ('UNDER_REVIEW', 'SUBMITTED')))`);
    } else {
      where.push("p.status IN (?)");
    }
    params.push(f.status);
  }
  for (const [key, col] of [
    ["financial_year", "p.financial_year"],
    ["season", "p.season"],
    ["state_id", "p.state_id"],
    ["territory_id", "p.territory_id"],
    ["assigned_user_id", "p.assigned_user_id"],
  ]) {
    if (f[key] !== undefined && f[key] !== null && f[key] !== "") {
      where.push(`${col} = ?`);
      params.push(f[key]);
    }
  }
  if (f.product_id) {
    where.push(`(EXISTS (SELECT 1 FROM bp_product_lines pl WHERE pl.plan_id = p.id AND pl.stock_item_id = ?)
                 OR EXISTS (SELECT 1 FROM bp_distributor_lines d
                            INNER JOIN bp_distributor_products dp ON dp.distributor_line_id = d.id
                            WHERE d.plan_id = p.id AND dp.stock_item_id = ?))`);
    params.push(f.product_id, f.product_id);
  }
  // only these plans (e.g. "pending my approval" from the approval steps)
  if (Array.isArray(f.ids)) {
    where.push("p.id IN (?)");
    params.push(f.ids.length ? f.ids : [0]);
  }
  // "pending my approval": submitted plans that are neither mine nor created by me
  if (f.exclude_user_id) {
    where.push("p.assigned_user_id <> ? AND p.created_by <> ?");
    params.push(f.exclude_user_id, f.exclude_user_id);
  }
  if (f.active_on) {
    where.push("p.start_date <= ? AND p.end_date >= ?");
    params.push(f.active_on, f.active_on);
  }
  return { sql: where.join(" AND "), params };
};

const listPlans = async (filters, { page = 1, limit = 20, sortBy = "created_at", sortDir = "desc" } = {}) => {
  const w = buildPlanWhere(filters);
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const pg = Math.max(Number(page) || 1, 1);
  const order = `${SORT_COLUMNS[sortBy] || "p.created_at"} ${String(sortDir).toLowerCase() === "asc" ? "ASC" : "DESC"}, p.id DESC`;

  const [rows] = await db.query(
    `${PLAN_SELECT} WHERE ${w.sql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...w.params, lim, (pg - 1) * lim],
  );
  const [countRows] = await db.query(
    `SELECT COUNT(*) AS c
     FROM business_plans p
     LEFT JOIN users au ON au.id = p.assigned_user_id
     LEFT JOIN bp_territories t ON t.id = p.territory_id
     WHERE ${w.sql}`,
    w.params,
  );
  const total = num(countRows[0] && countRows[0].c);
  return { items: rows.map(shapePlan), total, page: pg, limit: lim, totalPages: Math.max(Math.ceil(total / lim), 1) };
};

// every matching plan (analytics); capped for safety
const listAllPlans = async (filters, cap = 2000) => {
  const w = buildPlanWhere(filters);
  const [rows] = await db.query(
    `${PLAN_SELECT} WHERE ${w.sql} ORDER BY p.start_date DESC, p.id DESC LIMIT ?`,
    [...w.params, cap],
  );
  return rows.map(shapePlan);
};

const getPlan = async (id) => {
  const [rows] = await db.query(`${PLAN_SELECT} WHERE p.id = ? AND p.is_deleted = 0`, [id]);
  return rows[0] ? shapePlan(rows[0]) : null;
};

// lock the row and return its current status (inside a transaction)
const lockPlan = async (conn, id) => {
  const [[row]] = await conn.query(
    `SELECT id, status, assigned_user_id, created_by FROM business_plans
     WHERE id = ? AND is_deleted = 0 FOR UPDATE`,
    [id],
  );
  return row || null;
};

// "Rajasthan" -> RAJ, "Madhya Pradesh" -> MP
const stateCode = (stateName) => {
  const words = String(stateName || "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "GEN";
  if (words.length === 1) return words[0].slice(0, 3);
  return words.map((w) => w[0]).join("").slice(0, 4);
};

const nextPlanCode = async (conn, prefix) => {
  const [[last]] = await conn.query(
    `SELECT plan_code FROM business_plans WHERE plan_code LIKE ? ORDER BY plan_code DESC LIMIT 1 FOR UPDATE`,
    [`${prefix}%`],
  );
  const lastNo = last ? Number(String(last.plan_code).slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(lastNo + 1).padStart(4, "0")}`;
};

const addActivity = (runner, { planId, action, fromStatus = null, toStatus = null, remark = null, detail = null, userId }) =>
  runner.query(
    `INSERT INTO bp_plan_activity (plan_id, action, from_status, to_status, remark, detail, acted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [planId, action, fromStatus, toStatus, remark, detail ? String(detail).slice(0, 500) : null, userId],
  );

// data: validated header fields. Returns the new id.
const createPlan = async (data, userId, codePrefix) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const code = await nextPlanCode(conn, codePrefix);
      const [res] = await conn.query(
        `INSERT INTO business_plans
           (plan_code, name, financial_year, season, start_date, end_date, state_id, territory_id,
            assigned_user_id, plan_type, status, created_by, abs_booking_target, abs_advance_target)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)`,
        [
          code, data.name, data.financial_year, data.season, data.start_date, data.end_date,
          data.state_id, data.territory_id, data.assigned_user_id, data.plan_type, userId,
          data.abs_booking_target || 0, data.abs_advance_target || 0,
        ],
      );
      await addActivity(conn, {
        planId: res.insertId,
        action: "PLAN_CREATED",
        toStatus: "DRAFT",
        detail: code,
        userId,
      });
      await conn.commit();
      return res.insertId;
    } catch (err) {
      await conn.rollback();
      if (err && err.code === "ER_DUP_ENTRY" && attempt < 2) continue;
      throw err;
    } finally {
      conn.release();
    }
  }
  throw new Error("Could not generate a plan code");
};

const HEADER_FIELDS = [
  "name", "financial_year", "season", "start_date", "end_date",
  "state_id", "territory_id", "assigned_user_id", "plan_type",
  "abs_booking_target", "abs_advance_target",
];

const updatePlanHeader = async (id, data, userId) => {
  const keys = HEADER_FIELDS.filter((k) => data[k] !== undefined);
  if (!keys.length) return;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE business_plans SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
      [...keys.map((k) => data[k]), id],
    );
    // the dates decide the season targets (D1)
    if (keys.includes("start_date") || keys.includes("end_date")) await targets().recalcTotals(conn, id);
    await addActivity(conn, { planId: id, action: "PLAN_UPDATED", detail: keys.join(", "), userId });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// another live plan (Draft / Submitted / Under Review / Active) of the same employee for the
// same financial year and season
const findLivePlan = async ({ assignedUserId, financialYear, season, excludeId = 0 }) => {
  const [rows] = await db.query(
    `SELECT id, plan_code, status FROM business_plans
     WHERE assigned_user_id = ? AND financial_year = ? AND season = ? AND is_deleted = 0
       AND status IN (?) AND id <> ?
     ORDER BY id LIMIT 1`,
    [assignedUserId, financialYear, season, LIVE_STATUSES, excludeId || 0],
  );
  return rows[0] || null;
};

// distributors of this plan that are also in another plan of the same employee with
// overlapping dates (a warning; seasonal plans may legitimately share distributors)
const findOverlaps = async (planId) => {
  const [rows] = await db.query(
    `SELECT da.ledger_id, l.ledger_name AS distributor, o.id AS other_plan_id, o.plan_code AS other_plan_code,
            o.season AS other_season, o.status AS other_status,
            DATE_FORMAT(o.start_date, '%Y-%m-%d') AS other_start_date, DATE_FORMAT(o.end_date, '%Y-%m-%d') AS other_end_date
     FROM business_plans p
     INNER JOIN bp_distributor_lines da ON da.plan_id = p.id
     INNER JOIN business_plans o ON o.assigned_user_id = p.assigned_user_id AND o.id <> p.id AND o.is_deleted = 0
          AND o.status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACTIVE', 'CLOSED')
          AND o.start_date <= p.end_date AND o.end_date >= p.start_date
     INNER JOIN bp_distributor_lines db2 ON db2.plan_id = o.id AND db2.ledger_id = da.ledger_id
     LEFT JOIN ledgers l ON l.id = da.ledger_id
     WHERE p.id = ?
     ORDER BY l.ledger_name, o.id`,
    [planId],
  );
  return rows;
};

const DEVELOPMENT_FIELDS = [
  "new_distributor_target", "new_retailer_target", "retailer_contacted", "retailer_qualified",
  "retailer_onboarded", "retailer_ordered", "retailer_expected_business",
];

const updateDevelopment = async (id, data, userId) => {
  const keys = DEVELOPMENT_FIELDS.filter((k) => data[k] !== undefined);
  if (!keys.length) return;
  await db.query(
    `UPDATE business_plans SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
    [...keys.map((k) => data[k]), id],
  );
  await addActivity(db, { planId: id, action: "DEVELOPMENT_UPDATED", detail: keys.join(", "), userId });
};

const softDeletePlan = async (id, userId) => {
  await db.query(`UPDATE business_plans SET is_deleted = 1 WHERE id = ?`, [id]);
  await addActivity(db, { planId: id, action: "PLAN_DELETED", userId });
};

// Status change inside one transaction. allowedFrom: statuses that may move.
// Returns { ok, from } or { ok: false, current }.
// extra(conn, row): runs inside the same transaction before commit (approval steps);
// throwing from it rolls the status change back. Its return value is passed back as `extra`.
// nextApproverId: sets approver_id (the approver of the current level)
// extraSets: [[ "column = ?", value ], ...] written in the same UPDATE
const changeStatus = async (id, { allowedFrom, to, action, remark, detail = null, userId, approverId, decision, extra, nextApproverId, extraSets = [] }) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const row = await lockPlan(conn, id);
    if (!row) {
      await conn.rollback();
      return { ok: false, current: null };
    }
    if (!allowedFrom.includes(row.status)) {
      await conn.rollback();
      return { ok: false, current: row.status };
    }

    const sets = ["status = ?"];
    const params = [to];
    if (action === "SUBMITTED") {
      sets.push("submitted_at = NOW()", "approver_id = ?", "decided_by = NULL", "decided_at = NULL", "decision_remark = NULL");
      params.push(approverId || null);
    }
    if (decision) {
      sets.push("decided_by = ?", "decided_at = NOW()", "decision_remark = ?");
      params.push(userId, remark || null);
    }
    if (nextApproverId !== undefined) {
      sets.push("approver_id = ?");
      params.push(nextApproverId);
    }
    for (const [sql, value] of extraSets) {
      sets.push(sql);
      if (value !== undefined) params.push(value);
    }
    params.push(id);
    await conn.query(`UPDATE business_plans SET ${sets.join(", ")} WHERE id = ?`, params);
    const extraResult = extra ? await extra(conn, row) : undefined;
    await addActivity(conn, { planId: id, action, fromStatus: row.status, toStatus: to, remark, detail, userId });
    await conn.commit();
    return { ok: true, from: row.status, extra: extraResult };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// plan target = distributor SEASON targets; else product value targets; else retailer targets
// (rule in bpTargets.model.planTotals, D1)
const recalcTotals = (runner, planId) => targets().recalcTotals(runner, planId);

const countLines = async (planId) => {
  const [[r]] = await db.query(
    `SELECT (SELECT COUNT(*) FROM bp_distributor_lines WHERE plan_id = ?)
          + (SELECT COUNT(*) FROM bp_retailer_lines WHERE plan_id = ?)
          + (SELECT COUNT(*) FROM bp_product_lines WHERE plan_id = ?) AS c`,
    [planId, planId, planId],
  );
  return num(r.c);
};

// ---------------------------------------------------------------------
//  DISTRIBUTOR LINES (+ product planning)
// ---------------------------------------------------------------------
const listDistributorLines = async (planId) => {
  const [lines] = await db.query(
    `SELECT d.id, d.plan_id, d.ledger_id, l.ledger_name AS name, l.location,
            gd.district_name_english AS district,
            d.annual_target, d.seasonal_target, d.collection_target, d.seasonal_collection_target,
            d.max_outstanding, d.expected_collection, d.previous_year_sales, d.growth_percent
     FROM bp_distributor_lines d
     LEFT JOIN ledgers l ON l.id = d.ledger_id
     LEFT JOIN geo_districts gd ON gd.id = l.district_id
     WHERE d.plan_id = ?
     ORDER BY l.ledger_name ASC`,
    [planId],
  );
  if (!lines.length) return [];
  const [products] = await db.query(
    `SELECT dp.id, dp.distributor_line_id, dp.stock_item_id, si.item_name AS name,
            sc.name AS category, dp.planned_qty, dp.planned_value
     FROM bp_distributor_products dp
     LEFT JOIN stock_items si ON si.id = dp.stock_item_id
     LEFT JOIN stock_categories sc ON sc.id = si.stock_category_id
     WHERE dp.distributor_line_id IN (?)
     ORDER BY si.item_name ASC`,
    [lines.map((l) => l.id)],
  );
  const byLine = new Map();
  for (const p of products) {
    if (!byLine.has(p.distributor_line_id)) byLine.set(p.distributor_line_id, []);
    byLine.get(p.distributor_line_id).push({
      id: p.id,
      stock_item_id: p.stock_item_id,
      name: p.name,
      category: p.category,
      planned_qty: num(p.planned_qty),
      planned_value: num(p.planned_value),
    });
  }
  return lines.map((l) => ({
    ...l,
    annual_target: num(l.annual_target),
    seasonal_target: num(l.seasonal_target),
    collection_target: num(l.collection_target),
    annual_collection_target: num(l.collection_target),
    seasonal_collection_target: num(l.seasonal_collection_target),
    max_outstanding: num(l.max_outstanding),
    expected_collection: num(l.expected_collection),
    previous_year_sales: num(l.previous_year_sales),
    growth_percent: l.growth_percent === null ? null : num(l.growth_percent),
    products: byLine.get(l.id) || [],
  }));
};

const getDistributorLine = async (planId, lineId) => {
  const [rows] = await db.query(
    `SELECT d.*, l.ledger_name AS name FROM bp_distributor_lines d
     LEFT JOIN ledgers l ON l.id = d.ledger_id
     WHERE d.plan_id = ? AND d.id = ?`,
    [planId, lineId],
  );
  return rows[0] || null;
};

const findDistributorLine = async (planId, ledgerId) => {
  const [rows] = await db.query(
    `SELECT id FROM bp_distributor_lines WHERE plan_id = ? AND ledger_id = ?`,
    [planId, ledgerId],
  );
  return rows[0] || null;
};

const DIST_FIELDS = [
  "annual_target", "seasonal_target", "collection_target", "seasonal_collection_target", "max_outstanding",
  "expected_collection", "previous_year_sales", "growth_percent",
];

// data: { ledger_id?, ...DIST_FIELDS, products?: [{stock_item_id, planned_qty, planned_value}] }
const saveDistributorLine = async (planId, lineId, data, userId, label) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let id = lineId;
    if (lineId) {
      const keys = DIST_FIELDS.filter((k) => data[k] !== undefined);
      if (keys.length) {
        await conn.query(
          `UPDATE bp_distributor_lines SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND plan_id = ?`,
          [...keys.map((k) => data[k]), lineId, planId],
        );
      }
    } else {
      const [res] = await conn.query(
        `INSERT INTO bp_distributor_lines
           (plan_id, ledger_id, annual_target, seasonal_target, collection_target, seasonal_collection_target,
            max_outstanding, expected_collection, previous_year_sales, growth_percent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          planId, data.ledger_id, data.annual_target || 0, data.seasonal_target || 0,
          data.collection_target || 0, data.seasonal_collection_target || 0, data.max_outstanding || 0, data.expected_collection || 0,
          data.previous_year_sales || 0, data.growth_percent === undefined ? null : data.growth_percent,
        ],
      );
      id = res.insertId;
    }
    if (Array.isArray(data.products)) {
      await conn.query(`DELETE FROM bp_distributor_products WHERE distributor_line_id = ?`, [id]);
      if (data.products.length) {
        await conn.query(
          `INSERT INTO bp_distributor_products (distributor_line_id, stock_item_id, planned_qty, planned_value) VALUES ?`,
          [data.products.map((p) => [id, p.stock_item_id, p.planned_qty || 0, p.planned_value || 0])],
        );
      }
    }
    await recalcTotals(conn, planId);
    await addActivity(conn, {
      planId,
      action: lineId ? "DISTRIBUTOR_UPDATED" : "DISTRIBUTOR_ADDED",
      detail: label,
      userId,
    });
    await conn.commit();
    return id;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const deleteDistributorLine = async (planId, lineId, userId, label) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM bp_monthly_targets WHERE plan_id = ? AND distributor_line_id = ?`, [planId, lineId]);
    await conn.query(
      `UPDATE bp_corrective_actions SET distributor_line_id = NULL WHERE plan_id = ? AND distributor_line_id = ?`,
      [planId, lineId],
    );
    await conn.query(`DELETE FROM bp_distributor_lines WHERE id = ? AND plan_id = ?`, [lineId, planId]);
    await recalcTotals(conn, planId);
    await addActivity(conn, { planId, action: "DISTRIBUTOR_REMOVED", detail: label, userId });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ---------------------------------------------------------------------
//  RETAILER LINES
// ---------------------------------------------------------------------
const listRetailerLines = async (planId) => {
  const [rows] = await db.query(
    `SELECT r.id, r.plan_id, r.retailer_id, COALESCE(NULLIF(c.firm_name, ''), c.name) AS name,
            c.contact_number, c.area, c.district,
            r.parent_ledger_id, l.ledger_name AS parent_distributor,
            r.category, r.sales_target, r.visit_frequency, r.previous_business,
            r.reported_actual, r.growth_percent
     FROM bp_retailer_lines r
     LEFT JOIN customers c ON c.id = r.retailer_id
     LEFT JOIN ledgers l ON l.id = r.parent_ledger_id
     WHERE r.plan_id = ?
     ORDER BY name ASC`,
    [planId],
  );
  return rows.map((r) => ({
    ...r,
    sales_target: num(r.sales_target),
    previous_business: num(r.previous_business),
    reported_actual: num(r.reported_actual),
    growth_percent: r.growth_percent === null ? null : num(r.growth_percent),
  }));
};

const getRetailerLine = async (planId, lineId) => {
  const [rows] = await db.query(
    `SELECT r.*, COALESCE(NULLIF(c.firm_name, ''), c.name) AS name
     FROM bp_retailer_lines r LEFT JOIN customers c ON c.id = r.retailer_id
     WHERE r.plan_id = ? AND r.id = ?`,
    [planId, lineId],
  );
  return rows[0] || null;
};

const findRetailerLine = async (planId, retailerId) => {
  const [rows] = await db.query(
    `SELECT id FROM bp_retailer_lines WHERE plan_id = ? AND retailer_id = ?`,
    [planId, retailerId],
  );
  return rows[0] || null;
};

const RET_FIELDS = [
  "parent_ledger_id", "category", "sales_target", "visit_frequency",
  "previous_business", "reported_actual", "growth_percent",
];

const saveRetailerLine = async (planId, lineId, data, userId, label) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let id = lineId;
    if (lineId) {
      const keys = RET_FIELDS.filter((k) => data[k] !== undefined);
      if (keys.length) {
        await conn.query(
          `UPDATE bp_retailer_lines SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND plan_id = ?`,
          [...keys.map((k) => data[k]), lineId, planId],
        );
      }
    } else {
      const [res] = await conn.query(
        `INSERT INTO bp_retailer_lines
           (plan_id, retailer_id, parent_ledger_id, category, sales_target, visit_frequency,
            previous_business, reported_actual, growth_percent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          planId, data.retailer_id, data.parent_ledger_id || null, data.category || "C",
          data.sales_target || 0, data.visit_frequency || "WEEKLY", data.previous_business || 0,
          data.reported_actual || 0, data.growth_percent === undefined ? null : data.growth_percent,
        ],
      );
      id = res.insertId;
    }
    await recalcTotals(conn, planId);
    await addActivity(conn, {
      planId,
      action: lineId ? "RETAILER_UPDATED" : "RETAILER_ADDED",
      detail: label,
      userId,
    });
    await conn.commit();
    return id;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const deleteRetailerLine = async (planId, lineId, userId, label) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM bp_retailer_lines WHERE id = ? AND plan_id = ?`, [lineId, planId]);
    await recalcTotals(conn, planId);
    await addActivity(conn, { planId, action: "RETAILER_REMOVED", detail: label, userId });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ---------------------------------------------------------------------
//  PRODUCT LINES (+ state allocation)
// ---------------------------------------------------------------------
const listProductLines = async (planId) => {
  const [lines] = await db.query(
    `SELECT pl.id, pl.plan_id, pl.stock_item_id, si.item_name AS name, sc.name AS category,
            cr.crop_name, pl.qty_target, pl.value_target, pl.prev_year_qty, pl.prev_year_value
     FROM bp_product_lines pl
     LEFT JOIN stock_items si ON si.id = pl.stock_item_id
     LEFT JOIN stock_categories sc ON sc.id = si.stock_category_id
     LEFT JOIN crops cr ON cr.id = si.crop_id
     WHERE pl.plan_id = ?
     ORDER BY si.item_name ASC`,
    [planId],
  );
  if (!lines.length) return [];
  const [allocs] = await db.query(
    `SELECT a.product_line_id, a.state_id, gs.state_name, a.qty
     FROM bp_product_state_allocations a
     LEFT JOIN geo_states gs ON gs.id = a.state_id
     WHERE a.product_line_id IN (?)
     ORDER BY gs.state_name ASC`,
    [lines.map((l) => l.id)],
  );
  const byLine = new Map();
  for (const a of allocs) {
    if (!byLine.has(a.product_line_id)) byLine.set(a.product_line_id, []);
    byLine.get(a.product_line_id).push({ state_id: a.state_id, state_name: a.state_name, qty: num(a.qty) });
  }
  return lines.map((l) => {
    const allocations = byLine.get(l.id) || [];
    return {
      ...l,
      qty_target: num(l.qty_target),
      value_target: num(l.value_target),
      prev_year_qty: num(l.prev_year_qty),
      prev_year_value: num(l.prev_year_value),
      allocations,
      allocated_qty: allocations.reduce((s, a) => s + a.qty, 0),
    };
  });
};

const getProductLine = async (planId, lineId) => {
  const [rows] = await db.query(
    `SELECT pl.*, si.item_name AS name FROM bp_product_lines pl
     LEFT JOIN stock_items si ON si.id = pl.stock_item_id
     WHERE pl.plan_id = ? AND pl.id = ?`,
    [planId, lineId],
  );
  return rows[0] || null;
};

const findProductLine = async (planId, itemId) => {
  const [rows] = await db.query(
    `SELECT id FROM bp_product_lines WHERE plan_id = ? AND stock_item_id = ?`,
    [planId, itemId],
  );
  return rows[0] || null;
};

const PROD_FIELDS = ["qty_target", "value_target", "prev_year_qty", "prev_year_value"];

// data.allocations: [{state_id, qty}] replaces all allocations when given
const saveProductLine = async (planId, lineId, data, userId, label) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let id = lineId;
    if (lineId) {
      const keys = PROD_FIELDS.filter((k) => data[k] !== undefined);
      if (keys.length) {
        await conn.query(
          `UPDATE bp_product_lines SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND plan_id = ?`,
          [...keys.map((k) => data[k]), lineId, planId],
        );
      }
    } else {
      const [res] = await conn.query(
        `INSERT INTO bp_product_lines (plan_id, stock_item_id, qty_target, value_target, prev_year_qty, prev_year_value)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          planId, data.stock_item_id, data.qty_target || 0, data.value_target || 0,
          data.prev_year_qty || 0, data.prev_year_value || 0,
        ],
      );
      id = res.insertId;
    }
    if (Array.isArray(data.allocations)) {
      await conn.query(`DELETE FROM bp_product_state_allocations WHERE product_line_id = ?`, [id]);
      const rows = data.allocations.filter((a) => a.qty > 0);
      if (rows.length) {
        await conn.query(
          `INSERT INTO bp_product_state_allocations (product_line_id, state_id, qty) VALUES ?`,
          [rows.map((a) => [id, a.state_id, a.qty])],
        );
      }
    }
    await recalcTotals(conn, planId);
    await addActivity(conn, {
      planId,
      action: lineId ? "PRODUCT_UPDATED" : "PRODUCT_ADDED",
      detail: label,
      userId,
    });
    await conn.commit();
    return id;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const deleteProductLine = async (planId, lineId, userId, label) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM bp_product_lines WHERE id = ? AND plan_id = ?`, [lineId, planId]);
    await recalcTotals(conn, planId);
    await addActivity(conn, { planId, action: "PRODUCT_REMOVED", detail: label, userId });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ---------------------------------------------------------------------
//  MONTHLY TARGETS (only overrides are stored)
// ---------------------------------------------------------------------
// Map `${distributor_line_id}:${YYYY-MM}` -> { sales_target, collection_target }
const getMonthlyOverrides = async (planId) => {
  const [rows] = await db.query(
    `SELECT distributor_line_id, DATE_FORMAT(month_start, '%Y-%m') AS ym, sales_target, collection_target
     FROM bp_monthly_targets WHERE plan_id = ? AND is_sales_override = 1`,
    [planId],
  );
  const out = new Map();
  for (const r of rows) {
    out.set(`${r.distributor_line_id}:${r.ym}`, {
      sales_target: num(r.sales_target),
      collection_target: num(r.collection_target),
    });
  }
  return out;
};

// Map YYYY-MM -> { abs_booking_target, abs_advance_target } (null = default split)
const getAbsMonthlyOverrides = async (planId) => {
  const [rows] = await db.query(
    `SELECT DATE_FORMAT(month_start, '%Y-%m') AS ym, abs_booking_target, abs_advance_target
     FROM bp_monthly_targets
     WHERE plan_id = ? AND distributor_line_id = 0 AND (abs_booking_target IS NOT NULL OR abs_advance_target IS NOT NULL)`,
    [planId],
  );
  const out = new Map();
  for (const r of rows) {
    out.set(r.ym, {
      abs_booking_target: r.abs_booking_target === null ? null : num(r.abs_booking_target),
      abs_advance_target: r.abs_advance_target === null ? null : num(r.abs_advance_target),
    });
  }
  return out;
};

// rows: [{ month: 'YYYY-MM', abs_booking_target, abs_advance_target }] — plan-level row (line 0);
// a row created only for ABS is not a sales override (is_sales_override = 0)
const saveAbsMonthly = async (planId, rows, userId) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO bp_monthly_targets
         (plan_id, distributor_line_id, month_start, sales_target, collection_target, is_sales_override,
          abs_booking_target, abs_advance_target, updated_by)
       VALUES ?
       ON DUPLICATE KEY UPDATE abs_booking_target = VALUES(abs_booking_target),
                               abs_advance_target = VALUES(abs_advance_target),
                               updated_by = VALUES(updated_by)`,
      [rows.map((r) => [planId, 0, `${r.month}-01`, 0, 0, 0, r.abs_booking_target, r.abs_advance_target, userId])],
    );
    await addActivity(conn, { planId, action: "MONTHLY_PLAN_UPDATED", detail: `ABS: ${rows.length} month(s)`, userId });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// rows: [{ distributor_line_id, month: 'YYYY-MM', sales_target, collection_target }]
const saveMonthlyTargets = async (planId, rows, userId) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO bp_monthly_targets (plan_id, distributor_line_id, month_start, sales_target, collection_target, is_sales_override, updated_by)
       VALUES ?
       ON DUPLICATE KEY UPDATE sales_target = VALUES(sales_target),
                               collection_target = VALUES(collection_target),
                               is_sales_override = VALUES(is_sales_override),
                               updated_by = VALUES(updated_by)`,
      [rows.map((r) => [planId, r.distributor_line_id, `${r.month}-01`, r.sales_target, r.collection_target, 1, userId])],
    );
    await addActivity(conn, { planId, action: "MONTHLY_PLAN_UPDATED", detail: `${rows.length} month(s)`, userId });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// back to the default split for sales / collection. ABS values set on a month are kept
// (the row stays, no longer a sales override).
const resetMonthlyTargets = async (planId, userId) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE bp_monthly_targets SET is_sales_override = 0, sales_target = 0, collection_target = 0
       WHERE plan_id = ? AND (abs_booking_target IS NOT NULL OR abs_advance_target IS NOT NULL)`,
      [planId],
    );
    await conn.query(
      `DELETE FROM bp_monthly_targets
       WHERE plan_id = ? AND abs_booking_target IS NULL AND abs_advance_target IS NULL`,
      [planId],
    );
    await addActivity(conn, { planId, action: "MONTHLY_PLAN_RESET", userId });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ---------------------------------------------------------------------
//  CORRECTIVE ACTIONS
// ---------------------------------------------------------------------
const CA_SELECT = `
  SELECT ca.id, ca.plan_id, ca.distributor_line_id, ca.sheet_id,
         DATE_FORMAT(ca.review_month, '%Y-%m-%d') AS review_month, ca.kpi,
         ca.scope_label, ca.reason, ca.action_required,
         ca.responsible_user_id, ru.name AS responsible_user_name,
         DATE_FORMAT(ca.due_date, '%Y-%m-%d') AS due_date, ca.priority, ca.manager_comment,
         DATE_FORMAT(ca.follow_up_date, '%Y-%m-%d') AS follow_up_date, ca.status,
         ca.created_by, cb.name AS created_by_name,
         DATE_FORMAT(ca.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
         DATE_FORMAT(ca.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
  FROM bp_corrective_actions ca
  LEFT JOIN users ru ON ru.id = ca.responsible_user_id
  LEFT JOIN users cb ON cb.id = ca.created_by`;

const listCorrectiveActions = async (planId, { status } = {}) => {
  const params = [planId];
  let extra = "";
  if (status) {
    extra = " AND ca.status = ?";
    params.push(status);
  }
  const [rows] = await db.query(
    `${CA_SELECT} WHERE ca.plan_id = ?${extra}
     ORDER BY FIELD(ca.status, 'OPEN', 'IN_PROGRESS', 'CLOSED'), FIELD(ca.priority, 'HIGH', 'MEDIUM', 'LOW'), ca.id DESC`,
    params,
  );
  return rows;
};

const getCorrectiveAction = async (planId, id) => {
  const [rows] = await db.query(`${CA_SELECT} WHERE ca.plan_id = ? AND ca.id = ?`, [planId, id]);
  return rows[0] || null;
};

const CA_FIELDS = [
  "distributor_line_id", "scope_label", "reason", "action_required", "responsible_user_id",
  "due_date", "priority", "manager_comment", "follow_up_date", "status",
];

// monthly review reasons of a target sheet (stored as the plan's corrective actions)
const listSheetReviewActions = async (sheetId) => {
  const [rows] = await db.query(`${CA_SELECT} WHERE ca.sheet_id = ? ORDER BY ca.review_month, ca.kpi, ca.id`, [sheetId]);
  return rows;
};

const findSheetReviewAction = async (sheetId, reviewMonth, kpi) => {
  const [rows] = await db.query(
    `SELECT id, plan_id FROM bp_corrective_actions WHERE sheet_id = ? AND review_month = ? AND kpi = ? LIMIT 1`,
    [sheetId, reviewMonth, kpi],
  );
  return rows[0] || null;
};

// data: { plan_id, sheet_id, review_month 'YYYY-MM-01', kpi, scope_label, reason, action_required,
//         responsible_user_id, due_date }
const saveSheetReviewAction = async (data, userId) => {
  const existing = await findSheetReviewAction(data.sheet_id, data.review_month, data.kpi);
  if (existing) {
    await db.query(
      `UPDATE bp_corrective_actions SET reason = ?, action_required = ?, due_date = ?, scope_label = ? WHERE id = ?`,
      [data.reason, data.action_required, data.due_date || null, data.scope_label, existing.id],
    );
    await addActivity(db, { planId: existing.plan_id, action: "CORRECTIVE_ACTION_UPDATED", detail: data.scope_label, userId });
    return existing.id;
  }
  const [res] = await db.query(
    `INSERT INTO bp_corrective_actions
       (plan_id, distributor_line_id, sheet_id, review_month, kpi, scope_label, reason, action_required,
        responsible_user_id, due_date, priority, status, created_by)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'MEDIUM', 'OPEN', ?)`,
    [
      data.plan_id, data.sheet_id, data.review_month, data.kpi, data.scope_label, data.reason,
      data.action_required, data.responsible_user_id || null, data.due_date || null, userId,
    ],
  );
  await addActivity(db, { planId: data.plan_id, action: "CORRECTIVE_ACTION_ADDED", detail: data.scope_label, userId });
  return res.insertId;
};

const saveCorrectiveAction = async (planId, id, data, userId) => {
  let actionId = id;
  if (id) {
    const keys = CA_FIELDS.filter((k) => data[k] !== undefined);
    if (keys.length) {
      await db.query(
        `UPDATE bp_corrective_actions SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND plan_id = ?`,
        [...keys.map((k) => data[k]), id, planId],
      );
    }
  } else {
    const [res] = await db.query(
      `INSERT INTO bp_corrective_actions
         (plan_id, distributor_line_id, scope_label, reason, action_required, responsible_user_id,
          due_date, priority, manager_comment, follow_up_date, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        planId, data.distributor_line_id || null, data.scope_label || "General", data.reason,
        data.action_required, data.responsible_user_id || null, data.due_date || null,
        data.priority || "MEDIUM", data.manager_comment || null, data.follow_up_date || null,
        data.status || "OPEN", userId,
      ],
    );
    actionId = res.insertId;
  }
  await addActivity(db, {
    planId,
    action: id ? "CORRECTIVE_ACTION_UPDATED" : "CORRECTIVE_ACTION_ADDED",
    detail: data.scope_label || null,
    userId,
  });
  return actionId;
};

const deleteCorrectiveAction = async (planId, id, userId) => {
  await db.query(`DELETE FROM bp_corrective_actions WHERE id = ? AND plan_id = ?`, [id, planId]);
  await addActivity(db, { planId, action: "CORRECTIVE_ACTION_REMOVED", userId });
};

const countOpenActions = async (planIds) => {
  const out = new Map();
  if (!planIds.length) return out;
  const [rows] = await db.query(
    `SELECT plan_id, COUNT(*) AS c FROM bp_corrective_actions
     WHERE plan_id IN (?) AND status <> 'CLOSED' GROUP BY plan_id`,
    [planIds],
  );
  for (const r of rows) out.set(r.plan_id, num(r.c));
  return out;
};

// ---------------------------------------------------------------------
//  ACTIVITY
// ---------------------------------------------------------------------
const listActivity = async (planId, { approvalOnly = false, page = 1, limit = 50 } = {}) => {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = (Math.max(Number(page) || 1, 1) - 1) * lim;
  const params = [planId];
  let extra = "";
  if (approvalOnly) {
    extra = " AND a.action IN (?)";
    params.push(APPROVAL_ACTIONS);
  }
  const [rows] = await db.query(
    `SELECT a.id, a.action, a.from_status, a.to_status, a.remark, a.detail,
            a.acted_by, u.name AS acted_by_name, jr.name AS acted_by_role,
            DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM bp_plan_activity a
     LEFT JOIN users u ON u.id = a.acted_by
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     WHERE a.plan_id = ?${extra}
     ORDER BY a.id DESC
     LIMIT ? OFFSET ?`,
    [...params, lim, off],
  );
  return rows;
};

module.exports = {
  STATUS_LABEL,
  REVISION_OPEN,
  LIVE_STATUSES,
  num,
  findLivePlan,
  findOverlaps,
  getAbsMonthlyOverrides,
  saveAbsMonthly,
  listSheetReviewActions,
  saveSheetReviewAction,
  recalcTotals,
  lockPlan,
  stateCode,
  listPlans,
  listAllPlans,
  getPlan,
  createPlan,
  updatePlanHeader,
  updateDevelopment,
  softDeletePlan,
  changeStatus,
  countLines,
  addActivity,
  listDistributorLines,
  getDistributorLine,
  findDistributorLine,
  saveDistributorLine,
  deleteDistributorLine,
  listRetailerLines,
  getRetailerLine,
  findRetailerLine,
  saveRetailerLine,
  deleteRetailerLine,
  listProductLines,
  getProductLine,
  findProductLine,
  saveProductLine,
  deleteProductLine,
  getMonthlyOverrides,
  saveMonthlyTargets,
  resetMonthlyTargets,
  listCorrectiveActions,
  getCorrectiveAction,
  saveCorrectiveAction,
  deleteCorrectiveAction,
  countOpenActions,
  listActivity,
};
