// Business Plan: multi-level approval steps (target sheets and plans).
//
// One row per approval level per submission ("round"). A resubmission after a
// return starts a new round, so earlier rounds stay as history.
//   status: WAITING (later level) -> PENDING (current level) -> APPROVED / RETURNED / REJECTED
//           SKIPPED = not needed any more (admin gave final approval, or the item was returned)
// approver_kind: MANAGER = a manager in the employee's reporting line
//                RSM     = final approver found in the reporting line (job role in Settings)
//                ADMIN   = no RSM in the line: any Admin / Super Admin gives the final approval
const db = require("../../config/db");

const ENTITY_TYPES = ["PLAN", "SHEET"];
const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];
const MAX_DEPTH = 25; // guard against loops in reporting_under

const STEP_LABEL = {
  WAITING: "Waiting",
  PENDING: "Pending",
  APPROVED: "Approved",
  RETURNED: "Returned",
  REJECTED: "Rejected",
  SKIPPED: "Skipped",
};

// Final-approver rule from Settings (final_approver_roles), comma separated. Each entry is:
//   a job role name   "RSM" / "Regional Sales Manager"  (case, dots and spaces ignored;
//                     a short name in brackets counts too: "Regional Sales Manager (R.S.M)"
//                     matches both "Regional Sales Manager" and "RSM")
//   id:<n>            job_roles.id,    e.g. "id:2"
//   level:<n>         job_roles.level, e.g. "level:2"
const normRole = (v) =>
  String(v || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseRoles = (value) =>
  String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const m = x.match(/^(id|level)\s*:\s*(\d+)$/i);
      if (m) return { kind: m[1].toLowerCase(), value: Number(m[2]) };
      return { kind: "name", value: normRole(x).replace(/[()]/g, "").replace(/\s+/g, " ").trim() };
    })
    .filter((r) => r.kind !== "name" || r.value);

// every name a job role answers to: "Regional Sales Manager (R.S.M)" ->
// ["regional sales manager rsm", "regional sales manager", "rsm"]
const roleNames = (jobRole) => {
  const n = normRole(jobRole);
  if (!n) return [];
  const names = new Set([n.replace(/[()]/g, "").replace(/\s+/g, " ").trim()]);
  const outside = n.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (outside) names.add(outside);
  for (const m of n.matchAll(/\(([^)]*)\)/g)) {
    const inner = m[1].trim();
    if (inner) names.add(inner);
  }
  return [...names];
};

// node: { job_role, job_role_id, job_role_level } (from loadNode); a plain string = job role name
const isFinalRole = (node, finalRoles) => {
  if (!node || !finalRoles || !finalRoles.length) return false;
  const n = typeof node === "string" ? { job_role: node } : node;
  const names = roleNames(n.job_role);
  return finalRoles.some((r) => {
    if (r.kind === "id") return n.job_role_id !== null && n.job_role_id !== undefined && Number(n.job_role_id) === r.value;
    if (r.kind === "level") return n.job_role_level !== null && n.job_role_level !== undefined && Number(n.job_role_level) === r.value;
    return names.includes(r.value);
  });
};

// ---------------------------------------------------------------------
//  HIERARCHY
// ---------------------------------------------------------------------
const loadNode = async (runner, id) => {
  const [rows] = await runner.query(
    `SELECT u.id, u.name, u.is_active, u.reporting_under, u.approver_id,
            jr.id AS job_role_id, jr.name AS job_role, jr.level AS job_role_level, r.name AS role
     FROM users u
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = ?`,
    [id],
  );
  return rows[0] || null;
};

// Approval chain for an employee, read from users.reporting_under (actual hierarchy).
// Walks up level by level and stops (inclusive) at the first manager whose job role
// is a final-approver role (RSM), or who is an Admin / Super Admin. Inactive managers
// are passed over. Without an RSM / admin in the line, a last ADMIN level is added so
// the item never gets stuck. excludeIds: users who may not approve (e.g. the creator).
const buildChain = async (employeeId, { finalRoles = [], excludeIds = [], runner = db } = {}) => {
  const levels = [];
  const emp = await loadNode(runner, employeeId);
  const seen = new Set([Number(employeeId)]);
  const skip = new Set(excludeIds.map(Number));
  // employees without reporting_under fall back to their configured approver
  let nextId = emp ? emp.reporting_under || emp.approver_id || null : null;
  let depth = 0;
  let closed = false;

  while (nextId && !seen.has(Number(nextId)) && depth < MAX_DEPTH) {
    depth += 1;
    seen.add(Number(nextId));
    const m = await loadNode(runner, nextId);
    if (!m) break;
    const above = m.reporting_under;
    if (Number(m.is_active) !== 1 || skip.has(Number(m.id))) {
      nextId = above;
      continue;
    }
    const finalByRole = isFinalRole(m, finalRoles);
    const isAdmin = ADMIN_ROLES.includes(String(m.role || "").toUpperCase());
    levels.push({
      approver_kind: finalByRole ? "RSM" : "MANAGER",
      approver_id: m.id,
      approver_name: m.name,
      approver_role: m.job_role || m.role || null,
    });
    if (finalByRole || isAdmin) {
      closed = true;
      break;
    }
    nextId = above;
  }

  if (!closed) {
    levels.push({ approver_kind: "ADMIN", approver_id: null, approver_name: null, approver_role: "Admin / Super Admin" });
  }
  return levels.map((l, i) => ({ ...l, level_no: i + 1, is_final: i === levels.length - 1 }));
};

