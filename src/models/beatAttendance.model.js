// Beat chosen at attendance + party addition requests.
// Reuses the existing beat tables: beats, beat_parties, beat_weekly_plans,
// beat_plan_days, beat_notifications. New: emp_attendance.beat_id / beat_scope
// and the beat_party_requests table (see sql/beat_attendance_party_requests.sql).
const db = require("../config/db");

const PARTY_NAME = `COALESCE(NULLIF(c.firm_name, ''), c.name)`;

// ---------------------------------------------------------------------
//  WHICH BEATS MAY THE EMPLOYEE PICK TODAY
// ---------------------------------------------------------------------

// today's day of an APPROVED weekly plan (same approval rule as GET /beat-plan/today)
const getApprovedPlanBeat = async (userId, date) => {
  const [rows] = await db.query(
    `SELECT d.beat_id, p.status AS plan_status, d.amend_status
     FROM beat_plan_days d
     JOIN beat_weekly_plans p ON p.id = d.plan_id
     JOIN beats b ON b.id = d.beat_id
     WHERE p.user_id = ? AND d.plan_date = ?
     LIMIT 1`,
    [userId, date],
  );
  const row = rows[0];
  if (!row || row.plan_status !== "APPROVED") return null;
  if (row.amend_status && row.amend_status !== "APPROVED") return null;
  return row.beat_id;
};

// manager-created beats assigned to the employee
const getAssignedMasterBeatIds = async (userId) => {
  const [rows] = await db.query(
    `SELECT id FROM beats
     WHERE assigned_user_id = ? AND is_active = 1 AND source = 'MASTER'
     ORDER BY name ASC`,
    [userId],
  );
  return rows.map((r) => r.id);
};

const getBeatsByIds = async (beatIds) => {
  if (!beatIds.length) return [];
  const [rows] = await db.query(
    `SELECT b.id, b.name, b.market_area, b.district, b.total_km, b.source, b.is_active
     FROM beats b
     WHERE b.id IN (?)`,
    [beatIds],
  );
  // keep the order the ids were given in
  const byId = new Map(rows.map((r) => [r.id, r]));
  return beatIds.map((id) => byId.get(id)).filter(Boolean);
};

const getPartiesForBeats = async (beatIds) => {
  if (!beatIds.length) return [];
  const [rows] = await db.query(
    `SELECT bp.beat_id, c.id AS customer_id, c.type, c.distributor_ledger_id AS ledger_id,
            ${PARTY_NAME} AS name
     FROM beat_parties bp
     JOIN customers c ON c.id = bp.customer_id
     WHERE bp.beat_id IN (?)
     ORDER BY bp.beat_id ASC, bp.sequence_no ASC, name ASC`,
    [beatIds],
  );
  return rows;
};

// Scenario A (PLAN): approved plan for today -> only today's planned beat
// Scenario B (ASSIGNED): no approved plan, manager-created beats assigned -> those beats
// Scenario C (MANUAL): nothing -> the app shows a text field
const resolveAttendanceBeats = async (userId, date) => {
  let scope = "MANUAL";
  let beatIds = [];

  const plannedBeatId = await getApprovedPlanBeat(userId, date);
  if (plannedBeatId) {
    scope = "PLAN";
    beatIds = [plannedBeatId];
  } else {
    beatIds = await getAssignedMasterBeatIds(userId);
    if (beatIds.length) scope = "ASSIGNED";
  }

  const beats = await getBeatsByIds(beatIds);
  if (!beats.length) return { scope: "MANUAL", beats: [] };

  const parties = await getPartiesForBeats(beats.map((b) => b.id));
  const byBeat = new Map();
  for (const p of parties) {
    if (!byBeat.has(p.beat_id)) byBeat.set(p.beat_id, []);
    byBeat.get(p.beat_id).push({
      id: p.customer_id,
      type: p.type,
      ledger_id: p.ledger_id,
      name: p.name,
    });
  }

  return {
    scope,
    beats: beats.map((b) => ({
      id: b.id,
      name: b.name,
      market_area: b.market_area || "",
      district: b.district || "",
      total_km: Number(b.total_km) || 0,
      is_new_location: b.source === "ADHOC",
      parties: byBeat.get(b.id) || [],
    })),
  };
};

// ---------------------------------------------------------------------
//  TODAY'S ATTENDANCE BEAT (used by visits)
// ---------------------------------------------------------------------
const getTodayAttendanceBeat = async (employeeId) => {
  const [rows] = await db.query(
    `SELECT a.id AS attendance_id, a.status, a.beat_id, a.beat_scope, a.visit_location,
            b.name AS beat_name, b.source AS beat_source
     FROM emp_attendance a
     LEFT JOIN beats b ON b.id = a.beat_id
     WHERE a.employee_id = ? AND a.attendance_date = CURDATE()
     LIMIT 1`,
    [employeeId],
  );
  return rows[0] || null;
};

