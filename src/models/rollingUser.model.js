const db = require("../config/db");

// ===============================
// GET SINGLE USER
// ===============================
const getUserWithRole = async (userId) => {
  const [rows] = await db.query(
    `SELECT 
        u.id,
        u.name,
        u.contact_no,
        u.reporting_under,
        jr.id AS job_role_id,
        jr.name AS job_role,
        jr.level
     FROM users u
     LEFT JOIN job_roles jr 
        ON u.job_role_id = jr.id
     WHERE u.id = ?`,
    [userId]
  );

  return rows[0];
};

// ===============================
// GET DIRECT SUBORDINATES
// ===============================
const getDirectSubordinates = async (userId) => {
  const [rows] = await db.query(
    `SELECT 
        u.id,
        u.name,
        u.contact_no,
        u.reporting_under,
        jr.id AS job_role_id,
        jr.name AS job_role,
        jr.level
     FROM users u
     LEFT JOIN job_roles jr 
        ON u.job_role_id = jr.id
     WHERE u.reporting_under = ?`,
    [userId]
  );

  return rows;
};

module.exports = {
  getUserWithRole,
  getDirectSubordinates
};