// ---------------------------------------------------------------------
//  STEPS
// ---------------------------------------------------------------------
const STEP_SELECT = `
  SELECT st.id, st.entity_type, st.entity_id, st.round_no, st.level_no, st.approver_kind,
         st.approver_id, au.name AS approver_name, st.approver_role, st.is_final, st.status,
         st.acted_by, ab.name AS acted_by_name, jr.name AS acted_by_role, st.acted_as,
         DATE_FORMAT(st.acted_at, '%Y-%m-%d %H:%i:%s') AS acted_at, st.remark,
         DATE_FORMAT(st.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
  FROM bp_approval_steps st
  LEFT JOIN users au ON au.id = st.approver_id
  LEFT JOIN users ab ON ab.id = st.acted_by
  LEFT JOIN job_roles jr ON jr.id = ab.job_role_id`;

const shapeStep = (r) => ({
  ...r,
  is_final: Number(r.is_final) === 1,
  status_label: STEP_LABEL[r.status] || r.status,
  approver_name: r.approver_name || (r.approver_kind === "ADMIN" ? "Admin / Super Admin" : null),
});

// all rounds, oldest first
const listSteps = async (type, entityId, runner = db) => {
  const [rows] = await runner.query(
    `${STEP_SELECT} WHERE st.entity_type = ? AND st.entity_id = ? ORDER BY st.round_no ASC, st.level_no ASC`,
    [type, entityId],
  );
  return rows.map(shapeStep);
};

const lastRound = async (runner, type, entityId) => {
  const [rows] = await runner.query(
    `SELECT COALESCE(MAX(round_no), 0) AS r FROM bp_approval_steps WHERE entity_type = ? AND entity_id = ?`,
    [type, entityId],
  );
  return Number(rows[0] && rows[0].r) || 0;
};

// new round: level 1 PENDING, the rest WAITING. levels = buildChain(...)
const createRound = async (runner, type, entityId, levels) => {
  const round = (await lastRound(runner, type, entityId)) + 1;
  if (!levels.length) return { round, steps: [] };
  await runner.query(
    `INSERT INTO bp_approval_steps
       (entity_type, entity_id, round_no, level_no, approver_kind, approver_id, approver_role, is_final, status)
     VALUES ?`,
    [levels.map((l, i) => [type, entityId, round, l.level_no, l.approver_kind, l.approver_id, l.approver_role ? String(l.approver_role).slice(0, 100) : null, l.is_final ? 1 : 0, i === 0 ? "PENDING" : "WAITING"])],
  );
  return { round };
};

// legacy rows (submitted before this table existed): level 1 already done by `doneBy`
const markLevelDone = async (runner, type, entityId, round, levelNo, { actedBy, actedAt }) => {
  await runner.query(
    `UPDATE bp_approval_steps SET status = 'APPROVED', acted_by = ?, acted_at = COALESCE(?, NOW()), acted_as = 'APPROVER'
     WHERE entity_type = ? AND entity_id = ? AND round_no = ? AND level_no = ?`,
    [actedBy, actedAt || null, type, entityId, round, levelNo],
  );
  await runner.query(
    `UPDATE bp_approval_steps SET status = 'PENDING'
     WHERE entity_type = ? AND entity_id = ? AND round_no = ? AND level_no = ? AND status = 'WAITING'`,
    [type, entityId, round, levelNo + 1],
  );
};

// the PENDING step, locked (inside a transaction)
const lockPendingStep = async (conn, type, entityId) => {
  const [rows] = await conn.query(
    `SELECT id, round_no, level_no, approver_kind, approver_id, is_final, status
     FROM bp_approval_steps
     WHERE entity_type = ? AND entity_id = ? AND status = 'PENDING'
     ORDER BY round_no DESC, level_no ASC LIMIT 1 FOR UPDATE`,
    [type, entityId],
  );
  return rows[0] || null;
};

const actOnStep = async (conn, stepId, { status, actedBy, actedAs, remark }) => {
  await conn.query(
    `UPDATE bp_approval_steps SET status = ?, acted_by = ?, acted_as = ?, acted_at = NOW(), remark = ? WHERE id = ?`,
    [status, actedBy, actedAs, remark ? String(remark).slice(0, 500) : null, stepId],
  );
};

