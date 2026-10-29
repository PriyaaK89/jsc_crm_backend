const model = require("../models/beatPlan.model");
const D = require("../utils/beatDates");

// ------------------------------------------------------------------
//  RULES (change here if your company policy changes)
// ------------------------------------------------------------------
const MIN_DAYS_TO_SUBMIT = 1; // employee may submit with just 1-2-3 days planned
const MAX_WEEKS_AHEAD = 2; // can plan current week + next 2 weeks
const EDITABLE = ["DRAFT", "REJECTED"];

// ------------------------------------------------------------------
//  small helpers
// ------------------------------------------------------------------
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
    console.error("BEAT PLAN ERROR:", err);
    return res
      .status(500)
      .json({ success: false, message: "Something went wrong" });
  }
};

const ok = (res, data, message = "OK", status = 200) =>
  res.status(status).json({ success: true, message, data });

const toId = (value, label = "id") => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${label}`);
  return n;
};

const toAmount = (value, label) => {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new HttpError(400, `${label} must be a number, 0 or more`);
  }
  return Math.round(n * 100) / 100;
};

const toCount = (value, label) => {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new HttpError(400, `${label} must be a whole number, 0 or more`);
  }
  return n;
};

const clean = (value, max) => {
  const s = String(value ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
};

// ------------------------------------------------------------------
//  response builder  (what the Flutter app receives)
// ------------------------------------------------------------------
// can the logged-in employee open / change this day?
//  - own DRAFT / REJECTED plan: every future day
//  - own APPROVED plan: only EMPTY days (new days) or his own PENDING / REJECTED added days


const canEditDay = (plan, viewerId, date, row, today) => {
  console.log("CAN_EDIT DEBUG", {
 viewerType: typeof viewerId,
  planUserId: plan.user_id, planUserType: typeof plan.user_id,
  date, today, status: plan.status,
  rowStatus: row ? row.amend_status : null,
});
  if (viewerId !== plan.user_id) return false;
  if (date < today) return false;
  if (EDITABLE.includes(plan.status)) return true;
  if (plan.status === "APPROVED") {
    return !row || ["PENDING", "REJECTED"].includes(row.amend_status);
  }
  return false;
};

const buildPlanPayload = async (plan, viewerId) => {
  const owner = await model.getUserForPlan(plan.user_id);
  const holidays = await model.getHolidaySet(plan.week_start, plan.week_end);
  const rows = await model.getPlanDays(plan.id);
  const byDate = new Map(rows.map((r) => [r.plan_date, r]));

  const today = D.todayIST();
  const days = [];
  const offDays = [];

  for (const date of D.weekDates(plan.week_start)) {
    const reason = D.nonWorkingReason(date, owner && owner.week_off, holidays);
    if (reason) {
      offDays.push({ date, weekday: D.weekdayName(date), reason });
      continue;
    }
    const r = byDate.get(date);
    days.push({
      date,
      weekday: D.weekdayName(date),
      is_planned: !!r,
      beat_id: r ? r.beat_id : null,
      beat_name: r ? r.beat_name : null,
      is_new_location: r ? r.beat_source === "ADHOC" : false,
      purpose: r ? r.purpose || "" : "",
      sales_target: r ? Number(r.sales_target) : 0,
      collection_target: r ? Number(r.collection_target) : 0,
      abs_target: r ? Number(r.abs_target) : 0,
      new_dealer_target: r ? Number(r.new_dealer_target) : 0,
      remark: r ? r.remark || "" : "",
      amend_status: r ? r.amend_status || "" : "",
      amend_remark: r ? r.amend_remark || "" : "",
      can_edit: canEditDay(plan, viewerId, date, r, today),
    });
  }

  const totals = rows.reduce(
    (t, r) => ({
      sales: t.sales + Number(r.sales_target),
      collection: t.collection + Number(r.collection_target),
      abs: t.abs + Number(r.abs_target),
      new_dealers: t.new_dealers + Number(r.new_dealer_target),
    }),
    { sales: 0, collection: 0, abs: 0, new_dealers: 0 },
  );

  const daysPlanned = days.filter((d) => d.is_planned).length;

  // the manager this plan goes to (shown before the employee submits)
  let routeTo = null;
  const routeId =
    plan.approver_id ||
    (owner && (owner.reporting_under || owner.approver_id)) ||
    null;
  if (routeId && routeId !== plan.user_id) {
    const m = await model.getUserForPlan(routeId);
    if (m) routeTo = { id: m.id, name: m.name, job_role: m.job_role };
  }

  const isOwner = viewerId === plan.user_id;
  const editable = isOwner && EDITABLE.includes(plan.status);

  return {
    id: plan.id,
    user_id: plan.user_id,
    user_name: plan.user_name,
    week_start: plan.week_start,
    week_end: plan.week_end,
    status: plan.status,
    approver: plan.approver_id
      ? {
          id: plan.approver_id,
          name: plan.approver_name,
          job_role: plan.approver_role,
        }
      : null,
    route_to: routeTo,
    submitted_at: plan.submitted_at,
    decided_at: plan.decided_at,
    manager_remark: plan.manager_remark,
    days_planned: daysPlanned,
    total_days: days.length,
    totals,
    can_edit: editable,
    can_submit: editable && daysPlanned >= MIN_DAYS_TO_SUBMIT,
    has_pending_amendments: rows.some((r) => r.amend_status === "PENDING"),
    days,
    off_days: offDays,
  };
};

// Who is the manager that should approve this employee's plan?
const resolveApproverId = async (employee) => {
  const id = employee.reporting_under || employee.approver_id || null;
  return id && id !== employee.id ? id : null;
};

// owner, manager (approver) or anybody above in the reporting chain
const canViewPlan = async (viewerId, plan) => {
  if (viewerId === plan.user_id || viewerId === plan.approver_id) return true;
  const subordinateIds = await model.getSubordinateIds(viewerId);
  return subordinateIds.includes(plan.user_id);
};

const loadPlan = async (planId) => {
  const plan = await model.getPlanById(planId);
  if (!plan) throw new HttpError(404, "Beat plan not found");
  return plan;
};

// day edits are also allowed on an APPROVED plan (new days that need approval)
const loadDayEditablePlan = async (userId, planId) => {
  const plan = await loadPlan(planId);
  if (plan.user_id !== userId) throw new HttpError(403, "This is not your plan");
  if (![...EDITABLE, "APPROVED"].includes(plan.status)) {
    throw new HttpError(
      409,
      "A plan waiting for approval cannot be edited. Withdraw it first.",
    );
  }
  return plan;
};

const loadEditablePlan = async (userId, planId) => {
  const plan = await loadPlan(planId);
  if (plan.user_id !== userId) throw new HttpError(403, "This is not your plan");
  if (!EDITABLE.includes(plan.status)) {
    throw new HttpError(
      409,
      `A ${plan.status.toLowerCase()} plan cannot be edited. Withdraw it first or raise a beat change request.`,
    );
  }
  return plan;
};

// ------------------------------------------------------------------
//  BEATS
// ------------------------------------------------------------------

// GET /beats/my   -> beats the logged-in user can pick in Day Plan
exports.getMyBeats = wrap(async (req, res) => {
  const rows = await model.getBeatsForUser(req.user.id);
  const data = rows.map((b) => ({
    id: b.id,
    name: b.name,
    market_area: b.market_area,
    district: b.district,
    parties_count: Number(b.parties_count) || 0,
    total_km: Number(b.total_km) || 0,
    is_new_location: b.source === "ADHOC",
    contact_mobile: b.contact_mobile,
  }));
  return ok(res, data);
});

// POST /beats/location  -> "+ ADD & SELECT LOCATION" on the Day Plan screen
// body: { name, market_area, contact_mobile }
exports.addLocation = wrap(async (req, res) => {
  const me = req.user.id;
  const name = clean(req.body.name, 150);
  const marketArea = clean(req.body.market_area, 150);
  const mobile = clean(req.body.contact_mobile, 15);

  if (name.length < 2) throw new HttpError(400, "Location / party name is required");
  if (mobile && !/^\d{10}$/.test(mobile)) {
    throw new HttpError(400, "Contact mobile must be 10 digits");
  }

  const id = await model.createBeat({
    name,
    marketArea,
    totalKm: 0,
    assignedUserId: me,
    source: "ADHOC",
    contactMobile: mobile,
    createdBy: me,
  });

  return ok(
    res,
    {
      id,
      name,
      market_area: marketArea || null,
      parties_count: 0,
      total_km: 0,
      is_new_location: true,
      contact_mobile: mobile || null,
    },
    "Location added",
    201,
  );
});

// ------------------------------------------------------------------
//  MANAGE BEATS  (manager side)
// ------------------------------------------------------------------
const requireManager = async (me) => {
  const reports = await model.getDirectSubordinates(me);
  if (!reports.length) {
    throw new HttpError(403, "Only managers can manage beats");
  }
};

const parseBeatBody = (body) => {
  const name = clean(body.name, 150);
  if (name.length < 2) throw new HttpError(400, "Beat name is required");
  return {
    name,
    marketArea: clean(body.market_area, 150),
    district: clean(body.district, 100),
    totalKm: toAmount(body.total_km, "Total km"),
  };
};

// returns null when the field is missing (= "keep existing parties")
const parsePartyIds = (value) => {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map((p) => toId(p, "party id")))];
};

// parties must belong to the manager's team and may sit in only ONE active beat
const validateParties = async (partyIds, teamIds, excludeBeatId) => {
  if (!partyIds.length) return;

  const inTeam = await model.countLedgersInTeam(partyIds, teamIds);
  if (inTeam !== partyIds.length) {
    throw new HttpError(400, "Some parties do not belong to your team");
  }

  const conflicts = await model.findPartyConflicts(partyIds, excludeBeatId);
  if (conflicts.length) {
    const c = conflicts[0];
    const more = conflicts.length > 1 ? ` (and ${conflicts.length - 1} more)` : "";
    throw new HttpError(
      409,
      `${c.ledger_name} is already in beat "${c.beat_name}"${more}`,
    );
  }
};

const loadManagedBeat = async (me, beatId) => {
  const beat = await model.getBeatById(beatId);
  if (!beat || beat.source !== "MASTER") {
    throw new HttpError(404, "Beat not found");
  }
  const team = await model.getSubordinateIds(me);
  if (beat.created_by !== me && !team.includes(beat.assigned_user_id)) {
    throw new HttpError(403, "This beat is not in your team");
  }
  return { beat, team };
};

// a beat that is used in a plan waiting for approval cannot be moved / switched off
const guardPendingUses = async (beatId, today) => {
  const pending = await model.countPendingFutureUses(beatId, today);
  if (pending > 0) {
    throw new HttpError(
      409,
      `${pending} submitted plan(s) are waiting for approval and use this beat. Approve or reject them first.`,
    );
  }
};

const partyRow = (p, beatInfo) => ({
  id: p.id,
  name: p.name,
  location: p.location || "",
  village: p.village_name || "",
  tehsil: p.tehsil_name || "",
  contact: p.contact || "",
  owner_name: p.owner_name || "",
  in_beat_id: beatInfo ? beatInfo.beat_id : null,
  in_beat_name: beatInfo ? beatInfo.beat_name : "",
});

const mapBeat = (b, parties = null) => ({
  id: b.id,
  name: b.name,
  market_area: b.market_area || "",
  district: b.district || "",
  total_km: Number(b.total_km) || 0,
  parties_count: Number(b.parties_count) || 0,
  assigned_user_id: b.assigned_user_id,
  assigned_user_name: b.assigned_user_name || "",
  assigned_role: b.assigned_role || "",
  created_by_name: b.created_by_name || "",
  is_active: !!b.is_active,
  ...(parties ? { parties: parties.map((p) => partyRow(p, null)) } : {}),
});

const beatPayload = async (beatId) => {
  const beat = await model.getBeatById(beatId);
  const parties = await model.getBeatParties(beatId);
  return mapBeat(beat, parties);
};

// GET /team   -> is the user a manager + the people he can assign beats to
exports.getTeam = wrap(async (req, res) => {
  const me = req.user.id;
  const reports = await model.getDirectSubordinates(me);
  if (!reports.length) return ok(res, { is_manager: false, members: [] });

  const ids = await model.getSubordinateIds(me); // includes the manager
  const rows = await model.getUsersByIds(ids);
  const members = rows.map((u) => ({
    id: u.id,
    name: u.name,
    job_role: u.job_role || "",
    is_self: u.id === me,
  }));
  return ok(res, { is_manager: true, members });
});

// GET /beats/managed?status=active|inactive|all&assigned_user_id=&search=
exports.listManagedBeats = wrap(async (req, res) => {
  const me = req.user.id;
  await requireManager(me);

  const status = ["active", "inactive", "all"].includes(req.query.status)
    ? req.query.status
    : "active";
  const assignedUserId = req.query.assigned_user_id
    ? toId(req.query.assigned_user_id, "assigned_user_id")
    : null;

  const team = await model.getSubordinateIds(me);
  const rows = await model.listManagedBeats({
    teamIds: team,
    createdBy: me,
    status,
    assignedUserId,
    search: clean(req.query.search, 100),
  });
  return ok(res, rows.map((b) => mapBeat(b)));
});

// GET /beats/:id   -> one beat with its parties
exports.getManagedBeat = wrap(async (req, res) => {
  const me = req.user.id;
  await requireManager(me);
  const beatId = toId(req.params.id, "beat id");
  await loadManagedBeat(me, beatId);
  return ok(res, await beatPayload(beatId));
});

// POST /beats   body: { name, market_area, district, total_km,
//                       assigned_user_id, party_ids: [] }
exports.createBeat = wrap(async (req, res) => {
  const me = req.user.id;
  await requireManager(me);

  const base = parseBeatBody(req.body);
  const team = await model.getSubordinateIds(me);

  const assignedUserId = req.body.assigned_user_id
    ? toId(req.body.assigned_user_id, "assigned_user_id")
    : me;
  if (!team.includes(assignedUserId)) {
    throw new HttpError(403, "You can assign beats only to your own team");
  }

  const partyIds = parsePartyIds(req.body.party_ids) || [];
  if (!partyIds.length) throw new HttpError(400, "Select at least one party");
  await validateParties(partyIds, team, null);

  const id = await model.createBeat({
    ...base,
    assignedUserId,
    source: "MASTER",
    createdBy: me,
    partyIds,
  });

  return ok(res, await beatPayload(id), "Beat created", 201);
});

// PUT /beats/:id   same body as create. Also used to REASSIGN (change assigned_user_id)
exports.updateBeat = wrap(async (req, res) => {
  const me = req.user.id;
  await requireManager(me);
  const beatId = toId(req.params.id, "beat id");
  const { beat, team } = await loadManagedBeat(me, beatId);

  const base = parseBeatBody(req.body);

  const assignedUserId = req.body.assigned_user_id
    ? toId(req.body.assigned_user_id, "assigned_user_id")
    : beat.assigned_user_id;
  if (!team.includes(assignedUserId)) {
    throw new HttpError(403, "You can assign beats only to your own team");
  }

  const partyIds = parsePartyIds(req.body.party_ids);
  if (partyIds) {
    if (!partyIds.length) throw new HttpError(400, "Select at least one party");
    await validateParties(partyIds, team, beatId);
  }

  const today = D.todayIST();
  const reassigned = assignedUserId !== beat.assigned_user_id;
  if (reassigned) await guardPendingUses(beatId, today);

  await model.updateBeat(beatId, { ...base, assignedUserId, partyIds });

  let message = "Beat updated";
  if (reassigned) {
    const cleared = await model.clearFutureDraftDays(beatId, today);
    message = cleared
      ? `Beat reassigned. ${cleared} upcoming day(s) in the previous employee's draft plans were cleared.`
      : "Beat reassigned";
  }

  return ok(res, await beatPayload(beatId), message);
});