const getBeatPartyIdSets = async (beatId) => {
  const [rows] = await db.query(
    `SELECT bp.customer_id, COALESCE(bp.ledger_id, c.distributor_ledger_id) AS ledger_id
     FROM beat_parties bp
     LEFT JOIN customers c ON c.id = bp.customer_id
     WHERE bp.beat_id = ?`,
    [beatId],
  );
  return {
    customerIds: rows.map((r) => r.customer_id).filter((v) => v !== null),
    ledgerIds: rows.map((r) => r.ledger_id).filter((v) => v !== null),
  };
};

const isPartyInBeat = async (beatId, customerId, runner = db) => {
  const [rows] = await runner.query(
    `SELECT 1 FROM beat_parties bp
     WHERE bp.beat_id = ?
       AND (bp.customer_id = ?
            OR (bp.ledger_id IS NOT NULL AND bp.ledger_id = (
                 SELECT c.distributor_ledger_id FROM customers c
                 WHERE c.id = ? AND c.type = 'distributor')))
     LIMIT 1`,
    [beatId, customerId, customerId],
  );
  return rows.length > 0;
};

const getCustomerById = async (customerId) => {
  const [rows] = await db.query(
    `SELECT c.id, c.type, c.distributor_ledger_id, ${PARTY_NAME} AS name
     FROM customers c WHERE c.id = ?`,
    [customerId],
  );
  return rows[0] || null;
};

const getDistributorCustomerByLedger = async (ledgerId) => {
  const [rows] = await db.query(
    `SELECT c.id, c.type, c.distributor_ledger_id, ${PARTY_NAME} AS name
     FROM customers c
     WHERE c.type = 'distributor' AND c.distributor_ledger_id = ?
     LIMIT 1`,
    [ledgerId],
  );
  return rows[0] || null;
};

const getBeat = async (beatId) => {
  const [rows] = await db.query(
    `SELECT id, name, source, is_active, assigned_user_id FROM beats WHERE id = ?`,
    [beatId],
  );
  return rows[0] || null;
};

// another active manager beat that already holds this party (a party sits in one master beat)
const findOtherMasterBeat = async (customerId, excludeBeatId, runner = db) => {
  const [rows] = await runner.query(
    `SELECT b.id, b.name
     FROM beat_parties bp
     JOIN beats b ON b.id = bp.beat_id AND b.is_active = 1 AND b.source = 'MASTER'
     WHERE bp.customer_id = ? AND b.id <> ?
     LIMIT 1`,
    [customerId, excludeBeatId],
  );
  return rows[0] || null;
};

// ---------------------------------------------------------------------
//  PARTY ADDITION REQUESTS
// ---------------------------------------------------------------------
const REQUEST_SELECT = `
  SELECT r.id, r.user_id, r.beat_id, r.customer_id, r.approver_id, r.remarks,
         r.status, r.decision_remark, r.decided_by, r.request_date,
         DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
         DATE_FORMAT(r.decided_at, '%Y-%m-%d %H:%i:%s') AS decided_at,
         u.name AS user_name, jr.name AS job_role,
         b.name AS beat_name,
         ${PARTY_NAME} AS party_name, c.type AS party_type,
         ap.name AS approver_name, dc.name AS decided_by_name,
         (SELECT ob.name
            FROM beat_parties obp
            JOIN beats ob ON ob.id = obp.beat_id AND ob.is_active = 1 AND ob.source = 'MASTER'
           WHERE obp.customer_id = r.customer_id AND ob.id <> r.beat_id
           LIMIT 1) AS other_beat_name
  FROM beat_party_requests r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN job_roles jr ON jr.id = u.job_role_id
  JOIN beats b ON b.id = r.beat_id
  JOIN customers c ON c.id = r.customer_id
  LEFT JOIN users ap ON ap.id = r.approver_id
  LEFT JOIN users dc ON dc.id = r.decided_by`;

const getRequestById = async (id) => {
  const [rows] = await db.query(`${REQUEST_SELECT} WHERE r.id = ?`, [id]);
  return rows[0] || null;
};

const findPendingRequest = async (beatId, customerId) => {
  const [rows] = await db.query(
    `SELECT id FROM beat_party_requests
     WHERE beat_id = ? AND customer_id = ? AND status = 'PENDING'
     LIMIT 1`,
    [beatId, customerId],
  );
  return rows[0] || null;
};

