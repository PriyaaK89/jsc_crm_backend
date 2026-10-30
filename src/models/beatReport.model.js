const db = require("../config/db");

// condition used everywhere: a plan day counts only when its plan is APPROVED
// and the day itself is not a pending / rejected add-on day
const APPROVED_DAY = `p.status = 'APPROVED' AND (d.amend_status IS NULL OR d.amend_status = 'APPROVED')`;

// ---------------------------------------------------------------------
//  SETTINGS  (change here if your data is organised differently)
// ---------------------------------------------------------------------

// which amount of a sale counts as "sales":  subtotal (without GST) | total_amount (with GST)
const SALES_AMOUNT_COL = "subtotal";

// which employee a sale belongs to: the employee it is booked under
// (employee_under_id), else the assigned employee, else the employee who raised the
// order (created_by – the sales flow saves the employee who created the order there)
const SALES_OWNER = "COALESCE(s.employee_under_id, s.assign_employee_id, s.created_by)";

// which employee a receipt (collection) belongs to
const RECEIPT_OWNER = "COALESCE(r.employee_under_id, r.created_by)";

// display name of a customer: the shop / firm name, else the person's name
const PARTY_NAME = `COALESCE(NULLIF(c.firm_name, ''), c.name)`;

// the calendar day (India) of a timestamp column – works whether the DB runs in UTC or IST
const IST_DAY = (col) =>
  `DATE(CONVERT_TZ(${col}, @@session.time_zone, '+05:30'))`;

// ---------------------------------------------------------------------
//  TEAM TODAY
// ---------------------------------------------------------------------
const getAttendanceForDay = async (userIds, date) => {
  if (!userIds.length) return [];
  const [rows] = await db.query(
    `SELECT employee_id, status
     FROM emp_attendance
     WHERE employee_id IN (?) AND attendance_date = ?`,
    [userIds, date],
  );
  return rows;
};

// Map(user_id -> { parties, sales_target }) for the user's approved beat of that day
const getPlannedForDay = async (userIds, date) => {
  const out = new Map();
  if (!userIds.length) return out;
  const [rows] = await db.query(
    `SELECT p.user_id,
            (SELECT COUNT(*) FROM beat_parties bp WHERE bp.beat_id = d.beat_id) AS parties,
            d.sales_target
     FROM beat_plan_days d
     JOIN beat_weekly_plans p ON p.id = d.plan_id
     WHERE p.user_id IN (?) AND d.plan_date = ? AND ${APPROVED_DAY}`,
    [userIds, date],
  );
  rows.forEach((r) =>
    out.set(r.user_id, {
      parties: Number(r.parties) || 0,
      sales_target: Number(r.sales_target) || 0,
    }),
  );
  return out;
};

// ---------------------------------------------------------------------
//  LIVE NUMBERS  (visits / sales / collection per employee per day)
//  every Map key is  "<user_id>|<YYYY-MM-DD>"
// ---------------------------------------------------------------------

// visits: how many visits and how many different customers
const getVisitsByUserDate = async (userIds, start, end) => {
  const out = new Map();
  if (!userIds.length) return out;

  const [rows] = await db.query(
    `SELECT v.user_id,
            DATE_FORMAT(${IST_DAY("v.created_at")}, '%Y-%m-%d') AS d,
            COUNT(*) AS visits,
            COUNT(DISTINCT v.customer_id) AS customers
     FROM visits v
     WHERE v.user_id IN (?)
       AND ${IST_DAY("v.created_at")} BETWEEN ? AND ?
     GROUP BY v.user_id, d`,
    [userIds, start, end],
  );

  rows.forEach((r) =>
    out.set(`${r.user_id}|${r.d}`, {
      visits: Number(r.visits) || 0,
      customers: Number(r.customers) || 0,
    }),
  );
  return out;
};