// POST /beats/:id/status   body: { is_active: true | false }
exports.setBeatStatus = wrap(async (req, res) => {
  const me = req.user.id;
  await requireManager(me);
  const beatId = toId(req.params.id, "beat id");
  const { beat } = await loadManagedBeat(me, beatId);

  if (typeof req.body.is_active !== "boolean") {
    throw new HttpError(400, "is_active must be true or false");
  }
  const makeActive = req.body.is_active;
  const today = D.todayIST();

  if (!makeActive) {
    await guardPendingUses(beatId, today);
    await model.setBeatActive(beatId, false);
    const cleared = await model.clearFutureDraftDays(beatId, today);
    return ok(
      res,
      await beatPayload(beatId),
      cleared
        ? `Beat deactivated. ${cleared} upcoming day(s) in draft plans were cleared.`
        : "Beat deactivated",
    );
  }

  // re-activating: its parties must not be sitting in another active beat now
  const parties = await model.getBeatParties(beatId);
  await validateParties(
    parties.map((p) => p.id),
    await model.getSubordinateIds(me),
    beatId,
  );
  await model.setBeatActive(beatId, true);
  return ok(res, await beatPayload(beatId), "Beat activated");
});

// GET /parties?assigned_user_id=&search=&exclude_beat_id=&limit=&offset=
//   parties of the manager's team, each flagged if it is already in another beat
exports.searchParties = wrap(async (req, res) => {
  const me = req.user.id;
  await requireManager(me);
  const team = await model.getSubordinateIds(me);

  const ownerId = req.query.assigned_user_id
    ? toId(req.query.assigned_user_id, "assigned_user_id")
    : null;
  if (ownerId && !team.includes(ownerId)) {
    throw new HttpError(403, "That employee is not in your team");
  }

  const excludeBeatId = req.query.exclude_beat_id
    ? toId(req.query.exclude_beat_id, "exclude_beat_id")
    : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 50);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const { rows, total } = await model.searchParties({
    teamIds: team,
    ownerId,
    search: clean(req.query.search, 100),
    limit,
    offset,
  });

  const beatMap = await model.getPartyBeatMap(
    rows.map((r) => r.id),
    excludeBeatId,
  );

  return ok(res, {
    total,
    items: rows.map((r) => partyRow(r, beatMap.get(r.id))),
  });
});

