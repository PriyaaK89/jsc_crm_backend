// Employee Target Sheet (employment annexure).
// Fixed fields are columns; the full form is stored as JSON (form_values / form_tables).
const db = require("../../config/db");

const STATUS_LABEL = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  MANAGER_APPROVED: "In Approval", // approved at one or more levels, waiting for the next one
  APPROVED: "Approved",
  RETURNED: "Returned",
};

const num = (v) => Number(v) || 0;

const parseJson = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
};

const SHEET_SELECT = `
  SELECT s.id, s.sheet_code, s.user_id, u.name AS employee_name, jr.name AS designation,
         DATE_FORMAT(s.period_from, '%Y-%m-%d') AS period_from,
         DATE_FORMAT(s.period_to, '%Y-%m-%d') AS period_to,
         s.financial_year, s.quarter,
         s.territory_type, s.state, s.status, s.target_source, s.version_no, s.targets_outdated, s.outdated_reason,
         DATE_FORMAT(s.snapshot_at, '%Y-%m-%d %H:%i:%s') AS snapshot_at,
         s.total_sales, s.total_collection,
         s.acknowledged, s.manager_id, m.name AS manager_name,
         s.manager_approved_by, mab.name AS manager_approved_by_name,
         DATE_FORMAT(s.manager_approved_at, '%Y-%m-%d %H:%i:%s') AS manager_approved_at,
         s.approved_by, ab.name AS approved_by_name,
         DATE_FORMAT(s.approved_at, '%Y-%m-%d %H:%i:%s') AS approved_at,
         DATE_FORMAT(s.submitted_at, '%Y-%m-%d %H:%i:%s') AS submitted_at,
         s.return_remark, s.created_by,
         DATE_FORMAT(s.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
         DATE_FORMAT(s.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
         (SELECT st.level_no FROM bp_approval_steps st
           WHERE st.entity_type = 'SHEET' AND st.entity_id = s.id AND st.status = 'PENDING'
           ORDER BY st.round_no DESC LIMIT 1) AS pending_level,
         (SELECT COALESCE(su.name, 'Admin / Super Admin') FROM bp_approval_steps st
           LEFT JOIN users su ON su.id = st.approver_id
           WHERE st.entity_type = 'SHEET' AND st.entity_id = s.id AND st.status = 'PENDING'
           ORDER BY st.round_no DESC LIMIT 1) AS pending_with`;

const SHEET_FROM = `
  FROM bp_target_sheets s
  LEFT JOIN users u ON u.id = s.user_id
  LEFT JOIN job_roles jr ON jr.id = u.job_role_id
  LEFT JOIN users m ON m.id = s.manager_id
  LEFT JOIN users mab ON mab.id = s.manager_approved_by
  LEFT JOIN users ab ON ab.id = s.approved_by`;

const shape = (r) => ({
  ...r,
  status_label: STATUS_LABEL[r.status] || r.status,
  total_sales: num(r.total_sales),
  total_collection: num(r.total_collection),
  acknowledged: Number(r.acknowledged) === 1,
  quarter: r.quarter === null || r.quarter === undefined ? null : Number(r.quarter),
  // LEGACY = sheet with typed targets (made before targets came from the Business Plan)
  target_source: r.target_source || "LEGACY",
  is_legacy: (r.target_source || "LEGACY") !== "PLAN",
  version_no: num(r.version_no) || 1,
  targets_outdated: Number(r.targets_outdated) === 1,
  pending_level: r.pending_level === null || r.pending_level === undefined ? null : Number(r.pending_level),
  pending_with: r.pending_with || null,
});

