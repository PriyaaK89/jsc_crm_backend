const db = require("../../config/db");

const TASK_DEPARTMENT_ID = 2;

const TASK_SELECT = `
  SELECT
    t.id, t.title, t.description, t.priority, t.status, t.deadline,
    t.allowed_actions, t.proof_required, t.comment,
    t.started_at, t.completed_at, t.created_at, t.updated_at,
    t.assigned_by, ab.name AS assigned_by_name, abjr.name AS assigned_by_role,
    t.assigned_to, ae.name AS assigned_to_name, aejr.name AS assigned_to_role
  FROM tasks t
  LEFT JOIN users ab ON ab.id = t.assigned_by
  LEFT JOIN job_roles abjr ON abjr.id = ab.job_role_id
  LEFT JOIN users ae ON ae.id = t.assigned_to
  LEFT JOIN job_roles aejr ON aejr.id = ae.job_role_id
`;

const hasPermission = async (userId, code) => {
    const [rows] = await db.query(
        `SELECT 1
     FROM user_permissions up
     JOIN permissions p ON p.id = up.permission_id
     WHERE up.user_id = ? AND p.code = ? AND up.is_allowed = 1
     LIMIT 1`,
        [userId, code]
    );
    return rows.length > 0;
};
// ---------- Assigner context ----------
const getAssignerContext = async (userId) => {
    const [rows] = await db.query(
        `SELECT u.id, u.name, r.name AS role, jr.name AS job_role, jr.level
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     WHERE u.id = ?`,
        [userId]
    );
    return rows[0];
};

// ---------- Dropdown data ----------
// teamIds === null -> unrestricted (admin / has access): everyone in department 2
const getAssignableRoles = async (teamIds, excludeId) => {
  if (teamIds !== null && teamIds.length === 0) return [];

  const params = [TASK_DEPARTMENT_ID, excludeId];
  let teamFilter = "";
  if (teamIds !== null) {
    teamFilter = "AND u.id IN (?)";
    params.push(teamIds);
  }

  const [rows] = await db.query(
    `SELECT DISTINCT jr.id, jr.name, jr.level
     FROM users u
     JOIN job_roles jr ON jr.id = u.job_role_id AND jr.is_active = 1
     WHERE u.is_active = 1
       AND u.department_id = ?
       AND u.id <> ?
       ${teamFilter}
     ORDER BY jr.level`,
    params
  );
  return rows;
};

const getAssignableUsers = async (jobRoleId, teamIds, excludeId) => {
  if (teamIds !== null && teamIds.length === 0) return [];

  const params = [jobRoleId, TASK_DEPARTMENT_ID, excludeId];
  let teamFilter = "";
  if (teamIds !== null) {
    teamFilter = "AND u.id IN (?)";
    params.push(teamIds);
  }

  const [rows] = await db.query(
    `SELECT u.id, u.name, u.contact_no, jr.name AS job_role
     FROM users u
     JOIN job_roles jr ON jr.id = u.job_role_id
     WHERE u.is_active = 1
       AND u.job_role_id = ?
       AND u.department_id = ?
       AND u.id <> ?
       ${teamFilter}
     ORDER BY u.name`,
    params
  );
  return rows;
};

const findAssignableUser = async (userId, teamIds, excludeId) => {
  if (teamIds !== null && teamIds.length === 0) return null;

  const params = [userId, TASK_DEPARTMENT_ID, excludeId];
  let teamFilter = "";
  if (teamIds !== null) {
    teamFilter = "AND id IN (?)";
    params.push(teamIds);
  }

  const [rows] = await db.query(
    `SELECT id, name
     FROM users
     WHERE id = ? AND is_active = 1 AND department_id = ? AND id <> ? ${teamFilter}`,
    params
  );
  return rows[0] || null;
};

// ---------- Tasks ----------
const createTask = async (t) => {
    const [result] = await db.query(
        `INSERT INTO tasks
      (title, description, priority, assigned_by, assigned_to, deadline,
       allowed_actions, proof_required)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            t.title,
            t.description || null,
            t.priority,
            t.assigned_by,
            t.assigned_to,
            t.deadline,
            JSON.stringify(t.allowed_actions),
            t.proof_required ? 1 : 0,
        ]
    );
    return result.insertId;
};

const getTaskById = async (id) => {
    const [rows] = await db.query(`${TASK_SELECT} WHERE t.id = ?`, [id]);
    return rows[0] || null;
};

// column must be "assigned_to" or "assigned_by" (internal use only)
const getTasksByColumn = async (column, userId, { status, page, limit }) => {
    const where = [`t.${column} = ?`];
    const params = [userId];
    if (status) {
        where.push("t.status = ?");
        params.push(status);
    }
    const whereSql = where.join(" AND ");
    const offset = (page - 1) * limit;

    const [rows] = await db.query(
        `${TASK_SELECT}
     WHERE ${whereSql}
     ORDER BY (t.status = 'COMPLETED') ASC, t.deadline ASC
     LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    const [[{ total }]] = await db.query(
        `SELECT COUNT(*) AS total FROM tasks t WHERE ${whereSql}`,
        params
    );

    return { rows, total };
};

// Guarded transitions: affectedRows === 0 means "not allowed right now"
const startTask = async (taskId, userId) => {
    const [r] = await db.query(
        `UPDATE tasks SET status = 'IN_PROGRESS', started_at = NOW()
     WHERE id = ? AND assigned_to = ? AND status = 'PENDING'`,
        [taskId, userId]
    );
    return r.affectedRows > 0;
};

const completeTask = async (taskId, userId, comment) => {
    const [r] = await db.query(
        `UPDATE tasks
     SET status = 'COMPLETED',
         completed_at = NOW(),
         started_at = COALESCE(started_at, NOW()),
         comment = COALESCE(?, comment)
     WHERE id = ? AND assigned_to = ? AND status IN ('PENDING','IN_PROGRESS')`,
        [comment || null, taskId, userId]
    );
    return r.affectedRows > 0;
};

const updateComment = async (taskId, userId, comment) => {
    const [r] = await db.query(
        `UPDATE tasks SET comment = ?
     WHERE id = ? AND assigned_to = ? AND status <> 'COMPLETED'`,
        [comment, taskId, userId]
    );
    return r.affectedRows > 0;
};

// ---------- Proofs ----------
const addProofs = async (rows) => {
    // rows: [[task_id, file_path, file_name, mime_type, uploaded_by], ...]
    await db.query(
        `INSERT INTO task_proofs (task_id, file_path, file_name, mime_type, uploaded_by)
     VALUES ?`,
        [rows]
    );
};

const getProofsByTaskIds = async (taskIds) => {
    if (taskIds.length === 0) return [];
    const [rows] = await db.query(
        `SELECT id, task_id, file_path, file_name, mime_type, created_at
     FROM task_proofs WHERE task_id IN (?) ORDER BY id`,
        [taskIds]
    );
    return rows;
};

const countProofs = async (taskId) => {
    const [[row]] = await db.query(
        `SELECT COUNT(*) AS c FROM task_proofs WHERE task_id = ?`,
        [taskId]
    );
    return row.c;
};

module.exports = {
    getAssignerContext,
    getAssignableRoles,
    getAssignableUsers,
    findAssignableUser,
    createTask,
    getTaskById,
    getTasksByColumn,
    startTask,
    completeTask,
    updateComment,
    addProofs,
    getProofsByTaskIds,
    countProofs,
};