// ------------------------------------------------------------------
//  WEEKLY PLAN  (employee side)
// ------------------------------------------------------------------

// GET /plans   -> my recent plans + which week is "current"
exports.listMyPlans = wrap(async (req, res) => {
  const me = req.user.id;
  const today = D.todayIST();
  const currentWeekStart = D.weekStartOf(today);

  const rows = await model.listMyPlans(me);
  const owner = await model.getUserForPlan(me);

  const plans = [];
  for (const p of rows) {
    const holidays = await model.getHolidaySet(p.week_start, p.week_end);
    const totalDays = D.weekDates(p.week_start).filter(
      (d) => !D.nonWorkingReason(d, owner && owner.week_off, holidays),
    ).length;

    plans.push({
      id: p.id,
      week_start: p.week_start,
      week_end: p.week_end,
      status: p.status,
      days_planned: Number(p.days_planned) || 0,
      total_days: totalDays,
      manager_remark: p.manager_remark,
    });
  }

  return ok(res, {
    current_week: {
      week_start: currentWeekStart,
      week_end: D.weekEndOf(currentWeekStart),
    },
    plans,
  });
});

// POST /plans   body: { week_start? }   (any date inside the week is fine)
// -> opens the plan for that week. Creates an empty DRAFT if there is none.
exports.openPlan = wrap(async (req, res) => {
  const me = req.user.id;
  const today = D.todayIST();
  const currentWeekStart = D.weekStartOf(today);

  const given = req.body.week_start || today;
  if (!D.isValidDate(given)) throw new HttpError(400, "week_start must be YYYY-MM-DD");

  const weekStart = D.weekStartOf(given);
  if (weekStart < currentWeekStart) {
    throw new HttpError(400, "You cannot create a plan for a past week");
  }
  if (weekStart > D.addDays(currentWeekStart, 7 * MAX_WEEKS_AHEAD)) {
    throw new HttpError(
      400,
      `You can plan only up to ${MAX_WEEKS_AHEAD} weeks ahead`,
    );
  }

  let plan = await model.findPlanByWeek(me, weekStart);
  let created = false;

  if (!plan) {
    try {
      const id = await model.createPlan({
        userId: me,
        weekStart,
        weekEnd: D.weekEndOf(weekStart),
      });
      await model.addLog(id, "CREATED", me);
      plan = await model.getPlanById(id);
      created = true;
    } catch (err) {
      // two taps at the same time -> unique key (user_id, week_start)
      if (err && err.code === "ER_DUP_ENTRY") {
        plan = await model.findPlanByWeek(me, weekStart);
      } else {
        throw err;
      }
    }
  }

  return ok(
    res,
    await buildPlanPayload(plan, me),
    created ? "Plan created" : "Plan loaded",
    created ? 201 : 200,
  );
});

