// Target sheet <-> Business Plan: plan links, signed versions and target revision requests.
// Versions and links are written by the application only by INSERT (versions) or by
// replacing the links of a sheet that is not yet signed. Signed versions never change.
const db = require("../../config/db");

const num = (v) => Number(v) || 0;
const parseJson = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
};

// ---------------------------------------------------------------------
//  PLAN LINKS
// ---------------------------------------------------------------------
const listLinks = async (sheetId, runner = db) => {
  const [rows] = await runner.query(
    `SELECT sp.plan_id, sp.plan_revision_no, p.plan_code, p.name, p.season, p.financial_year
     FROM bp_target_sheet_plans sp
     LEFT JOIN business_plans p ON p.id = sp.plan_id
     WHERE sp.sheet_id = ? ORDER BY sp.plan_id`,
    [sheetId],
  );
  return rows.map((r) => ({ ...r, plan_revision_no: num(r.plan_revision_no) }));
};

// links: [{ plan_id, revision_no }]
const replaceLinks = async (runner, sheetId, links) => {
  await runner.query(`DELETE FROM bp_target_sheet_plans WHERE sheet_id = ?`, [sheetId]);
  if (links.length) {
    await runner.query(
      `INSERT INTO bp_target_sheet_plans (sheet_id, plan_id, plan_revision_no) VALUES ?`,
      [links.map((l) => [sheetId, l.plan_id, l.revision_no])],
    );
  }
};

// ---------------------------------------------------------------------
//  SIGNED VERSIONS
// ---------------------------------------------------------------------
const VERSION_SELECT = `
  SELECT v.id, v.sheet_id, v.version_no, v.target_source, v.archived_reason,
         v.form_values, v.form_tables, v.target_snapshot, v.plan_links,
         v.manager_approved_by, mu.name AS manager_approved_by_name,
         DATE_FORMAT(v.manager_approved_at, '%Y-%m-%d %H:%i:%s') AS manager_approved_at,
         v.approved_by, au.name AS approved_by_name,
         DATE_FORMAT(v.approved_at, '%Y-%m-%d %H:%i:%s') AS approved_at,
         v.created_by, DATE_FORMAT(v.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
  FROM bp_target_sheet_versions v
  LEFT JOIN users mu ON mu.id = v.manager_approved_by
  LEFT JOIN users au ON au.id = v.approved_by`;

const shapeVersion = (r, full) => {
  const out = {
    id: r.id,
    sheet_id: r.sheet_id,
    version_no: num(r.version_no),
    target_source: r.target_source,
    archived_reason: r.archived_reason,
    manager_approved_by_name: r.manager_approved_by_name || null,
    manager_approved_at: r.manager_approved_at,
    approved_by_name: r.approved_by_name || null,
    approved_at: r.approved_at,
    created_at: r.created_at,
    plan_links: parseJson(r.plan_links, []),
  };
  if (full) {
    out.values = parseJson(r.form_values, {});
    out.tables = parseJson(r.form_tables, {});
    out.target_snapshot = parseJson(r.target_snapshot, null);
  }
  return out;
};

const listVersions = async (sheetId) => {
  const [rows] = await db.query(`${VERSION_SELECT} WHERE v.sheet_id = ? ORDER BY v.version_no DESC`, [sheetId]);
  return rows.map((r) => shapeVersion(r, false));
};

const getVersion = async (sheetId, versionNo) => {
  const [rows] = await db.query(`${VERSION_SELECT} WHERE v.sheet_id = ? AND v.version_no = ?`, [sheetId, versionNo]);
  return rows[0] ? shapeVersion(rows[0], true) : null;
};