// { userIds (null = all), ids (only these), status (one or a list), financialYear, quarter, search, page, limit }
const listSheets = async ({ userIds, ids, status, financialYear, quarter, search, page, limit }) => {
  const where = ["s.is_deleted = 0"];
  const params = [];
  if (userIds) {
    where.push("s.user_id IN (?)");
    params.push(userIds.length ? userIds : [0]);
  }
  if (Array.isArray(ids)) {
    where.push("s.id IN (?)");
    params.push(ids.length ? ids : [0]);
  }
  if (status) {
    where.push(Array.isArray(status) ? "s.status IN (?)" : "s.status = ?");
    params.push(status);
  }
  if (financialYear) {
    where.push("s.financial_year = ?");
    params.push(financialYear);
  }
  if (quarter) {
    where.push("s.quarter = ?");
    params.push(quarter);
  }
  if (search) {
    where.push("(u.name LIKE ? OR s.sheet_code LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const pg = Math.max(Number(page) || 1, 1);
  const [rows] = await db.query(
    `${SHEET_SELECT} ${SHEET_FROM} WHERE ${where.join(" AND ")}
     ORDER BY s.updated_at DESC, s.id DESC LIMIT ? OFFSET ?`,
    [...params, lim, (pg - 1) * lim],
  );
  const [countRows] = await db.query(
    `SELECT COUNT(*) AS c ${SHEET_FROM} WHERE ${where.join(" AND ")}`,
    params,
  );
  const total = num(countRows[0] && countRows[0].c);
  return { items: rows.map(shape), total, page: pg, limit: lim, totalPages: Math.max(Math.ceil(total / lim), 1) };
};

const getSheet = async (id) => {
  const [rows] = await db.query(
    `${SHEET_SELECT}, s.form_values, s.form_tables, s.target_snapshot ${SHEET_FROM} WHERE s.id = ? AND s.is_deleted = 0`,
    [id],
  );
  if (!rows[0]) return null;
  const r = shape(rows[0]);
  r.values = parseJson(r.form_values, {});
  r.tables = parseJson(r.form_tables, {});
  r.target_snapshot = parseJson(r.target_snapshot, null);
  delete r.form_values;
  delete r.form_tables;
  return r;
};

const nextSheetCode = async (conn) => {
  const year = new Date(Date.now() + 5.5 * 3600000).getUTCFullYear();
  const prefix = `ETS-${year}-`;
  const [[last]] = await conn.query(
    `SELECT sheet_code FROM bp_target_sheets WHERE sheet_code LIKE ? ORDER BY sheet_code DESC LIMIT 1 FOR UPDATE`,
    [`${prefix}%`],
  );
  const lastNo = last ? Number(String(last.sheet_code).slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(lastNo + 1).padStart(5, "0")}`;
};

// another (not deleted) sheet of the same employee for the same quarter
const findQuarterSheet = async (userId, financialYear, quarter, excludeId = 0) => {
  const [rows] = await db.query(
    `SELECT id, sheet_code, status FROM bp_target_sheets
     WHERE user_id = ? AND financial_year = ? AND quarter = ? AND is_deleted = 0 AND id <> ?
     ORDER BY id DESC LIMIT 1`,
    [userId, financialYear, quarter, excludeId || 0],
  );
  return rows[0] || null;
};

// data: { user_id, financial_year, quarter, period_from, period_to, territory_type, state,
//         total_sales, total_collection, values, tables, acknowledged }
const createSheet = async (data, createdBy) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const code = await nextSheetCode(conn);
      const [res] = await conn.query(
        `INSERT INTO bp_target_sheets
           (sheet_code, user_id, period_from, period_to, territory_type, state, status,
            total_sales, total_collection, form_values, form_tables, acknowledged, created_by,
            financial_year, quarter, target_source, version_no)
         VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          code, data.user_id, data.period_from, data.period_to, data.territory_type, data.state,
          data.total_sales, data.total_collection, JSON.stringify(data.values),
          JSON.stringify(data.tables), data.acknowledged ? 1 : 0, createdBy,
          data.financial_year || null, data.quarter || null, data.target_source || "PLAN",
        ],
      );
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
  throw new Error("Could not generate a sheet code");
};

const updateSheet = async (id, data) => {
  await db.query(
    `UPDATE bp_target_sheets
     SET period_from = ?, period_to = ?, territory_type = ?, state = ?, total_sales = ?,
         total_collection = ?, form_values = ?, form_tables = ?, acknowledged = ?,
         financial_year = ?, quarter = ?
     WHERE id = ? AND is_deleted = 0`,
    [
      data.period_from, data.period_to, data.territory_type, data.state, data.total_sales,
      data.total_collection, JSON.stringify(data.values), JSON.stringify(data.tables),
      data.acknowledged ? 1 : 0, data.financial_year || null, data.quarter || null, id,
    ],
  );
};

// status move with a row lock. extra(conn, row) runs in the same transaction
// (approval steps); throwing from it rolls everything back.
const moveSheet = async (id, { allowedFrom, to, sets = [], params = [], extra }) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      `SELECT id, status FROM bp_target_sheets WHERE id = ? AND is_deleted = 0 FOR UPDATE`,
      [id],
    );
    if (!row || !allowedFrom.includes(row.status)) {
      await conn.rollback();
      return { ok: false, current: row ? row.status : null };
    }
    await conn.query(
      `UPDATE bp_target_sheets SET status = ?${sets.length ? `, ${sets.join(", ")}` : ""} WHERE id = ?`,
      [to, ...params, id],
    );
    const extraResult = extra ? await extra(conn, row) : undefined;
    await conn.commit();
    return { ok: true, from: row.status, extra: extraResult };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const softDeleteSheet = async (id) => {
  await db.query(`UPDATE bp_target_sheets SET is_deleted = 1 WHERE id = ?`, [id]);
};

module.exports = {
  STATUS_LABEL,
  listSheets,
  getSheet,
  createSheet,
  updateSheet,
  findQuarterSheet,
  moveSheet,
  softDeleteSheet,
};
