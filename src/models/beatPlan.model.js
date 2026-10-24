const db = require("../config/db");

// Use this value in transitionStatus() when a column should be set to NOW()
const NOW = Symbol("NOW");

const PLAN_COLS = `
  p.id, p.user_id, p.status, p.approver_id, p.decided_by, p.manager_remark,
  DATE_FORMAT(p.week_start,   '%Y-%m-%d')          AS week_start,
  DATE_FORMAT(p.week_end,     '%Y-%m-%d')          AS week_end,
  DATE_FORMAT(p.submitted_at, '%Y-%m-%d %H:%i:%s') AS submitted_at,
  DATE_FORMAT(p.decided_at,   '%Y-%m-%d %H:%i:%s') AS decided_at`;

// ---------------------------------------------------------------------
//  USERS / CALENDAR
// ---------------------------------------------------------------------
const getUserForPlan = async (userId) => {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.reporting_under, u.approver_id, u.week_off,
            jr.name AS job_role
     FROM users u
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     WHERE u.id = ?`,
    [userId],
  );
  return rows[0] || null;
};

const getHolidaySet = async (start, end) => {
  const [rows] = await db.query(
    `SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS d
     FROM company_holidays
     WHERE holiday_date BETWEEN ? AND ?`,
    [start, end],
  );
  return new Set(rows.map((r) => r.d));
};

// ---------------------------------------------------------------------
//  BEATS
// ---------------------------------------------------------------------
const getBeatsForUser = async (userId) => {
  const [rows] = await db.query(
    `SELECT b.id, b.name, b.market_area, b.district, b.total_km, b.source,
            b.contact_mobile,
            (SELECT COUNT(*) FROM beat_parties bp WHERE bp.beat_id = b.id) AS parties_count
     FROM beats b
     WHERE b.is_active = 1 AND b.assigned_user_id = ?
     ORDER BY b.source ASC, b.name ASC`,
    [userId],
  );
  return rows;
};

// a beat is usable by a user only if it is assigned to that user
const getBeatForUser = async (beatId, userId) => {
  const [rows] = await db.query(
    `SELECT id, name, source
     FROM beats
     WHERE id = ? AND assigned_user_id = ? AND is_active = 1`,
    [beatId, userId],
  );
  return rows[0] || null;
};

const createBeat = async ({
  name,
  marketArea,
  district,
  totalKm,
  assignedUserId,
  source,
  contactMobile,
  createdBy,
  partyIds = [],
}) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO beats
        (name, market_area, district, total_km, assigned_user_id, source,
         contact_mobile, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        marketArea || null,
        district || null,
        totalKm || 0,
        assignedUserId || null,
        source,
        contactMobile || null,
        createdBy,
      ],
    );
    const beatId = result.insertId;

    for (let i = 0; i < partyIds.length; i++) {
      await conn.query(
        `INSERT INTO beat_parties (beat_id, ledger_id, sequence_no) VALUES (?, ?, ?)`,
        [beatId, partyIds[i], i + 1],
      );
    }

    await conn.commit();
    return beatId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const countExistingLedgers = async (ledgerIds) => {
  if (!ledgerIds.length) return 0;
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS c FROM ledgers WHERE id IN (?)`,
    [ledgerIds],
  );
  return Number(row.c) || 0;
};

// ---------------------------------------------------------------------
//  PLANS
// ---------------------------------------------------------------------
const PLAN_JOINS = `
  FROM beat_weekly_plans p
  JOIN users ou ON ou.id = p.user_id
  LEFT JOIN users ap ON ap.id = p.approver_id
  LEFT JOIN job_roles ajr ON ajr.id = ap.job_role_id`;

const getPlanById = async (planId) => {
  const [rows] = await db.query(
    `SELECT ${PLAN_COLS},
            ou.name AS user_name,
            ap.name AS approver_name,
            ajr.name AS approver_role
     ${PLAN_JOINS}
     WHERE p.id = ?`,
    [planId],
  );
  return rows[0] || null;
};

const findPlanByWeek = async (userId, weekStart) => {
  const [rows] = await db.query(
    `SELECT ${PLAN_COLS},
            ou.name AS user_name,
            ap.name AS approver_name,
            ajr.name AS approver_role
     ${PLAN_JOINS}
     WHERE p.user_id = ? AND p.week_start = ?`,
    [userId, weekStart],
  );
  return rows[0] || null;
};

const createPlan = async ({ userId, weekStart, weekEnd }) => {
  const [result] = await db.query(
    `INSERT INTO beat_weekly_plans (user_id, week_start, week_end, status)
     VALUES (?, ?, ?, 'DRAFT')`,
    [userId, weekStart, weekEnd],
  );
  return result.insertId;
};