// GET /plans/:id
exports.getPlan = wrap(async (req, res) => {
  const me = req.user.id;
  const plan = await loadPlan(toId(req.params.id, "plan id"));

  if (!(await canViewPlan(me, plan))) {
    throw new HttpError(403, "You cannot view this plan");
  }

  const payload = await buildPlanPayload(plan, me);
  payload.logs = await model.getLogs(plan.id);
  return ok(res, payload);
});

// PUT /plans/:id/days/:date
// body: { beat_id, purpose, sales_target, collection_target, abs_target,
//         new_dealer_target, remark }
exports.saveDay = wrap(async (req, res) => {
  const me = req.user.id;
  const planId = toId(req.params.id, "plan id");
  const date = req.params.date;
  if (!D.isValidDate(date)) throw new HttpError(400, "date must be YYYY-MM-DD");

  const plan = await loadDayEditablePlan(me, planId);

  if (date < plan.week_start || date > plan.week_end) {
    throw new HttpError(400, "This date is outside the plan week");
  }
  if (date < D.todayIST()) {
    throw new HttpError(400, "You cannot plan a past date");
  }

  const owner = await model.getUserForPlan(me);
  const holidays = await model.getHolidaySet(date, date);
  const reason = D.nonWorkingReason(date, owner && owner.week_off, holidays);
  if (reason) {
    throw new HttpError(
      400,
      reason === "HOLIDAY"
        ? "This date is a company holiday"
        : "This date is your weekly off",
    );
  }

  // on an APPROVED plan only NEW days (or his own pending / rejected added days)
  // can be saved. Changing an approved day needs a Beat Change Request.
  const addOn = plan.status === "APPROVED";
  if (addOn) {
    const existing = await model.getPlanDay(planId, date);
    if (existing && !["PENDING", "REJECTED"].includes(existing.amend_status)) {
      throw new HttpError(
        409,
        "This day is already approved. To change it, raise a Beat Change Request.",
      );
    }
  }

  const beatId = toId(req.body.beat_id, "beat_id");
  const beat = await model.getBeatForUser(beatId, me);
  if (!beat) throw new HttpError(400, "This beat is not assigned to you");

  await model.upsertDay(planId, date, {
    beatId,
    purpose: clean(req.body.purpose, 255),
    salesTarget: toAmount(req.body.sales_target, "Sales target"),
    collectionTarget: toAmount(req.body.collection_target, "Collection target"),
    absTarget: toAmount(req.body.abs_target, "ABS target"),
    newDealerTarget: toCount(req.body.new_dealer_target, "New dealer target"),
    remark: clean(req.body.remark, 500),
  }, addOn ? "PENDING" : null);

  if (addOn) {
    await model.addLog(planId, "DAY_ADDED", me, date);
  }

  // editing a rejected plan turns it back into a draft
  if (plan.status === "REJECTED") {
    await model.transitionStatus(planId, ["REJECTED"], { status: "DRAFT" });
  }

  const fresh = await loadPlan(planId);
  return ok(res, await buildPlanPayload(fresh, me), addOn ? "Day added – waiting for your manager's approval" : "Day plan saved");
});

