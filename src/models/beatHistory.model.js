const db = require("../config/db");

// Read-only queries for viewing beats, plans and history.
// Nothing here changes the plan, approval or beat change data.

const PARTY_NAME = `COALESCE(NULLIF(c.firm_name, ''), c.name)`;
const IST_DAY = (col) =>
  `DATE(CONVERT_TZ(${col}, @@session.time_zone, '+05:30'))`;

// userIds = null means every employee (admin)
const listEmployees = async ({ userIds, search }) => {
  const where = ["1=1"];
  const params = [];

  if (userIds) {
    where.push("u.id IN (?)");
    params.push(userIds);
  }
  if (search) {
    where.push("u.name LIKE ?");
    params.push(`%${search}%`);
  }

  const [rows] = await db.query(
    `SELECT u.id, u.name, u.is_active, jr.name AS job_role,
            rm.name AS reporting_manager
     FROM users u
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     LEFT JOIN users rm ON rm.id = u.reporting_under
     WHERE ${where.join(" AND ")}
     ORDER BY u.is_active DESC, u.name ASC
     LIMIT 500`,
    params,
  );
  return rows;
};

const getEmployee = async (userId) => {
  const [rows] = await db.query(
    `SELECT u.id, u.name, jr.name AS job_role, rm.name AS reporting_manager
     FROM users u
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     LEFT JOIN users rm ON rm.id = u.reporting_under
     WHERE u.id = ?`,
    [userId],
  );
  return rows[0] || null;
};

const getPartiesForBeats = async (beatIds) => {
  if (!beatIds.length) return [];
  const [rows] = await db.query(
    `SELECT bp.beat_id, bp.sequence_no, c.id, c.type,
            ${PARTY_NAME} AS display_name, c.name AS person,
            c.area, c.town, c.district, c.contact_number AS contact,
            eu.name AS owner_name
     FROM beat_parties bp
     JOIN customers c ON c.id = bp.customer_id
     LEFT JOIN ledgers dl ON dl.id = c.distributor_ledger_id
     LEFT JOIN users eu ON eu.id = COALESCE(dl.employee_under, c.created_by)
     WHERE bp.beat_id IN (?)
     ORDER BY bp.beat_id ASC, bp.sequence_no ASC`,
    [beatIds],
  );
  return rows;
};

const getAssignedBeats = async (userId) => {
  const [rows] = await db.query(
    `SELECT b.id, b.name, b.market_area, b.district, b.total_km, b.source,
            b.contact_mobile, b.is_active, cb.name AS created_by_name,
            DATE_FORMAT(b.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM beats b
     LEFT JOIN users cb ON cb.id = b.created_by
     WHERE b.assigned_user_id = ?
     ORDER BY b.is_active DESC, b.source ASC, b.name ASC`,
    [userId],
  );
  return rows;
};

const getPlanDay = async (userId, date) => {
  const [rows] = await db.query(
    `SELECT p.id AS plan_id, p.status AS plan_status,
            DATE_FORMAT(p.week_start, '%Y-%m-%d') AS week_start,
            DATE_FORMAT(p.week_end, '%Y-%m-%d') AS week_end,
            DATE_FORMAT(p.submitted_at, '%Y-%m-%d %H:%i:%s') AS submitted_at,
            DATE_FORMAT(p.decided_at, '%Y-%m-%d %H:%i:%s') AS decided_at,
            p.manager_remark, ap.name AS approver_name, dc.name AS decided_by_name,
            d.beat_id, d.purpose, d.sales_target, d.collection_target,
            d.abs_target, d.new_dealer_target, d.remark,
            d.amend_status, d.amend_remark,
            b.name AS beat_name, b.market_area, b.district, b.total_km,
            b.source, b.contact_mobile
     FROM beat_plan_days d
     JOIN beat_weekly_plans p ON p.id = d.plan_id
     JOIN beats b ON b.id = d.beat_id
     LEFT JOIN users ap ON ap.id = p.approver_id
     LEFT JOIN users dc ON dc.id = p.decided_by
     WHERE p.user_id = ? AND d.plan_date = ?
     LIMIT 1`,
    [userId, date],
  );
  return rows[0] || null;
};

