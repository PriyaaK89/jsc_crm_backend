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
        `INSERT INTO beat_parties (beat_id, customer_id, ledger_id, sequence_no)
         SELECT ?, c.id, c.distributor_ledger_id, ?
         FROM customers c WHERE c.id = ?`,
        [beatId, i + 1, partyIds[i]],
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

// submitted plans + approved plans that have NEW days waiting for approval
const listPendingForApprover = async (approverId) => {
  const [rows] = await db.query(
    `SELECT ${PLAN_COLS},
            u.name AS user_name,
            jr.name AS job_role,
            (SELECT COUNT(*) FROM beat_plan_days d WHERE d.plan_id = p.id) AS days_planned,
            (SELECT COUNT(*) FROM beat_plan_days d WHERE d.plan_id = p.id AND d.amend_status = 'PENDING') AS pending_days,
            (SELECT COALESCE(SUM(d.sales_target), 0) FROM beat_plan_days d WHERE d.plan_id = p.id) AS total_sales,
            (SELECT COALESCE(SUM(d.collection_target), 0) FROM beat_plan_days d WHERE d.plan_id = p.id) AS total_collection,
            (SELECT COALESCE(SUM(d.new_dealer_target), 0) FROM beat_plan_days d WHERE d.plan_id = p.id) AS total_new_dealers
     FROM beat_weekly_plans p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     WHERE p.approver_id = ?
       AND (
         p.status = 'SUBMITTED'
         OR (p.status = 'APPROVED' AND EXISTS (
               SELECT 1 FROM beat_plan_days d
               WHERE d.plan_id = p.id AND d.amend_status = 'PENDING'))
       )
     ORDER BY p.week_start ASC, p.id ASC`,
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
            d.new_dealer_target, d.remark, d.amend_status, d.amend_remark
     FROM beat_plan_days d
     JOIN beats b ON b.id = d.beat_id
     WHERE d.plan_id = ?
     ORDER BY d.plan_date ASC`,
    [planId],
  );
  return rows;
};

// amendStatus: null for normal days, 'PENDING' for a day added to an approved plan
const upsertDay = async (planId, date, d, amendStatus = null) => {
  await db.query(
    `INSERT INTO beat_plan_days
       (plan_id, plan_date, beat_id, purpose, sales_target, collection_target,
        abs_target, new_dealer_target, remark, amend_status, amend_remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       beat_id = VALUES(beat_id),
       purpose = VALUES(purpose),
       sales_target = VALUES(sales_target),
       collection_target = VALUES(collection_target),
       abs_target = VALUES(abs_target),
       new_dealer_target = VALUES(new_dealer_target),
       remark = VALUES(remark),
       amend_status = VALUES(amend_status),
       amend_remark = NULL`,
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
      amendStatus,
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

// ---------------------------------------------------------------------
//  MANAGE BEATS  (manager side)
// ---------------------------------------------------------------------
const getUsersByIds = async (ids) => {
  if (!ids.length) return [];
  const [rows] = await db.query(
    `SELECT u.id, u.name, jr.name AS job_role, jr.level
     FROM users u
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     WHERE u.id IN (?) AND u.is_active = 1
     ORDER BY u.name ASC`,
    [ids],
  );
  return rows;
};

const BEAT_SELECT = `
  SELECT b.id, b.name, b.market_area, b.district, b.total_km, b.source,
         b.is_active, b.assigned_user_id, b.created_by,
         u.name  AS assigned_user_name,
         jr.name AS assigned_role,
         cb.name AS created_by_name,
         (SELECT COUNT(*) FROM beat_parties bp WHERE bp.beat_id = b.id) AS parties_count
  FROM beats b
  LEFT JOIN users u  ON u.id  = b.assigned_user_id
  LEFT JOIN job_roles jr ON jr.id = u.job_role_id
  LEFT JOIN users cb ON cb.id = b.created_by`;

const getBeatById = async (beatId) => {
  const [rows] = await db.query(`${BEAT_SELECT} WHERE b.id = ?`, [beatId]);
  return rows[0] || null;
};

// every MASTER beat created by the manager OR assigned to anybody in his team
const listManagedBeats = async ({
  teamIds,
  createdBy,
  status,
  assignedUserId,
  search,
}) => {
  const where = [
    `b.source = 'MASTER'`,
    `(b.created_by = ? OR b.assigned_user_id IN (?))`,
  ];
  const params = [createdBy, teamIds];

  if (status === "active") where.push("b.is_active = 1");
  if (status === "inactive") where.push("b.is_active = 0");

  if (assignedUserId) {
    where.push("b.assigned_user_id = ?");
    params.push(assignedUserId);
  }
  if (search) {
    where.push("(b.name LIKE ? OR b.market_area LIKE ? OR u.name LIKE ?)");
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const [rows] = await db.query(
    `${BEAT_SELECT}
     WHERE ${where.join(" AND ")}
     ORDER BY b.is_active DESC, b.name ASC
     LIMIT 300`,
    params,
  );
  return rows;
};

// display name of a customer: the shop / firm name, else the person's name
const PARTY_NAME = `COALESCE(NULLIF(c.firm_name, ''), c.name)`;

// Customers that belong to these employees:
//   distributor        -> its ledger is assigned to the employee (ledgers.employee_under)
//   retailer / farmer  -> registered by the employee, or sitting under one of his distributors
const PARTY_SCOPE = `(
     (c.type = 'distributor' AND dl.employee_under IN (?))
  OR (c.type IN ('retailer', 'farmer') AND c.created_by IN (?))
  OR (c.type = 'retailer' AND EXISTS (
        SELECT 1 FROM retailer_distributors rd
        JOIN ledgers l2 ON l2.id = rd.distributor_ledger_id
        WHERE rd.retailer_id = c.id AND l2.employee_under IN (?)))
  OR (c.type = 'farmer' AND EXISTS (
        SELECT 1 FROM farmer_distributors fd
        JOIN ledgers l3 ON l3.id = fd.distributor_ledger_id
        WHERE fd.farmer_id = c.id AND l3.employee_under IN (?)))
  OR (c.type = 'farmer' AND EXISTS (
        SELECT 1 FROM farmer_retailers fr
        JOIN retailer_distributors rd2 ON rd2.retailer_id = fr.retailer_id
        JOIN ledgers l4 ON l4.id = rd2.distributor_ledger_id
        WHERE fr.farmer_id = c.id AND l4.employee_under IN (?)))
)`;
const scopeParams = (ids) => [ids, ids, ids, ids, ids];

const PARTY_FROM = `
  FROM customers c
  LEFT JOIN ledgers dl ON dl.id = c.distributor_ledger_id
  LEFT JOIN users eu ON eu.id = COALESCE(dl.employee_under, c.created_by)`;

// Every ledger assigned to these employees is a distributor for the app. Make sure it
// has its "distributor" customer row (same rule as findOrCreateDistributorCustomer),
// so it can be picked as a beat party and visited. Safe to run many times.
const ensureDistributorCustomers = async (employeeIds) => {
  if (!employeeIds.length) return;
  await db.query(
    `INSERT INTO customers
       (type, name, firm_name, gst_number, state, pincode, distributor_ledger_id, created_by)
     SELECT 'distributor', l.ledger_name, l.ledger_name, l.gst_no, l.state, l.pincode,
            l.id, l.employee_under
     FROM ledgers l
     WHERE l.employee_under IN (?)
       AND NOT EXISTS (
         SELECT 1 FROM customers c
         WHERE c.type = 'distributor' AND c.distributor_ledger_id = l.id
       )`,
    [employeeIds],
  );
};

const getBeatParties = async (beatId) => {
  const [rows] = await db.query(
    `SELECT c.id, c.type, ${PARTY_NAME} AS display_name, c.name AS person,
            c.area, c.town, c.district, c.contact_number AS contact,
            eu.name AS owner_name
     FROM beat_parties bp
     JOIN customers c ON c.id = bp.customer_id
     LEFT JOIN ledgers dl ON dl.id = c.distributor_ledger_id
     LEFT JOIN users eu ON eu.id = COALESCE(dl.employee_under, c.created_by)
     WHERE bp.beat_id = ?
     ORDER BY bp.sequence_no ASC, display_name ASC`,
    [beatId],
  );
  return rows;
};

// parties of the manager's team (or of one employee when ownerId is given)
//   type: '' | distributor | retailer | farmer
const searchParties = async ({ teamIds, ownerId, search, type, limit, offset }) => {
  const ids = ownerId ? [ownerId] : teamIds;
  await ensureDistributorCustomers(ids);

  const where = [PARTY_SCOPE];
  const params = scopeParams(ids);

  if (["distributor", "retailer", "farmer"].includes(type)) {
    where.push("c.type = ?");
    params.push(type);
  }
  if (search) {
    where.push(
      `(c.name LIKE ? OR c.firm_name LIKE ? OR c.contact_number LIKE ?
        OR c.area LIKE ? OR c.town LIKE ? OR c.district LIKE ?)`,
    );
    const s = `%${search}%`;
    params.push(s, s, s, s, s, s);
  }

  const [rows] = await db.query(
    `SELECT c.id, c.type, ${PARTY_NAME} AS display_name, c.name AS person,
            c.area, c.town, c.district, c.contact_number AS contact,
            eu.name AS owner_name
     ${PARTY_FROM}
     WHERE ${where.join(" AND ")}
     ORDER BY display_name ASC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)],
  );

  const [[countRow]] = await db.query(
    `SELECT COUNT(*) AS total ${PARTY_FROM} WHERE ${where.join(" AND ")}`,
    params,
  );

  return { rows, total: Number(countRow.total) || 0 };
};