// DELETE /plans/:id/days/:date   -> clear one planned day
exports.clearDay = wrap(async (req, res) => {
  const me = req.user.id;
  const planId = toId(req.params.id, "plan id");
  const date = req.params.date;
  if (!D.isValidDate(date)) throw new HttpError(400, "date must be YYYY-MM-DD");

  const plan = await loadDayEditablePlan(me, planId);
  if (date < D.todayIST()) {
    throw new HttpError(400, "You cannot change a past date");
  }

  if (plan.status === "APPROVED") {
    // only an added day that is still pending / rejected can be removed
    const existing = await model.getPlanDay(planId, date);
    if (existing && !["PENDING", "REJECTED"].includes(existing.amend_status)) {
      throw new HttpError(
        409,
        "This day is already approved. To change it, raise a Beat Change Request.",
      );
    }
  }

  await model.deleteDay(planId, date);
  if (plan.status === "REJECTED") {
    await model.transitionStatus(planId, ["REJECTED"], { status: "DRAFT" });
  }

  const fresh = await loadPlan(planId);
  return ok(res, await buildPlanPayload(fresh, me), "Day plan cleared");
});

// POST /plans/:id/submit   -> send to the reporting manager
exports.submitPlan = wrap(async (req, res) => {
  const me = req.user.id;
  const planId = toId(req.params.id, "plan id");
  const plan = await loadEditablePlan(me, planId);

  const planned = await model.countPlannedDays(planId);
  if (planned < MIN_DAYS_TO_SUBMIT) {
    throw new HttpError(
      400,
      `Plan at least ${MIN_DAYS_TO_SUBMIT} day before submitting`,
    );
  }

  const employee = await model.getUserForPlan(me);
  const approverId = await resolveApproverId(employee);

  // top of the hierarchy (nobody to report to) -> auto approved
  if (!approverId) {
    const done = await model.transitionStatus(planId, EDITABLE, {
      status: "APPROVED",
      approver_id: null,
      submitted_at: model.NOW,
      decided_by: me,
      decided_at: model.NOW,
      manager_remark: null,
    });
    if (!done) throw new HttpError(409, "Plan status has just changed, please refresh");

    await model.addLog(planId, "AUTO_APPROVED", me, "No reporting manager");
    const fresh = await loadPlan(planId);
    return ok(res, await buildPlanPayload(fresh, me), "Plan approved automatically");
  }

  const done = await model.transitionStatus(planId, EDITABLE, {
    status: "SUBMITTED",
    approver_id: approverId,
    submitted_at: model.NOW,
    decided_by: null,
    decided_at: null,
    manager_remark: null,
  });
  if (!done) throw new HttpError(409, "Plan status has just changed, please refresh");

  await model.addLog(planId, "SUBMITTED", me);
  const fresh = await loadPlan(planId);
  return ok(res, await buildPlanPayload(fresh, me), "Plan submitted for approval");
});