// returns the new id, or null when a pending request for this party + beat already exists
const createRequest = async ({ userId, beatId, customerId, approverId, remarks, date }) => {
  try {
    const [result] = await db.query(
      `INSERT INTO beat_party_requests
         (user_id, beat_id, customer_id, approver_id, remarks, status, request_date)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
      [userId, beatId, customerId, approverId, remarks || null, date],
    );
    return result.insertId;
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") return null;
    throw err;
  }
};

const listMyRequests = async (userId) => {
  const [rows] = await db.query(
    `${REQUEST_SELECT} WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 100`,
    [userId],
  );
  return rows;
};

// pending requests the manager can decide: sent to him, or raised by anybody below him
const listPendingForManager = async (managerId, teamIds) => {
  const [rows] = await db.query(
    `${REQUEST_SELECT}
     WHERE r.status = 'PENDING'
       AND r.user_id <> ?
       AND (r.approver_id = ? OR r.user_id IN (?))
     ORDER BY r.id ASC`,
    [managerId, managerId, teamIds.length ? teamIds : [0]],
  );
  return rows;
};

const listHistoryForManager = async (managerId, teamIds, { status, page, limit }) => {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const off = (Math.max(Number(page) || 1, 1) - 1) * lim;
  const params = [managerId, managerId, teamIds.length ? teamIds : [0]];
  let statusSql = "";
  if (status) {
    statusSql = "AND r.status = ?";
    params.push(status);
  }

  const where = `
     WHERE r.user_id <> ?
       AND (r.approver_id = ? OR r.user_id IN (?))
       ${statusSql}`;

  const [rows] = await db.query(
    `${REQUEST_SELECT} ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
    [...params, lim, off],
  );
  const [[t]] = await db.query(
    `SELECT COUNT(*) AS c FROM beat_party_requests r ${where}`,
    params,
  );
  const total = Number(t.c) || 0;
  return { items: rows, total, page: Math.max(Number(page) || 1, 1), totalPages: Math.max(Math.ceil(total / lim), 1) };
};

// Approve in one transaction: lock the request, add the party to the beat, mark approved.
//   result.code: DONE | NOT_PENDING | BEAT_INACTIVE | OTHER_BEAT
const approveRequest = async (id, deciderId, remark) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[request]] = await conn.query(
      `SELECT id, beat_id, customer_id, status FROM beat_party_requests WHERE id = ? FOR UPDATE`,
      [id],
    );
    if (!request || request.status !== "PENDING") {
      await conn.rollback();
      return { code: "NOT_PENDING" };
    }

    const [[beat]] = await conn.query(
      `SELECT id, is_active FROM beats WHERE id = ? FOR UPDATE`,
      [request.beat_id],
    );
    if (!beat || !beat.is_active) {
      await conn.rollback();
      return { code: "BEAT_INACTIVE" };
    }

    const other = await findOtherMasterBeat(request.customer_id, request.beat_id, conn);
    if (other) {
      await conn.rollback();
      return { code: "OTHER_BEAT", otherBeatName: other.name };
    }

    let added = false;
    if (!(await isPartyInBeat(request.beat_id, request.customer_id, conn))) {
      const [[seq]] = await conn.query(
        `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_no FROM beat_parties WHERE beat_id = ?`,
        [request.beat_id],
      );
      await conn.query(
        `INSERT INTO beat_parties (beat_id, customer_id, ledger_id, sequence_no)
         SELECT ?, c.id, c.distributor_ledger_id, ?
         FROM customers c WHERE c.id = ?`,
        [request.beat_id, seq.next_no, request.customer_id],
      );
      added = true;
    }

    await conn.query(
      `UPDATE beat_party_requests
       SET status = 'APPROVED', decision_remark = ?, decided_by = ?, decided_at = NOW()
       WHERE id = ? AND status = 'PENDING'`,
      [remark || null, deciderId, id],
    );

    await conn.commit();
    return { code: "DONE", added };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// only the call that actually changes PENDING -> REJECTED gets done = true
const rejectRequest = async (id, deciderId, remark) => {
  const [result] = await db.query(
    `UPDATE beat_party_requests
     SET status = 'REJECTED', decision_remark = ?, decided_by = ?, decided_at = NOW()
     WHERE id = ? AND status = 'PENDING'`,
    [remark || null, deciderId, id],
  );
  return result.affectedRows === 1;
};

const clearRequestNotifications = async (requestId) => {
  await db.query(
    `UPDATE beat_notifications
     SET is_read = 1, read_at = NOW()
     WHERE ref_id = ? AND type = 'BEAT_PARTY_REQUESTED' AND is_read = 0`,
    [requestId],
  );
};

module.exports = {
  resolveAttendanceBeats,
  getTodayAttendanceBeat,
  getBeatPartyIdSets,
  isPartyInBeat,
  getCustomerById,
  getDistributorCustomerByLedger,
  getBeat,
  findPendingRequest,
  createRequest,
  getRequestById,
  listMyRequests,
  listPendingForManager,
  listHistoryForManager,
  approveRequest,
  rejectRequest,
  clearRequestNotifications,
};