// sales ORDERS created by the employee (transaction_approvals, type SALES).
// An order created = an "order received" = a productive visit.
// (rejected orders are not counted)
const getOrdersByUserDate = async (userIds, start, end) => {
  const out = new Map();
  if (!userIds.length) return out;

  const [rows] = await db.query(
    `SELECT t.created_by AS user_id,
            DATE_FORMAT(${IST_DAY("t.created_at")}, '%Y-%m-%d') AS d,
            COUNT(*) AS orders
     FROM transaction_approvals t
     WHERE t.transaction_type = 'SALES'
       AND t.status <> 'REJECTED'
       AND t.created_by IN (?)
       AND ${IST_DAY("t.created_at")} BETWEEN ? AND ?
     GROUP BY t.created_by, d`,
    [userIds, start, end],
  );

  rows.forEach((r) => out.set(`${r.user_id}|${r.d}`, Number(r.orders) || 0));
  return out;
};

// sales booked (rows of the `sales` table)
const getSalesByUserDate = async (userIds, start, end) => {
  const out = new Map();
  if (!userIds.length) return out;

  const [rows] = await db.query(
    `SELECT ${SALES_OWNER} AS emp_id,
            DATE_FORMAT(s.sales_date, '%Y-%m-%d') AS d,
            SUM(s.${SALES_AMOUNT_COL}) AS amount
     FROM sales s
     WHERE DATE(s.sales_date) BETWEEN ? AND ?
       AND ${SALES_OWNER} IN (?)
     GROUP BY emp_id, d`,
    [start, end, userIds],
  );

  rows.forEach((r) => out.set(`${r.emp_id}|${r.d}`, Number(r.amount) || 0));
  return out;
};

// money received (rows of the `receipts` table)
const getCollectionsByUserDate = async (userIds, start, end) => {
  const out = new Map();
  if (!userIds.length) return out;

  const [rows] = await db.query(
    `SELECT ${RECEIPT_OWNER} AS emp_id,
            DATE_FORMAT(r.receipt_date, '%Y-%m-%d') AS d,
            SUM(r.total_amount) AS amount
     FROM receipts r
     WHERE DATE(r.receipt_date) BETWEEN ? AND ?
       AND ${RECEIPT_OWNER} IN (?)
     GROUP BY emp_id, d`,
    [start, end, userIds],
  );

  rows.forEach((r) => out.set(`${r.emp_id}|${r.d}`, Number(r.amount) || 0));
  return out;
};

// Map(user_id -> total) between two dates, built from a "<user>|<date>" map
const sumByUser = (byUserDate) => {
  const out = new Map();
  byUserDate.forEach((amount, key) => {
    const uid = Number(key.split("|")[0]);
    out.set(uid, (out.get(uid) || 0) + amount);
  });
  return out;
};

const getSalesTotals = async (userIds, start, end) =>
  sumByUser(await getSalesByUserDate(userIds, start, end));

// ---------------------------------------------------------------------
//  APPROVED PLAN DAYS  (the base of every performance number)
//  parties = customers in the planned beat
//  done    = how many of those customers the employee really visited that day
// ---------------------------------------------------------------------
// planOwnerIds: only plans of these employees
// beatOwnerIds: only beats assigned to these employees
const getApprovedDays = async ({ planOwnerIds = null, beatOwnerIds = null, start, end }) => {
  const where = ["d.plan_date BETWEEN ? AND ?", APPROVED_DAY];
  const params = [start, end];

  if (planOwnerIds) {
    where.push("p.user_id IN (?)");
    params.push(planOwnerIds);
  }
  if (beatOwnerIds) {
    where.push("b.assigned_user_id IN (?)");
    params.push(beatOwnerIds);
  }

  const [rows] = await db.query(
    `SELECT pd.beat_id, pd.beat_name, pd.user_id, pd.user_name,
            DATE_FORMAT(pd.plan_date, '%Y-%m-%d') AS plan_date,
            MAX(pd.sales_target) AS sales_target,
            MAX(pd.collection_target) AS collection_target,
            MAX(pd.abs_target) AS abs_target,
            COUNT(DISTINCT bp.customer_id) AS parties,
            COUNT(DISTINCT CASE WHEN v.id IS NOT NULL THEN bp.customer_id END) AS done
     FROM (
        SELECT d.beat_id, b.name AS beat_name, p.user_id, u.name AS user_name,
               d.plan_date, d.sales_target, d.collection_target, d.abs_target
        FROM beat_plan_days d
        JOIN beat_weekly_plans p ON p.id = d.plan_id
        JOIN beats b ON b.id = d.beat_id
        JOIN users u ON u.id = p.user_id
        WHERE ${where.join(" AND ")}
     ) pd
     LEFT JOIN beat_parties bp ON bp.beat_id = pd.beat_id
     LEFT JOIN visits v
            ON v.user_id = pd.user_id
           AND v.customer_id = bp.customer_id
           AND ${IST_DAY("v.created_at")} = pd.plan_date
     GROUP BY pd.beat_id, pd.beat_name, pd.user_id, pd.user_name, pd.plan_date`,
    params,
  );
  return rows;
};

