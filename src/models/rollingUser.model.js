const db = require("../config/db");

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

const getUsersByLevelAndHierarchy = async ( level, userIds ) => {

  const [rows] = await db.query(
    ` SELECT
      u.id,
      u.name,
      jr.name AS role_name,
      jr.level
    FROM users u
    JOIN job_roles jr
      ON jr.id = u.job_role_id
    WHERE jr.level = ?
    AND u.id IN (${userIds.map(() => "?").join(",")})
    ORDER BY u.name
    `,
    [level, ...userIds]
  );

  return rows;
};

module.exports = {  getUserWithRole, getDirectSubordinates, getUsersByLevelAndHierarchy };