// next WAITING level becomes PENDING; returns it (or null)
const activateNext = async (conn, type, entityId, round, afterLevel) => {
  const [rows] = await conn.query(
    `SELECT id, level_no, approver_kind, approver_id, is_final
     FROM bp_approval_steps
     WHERE entity_type = ? AND entity_id = ? AND round_no = ? AND level_no > ? AND status = 'WAITING'
     ORDER BY level_no ASC LIMIT 1`,
    [type, entityId, round, afterLevel],
  );
  const next = rows[0] || null;
  if (next) await conn.query(`UPDATE bp_approval_steps SET status = 'PENDING' WHERE id = ?`, [next.id]);
  return next;
};

// everything still open in the round is not needed any more
const skipOpen = async (conn, type, entityId, round) => {
  await conn.query(
    `UPDATE bp_approval_steps SET status = 'SKIPPED'
     WHERE entity_type = ? AND entity_id = ? AND round_no = ? AND status IN ('WAITING', 'PENDING')`,
    [type, entityId, round],
  );
};

// ids with a PENDING step for this user.
// all = true (admin): every pending item; pool = true: also items waiting for the admin level
const pendingEntityIds = async (type, userId, { all = false, pool = false } = {}) => {
  const where = ["entity_type = ?", "status = 'PENDING'"];
  const params = [type];
  if (!all) {
    where.push(pool ? "(approver_id = ? OR approver_kind = 'ADMIN')" : "approver_id = ?");
    params.push(userId);
  }
  const [rows] = await db.query(`SELECT DISTINCT entity_id FROM bp_approval_steps WHERE ${where.join(" AND ")}`, params);
  return rows.map((r) => Number(r.entity_id));
};

// is (or was) this user an approver of the item? Gives read access to items outside the team.
const isApproverOf = async (type, entityId, userId) => {
  const [rows] = await db.query(
    `SELECT 1 FROM bp_approval_steps
     WHERE entity_type = ? AND entity_id = ? AND (approver_id = ? OR acted_by = ?) LIMIT 1`,
    [type, entityId, userId, userId],
  );
  return rows.length > 0;
};

const hasPendingPoolStep = async (type, entityId) => {
  const [rows] = await db.query(
    `SELECT 1 FROM bp_approval_steps
     WHERE entity_type = ? AND entity_id = ? AND status = 'PENDING' AND approver_kind = 'ADMIN' LIMIT 1`,
    [type, entityId],
  );
  return rows.length > 0;
};

// ---------------------------------------------------------------------
//  NOTIFICATIONS (beat_notifications, the table the app's bell reads)
// ---------------------------------------------------------------------
const adminUserIds = async () => {
  const [rows] = await db.query(
    `SELECT u.id FROM users u INNER JOIN roles r ON r.id = u.role_id
     WHERE r.name IN (?) AND u.is_active = 1`,
    [ADMIN_ROLES],
  );
  return rows.map((r) => Number(r.id));
};

// plan_id stays NULL (it points at beat plans); ref_id = sheet / plan id.
// A notification problem never fails the approval itself.
const notify = async (userIds, { type, title, message, refId }) => {
  const ids = [...new Set((userIds || []).filter(Boolean).map(Number))];
  if (!ids.length) return;
  try {
    await db.query(
      `INSERT INTO beat_notifications (user_id, plan_id, ref_id, type, title, message) VALUES ?`,
      [ids.map((id) => [id, null, refId, type, String(title).slice(0, 255), message ? String(message).slice(0, 1000) : null])],
    );
  } catch (err) {
    console.error("BUSINESS PLAN NOTIFICATION ERROR:", err.message);
  }
};

// "please approve" alerts for an item are done once somebody acts on it
const clearActionNotifications = async (refId, types) => {
  try {
    await db.query(
      `UPDATE beat_notifications SET is_read = 1, read_at = NOW()
       WHERE ref_id = ? AND plan_id IS NULL AND is_read = 0 AND type IN (?)`,
      [refId, types],
    );
  } catch (err) {
    console.error("BUSINESS PLAN NOTIFICATION ERROR:", err.message);
  }
};

module.exports = {
  ENTITY_TYPES,
  ADMIN_ROLES,
  STEP_LABEL,
  parseRoles,
  roleNames,
  isFinalRole,
  buildChain,
  listSteps,
  lastRound,
  createRound,
  markLevelDone,
  lockPendingStep,
  actOnStep,
  activateNext,
  skipOpen,
  pendingEntityIds,
  isApproverOf,
  hasPendingPoolStep,
  adminUserIds,
  notify,
  clearActionNotifications,
};