// data: { sheet_id, version_no, target_source, archived_reason, values, tables, target_snapshot,
//         plan_links, manager_approved_by, manager_approved_at, approved_by, approved_at, created_by }
const insertVersion = async (runner, d) => {
  await runner.query(
    `INSERT INTO bp_target_sheet_versions
       (sheet_id, version_no, target_source, archived_reason, form_values, form_tables, target_snapshot,
        plan_links, manager_approved_by, manager_approved_at, approved_by, approved_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.sheet_id, d.version_no, d.target_source, d.archived_reason,
      JSON.stringify(d.values || {}), JSON.stringify(d.tables || {}),
      d.target_snapshot ? JSON.stringify(d.target_snapshot) : null,
      JSON.stringify(d.plan_links || []),
      d.manager_approved_by || null, d.manager_approved_at || null, d.approved_by || null,
      d.approved_at || null, d.created_by,
    ],
  );
};

// ---------------------------------------------------------------------
//  TARGET REVISION REQUESTS
//    OPEN -> ACCEPTED (the plan will be revised) -> RESOLVED (revision approved)
//    OPEN -> DECLINED (with reason) | CANCELLED (by the employee)
// ---------------------------------------------------------------------
const REQUEST_LABEL = {
  OPEN: "Open",
  ACCEPTED: "Accepted — plan revision pending",
  RESOLVED: "Resolved — plan revised",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
};
const BLOCKING = ["OPEN", "ACCEPTED"];

const REQ_SELECT = `
  SELECT q.id, q.sheet_id, s.sheet_code, s.user_id, su.name AS employee_name, s.financial_year, s.quarter,
         q.plan_id, p.plan_code, p.name AS plan_name, q.requested_by, ru.name AS requested_by_name,
         q.items, q.remark, q.status, q.decided_by, du.name AS decided_by_name,
         DATE_FORMAT(q.decided_at, '%Y-%m-%d %H:%i:%s') AS decided_at, q.decision_remark, q.resolved_revision_no,
         DATE_FORMAT(q.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
  FROM bp_target_revision_requests q
  LEFT JOIN bp_target_sheets s ON s.id = q.sheet_id
  LEFT JOIN users su ON su.id = s.user_id
  LEFT JOIN business_plans p ON p.id = q.plan_id
  LEFT JOIN users ru ON ru.id = q.requested_by
  LEFT JOIN users du ON du.id = q.decided_by`;

const shapeRequest = (r) => ({
  ...r,
  quarter: r.quarter === null ? null : num(r.quarter),
  items: parseJson(r.items, []),
  status_label: REQUEST_LABEL[r.status] || r.status,
  blocking: BLOCKING.includes(r.status),
});

const listRequestsForSheet = async (sheetId) => {
  const [rows] = await db.query(`${REQ_SELECT} WHERE q.sheet_id = ? ORDER BY q.id DESC`, [sheetId]);
  return rows.map(shapeRequest);
};

// { userIds (null = all), sheetIds, status }
const listRequests = async ({ userIds, ids, status }) => {
  const where = ["1 = 1"];
  const params = [];
  if (userIds) {
    where.push("s.user_id IN (?)");
    params.push(userIds.length ? userIds : [0]);
  }
  if (Array.isArray(ids)) {
    where.push("q.id IN (?)");
    params.push(ids.length ? ids : [0]);
  }
  if (status) {
    where.push(Array.isArray(status) ? "q.status IN (?)" : "q.status = ?");
    params.push(status);
  }
  const [rows] = await db.query(`${REQ_SELECT} WHERE ${where.join(" AND ")} ORDER BY q.id DESC LIMIT 200`, params);
  return rows.map(shapeRequest);
};

const getRequest = async (id) => {
  const [rows] = await db.query(`${REQ_SELECT} WHERE q.id = ?`, [id]);
  return rows[0] ? shapeRequest(rows[0]) : null;
};

const countBlocking = async (sheetId) => {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS c FROM bp_target_revision_requests WHERE sheet_id = ? AND status IN (?)`,
    [sheetId, BLOCKING],
  );
  return num(r && r.c);
};

const createRequest = async ({ sheetId, planId, userId, items, remark }) => {
  const [res] = await db.query(
    `INSERT INTO bp_target_revision_requests (sheet_id, plan_id, requested_by, items, remark, status)
     VALUES (?, ?, ?, ?, ?, 'OPEN')`,
    [sheetId, planId || null, userId, JSON.stringify(items || []), String(remark).slice(0, 1000)],
  );
  return res.insertId;
};

// move with a check on the current status; returns true when the row changed
const moveRequest = async (id, { from, to, userId, remark }) => {
  const [res] = await db.query(
    `UPDATE bp_target_revision_requests
     SET status = ?, decided_by = ?, decided_at = NOW(), decision_remark = ?
     WHERE id = ? AND status IN (?)`,
    [to, userId, remark ? String(remark).slice(0, 500) : null, id, from],
  );
  return num(res && res.affectedRows) > 0;
};

// a plan revision was approved: ACCEPTED requests of that plan are resolved
const resolveAccepted = async (runner, planId, revisionNo) => {
  const [rows] = await runner.query(
    `SELECT q.id, q.sheet_id, s.user_id FROM bp_target_revision_requests q
     INNER JOIN bp_target_sheets s ON s.id = q.sheet_id
     WHERE q.plan_id = ? AND q.status = 'ACCEPTED'`,
    [planId],
  );
  if (rows.length) {
    await runner.query(
      `UPDATE bp_target_revision_requests SET status = 'RESOLVED', resolved_revision_no = ? WHERE id IN (?)`,
      [revisionNo, rows.map((r) => r.id)],
    );
  }
  return rows;
};

module.exports = {
  REQUEST_LABEL,
  BLOCKING,
  listLinks,
  replaceLinks,
  listVersions,
  getVersion,
  insertVersion,
  listRequestsForSheet,
  listRequests,
  getRequest,
  countBlocking,
  createRequest,
  moveRequest,
  resolveAccepted,
};