// Compare-and-set: only changes the plan if it is currently in one of
// `fromStatuses`. Returns true when a row was updated (prevents double clicks
// and two managers deciding the same plan).
const transitionStatus = async (planId, fromStatuses, fields) => {
  const allowed = [
    "status",
    "approver_id",
    "submitted_at",
    "decided_by",
    "decided_at",
    "manager_remark",
  ];
  const sets = [];
  const values = [];

  Object.entries(fields).forEach(([key, value]) => {
    if (!allowed.includes(key)) return;
    if (value === NOW) {
      sets.push(`${key} = NOW()`);
    } else {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  });
  if (!sets.length) return false;

  const [result] = await db.query(
    `UPDATE beat_weekly_plans
     SET ${sets.join(", ")}
     WHERE id = ? AND status IN (?)`,
    [...values, planId, fromStatuses],
  );
  return result.affectedRows > 0;
};

const listMyPlans = async (userId, limit = 12) => {
  const [rows] = await db.query(
    `SELECT ${PLAN_COLS},
            (SELECT COUNT(*) FROM beat_plan_days d WHERE d.plan_id = p.id) AS days_planned
     FROM beat_weekly_plans p
     WHERE p.user_id = ?
     ORDER BY p.week_start DESC
     LIMIT ?`,
    [userId, Number(limit)],
  );
  return rows;
};

const listPendingForApprover = async (approverId) => {
  const [rows] = await db.query(
    `SELECT ${PLAN_COLS},
            u.name AS user_name,
            jr.name AS job_role,
            (SELECT COUNT(*) FROM beat_plan_days d WHERE d.plan_id = p.id) AS days_planned,
            (SELECT COALESCE(SUM(d.sales_target), 0) FROM beat_plan_days d WHERE d.plan_id = p.id) AS total_sales,
            (SELECT COALESCE(SUM(d.collection_target), 0) FROM beat_plan_days d WHERE d.plan_id = p.id) AS total_collection,
            (SELECT COALESCE(SUM(d.new_dealer_target), 0) FROM beat_plan_days d WHERE d.plan_id = p.id) AS total_new_dealers
     FROM beat_weekly_plans p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     WHERE p.approver_id = ? AND p.status = 'SUBMITTED'
     ORDER BY p.submitted_at ASC`,
    [approverId],
  );
  return rows;
};

// ---------------------------------------------------------------------
//  DAYS
// ---------------------------------------------------------------------
const getPlanDays = async (planId) => {
  const [rows] = await db.query(
    `SELECT d.id,
            DATE_FORMAT(d.plan_date, '%Y-%m-%d') AS plan_date,
            d.beat_id, b.name AS beat_name, b.source AS beat_source,
            d.purpose, d.sales_target, d.collection_target, d.abs_target,
            d.new_dealer_target, d.remark
     FROM beat_plan_days d
     JOIN beats b ON b.id = d.beat_id
     WHERE d.plan_id = ?
     ORDER BY d.plan_date ASC`,
    [planId],
  );
  return rows;
};

const upsertDay = async (planId, date, d) => {
  await db.query(
    `INSERT INTO beat_plan_days
       (plan_id, plan_date, beat_id, purpose, sales_target, collection_target,
        abs_target, new_dealer_target, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       beat_id = VALUES(beat_id),
       purpose = VALUES(purpose),
       sales_target = VALUES(sales_target),
       collection_target = VALUES(collection_target),
       abs_target = VALUES(abs_target),
       new_dealer_target = VALUES(new_dealer_target),
       remark = VALUES(remark)`,
    [
      planId,
      date,
      d.beatId,
      d.purpose || null,
      d.salesTarget,
      d.collectionTarget,
      d.absTarget,
      d.newDealerTarget,
      d.remark || null,
    ],
  );
};

const deleteDay = async (planId, date) => {
  const [result] = await db.query(
    `DELETE FROM beat_plan_days WHERE plan_id = ? AND plan_date = ?`,
    [planId, date],
  );
  return result.affectedRows > 0;
};

const countPlannedDays = async (planId) => {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS c FROM beat_plan_days WHERE plan_id = ?`,
    [planId],
  );
  return Number(row.c) || 0;
};

// ---------------------------------------------------------------------
//  AUDIT LOG
// ---------------------------------------------------------------------
const addLog = async (planId, action, actorId, remark = null) => {
  await db.query(
    `INSERT INTO beat_plan_logs (plan_id, action, actor_id, remark)
     VALUES (?, ?, ?, ?)`,
    [planId, action, actorId, remark],
  );
};

const getLogs = async (planId) => {
  const [rows] = await db.query(
    `SELECT l.id, l.action, l.remark, l.actor_id, u.name AS actor_name,
            DATE_FORMAT(l.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM beat_plan_logs l
     LEFT JOIN users u ON u.id = l.actor_id
     WHERE l.plan_id = ?
     ORDER BY l.id ASC`,
    [planId],
  );
  return rows;
};

module.exports = {
  NOW,
  getUserForPlan,
  getHolidaySet,
  getBeatsForUser,
  getBeatForUser,
  createBeat,
  countExistingLedgers,
  getPlanById,
  findPlanByWeek,
  createPlan,
  transitionStatus,
  listMyPlans,
  listPendingForApprover,
  getPlanDays,
  upsertDay,
  deleteDay,
  countPlannedDays,
  addLog,
  getLogs,
};