// POST /plans/:id/withdraw   -> take back a submitted plan (before manager acts)
exports.withdrawPlan = wrap(async (req, res) => {
  const me = req.user.id;
  const planId = toId(req.params.id, "plan id");
  const plan = await loadPlan(planId);
  if (plan.user_id !== me) throw new HttpError(403, "This is not your plan");

  const done = await model.transitionStatus(planId, ["SUBMITTED"], {
    status: "DRAFT",
    approver_id: null,
    submitted_at: null,
  });
  if (!done) {
    throw new HttpError(409, "Only a submitted plan can be withdrawn");
  }

  await model.addLog(planId, "WITHDRAWN", me);
  const fresh = await loadPlan(planId);
  return ok(res, await buildPlanPayload(fresh, me), "Plan withdrawn");
});

// ------------------------------------------------------------------
//  APPROVAL  (manager side)
// ------------------------------------------------------------------

// GET /approvals/pending
exports.pendingApprovals = wrap(async (req, res) => {
  const rows = await model.listPendingForApprover(req.user.id);
  const data = rows.map((p) => ({
    id: p.id,
    user_id: p.user_id,
    user_name: p.user_name,
    job_role: p.job_role,
    week_start: p.week_start,
    week_end: p.week_end,
    submitted_at: p.submitted_at,
    days_planned: Number(p.days_planned) || 0,
    total_sales: Number(p.total_sales) || 0,
    total_collection: Number(p.total_collection) || 0,
    total_new_dealers: Number(p.total_new_dealers) || 0,
    is_amendment: p.status === "APPROVED", // approved plan with NEW days waiting
    pending_days: Number(p.pending_days) || 0,
  }));
  return ok(res, data);
});