// today's visits of one employee: customers of the beat vs other customers
const getTodayVisitSplit = async (userId, date, beatId) => {
  const [[row]] = await db.query(
    `SELECT COUNT(DISTINCT v.customer_id) AS total,
            COUNT(DISTINCT CASE WHEN bp.id IS NOT NULL THEN v.customer_id END) AS in_beat
     FROM visits v
     LEFT JOIN beat_parties bp ON bp.customer_id = v.customer_id AND bp.beat_id = ?
     WHERE v.user_id = ? AND ${IST_DAY("v.created_at")} = ?`,
    [beatId || 0, userId, date],
  );
  return {
    total: Number(row.total) || 0,
    inBeat: Number(row.in_beat) || 0,
  };
};

// every active master beat of these employees (with its owner's name)
const getTeamBeats = async (teamIds) => {
  const [rows] = await db.query(
    `SELECT b.id AS beat_id, b.name AS beat_name, u.name AS owner_name
     FROM beats b
     LEFT JOIN users u ON u.id = b.assigned_user_id
     WHERE b.is_active = 1 AND b.source = 'MASTER' AND b.assigned_user_id IN (?)
     ORDER BY b.name ASC`,
    [teamIds],
  );
  return rows;
};

// ---------------------------------------------------------------------
//  PARTY COVERAGE
// ---------------------------------------------------------------------
const getTeamBeatParties = async (teamIds) => {
  const [rows] = await db.query(
    `SELECT bp.customer_id, bp.visit_every_days, c.type,
            ${PARTY_NAME} AS party_name,
            b.id AS beat_id, b.name AS beat_name, u.name AS owner_name
     FROM beat_parties bp
     JOIN beats b ON b.id = bp.beat_id AND b.is_active = 1 AND b.source = 'MASTER'
     JOIN customers c ON c.id = bp.customer_id
     LEFT JOIN users u ON u.id = b.assigned_user_id
     WHERE b.assigned_user_id IN (?)
     ORDER BY party_name ASC
     LIMIT 1000`,
    [teamIds],
  );
  return rows;
};

// Map(customer_id -> 'YYYY-MM-DD' of the last visit by anybody)
const getLastVisitDates = async (customerIds) => {
  const out = new Map();
  if (!customerIds.length) return out;
  const [rows] = await db.query(
    `SELECT customer_id, DATE_FORMAT(MAX(created_at), '%Y-%m-%d') AS last_visit
     FROM visits
     WHERE customer_id IN (?)
     GROUP BY customer_id`,
    [customerIds],
  );
  rows.forEach((r) => out.set(r.customer_id, r.last_visit));
  return out;
};