const getVisitedCustomerIds = async (userId, date) => {
  const [rows] = await db.query(
    `SELECT DISTINCT v.customer_id
     FROM visits v
     WHERE v.user_id = ? AND ${IST_DAY("v.created_at")} = ?
       AND v.customer_id IS NOT NULL`,
    [userId, date],
  );
  return rows.map((r) => r.customer_id);
};

const listPlans = async ({
  userId,
  status,
  fromDate,
  toDate,
  hideDrafts,
  page,
  limit,
}) => {
  const where = ["p.user_id = ?"];
  const params = [userId];

  if (status) {
    where.push("p.status = ?");
    params.push(status);
  }
  if (hideDrafts) where.push("p.status <> 'DRAFT'");
  if (fromDate) {
    where.push("p.week_end >= ?");
    params.push(fromDate);
  }
  if (toDate) {
    where.push("p.week_start <= ?");
    params.push(toDate);
  }

  const [[count]] = await db.query(
    `SELECT COUNT(*) AS total FROM beat_weekly_plans p WHERE ${where.join(" AND ")}`,
    params,
  );

  const [rows] = await db.query(
    `SELECT p.id, p.user_id, p.status, p.manager_remark,
            DATE_FORMAT(p.week_start, '%Y-%m-%d') AS week_start,
            DATE_FORMAT(p.week_end, '%Y-%m-%d') AS week_end,
            DATE_FORMAT(p.submitted_at, '%Y-%m-%d %H:%i:%s') AS submitted_at,
            DATE_FORMAT(p.decided_at, '%Y-%m-%d %H:%i:%s') AS decided_at,
            ap.name AS approver_name, dc.name AS decided_by_name,
            (SELECT COUNT(*) FROM beat_plan_days d WHERE d.plan_id = p.id) AS days_planned,
            (SELECT COUNT(*) FROM beat_plan_days d
             WHERE d.plan_id = p.id AND d.amend_status = 'PENDING') AS pending_days,
            (SELECT COUNT(*) FROM beat_plan_days d
             WHERE d.plan_id = p.id AND d.amend_status = 'RESUBMIT_REQUIRED') AS resubmit_days,
            (SELECT COALESCE(SUM(d.sales_target), 0) FROM beat_plan_days d WHERE d.plan_id = p.id) AS total_sales,
            (SELECT COALESCE(SUM(d.collection_target), 0) FROM beat_plan_days d WHERE d.plan_id = p.id) AS total_collection,
            (SELECT COALESCE(SUM(d.new_dealer_target), 0) FROM beat_plan_days d WHERE d.plan_id = p.id) AS new_dealer_target
     FROM beat_weekly_plans p
     LEFT JOIN users ap ON ap.id = p.approver_id
     LEFT JOIN users dc ON dc.id = p.decided_by
     WHERE ${where.join(" AND ")}
     ORDER BY p.week_start DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  return { rows, total: Number(count.total) || 0 };
};

// a new dealer = a ledger newly created under this employee
const getNewDealers = async (userId, start, end) => {
  const [rows] = await db.query(
    `SELECT l.id, l.ledger_name,
            DATE_FORMAT(${IST_DAY("l.created_at")}, '%Y-%m-%d') AS created_on
     FROM ledgers l
     WHERE l.employee_under = ?
       AND ${IST_DAY("l.created_at")} BETWEEN ? AND ?
     ORDER BY l.id DESC`,
    [userId, start, end],
  );
  return rows;
};

const countNewDealers = async (userId, start, end) =>
  (await getNewDealers(userId, start, end)).length;

module.exports = {
  listEmployees,
  getEmployee,
  getPartiesForBeats,
  getAssignedBeats,
  getPlanDay,
  getVisitedCustomerIds,
  listPlans,
  getNewDealers,
  countNewDealers,
};