// how many of these customers belong to the team (all of them must)
const countPartiesInScope = async (partyIds, teamIds) => {
  if (!partyIds.length) return 0;
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS c
     ${PARTY_FROM}
     WHERE c.id IN (?) AND ${PARTY_SCOPE}`,
    [partyIds, ...scopeParams(teamIds)],
  );
  return Number(row.c) || 0;
};

// which of these parties already sit in another ACTIVE master beat
const findPartyConflicts = async (partyIds, excludeBeatId = null) => {
  if (!partyIds.length) return [];
  const params = [partyIds];
  let exclude = "";
  if (excludeBeatId) {
    exclude = "AND b.id <> ?";
    params.push(excludeBeatId);
  }
  const [rows] = await db.query(
    `SELECT bp.customer_id AS party_id, ${PARTY_NAME} AS party_name,
            b.id AS beat_id, b.name AS beat_name
     FROM beat_parties bp
     JOIN beats b ON b.id = bp.beat_id AND b.is_active = 1 AND b.source = 'MASTER'
     JOIN customers c ON c.id = bp.customer_id
     WHERE bp.customer_id IN (?) ${exclude}`,
    params,
  );
  return rows;
};

// beat that each party is already in (for the picker badges)
const getPartyBeatMap = async (partyIds, excludeBeatId = null) => {
  const rows = await findPartyConflicts(partyIds, excludeBeatId);
  return new Map(rows.map((r) => [r.party_id, r]));
};

const updateBeat = async (
  beatId,
  { name, marketArea, district, totalKm, assignedUserId, partyIds },
) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE beats
       SET name = ?, market_area = ?, district = ?, total_km = ?, assigned_user_id = ?
       WHERE id = ?`,
      [name, marketArea || null, district || null, totalKm || 0, assignedUserId, beatId],
    );

    // partyIds === null  ->  keep the existing parties
    if (Array.isArray(partyIds)) {
      await conn.query(`DELETE FROM beat_parties WHERE beat_id = ?`, [beatId]);
      for (let i = 0; i < partyIds.length; i++) {
        await conn.query(
          `INSERT INTO beat_parties (beat_id, customer_id, ledger_id, sequence_no)
         SELECT ?, c.id, c.distributor_ledger_id, ?
         FROM customers c WHERE c.id = ?`,
          [beatId, i + 1, partyIds[i]],
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

const setBeatActive = async (beatId, isActive) => {
  await db.query(`UPDATE beats SET is_active = ? WHERE id = ?`, [
    isActive ? 1 : 0,
    beatId,
  ]);
};

// plans that are waiting for approval and use this beat on a future day
const countPendingFutureUses = async (beatId, today) => {
  const [[row]] = await db.query(
    `SELECT COUNT(DISTINCT p.id) AS c
     FROM beat_plan_days d
     JOIN beat_weekly_plans p ON p.id = d.plan_id
     WHERE d.beat_id = ? AND d.plan_date >= ? AND p.status = 'SUBMITTED'`,
    [beatId, today],
  );
  return Number(row.c) || 0;
};

// future days in DRAFT / REJECTED plans that still use this beat
const clearFutureDraftDays = async (beatId, today) => {
  const [result] = await db.query(
    `DELETE d FROM beat_plan_days d
     JOIN beat_weekly_plans p ON p.id = d.plan_id
     WHERE d.beat_id = ? AND d.plan_date >= ? AND p.status IN ('DRAFT', 'REJECTED')`,
    [beatId, today],
  );
  return result.affectedRows;
};

// ---------------------------------------------------------------------
//  HIERARCHY  (kept here so this module does not depend on other models)
// ---------------------------------------------------------------------

// people who report DIRECTLY to this user (used to decide "is a manager")
const getDirectSubordinates = async (userId) => {
  const [rows] = await db.query(
    `SELECT id, name FROM users WHERE reporting_under = ? AND is_active = 1`,
    [userId],
  );
  return rows;
};

// the user + everybody below him at any depth (ZSM -> RSM -> ASM -> TSM -> SO -> FA)
// Works on every MySQL / MariaDB version (no "WITH RECURSIVE"): it walks the
// reporting tree one level at a time.
const getSubordinateIds = async (userId) => {
  const seen = new Set([userId]);
  let frontier = [userId];

  // 12 levels is far more than the 6-level hierarchy; it also stops loops
  for (let depth = 0; depth < 12 && frontier.length; depth++) {
    const [rows] = await db.query(
      `SELECT id FROM users WHERE reporting_under IN (?)`,
      [frontier],
    );

    frontier = [];
    for (const r of rows) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        frontier.push(r.id);
      }
    }
  }

  return [...seen];
};

// ---------------------------------------------------------------------
//  ADD-ON DAYS (days added after the plan was approved)
// ---------------------------------------------------------------------
const getPlanDay = async (planId, date) => {
  const [rows] = await db.query(
    `SELECT id, beat_id, amend_status
     FROM beat_plan_days
     WHERE plan_id = ? AND plan_date = ?`,
    [planId, date],
  );
  return rows[0] || null;
};

const countPendingAmendments = async (planId) => {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS c FROM beat_plan_days
     WHERE plan_id = ? AND amend_status = 'PENDING'`,
    [planId],
  );
  return Number(row.c) || 0;
};

// manager approves / rejects every PENDING added day of the plan
const decideAmendments = async (planId, status, remark) => {
  const [result] = await db.query(
    `UPDATE beat_plan_days
     SET amend_status = ?, amend_remark = ?
     WHERE plan_id = ? AND amend_status = 'PENDING'`,
    [status, remark || null, planId],
  );
  return result.affectedRows;
};

// ---------------------------------------------------------------------
//  TODAY'S BEAT (Beat Plan home screen)
// ---------------------------------------------------------------------
const getTodayPlanDay = async (userId, date) => {
  const [rows] = await db.query(
    `SELECT p.id AS plan_id, p.status AS plan_status,
            d.amend_status, d.beat_id, d.purpose, d.sales_target,
            d.collection_target, d.new_dealer_target, d.remark,
            b.name AS beat_name, b.market_area, b.district, b.total_km, b.source,
            (SELECT COUNT(*) FROM beat_parties bp WHERE bp.beat_id = b.id) AS parties_count
     FROM beat_plan_days d
     JOIN beat_weekly_plans p ON p.id = d.plan_id
     JOIN beats b ON b.id = d.beat_id
     WHERE p.user_id = ? AND d.plan_date = ?
     LIMIT 1`,
    [userId, date],
  );
  return rows[0] || null;
};

const getBeatPartyIds = async (beatId) => {
  const [rows] = await db.query(
    `SELECT customer_id FROM beat_parties WHERE beat_id = ? AND customer_id IS NOT NULL`,
    [beatId],
  );
  return rows.map((r) => r.customer_id);
};

// customers the user visited on that day (visits.customer_id)
const getVisitedCustomerIds = async (userId, date) => {
  const [rows] = await db.query(
    `SELECT DISTINCT customer_id
     FROM visits
     WHERE user_id = ?
       AND created_at >= ?
       AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
       AND customer_id IS NOT NULL`,
    [userId, date, date],
  );
  return rows.map((r) => r.customer_id);
};

// ---------------------------------------------------------------------
//  NOTIFICATIONS
// ---------------------------------------------------------------------
// skipIfUnread: do not insert again when that user already has an UNREAD
// notification of the same type for the same plan (avoids spam)
const addNotification = async (
  userIds,
  { planId, type, title, message, skipIfUnread = false },
) => {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return;

  let targets = ids;
  if (skipIfUnread) {
    const [rows] = await db.query(
      `SELECT user_id FROM beat_notifications
       WHERE plan_id = ? AND type = ? AND is_read = 0 AND user_id IN (?)`,
      [planId, type, ids],
    );
    const already = new Set(rows.map((r) => r.user_id));
    targets = ids.filter((id) => !already.has(id));
    if (!targets.length) return;
  }

  await db.query(
    `INSERT INTO beat_notifications (user_id, plan_id, type, title, message)
     VALUES ?`,
    [targets.map((id) => [id, planId, type, title, message || null])],
  );
};

// once a plan is decided / withdrawn, the managers' "awaiting approval" alerts are done
const clearActionNotifications = async (planId) => {
  await db.query(
    `UPDATE beat_notifications
     SET is_read = 1, read_at = NOW()
     WHERE plan_id = ? AND is_read = 0
       AND type IN ('BEAT_PLAN_SUBMITTED', 'BEAT_DAYS_ADDED')`,
    [planId],
  );
};

const countUnreadNotifications = async (userId) => {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS c FROM beat_notifications WHERE user_id = ? AND is_read = 0`,
    [userId],
  );
  return Number(row.c) || 0;
};