// ---------------------------------------------------------------------
//  RECOVERY PRIORITY
// ---------------------------------------------------------------------
const getOverdueParties = async (teamIds, today) => {
  const [rows] = await db.query(
    `SELECT l.id AS ledger_id, l.ledger_name, u.name AS owner_name,
            SUM(sbr.pending_amount) AS amount,
            DATEDIFF(?, MIN(sbr.due_date)) AS days_overdue
     FROM sales_bill_references sbr
     JOIN ledgers l ON l.id = sbr.ledger_id AND l.employee_under IN (?)
     LEFT JOIN users u ON u.id = l.employee_under
     WHERE sbr.pending_amount > 0
       AND sbr.due_date IS NOT NULL
       AND sbr.due_date < ?
       AND sbr.status IN ('PENDING', 'PARTIAL')
     GROUP BY l.id, l.ledger_name, u.name
     ORDER BY SUM(sbr.pending_amount) * DATEDIFF(?, MIN(sbr.due_date)) DESC
     LIMIT 50`,
    [today, teamIds, today, today],
  );
  return rows;
};

// ---------------------------------------------------------------------
//  EXCEPTIONS
// ---------------------------------------------------------------------
const getLateLogins = async (userIds, start, end) => {
  if (!userIds.length) return [];
  const [rows] = await db.query(
    `SELECT DISTINCT a.employee_id, u.name,
            DATE_FORMAT(a.attendance_date, '%Y-%m-%d') AS d
     FROM emp_attendance a
     JOIN users u ON u.id = a.employee_id
     WHERE a.employee_id IN (?)
       AND a.attendance_date BETWEEN ? AND ?
       AND a.late_login = 1`,
    [userIds, start, end],
  );
  return rows;
};

// ---------------------------------------------------------------------
//  BEAT CHANGE REQUESTS
// ---------------------------------------------------------------------
const CR_SELECT = `
  SELECT r.id, r.user_id, r.reason, r.details, r.status, r.approver_id,
         r.manager_remark,
         DATE_FORMAT(r.created_at, '%Y-%m-%d') AS created_at,
         DATE_FORMAT(r.decided_at, '%Y-%m-%d') AS decided_at,
         u.name AS user_name, jr.name AS job_role,
         b.name AS beat_name
  FROM beat_change_requests r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN job_roles jr ON jr.id = u.job_role_id
  LEFT JOIN beats b ON b.id = r.beat_id`;

const createChangeRequest = async ({ userId, beatId, reason, details, approverId }) => {
  const [result] = await db.query(
    `INSERT INTO beat_change_requests (user_id, beat_id, reason, details, approver_id)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, beatId || null, reason, details, approverId || null],
  );
  return result.insertId;
};

const getChangeRequestById = async (id) => {
  const [rows] = await db.query(`${CR_SELECT} WHERE r.id = ?`, [id]);
  return rows[0] || null;
};

const listMyChangeRequests = async (userId) => {
  const [rows] = await db.query(
    `${CR_SELECT} WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 50`,
    [userId],
  );
  return rows;
};

const listPendingChangeRequests = async (approverId) => {
  const [rows] = await db.query(
    `${CR_SELECT} WHERE r.approver_id = ? AND r.status = 'PENDING' ORDER BY r.id ASC`,
    [approverId],
  );
  return rows;
};

// compare-and-set: only a PENDING request can be decided (once)
const decideChangeRequest = async (id, decidedBy, status, remark) => {
  const [result] = await db.query(
    `UPDATE beat_change_requests
     SET status = ?, decided_by = ?, decided_at = NOW(), manager_remark = ?
     WHERE id = ? AND status = 'PENDING'`,
    [status, decidedBy, remark || null, id],
  );
  return result.affectedRows > 0;
};

module.exports = {
  getAttendanceForDay,
  getPlannedForDay,
  getVisitsByUserDate,
  getOrdersByUserDate,
  getTodayVisitSplit,
  getSalesByUserDate,
  getCollectionsByUserDate,
  getSalesTotals,
  getApprovedDays,
  getTeamBeats,
  getTeamBeatParties,
  getLastVisitDates,
  getOverdueParties,
  getLateLogins,
  createChangeRequest,
  getChangeRequestById,
  listMyChangeRequests,
  listPendingChangeRequests,
  decideChangeRequest,
};