const decide = async (req, res, decision) => {
  const me = req.user.id;
  const planId = toId(req.params.id, "plan id");
  const plan = await loadPlan(planId);

  if (plan.user_id === me) {
    throw new HttpError(403, "You cannot approve your own plan");
  }

  // the assigned manager, or anybody above him in the reporting chain
  let allowed = plan.approver_id === me;
  if (!allowed) {
    const team = await model.getSubordinateIds(me);
    allowed = team.includes(plan.user_id);
  }
  if (!allowed) throw new HttpError(403, "You are not allowed to decide this plan");

  const remark = clean(req.body.remark, 500);
  if (decision === "REJECTED" && remark.length < 3) {
    throw new HttpError(400, "Please give a reason for rejecting");
  }

  // new days added to an already approved plan
  if (plan.status === "APPROVED") {
    const changed = await model.decideAmendments(planId, decision, remark);
    if (!changed) {
      throw new HttpError(409, "There are no new days waiting for approval");
    }
    await model.addLog(planId, `DAYS_${decision}`, me, remark || null);
    const freshPlan = await loadPlan(planId);
    return ok(
      res,
      await buildPlanPayload(freshPlan, me),
      decision === "APPROVED" ? "New days approved" : "New days rejected",
    );
  }

  const done = await model.transitionStatus(planId, ["SUBMITTED"], {
    status: decision,
    decided_by: me,
    decided_at: model.NOW,
    manager_remark: remark || null,
  });
  if (!done) {
    throw new HttpError(409, "This plan is no longer waiting for approval");
  }

  await model.addLog(planId, decision, me, remark || null);
  const fresh = await loadPlan(planId);
  return ok(
    res,
    await buildPlanPayload(fresh, me),
    decision === "APPROVED" ? "Plan approved" : "Plan rejected",
  );
};

