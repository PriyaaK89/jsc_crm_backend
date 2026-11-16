// Beat at attendance, party check for visits, party addition requests.
// Mounted under /beat-plan (see routes/beatPlan.routes.js).
const ba = require("../models/beatAttendance.model");
const plan = require("../models/beatPlan.model");
const D = require("../utils/beatDates");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error("BEAT ATTENDANCE ERROR:", err);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
};

const ok = (res, data, message = "OK", status = 200) =>
  res.status(status).json({ success: true, message, data });

const toId = (value, label = "id") => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${label}`);
  return n;
};

const optId = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const clean = (value, max) => {
  const s = String(value ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
};

const notify = (userIds, payload) =>
  plan
    .addNotification(userIds, { planId: null, ...payload })
    .catch((e) => console.error("BEAT PARTY NOTIFY ERROR:", e));

const managerOf = async (employee) => {
  const id = employee.reporting_under || employee.approver_id || null;
  if (!id || id === employee.id) return null;
  return plan.getUserForPlan(id);
};

const PARTY_NOT_IN_BEAT_MSG =
  "This party is not included in your today's selected beat. Please select a party " +
  "assigned to your beat or request your reporting manager to add this party.";

// ------------------------------------------------------------------
//  SHARED CHECKS (also used by empAttendance + visit controllers)
// ------------------------------------------------------------------

// Validates the beat the app sent with "Mark Attendance".
// Returns { beatId, scope } to save, or throws HttpError.
const validateAttendanceBeat = async (userId, beatIdRaw) => {
  const beatId = optId(beatIdRaw);
  if (!beatId) throw new HttpError(400, "Invalid beat selected");

  const { scope, beats } = await ba.resolveAttendanceBeats(userId, D.todayIST());
  if (!beats.some((b) => b.id === beatId)) {
    throw new HttpError(
      400,
      scope === "PLAN"
        ? "Selected beat is not your approved beat for today. Please select today's planned beat."
        : "Selected beat is not assigned to you or is not valid for today.",
    );
  }
  return { beatId, scope };
};

// Is this visit allowed under today's attendance beat?
//   { allowed: true } or { allowed: false, beat_id, beat_name }
// Manual attendance, no attendance, ADHOC beats and beats without parties never restrict.
const checkVisitParty = async (userId, customerId) => {
  let att;
  try {
    att = await ba.getTodayAttendanceBeat(userId);
  } catch (err) {
    // e.g. SQL migration not run yet -> never block visits because of it
    console.error("BEAT VISIT CHECK SKIPPED:", err.code || err.message);
    return { allowed: true };
  }
  if (!att || !att.beat_id || att.beat_scope === "MANUAL") return { allowed: true };
  if (att.beat_source === "ADHOC") return { allowed: true };

  const sets = await ba.getBeatPartyIdSets(att.beat_id);
  if (!sets.customerIds.length && !sets.ledgerIds.length) return { allowed: true };

  if (await ba.isPartyInBeat(att.beat_id, customerId)) return { allowed: true };
  return { allowed: false, beat_id: att.beat_id, beat_name: att.beat_name };
};

// ------------------------------------------------------------------
//  ATTENDANCE
// ------------------------------------------------------------------

// GET /beat-plan/attendance-beats   -> scope PLAN | ASSIGNED | MANUAL + beats with parties
const attendanceBeats = wrap(async (req, res) => {
  const me = req.user.id;
  const date = D.todayIST();
  const result = await ba.resolveAttendanceBeats(me, date);
  return ok(res, { date, ...result });
});

// GET /beat-plan/attendance-beat/today   -> beat chosen at today's attendance
const todayAttendanceBeat = wrap(async (req, res) => {
  const me = req.user.id;
  const att = await ba.getTodayAttendanceBeat(me);

  if (!att || !att.beat_id) {
    return ok(res, {
      marked: Boolean(att),
      restricted: false,
      mode: "MANUAL",
      working_area: att ? att.visit_location || "" : "",
      beat: null,
      party_ids: [],
      ledger_ids: [],
    });
  }

  const sets = await ba.getBeatPartyIdSets(att.beat_id);
  const restricted =
    att.beat_scope !== "MANUAL" &&
    att.beat_source !== "ADHOC" &&
    (sets.customerIds.length > 0 || sets.ledgerIds.length > 0);

  return ok(res, {
    marked: true,
    restricted,
    mode: att.beat_scope || "PLAN",
    working_area: att.visit_location || att.beat_name || "",
    beat: { id: att.beat_id, name: att.beat_name },
    party_ids: sets.customerIds,
    ledger_ids: sets.ledgerIds,
  });
});

// ------------------------------------------------------------------
//  PARTY ADDITION REQUESTS
// ------------------------------------------------------------------

// POST /beat-plan/party-requests   { customer_id | ledger_id, beat_id?, remarks? }
const createPartyRequest = wrap(async (req, res) => {
  const me = req.user.id;
  const body = req.body || {};

  // party: a customer id, or a distributor ledger id
  let customer = null;
  const customerId = optId(body.customer_id);
  const ledgerId = optId(body.ledger_id);
  if (customerId) customer = await ba.getCustomerById(customerId);
  else if (ledgerId) customer = await ba.getDistributorCustomerByLedger(ledgerId);
  if (!customer) {
    throw new HttpError(
      400,
      ledgerId
        ? "This distributor has no party record yet. Please record one visit for it first, or ask your manager to add it."
        : "Party not found",
    );
  }

  // beat: the one given, else the beat chosen at today's attendance
  let beatId = optId(body.beat_id);
  if (!beatId) {
    const att = await ba.getTodayAttendanceBeat(me);
    beatId = att && att.beat_id ? att.beat_id : null;
  }
  if (!beatId) throw new HttpError(400, "No beat selected for today");

  const beat = await ba.getBeat(beatId);
  if (!beat || !beat.is_active) throw new HttpError(400, "This beat is not active");

  // employee may only ask for a beat that is his today (plan beat or assigned beat)
  const { beats } = await ba.resolveAttendanceBeats(me, D.todayIST());
  const att = await ba.getTodayAttendanceBeat(me);
  const mine =
    beats.some((b) => b.id === beatId) ||
    (att && att.beat_id === beatId) ||
    beat.assigned_user_id === me;
  if (!mine) throw new HttpError(403, "You can request parties only for your own beat");

  if (await ba.isPartyInBeat(beatId, customer.id)) {
    throw new HttpError(409, `${customer.name} is already in ${beat.name}`);
  }
  if (await ba.findPendingRequest(beatId, customer.id)) {
    throw new HttpError(409, "A request for this party is already pending with your manager");
  }

  const employee = await plan.getUserForPlan(me);
  const manager = employee ? await managerOf(employee) : null;
  if (!manager) throw new HttpError(400, "No reporting manager is set for you");

  const id = await ba.createRequest({
    userId: me,
    beatId,
    customerId: customer.id,
    approverId: manager.id,
    remarks: clean(body.remarks, 500),
    date: D.todayIST(),
  });
  if (!id) {
    throw new HttpError(409, "A request for this party is already pending with your manager");
  }

  notify([manager.id], {
    refId: id,
    type: "BEAT_PARTY_REQUESTED",
    title: "Party Addition Request",
    message: `${employee.name} requested to add ${customer.name} to beat ${beat.name}.`,
  });

  return ok(res, await ba.getRequestById(id), "Request sent to your reporting manager", 201);
});

// GET /beat-plan/party-requests/mine
const myPartyRequests = wrap(async (req, res) => {
  return ok(res, await ba.listMyRequests(req.user.id));
});

// GET /beat-plan/party-requests/pending   (manager)
const pendingPartyRequests = wrap(async (req, res) => {
  const me = req.user.id;
  const team = await plan.getSubordinateIds(me);
  return ok(res, await ba.listPendingForManager(me, team));
});

// GET /beat-plan/party-requests/history?status=&page=&limit=   (manager)
const partyRequestHistory = wrap(async (req, res) => {
  const me = req.user.id;
  const team = await plan.getSubordinateIds(me);
  const status = ["PENDING", "APPROVED", "REJECTED"].includes(
    String(req.query.status || "").toUpperCase(),
  )
    ? String(req.query.status).toUpperCase()
    : null;
  return ok(
    res,
    await ba.listHistoryForManager(me, team, {
      status,
      page: req.query.page,
      limit: req.query.limit,
    }),
  );
});

// can the logged-in user decide this request?
const canDecide = async (me, request) => {
  if (request.user_id === me) return false;
  if (request.approver_id === me) return true;
  const team = await plan.getSubordinateIds(me);
  return team.includes(request.user_id);
};

// GET /beat-plan/party-requests/:id
const getPartyRequest = wrap(async (req, res) => {
  const me = req.user.id;
  const id = toId(req.params.id, "request id");
  const request = await ba.getRequestById(id);
  if (!request) throw new HttpError(404, "Request not found");

  const decidable = await canDecide(me, request);
  if (request.user_id !== me && !decidable) {
    throw new HttpError(403, "You cannot view this request");
  }
  return ok(res, { ...request, can_decide: decidable && request.status === "PENDING" });
});

// POST /beat-plan/party-requests/:id/decide   { action: APPROVE|REJECT, remark }
const decidePartyRequest = wrap(async (req, res) => {
  const me = req.user.id;
  const id = toId(req.params.id, "request id");
  const action = String((req.body && req.body.action) || "").toUpperCase();
  const remark = clean(req.body && req.body.remark, 500);

  if (!["APPROVE", "REJECT"].includes(action)) {
    throw new HttpError(400, "action must be APPROVE or REJECT");
  }
  if (action === "REJECT" && remark.length < 3) {
    throw new HttpError(400, "Please enter a reason for rejection");
  }

  const request = await ba.getRequestById(id);
  if (!request) throw new HttpError(404, "Request not found");
  if (request.user_id === me) throw new HttpError(403, "You cannot decide your own request");
  if (!(await canDecide(me, request))) {
    throw new HttpError(403, "You are not allowed to decide this request");
  }
  if (request.status !== "PENDING") {
    throw new HttpError(409, `This request is already ${request.status.toLowerCase()}`);
  }

  if (action === "APPROVE") {
    const result = await ba.approveRequest(id, me, remark);
    if (result.code === "NOT_PENDING") throw new HttpError(409, "This request was already decided");
    if (result.code === "BEAT_INACTIVE") throw new HttpError(400, "This beat is no longer active");
    if (result.code === "OTHER_BEAT") {
      throw new HttpError(
        409,
        `${request.party_name} is already in beat ${result.otherBeatName}. ` +
          "Remove it from that beat first, or reject this request.",
      );
    }

    notify([request.user_id], {
      refId: id,
      type: "BEAT_PARTY_APPROVED",
      title: "Party Request Approved",
      message: `Your request to add ${request.party_name} to beat ${request.beat_name} has been approved.`,
    });
  } else {
    const done = await ba.rejectRequest(id, me, remark);
    if (!done) throw new HttpError(409, "This request was already decided");

    notify([request.user_id], {
      refId: id,
      type: "BEAT_PARTY_REJECTED",
      title: "Party Request Rejected",
      message: `Your request to add ${request.party_name} to beat ${request.beat_name} has been rejected. Reason: ${remark}`,
    });
  }

  ba.clearRequestNotifications(id).catch((e) =>
    console.error("BEAT PARTY NOTIFY CLEAR ERROR:", e),
  );

  return ok(
    res,
    await ba.getRequestById(id),
    action === "APPROVE" ? "Party added to the beat" : "Request rejected",
  );
});

module.exports = {
  // routes
  attendanceBeats,
  todayAttendanceBeat,
  createPartyRequest,
  myPartyRequests,
  pendingPartyRequests,
  partyRequestHistory,
  getPartyRequest,
  decidePartyRequest,
  // shared checks
  HttpError,
  validateAttendanceBeat,
  checkVisitParty,
  PARTY_NOT_IN_BEAT_MSG,
};
