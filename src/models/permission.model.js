const db = require("../config/db");

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];

// Role and permissions are always read from the database, so a change takes
// effect on the next request and old JWT values are never trusted.
const getUserAccess = async (userId) => {
  const [users] = await db.query(
    `SELECT u.id, u.is_active, r.name AS role
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = ?`,
    [userId],
  );
  if (!users.length) return null;

  const [rows] = await db.query(
    `SELECT p.code
     FROM user_permissions up
     JOIN permissions p ON p.id = up.permission_id
     WHERE up.user_id = ? AND up.is_allowed = 1`,
    [userId],
  );

  return {
    id: users[0].id,
    role: users[0].role,
    isActive: Number(users[0].is_active) !== 0,
    isAdmin: ADMIN_ROLES.includes(users[0].role),
    codes: new Set(rows.map((r) => r.code)),
  };
};

const getAllPermissions = async () => {
  const [rows] = await db.query(
    `SELECT id, name, code, module FROM permissions ORDER BY module ASC, id ASC`,
  );
  return rows;
};

const getAllowedPermissionIds = async (userId) => {
  const [rows] = await db.query(
    `SELECT permission_id FROM user_permissions
     WHERE user_id = ? AND is_allowed = 1`,
    [userId],
  );
  return rows.map((r) => r.permission_id);
};

// Replaces the user's allowed set in one transaction.
// Existing rows are switched off, never deleted, so history stays in the table.
const setUserPermissions = async (userId, permissionIds) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `SELECT permission_id FROM user_permissions WHERE user_id = ? FOR UPDATE`,
      [userId],
    );
    await conn.query(
      `UPDATE user_permissions SET is_allowed = 0 WHERE user_id = ?`,
      [userId],
    );

    if (permissionIds.length) {
      await conn.query(
        `UPDATE user_permissions SET is_allowed = 1
         WHERE user_id = ? AND permission_id IN (?)`,
        [userId, permissionIds],
      );
      const [existing] = await conn.query(
        `SELECT permission_id FROM user_permissions
         WHERE user_id = ? AND permission_id IN (?)`,
        [userId, permissionIds],
      );
      const found = new Set(existing.map((r) => r.permission_id));
      const missing = permissionIds.filter((id) => !found.has(id));

      if (missing.length) {
        await conn.query(
          `INSERT INTO user_permissions (user_id, permission_id, is_allowed) VALUES ?`,
          [missing.map((id) => [userId, id, 1])],
        );
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const USER_FROM = `
  FROM users u
  LEFT JOIN roles r ON r.id = u.role_id
  LEFT JOIN job_roles jr ON jr.id = u.job_role_id
  LEFT JOIN department d ON d.id = u.department_id`;

const HAS_ANY_PERMISSION = `EXISTS (
  SELECT 1 FROM user_permissions up
  WHERE up.user_id = u.id AND up.is_allowed = 1
)`;

const ADMIN_ROLE_SQL = `r.name IN ('ADMIN', 'SUPER_ADMIN')`;

// Super Admin page: users, their permissions and the totals for the header
const listUsersWithPermissions = async ({
  search,
  role,
  status,
  departmentId,
  access,
  permissionCode,
  page,
  limit,
}) => {
  const where = ["1=1"];
  const params = [];

  if (search) {
    where.push("(u.name LIKE ? OR u.email LIKE ? OR u.contact_no LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (role) {
    where.push("r.name = ?");
    params.push(role);
  }
  if (status === "active") where.push("u.is_active = 1");
  if (status === "inactive") where.push("u.is_active = 0");
  if (departmentId) {
    where.push("u.department_id = ?");
    params.push(departmentId);
  }
  if (access === "granted") where.push(`(${ADMIN_ROLE_SQL} OR ${HAS_ANY_PERMISSION})`);
  if (access === "none") {
    where.push(`NOT (COALESCE(${ADMIN_ROLE_SQL}, 0) OR ${HAS_ANY_PERMISSION})`);
  }
  if (permissionCode) {
    where.push(`(${ADMIN_ROLE_SQL} OR EXISTS (
      SELECT 1 FROM user_permissions up2
      JOIN permissions p2 ON p2.id = up2.permission_id
      WHERE up2.user_id = u.id AND up2.is_allowed = 1 AND p2.code = ?
    ))`);
    params.push(permissionCode);
  }

  const whereSql = where.join(" AND ");

  const [[summary]] = await db.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN ${ADMIN_ROLE_SQL} THEN 1 ELSE 0 END), 0) AS full_access,
            COALESCE(SUM(CASE WHEN ${HAS_ANY_PERMISSION} THEN 1 ELSE 0 END), 0) AS with_permissions
     ${USER_FROM}
     WHERE ${whereSql}`,
    params,
  );

  const [users] = await db.query(
    `SELECT u.id, u.name, u.email, u.contact_no, u.is_active,
            r.name AS role, jr.name AS job_role, d.name AS department
     ${USER_FROM}
     WHERE ${whereSql}
     ORDER BY u.is_active DESC, u.name ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  const granted = new Map();
  if (users.length) {
    const [rows] = await db.query(
      `SELECT up.user_id, p.code
       FROM user_permissions up
       JOIN permissions p ON p.id = up.permission_id
       WHERE up.is_allowed = 1 AND up.user_id IN (?)`,
      [users.map((u) => u.id)],
    );
    rows.forEach((r) => {
      granted.set(r.user_id, [...(granted.get(r.user_id) || []), r.code]);
    });
  }

  return {
    summary,
    users: users.map((u) => ({ ...u, permissions: granted.get(u.id) || [] })),
  };
};

const getUserSummary = async (userId) => {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email, u.contact_no, u.is_active,
            r.name AS role, jr.name AS job_role, d.name AS department
     ${USER_FROM}
     WHERE u.id = ?`,
    [userId],
  );
  return rows[0] || null;
};

module.exports = { listUsersWithPermissions, getUserSummary,
  ADMIN_ROLES, getUserAccess, getAllPermissions, getAllowedPermissionIds, setUserPermissions, };