// POST /plans/:id/approve   body: { remark? }
exports.approvePlan = wrap((req, res) => decide(req, res, "APPROVED"));

// POST /plans/:id/reject    body: { remark }   (reason is required)
exports.rejectPlan = wrap((req, res) => decide(req, res, "REJECTED"));

// ------------------------------------------------------------------
//  TODAY'S BEAT  (Beat Plan home screen)
// ------------------------------------------------------------------

// GET /today
//  -> today's beat of the logged-in employee + the planned / completed counts
exports.getToday = wrap(async (req, res) => {
  const me = req.user.id;
  const today = D.todayIST();

  const row = await model.getTodayPlanDay(me, today);

  // APPROVED | PENDING | REJECTED | DRAFT | NONE
  let approvalState = "NONE";
  if (row) {
    if (row.plan_status === "APPROVED") {
      if (!row.amend_status || row.amend_status === "APPROVED") {
        approvalState = "APPROVED";
      } else {
        approvalState = row.amend_status; // PENDING or REJECTED (added day)
      }
    } else if (row.plan_status === "SUBMITTED") {
      approvalState = "PENDING";
    } else if (row.plan_status === "REJECTED") {
      approvalState = "REJECTED";
    } else {
      approvalState = "DRAFT";
    }
  }

  // visits are compared with the beat's parties only when the beat is approved
  let partyIds = [];
  if (row && approvalState === "APPROVED") {
    partyIds = await model.getBeatPartyIds(row.beat_id);
  }

  let completed = 0;
  let unplanned = 0;
  try {
    const visited = await model.getVisitedCustomerIds(me, today);
    const partySet = new Set(partyIds);
    completed = visited.filter((id) => partySet.has(id)).length;
    unplanned = visited.length - completed;
  } catch (err) {
    // never break the home screen if the visits table differs from what we expect
    console.error("BEAT TODAY visits count failed:", err.message);
  }

  return ok(res, {
    date: today,
    approval_state: approvalState,
    plan_id: row ? row.plan_id : null,
    beat: row
      ? {
          id: row.beat_id,
          name: row.beat_name,
          market_area: row.market_area || "",
          district: row.district || "",
          total_km: Number(row.total_km) || 0,
          parties_count: Number(row.parties_count) || 0,
          is_new_location: row.source === "ADHOC",
          purpose: row.purpose || "",
          sales_target: Number(row.sales_target) || 0,
          collection_target: Number(row.collection_target) || 0,
          new_dealer_target: Number(row.new_dealer_target) || 0,
          remark: row.remark || "",
        }
      : null,
    counts: {
      planned: partyIds.length,
      completed,
      missed: 0, // a party is "missed" only after the day is over
      unplanned,
    },
  });
});