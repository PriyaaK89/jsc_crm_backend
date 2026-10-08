const db = require("../../config/db");

const SALES_TXN_TYPE = "SALES"; // transaction_approvals.transaction_type

// ---------- user / peers ----------
exports.getUserBasic = async (userId) => {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.reporting_under, u.job_role_id, u.department_id,
            jr.name AS role_name, jr.level
     FROM users u
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     WHERE u.id = ?`,
    [userId]
  );
  return rows[0] || null;
};

// scope "team": same manager + same job role
// scope "role": same job role + same department
exports.getPeerIds = async (user, scope, limit = 80) => {
  let where;
  let params;

  if (scope === "role") {
    where = "u.job_role_id <=> ? AND u.department_id <=> ?";
    params = [user.job_role_id, user.department_id];
  } else {
    if (user.reporting_under == null) return [user.id]; // top of the hierarchy
    where = "u.job_role_id <=> ? AND u.reporting_under = ?";
    params = [user.job_role_id, user.reporting_under];
  }

  const [rows] = await db.query(
    `SELECT u.id FROM users u
     WHERE u.is_active = 1 AND ${where}
     ORDER BY u.id LIMIT ?`,
    [...params, limit]
  );

  const ids = rows.map((r) => r.id);
  if (!ids.includes(user.id)) {
    if (ids.length >= limit) ids.pop();
    ids.push(user.id);
  }
  return ids;
};

// ---------- calendar ----------
exports.getHolidayDates = async (start, end) => {
  const [rows] = await db.query(
    `SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS d
     FROM company_holidays
     WHERE holiday_date BETWEEN ? AND ?`,
    [start, end]
  );
  return new Set(rows.map((r) => r.d));
};

// ---------- attendance ----------
exports.getAttendanceRows = async (userIds, start, end) => {
  if (!userIds.length) return [];
  const [rows] = await db.query(
    `SELECT employee_id,
            DATE_FORMAT(attendance_date, '%Y-%m-%d') AS d,
            status, attendance_unit, work_type, late_login
     FROM emp_attendance
     WHERE employee_id IN (?) AND attendance_date BETWEEN ? AND ?`,
    [userIds, start, end]
  );
  return rows;
};

exports.getFirstAttendanceDates = async (userIds) => {
  const out = new Map();
  if (!userIds.length) return out;
  const [rows] = await db.query(
    `SELECT employee_id, DATE_FORMAT(MIN(attendance_date), '%Y-%m-%d') AS d
     FROM emp_attendance
     WHERE employee_id IN (?)
     GROUP BY employee_id`,
    [userIds]
  );
  rows.forEach((r) => out.set(r.employee_id, r.d));
  return out;
};

// ---------- visits ----------
exports.getVisitCountsByDay = async (userIds, start, end) => {
  if (!userIds.length) return [];
  const [rows] = await db.query(
    `SELECT user_id, DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS c
     FROM visits
     WHERE user_id IN (?)
       AND created_at >= ?
       AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY user_id, d`,
    [userIds, start, end]
  );
  return rows;
};

// ---------- employee targets (sale / collection / new distributor) ----------
exports.getMonthlyTargets = async (userIds, start, end) => {
  if (!userIds.length) return [];
  const [rows] = await db.query(
    `SELECT et.id, et.user_id, et.target_type,
            DATE_FORMAT(et.start_date, '%Y-%m-%d') AS start_date,
            DATE_FORMAT(et.end_date, '%Y-%m-%d') AS end_date,
            et.target_amount,
            (SELECT GROUP_CONCAT(etc.category_id)
               FROM employee_target_categories etc
              WHERE etc.employee_target_id = et.id) AS category_ids
     FROM employee_targets et
     WHERE et.user_id IN (?)
       AND et.duration_type = 'MONTHLY'
       AND et.start_date <= ?
       AND et.end_date >= ?`,
    [userIds, end, start]
  );
  return rows;
};

// ---------- visit target (assignment system, same data as the dashboard card) ----------
// Returns Map(employeeId -> { target, achieved }) for assignments overlapping
// [start, end]; visits are counted only up to `end` and only for visit types
// that have a target (same rule as getAssignmentProgress).
exports.getVisitTargetTotals = async (userIds, start, end) => {
  const out = new Map();
  if (!userIds.length) return out;

  const [targetRows] = await db.query(
    `SELECT a.employee_id, SUM(d.target_value) AS target_total
     FROM visit_target_assignments a
     JOIN visit_target_assignment_details d ON d.assignment_id = a.id
     WHERE a.employee_id IN (?) AND a.period_start <= ? AND a.period_end >= ?
     GROUP BY a.employee_id`,
    [userIds, end, start]
  );

  const [achievedRows] = await db.query(
    `SELECT a.employee_id, COUNT(v.id) AS achieved
     FROM visit_target_assignments a
     JOIN visits v
       ON v.user_id = a.employee_id
      AND v.created_at >= a.period_start
      AND v.created_at < DATE_ADD(LEAST(a.period_end, CAST(? AS DATE)), INTERVAL 1 DAY)
      AND EXISTS (
        SELECT 1 FROM visit_target_assignment_details d
        WHERE d.assignment_id = a.id AND d.visit_type = v.visit_type
      )
     WHERE a.employee_id IN (?) AND a.period_start <= ? AND a.period_end >= ?
     GROUP BY a.employee_id`,
    [end, userIds, end, start]
  );

  targetRows.forEach((r) =>
    out.set(r.employee_id, { target: Number(r.target_total) || 0, achieved: 0 })
  );
  achievedRows.forEach((r) => {
    const row = out.get(r.employee_id);
    if (row) row.achieved = Number(r.achieved) || 0;
  });
  return out;
};

// ---------- follow-ups ----------
// Reminders whose reminder_date is inside [start, end].
// closed_on_time = Mark Visited on/before the reminder date, OR a later visit
// (on a later calendar day than the original visit) to the same customer on/before it.
// due = closed on time, or the reminder date has already passed.
exports.getFollowUpStats = async (userIds, start, end, today) => {
  const out = new Map();
  if (!userIds.length) return out;

  const [rows] = await db.query(
    `SELECT t.user_id,
            SUM(CASE WHEN t.closed_on_time = 1 OR t.reminder_date < ? THEN 1 ELSE 0 END) AS due_count,
            SUM(CASE WHEN t.closed_on_time = 1 THEN 1 ELSE 0 END) AS closed_count
     FROM (
       SELECT v.user_id, v.reminder_date,
              CASE WHEN (
                (v.reminder_status = 'DONE'
                  AND v.reminder_done_at IS NOT NULL
                  AND DATE(v.reminder_done_at) <= v.reminder_date)
                OR EXISTS (
                  SELECT 1 FROM visits v2
                  WHERE v2.user_id = v.user_id
                    AND v2.customer_id = v.customer_id
                    AND v2.id > v.id
                    AND DATE(v2.created_at) > DATE(v.created_at)
                    AND DATE(v2.created_at) <= v.reminder_date
                )
              ) THEN 1 ELSE 0 END AS closed_on_time
       FROM visits v
       WHERE v.user_id IN (?)
         AND v.reminder_date IS NOT NULL
         AND v.reminder_date BETWEEN ? AND ?
     ) t
     GROUP BY t.user_id`,
    [today, userIds, start, end]
  );

  rows.forEach((r) =>
    out.set(r.user_id, { due: Number(r.due_count) || 0, closed: Number(r.closed_count) || 0 })
  );
  return out;
};

// Reminders still open (not closed by anything) that can yet be closed on time
exports.getOpenFollowUps = async (userId, from, to) => {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS cnt
     FROM visits v
     WHERE v.user_id = ?
       AND v.reminder_date IS NOT NULL
       AND v.reminder_date BETWEEN ? AND ?
       AND v.reminder_status = 'PENDING'
       AND NOT EXISTS (
         SELECT 1 FROM visits v2
         WHERE v2.user_id = v.user_id
           AND v2.customer_id = v.customer_id
           AND v2.id > v.id
           AND DATE(v2.created_at) > DATE(v.created_at)
       )`,
    [userId, from, to]
  );
  return Number(row.cnt) || 0;
};

// ---------- orders / overdue (badges + suggestions) ----------
exports.getOrderDates = async (userId, start, end) => {
  const [rows] = await db.query(
    `SELECT DISTINCT DATE_FORMAT(created_at, '%Y-%m-%d') AS d
     FROM transaction_approvals
     WHERE created_by = ?
       AND transaction_type = ?
       AND created_at >= ?
       AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [userId, SALES_TXN_TYPE, start, end]
  );
  return rows.map((r) => r.d);
};

exports.getOverdueSummary = async (userId, today) => {
  const [[row]] = await db.query(
    `SELECT COUNT(DISTINCT sbr.ledger_id) AS parties,
            COALESCE(SUM(sbr.pending_amount), 0) AS amount
     FROM sales_bill_references sbr
     INNER JOIN ledgers l ON l.id = sbr.ledger_id AND l.employee_under = ?
     WHERE sbr.pending_amount > 0
       AND sbr.due_date IS NOT NULL
       AND sbr.due_date < ?
       AND sbr.status IN ('PENDING', 'PARTIAL')`,
    [userId, today]
  );
  return { parties: Number(row.parties) || 0, amount: Number(row.amount) || 0 };
};