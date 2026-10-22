const db = require("../../config/db");

// one attendance row per employee per day, so the LEFT JOIN never duplicates users
const MEMBER_COLS = `
  u.id, u.name, u.contact_no, u.reporting_under, u.headquarter, u.profile_image,
  jr.id AS job_role_id, jr.name AS job_role, jr.level,
  ea.status AS attendance_status, ea.work_type, ea.field_work_type,
  ea.visit_location, ea.day_over_location`;

const MEMBER_JOINS = `
  LEFT JOIN job_roles jr ON jr.id = u.job_role_id
  LEFT JOIN emp_attendance ea
         ON ea.employee_id = u.id AND ea.attendance_date = CURDATE()`;

const TEAM_CTE = `
  WITH RECURSIVE team AS (
    SELECT id, 1 AS depth FROM users WHERE reporting_under = ?
    UNION ALL
    SELECT u.id, t.depth + 1
    FROM users u JOIN team t ON u.reporting_under = t.id
    WHERE t.depth < 15
  )`;

exports.getRoleChain = async () => {
  const [rows] = await db.query(
    `SELECT id, name, level FROM job_roles WHERE is_active = 1 ORDER BY level ASC`
  );
  return rows;
};

exports.getMemberWithAttendance = async (userId) => {
  const [rows] = await db.query(
    `SELECT ${MEMBER_COLS} FROM users u ${MEMBER_JOINS} WHERE u.id = ?`,
    [userId]
  );
  return rows[0] || null;
};

exports.getDirectReportsWithAttendance = async (managerId) => {
  const [rows] = await db.query(
    `SELECT ${MEMBER_COLS}
     FROM users u ${MEMBER_JOINS}
     WHERE u.reporting_under = ? AND u.is_active = 1
     ORDER BY jr.level ASC, u.name ASC`,
    [managerId]
  );
  return rows;
};

// All users below `userId` (every level), found level by level.
// Works on any MySQL version (no recursive CTE needed).
exports.getSubtreeIds = async (userId) => {
  const all = [];
  const seen = new Set([Number(userId)]);
  let frontier = [Number(userId)];

  for (let depth = 0; depth < 15 && frontier.length; depth++) {
    const [rows] = await db.query(
      `SELECT id FROM users WHERE reporting_under IN (?)`,
      [frontier]
    );
    frontier = [];
    for (const r of rows) {
      if (seen.has(r.id)) continue; // guards against bad data / loops
      seen.add(r.id);
      all.push(r.id);
      frontier.push(r.id);
    }
  }
  return all;
};

exports.getTeamWithTodayAttendance = async (userId) => {
  const ids = await exports.getSubtreeIds(userId);
  if (!ids.length) return [];

  const [rows] = await db.query(
    `SELECT ${MEMBER_COLS}
     FROM users u
     ${MEMBER_JOINS}
     WHERE u.id IN (?) AND u.is_active = 1
     ORDER BY jr.level ASC, u.name ASC`,
    [ids]
  );
  return rows;
};

// access check: is memberId anywhere below managerId?
exports.isInHierarchy = async (managerId, memberId) => {
  const ids = await exports.getSubtreeIds(managerId);
  return ids.includes(Number(memberId));
};

exports.getVisitsTodayCount = async (userId) => {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS c FROM visits
     WHERE user_id = ?
       AND created_at >= CURDATE()
       AND created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`,
    [userId]
  );
  return Number(row.c) || 0;
};

// Latest GPS point recorded today. Uses idx_employee_date (employee_id, recorded_at).
exports.getLatestLocationToday = async (userId) => {
  const [rows] = await db.query(
    `SELECT latitude, longitude, accuracy, recorded_at,
            TIMESTAMPDIFF(MINUTE, recorded_at, NOW()) AS minutes_ago
     FROM employee_locations
     WHERE employee_id = ? AND recorded_at >= CURDATE()
     ORDER BY recorded_at DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
};

// current-month present / absent / leave (same rules as the existing monthly summary)
exports.getMonthAttendanceCounts = async (userId) => {
  const [[row]] = await db.query(
    `SELECT
       SUM(status IN ('present','day_over')) AS present_days,
       SUM(attendance_unit = 'absent')       AS absent_days,
       SUM(status = 'leave')                 AS leave_days
     FROM emp_attendance
     WHERE employee_id = ?
       AND attendance_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
       AND attendance_date <  DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)`,
    [userId]
  );
  return {
    present: Number(row.present_days) || 0,
    absent: Number(row.absent_days) || 0,
    leave: Number(row.leave_days) || 0,
  };
};

// ASSUMPTION: "planned" = follow-up reminders due today, "completed" = marked DONE
exports.getTodayPlanStats = async (userId) => {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS planned,
            COALESCE(SUM(reminder_status = 'DONE'), 0) AS completed
     FROM visits
     WHERE user_id = ? AND reminder_date = CURDATE()`,
    [userId]
  );
  const planned = Number(row.planned) || 0;
  const completed = Number(row.completed) || 0;
  return { planned, completed, pending: Math.max(planned - completed, 0) };
};

// visits logged today with GPS, for the "Live Beat Map"
exports.getTodayVisitPoints = async (userId) => {
  const [rows] = await db.query(
    `SELECT v.id, v.latitude, v.longitude, v.visit_type, v.created_at,
            c.name AS customer_name
     FROM visits v
     LEFT JOIN customers c ON c.id = v.customer_id
     WHERE v.user_id = ?
       AND v.created_at >= CURDATE()
       AND v.created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
       AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL
     ORDER BY v.created_at ASC
     LIMIT 50`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    visit_type: r.visit_type,
    customer_name: r.customer_name,
    created_at: r.created_at,
  }));
};