const listNotifications = async (
  userId,
  { unreadOnly = false, page = 1, limit = 10 } = {},
) => {
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const off = (Math.max(Number(page) || 1, 1) - 1) * lim;
  const where = unreadOnly ? "user_id = ? AND is_read = 0" : "user_id = ?";

  const [rows] = await db.query(
    `SELECT id, plan_id, type, title, message, is_read, created_at
     FROM beat_notifications
     WHERE ${where}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [userId, lim, off],
  );
  const [[t]] = await db.query(
    `SELECT COUNT(*) AS c FROM beat_notifications WHERE ${where}`,
    [userId],
  );
  return {
    rows,
    total: Number(t.c) || 0,
    unread: await countUnreadNotifications(userId),
  };
};

const markNotificationRead = async (userId, id) => {
  await db.query(
    `UPDATE beat_notifications SET is_read = 1, read_at = NOW()
     WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
};

const markAllNotificationsRead = async (userId) => {
  await db.query(
    `UPDATE beat_notifications SET is_read = 1, read_at = NOW()
     WHERE user_id = ? AND is_read = 0`,
    [userId],
  );
};

const deleteNotification = async (userId, id) => {
  const [result] = await db.query(
    `DELETE FROM beat_notifications WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  return result.affectedRows > 0;
};

const deleteAllNotifications = async (userId) => {
  const [result] = await db.query(
    `DELETE FROM beat_notifications WHERE user_id = ?`,
    [userId],
  );
  return result.affectedRows;
};

// the employee's current / upcoming APPROVED plan week
const getWeekPlanRange = async (userId, today) => {
  const [rows] = await db.query(
    `SELECT id,
            DATE_FORMAT(week_start, '%Y-%m-%d') AS week_start,
            DATE_FORMAT(week_end,   '%Y-%m-%d') AS week_end
     FROM beat_weekly_plans
     WHERE user_id = ? AND status = 'APPROVED' AND week_end >= ?
     ORDER BY week_start ASC
     LIMIT 1`,
    [userId, today],
  );
  return rows[0] || null;
};

// approved beat days of that plan + whether the employee actually did them
const getWeekBeatDays = async (planId, userId) => {
  const [rows] = await db.query(
    `SELECT DATE_FORMAT(d.plan_date, '%Y-%m-%d') AS plan_date,
            d.beat_id,
            EXISTS (
              SELECT 1 FROM visits v
              WHERE v.user_id = ?
                AND v.created_at >= d.plan_date
                AND v.created_at <  DATE_ADD(d.plan_date, INTERVAL 1 DAY)
                AND (
                  NOT EXISTS (SELECT 1 FROM beat_parties b1
                              WHERE b1.beat_id = d.beat_id)
                  OR v.customer_id IN (SELECT b2.customer_id FROM beat_parties b2
                                       WHERE b2.beat_id = d.beat_id)
                )
            ) AS done
     FROM beat_plan_days d
     WHERE d.plan_id = ?
       AND (d.amend_status IS NULL OR d.amend_status = 'APPROVED')
     ORDER BY d.plan_date ASC`,
    [userId, planId],
  );
  return rows;
};

// dates (yyyy-MM-dd) on which the employee made at least one visit
const getVisitDates = async (userId, start, end) => {
  const [rows] = await db.query(
    `SELECT DISTINCT DATE_FORMAT(created_at, '%Y-%m-%d') AS d
     FROM visits
     WHERE user_id = ?
       AND created_at >= ?
       AND created_at <  DATE_ADD(?, INTERVAL 1 DAY)`,
    [userId, start, end],
  );
  return rows.map((r) => r.d);
};

// stops of a beat in visiting order, with lat/lng
const getBeatStops = async (beatId) => {
  const [rows] = await db.query(
    `SELECT c.id, c.type, ${PARTY_NAME} AS name, bp.sequence_no,
            lv.latitude  AS lat,
            lv.longitude AS lng
     FROM beat_parties bp
     JOIN customers c ON c.id = bp.customer_id
     LEFT JOIN visits lv ON lv.id = (
       SELECT MAX(v.id) FROM visits v
       WHERE v.customer_id = c.id
         AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL
     )
     WHERE bp.beat_id = ?
     ORDER BY bp.sequence_no ASC`,
    [beatId],
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
  getUsersByIds,
  getBeatById,
  listManagedBeats,
  getBeatParties,
  searchParties,
  countPartiesInScope,
  ensureDistributorCustomers,
  findPartyConflicts,
  getPartyBeatMap,
  updateBeat,
  setBeatActive,
  countPendingFutureUses,
  clearFutureDraftDays,
  getDirectSubordinates,
  getSubordinateIds,
  getPlanDay,
  countPendingAmendments,
  decideAmendments,
  getTodayPlanDay,
  getBeatPartyIds,
  getVisitedCustomerIds,
   getVisitedCustomerIds,
  addNotification,
  clearActionNotifications,
  countUnreadNotifications,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  deleteAllNotifications, getWeekBeatDays, getVisitDates, getWeekPlanRange, getBeatStops
};