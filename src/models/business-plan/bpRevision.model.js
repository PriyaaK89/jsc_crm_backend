// Approved plan revisions: the official, immutable targets of a Business Plan.
//   revision 1   = first final approval
//   revision N+1 = final approval of a revision (Revise -> edit -> submit -> approve)
// Rows are only ever inserted. Plans approved before this module existed get their
// revision row built once, from their own lines, the first time they are read.
const db = require("../../config/db");
const plan = require("./bpPlan.model");
const T = require("./bpTargets.model");

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

const REV_SELECT = `
  SELECT r.id, r.plan_id, r.revision_no, r.sales_target, r.collection_target, r.snapshot, r.remark,
         r.approved_by, u.name AS approved_by_name,
         DATE_FORMAT(r.approved_at, '%Y-%m-%d %H:%i:%s') AS approved_at,
         DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
  FROM bp_plan_revisions r
  LEFT JOIN users u ON u.id = r.approved_by`;

const shape = (r, withSnapshot = true) => {
  const out = {
    id: r.id,
    plan_id: r.plan_id,
    revision_no: num(r.revision_no),
    sales_target: num(r.sales_target),
    collection_target: num(r.collection_target),
    remark: r.remark,
    approved_by: r.approved_by,
    approved_by_name: r.approved_by_name || null,
    approved_at: r.approved_at,
    created_at: r.created_at,
  };
  if (withSnapshot) out.snapshot = parseJson(r.snapshot, null);
  return out;
};

const listRevisions = async (planId) => {
  const [rows] = await db.query(`${REV_SELECT} WHERE r.plan_id = ? ORDER BY r.revision_no DESC`, [planId]);
  return rows.map((r) => shape(r, false));
};

const getRevision = async (planId, revisionNo) => {
  const [rows] = await db.query(`${REV_SELECT} WHERE r.plan_id = ? AND r.revision_no = ?`, [planId, revisionNo]);
  return rows[0] ? shape(rows[0]) : null;
};

const latestRevision = async (planId) => {
  const [rows] = await db.query(`${REV_SELECT} WHERE r.plan_id = ? ORDER BY r.revision_no DESC LIMIT 1`, [planId]);
  return rows[0] ? shape(rows[0]) : null;
};

// writes revision `revisionNo` from the plan's current lines (runner = a transaction or db)
const insertRevision = async (runner, p, revisionNo, { approvedBy, approvedAt = null, remark = null }) => {
  const snapshot = await T.buildSnapshot(p);
  await runner.query(
    `INSERT INTO bp_plan_revisions (plan_id, revision_no, sales_target, collection_target, snapshot, remark, approved_by, approved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${approvedAt ? "?" : "NOW()"})`,
    [
      p.id, revisionNo, snapshot.plan.sales_target, snapshot.plan.collection_target, JSON.stringify(snapshot),
      remark ? String(remark).slice(0, 500) : null, approvedBy || null, ...(approvedAt ? [approvedAt] : []),
    ],
  );
  return snapshot;
};

// Plans approved before revisions existed (status ACTIVE / CLOSED, or an open revision):
// build the baseline revision once from their lines. Safe under concurrency (unique key).
const ensureBaseline = async (p) => {
  const approvedBefore = ["ACTIVE", "CLOSED"].includes(p.status) || p.revision_status === plan.REVISION_OPEN;
  if (!approvedBefore) return null;
  const latest = await latestRevision(p.id);
  if (latest) return latest;
  const revisionNo = Math.max(num(p.revision_no), 1);
  try {
    await insertRevision(db, p, revisionNo, {
      approvedBy: p.decided_by || null,
      approvedAt: p.decided_at || null,
      remark: "Baseline: targets of the plan as approved before plan revisions were introduced",
    });
    await db.query(
      `UPDATE business_plans
       SET revision_no = GREATEST(revision_no, ?),
           approved_sales_target = COALESCE(approved_sales_target, sales_target),
           approved_collection_target = COALESCE(approved_collection_target, collection_target)
       WHERE id = ?`,
      [revisionNo, p.id],
    );
  } catch (err) {
    if (!(err && err.code === "ER_DUP_ENTRY")) throw err;
  }
  return latestRevision(p.id);
};

// ---------------------------------------------------------------------
//  TARGET SHEETS LINKED TO A PLAN
// ---------------------------------------------------------------------
const linkedSheets = async (planId) => {
  const [rows] = await db.query(
    `SELECT s.id, s.sheet_code, s.user_id, u.name AS employee_name, s.financial_year, s.quarter,
            s.status, s.version_no, s.targets_outdated, sp.plan_revision_no,
            DATE_FORMAT(s.period_from, '%Y-%m-%d') AS period_from, DATE_FORMAT(s.period_to, '%Y-%m-%d') AS period_to
     FROM bp_target_sheet_plans sp
     INNER JOIN bp_target_sheets s ON s.id = sp.sheet_id AND s.is_deleted = 0
     LEFT JOIN users u ON u.id = s.user_id
     WHERE sp.plan_id = ?
     ORDER BY s.financial_year DESC, s.quarter DESC`,
    [planId],
  );
  return rows.map((r) => ({ ...r, targets_outdated: num(r.targets_outdated) === 1, quarter: num(r.quarter) }));
};

// After a revision is approved: sheets of the CURRENT and FUTURE quarters that were signed
// (APPROVED) or are with the approvers (SUBMITTED / MANAGER_APPROVED) on an older revision are
// flagged. Signed versions are never changed; the employee re-acknowledges in a new version.
// Returns the flagged sheets.
const flagSheetsForRevision = async (runner, planId, newRevisionNo, fromDate) => {
  const [rows] = await runner.query(
    `SELECT s.id, s.sheet_code, s.user_id, s.status
     FROM bp_target_sheet_plans sp
     INNER JOIN bp_target_sheets s ON s.id = sp.sheet_id AND s.is_deleted = 0
     WHERE sp.plan_id = ? AND sp.plan_revision_no < ? AND s.target_source = 'PLAN'
       AND s.status IN ('APPROVED', 'SUBMITTED', 'MANAGER_APPROVED')
       AND s.period_to >= ?`,
    [planId, newRevisionNo, fromDate],
  );
  if (rows.length) {
    await runner.query(
      `UPDATE bp_target_sheets SET targets_outdated = 1, outdated_reason = ? WHERE id IN (?)`,
      [`Business Plan revision ${newRevisionNo} approved`, rows.map((r) => r.id)],
    );
  }
  return rows;
};

module.exports = {
  parseJson,
  listRevisions,
  getRevision,
  latestRevision,
  insertRevision,
  ensureBaseline,
  linkedSheets,
  flagSheetsForRevision,
};
