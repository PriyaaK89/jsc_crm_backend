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

module.exports = {
  ADMIN_ROLES,
  getUserAccess,
  getAllPermissions,
  getAllowedPermissionIds,
  setUserPermissions,
};
