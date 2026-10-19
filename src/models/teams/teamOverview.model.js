const db = require("../../config/db");

// Logged-in user (for top card + privacy flag)
exports.getCurrentUser = async (userId) => {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.contact_no, u.reporting_under, u.headquarter,
            u.profile_image, jr.id AS job_role_id, jr.name AS job_role, jr.level
     FROM users u
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     WHERE u.id = ?`,
    [userId]
  );
  return rows[0] || null;
};

// Every role in the company, top -> bottom (for ZM → RSM → ... → FA chips)
exports.getRoleChain = async () => {
  const [rows] = await db.query(
    `SELECT id, name, level FROM job_roles WHERE is_active = 1 ORDER BY level ASC`
  );
  return rows;
};

// All active users below `userId` (all levels) + their attendance for today
exports.getTeamWithTodayAttendance = async (userId) => {
  const [rows] = await db.query(
    `WITH RECURSIVE team AS (
        SELECT id, 1 AS depth FROM users WHERE reporting_under = ?
        UNION ALL
        SELECT u.id, t.depth + 1
        FROM users u
        JOIN team t ON u.reporting_under = t.id
        WHERE t.depth < 15
     )
     SELECT
        u.id, u.name, u.contact_no, u.reporting_under, u.headquarter,
        u.profile_image,
        jr.id   AS job_role_id,
        jr.name AS job_role,
        jr.level,
        ea.status          AS attendance_status,
        ea.work_type,
        ea.field_work_type,
        ea.visit_location
     FROM team t
     JOIN users u ON u.id = t.id
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     LEFT JOIN emp_attendance ea
            ON ea.employee_id = u.id AND ea.attendance_date = CURDATE()
     WHERE u.is_active = 1
     ORDER BY jr.level ASC, u.name ASC`,
    [userId]
  );
  return rows;
};
