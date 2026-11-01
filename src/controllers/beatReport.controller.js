const plan = require("../models/beatPlan.model");
const rpt = require("../models/beatReport.model");
const D = require("../utils/beatDates");
const { HttpError, wrap, ok, toId, clean } = require("../utils/beatHttp");

// ------------------------------------------------------------------
//  RULES  (change here if your company policy changes)
// ------------------------------------------------------------------
const CHANGE_REASONS = [
  "Route Too Long",
  "Party Shifted/Closed",
  "New Society Formed",
  "Territory Overlap",
  "Security/Safety Issue",
  "Better Coverage Possible",
  "Manager Instruction",
  "Other",
];

const EXCEPTION_DAYS = 7; // how far back flags are looked for
const LOW_COVERAGE_RATIO = 0.5; // less than 50% of the parties visited => flag

// ------------------------------------------------------------------
//  helpers
// ------------------------------------------------------------------
const requireManager = async (me) => {
  const direct = await plan.getDirectSubordinates(me);
  if (!direct.length) throw new HttpError(403, "Only managers can see this");
  return direct;
};

// me + everybody below me (for an employee without a team this is just himself)
const myScope = (me) => plan.getSubordinateIds(me);

// emp_attendance.status  ->  label shown in the app
//  ⚠ run  SELECT DISTINCT status FROM emp_attendance;  and adjust if needed
const attendanceLabel = (statuses) => {
  if (!statuses.length) return "Not Started";
  const s = statuses.join(" ").toLowerCase();
  if (s.includes("leave")) return "On Leave";
  if (s.includes("day_over") || s.includes("day over") || s.includes("complete") || s.includes("closed")) {
    return "Completed";
  }
  return "In Progress";
};

const ratingFor = (daysOverdue) => {
  if (daysOverdue >= 60) return "Critical";
  if (daysOverdue >= 30) return "Poor";
  if (daysOverdue >= 15) return "Average";
  return "Good";
};

const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };

// anomaly flags of the last few days for these employees
const buildExceptions = async (userIds, today) => {
  const from = D.addDays(today, -EXCEPTION_DAYS);
  const yesterday = D.addDays(today, -1);

  const [lateRows, planDays] = await Promise.all([
    rpt.getLateLogins(userIds, from, today),
    rpt.getApprovedDays({ planOwnerIds: userIds, start: from, end: yesterday }),
  ]);

  const flags = [];

  lateRows.forEach((r) =>
    flags.push({
      type: "LATE_LOGIN",
      severity: "LOW",
      title: r.name,
      subtitle: `Late check-in on ${r.d}`,
      date: r.d,
    }),
  );

  planDays.forEach((r) => {
    const parties = Number(r.parties) || 0;
    if (!parties) return;

    const visited = Number(r.done) || 0; // beat customers really visited that day

    if (visited === 0) {
      flags.push({
        type: "NO_VISITS",
        severity: "HIGH",
        title: r.user_name,
        subtitle: `No visits on planned beat "${r.beat_name}" (${r.plan_date})`,
        date: r.plan_date,
      });
    } else if (visited / parties < LOW_COVERAGE_RATIO) {
      flags.push({
        type: "LOW_COVERAGE",
        severity: "MEDIUM",
        title: r.user_name,
        subtitle: `Only ${visited} of ${parties} parties visited on "${r.beat_name}" (${r.plan_date})`,
        date: r.plan_date,
      });
    }
  });

  flags.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  return flags.map((f, i) => ({ id: i + 1, ...f }));
};

// ------------------------------------------------------------------
//  TEAM TODAY   (Beat Plan home preview + "Team's Day" full page)
// ------------------------------------------------------------------

// GET /team/today?scope=direct|all&limit=
exports.teamToday = wrap(async (req, res) => {
  const me = req.user.id;
  const direct = await requireManager(me);
  const today = D.todayIST();

  const scope = req.query.scope === "all" ? "all" : "direct";
  const limit = Math.min(
    Math.max(Number(req.query.limit) || (scope === "all" ? 200 : 5), 1),
    300,
  );

  const ids =
    scope === "direct"
      ? direct.map((r) => r.id)
      : (await myScope(me)).filter((id) => id !== me);

  const users = await plan.getUsersByIds(ids); // active users, by name
  const userIds = users.map((u) => u.id);

  const [attendance, visitMap, planned, sales] = await Promise.all([
    rpt.getAttendanceForDay(userIds, today),
    rpt.getVisitsByUserDate(userIds, today, today),
    rpt.getPlannedForDay(userIds, today),
    rpt.getSalesTotals(userIds, today, today),
  ]);

  const statusByUser = new Map();
  attendance.forEach((a) => {
    const list = statusByUser.get(a.employee_id) || [];
    list.push(String(a.status || ""));
    statusByUser.set(a.employee_id, list);
  });

  const members = users.map((u) => ({
    id: u.id,
    name: u.name,
    job_role: u.job_role || "",
    status: attendanceLabel(statusByUser.get(u.id) || []),
    visits: (visitMap.get(`${u.id}|${today}`) || {}).visits || 0,
    visits_planned: (planned.get(u.id) || {}).parties || 0,
    sales: sales.get(u.id) || 0,
  }));

  const visitsDone = members.reduce((t, m) => t + m.visits, 0);
  const visitsPlanned = members.reduce((t, m) => t + m.visits_planned, 0);
  const salesToday = members.reduce((t, m) => t + m.sales, 0);
  let salesTarget = 0;
  planned.forEach((p) => (salesTarget += p.sales_target));

  // flags must never break the screen
  let flags = 0;
  try {
    flags = (await buildExceptions(userIds, today)).length;
  } catch (err) {
    console.error("BEAT team flags failed:", err.message);
  }

  return ok(res, {
    summary: {
      visits_done: visitsDone,
      visits_planned: visitsPlanned,
      sales_today: salesToday,
      target_achievement:
        salesTarget > 0 ? Math.round((salesToday / salesTarget) * 100) : 0,
      flags,
    },
    members: members.slice(0, limit),
  });
});

// ------------------------------------------------------------------
//  REPORTS   (work for a manager's whole team, or just himself)
// ------------------------------------------------------------------

// ------------------------------------------------------------------
//  how the numbers are worked out (week = Monday..Sunday, up to today)
//   planned visits   = parties in the beat, for every APPROVED planned day so far
//   completed visits = customers the employee visited that day (never more than planned)
//   sales / collection = what the employee booked / collected on the planned days,
//                        against the targets typed in those day plans
// ------------------------------------------------------------------
const weekWindow = (given, today) => {
  const weekStart = D.weekStartOf(given || today);
  const weekEnd = D.weekEndOf(weekStart);
  const end = weekEnd < today ? weekEnd : today; // only days that already happened
  return { weekStart, weekEnd, end };
};

// GET /reports/week-compliance   -> "Beat Compliance This Week" on the Beat Plan home screen
//  one cell per day (Mon..Sun) of the logged-in employee:
//    percent = customers visited / customers planned (approved beat of that day)
//    state   = DONE | TODAY | PLANNED (future day with a plan) | NO_PLAN | OFF | FUTURE
//  the big % = all days up to today together
exports.weekCompliance = wrap(async (req, res) => {
  const me = req.user.id;
  const today = D.todayIST();
  const weekStart = D.weekStartOf(today);
  const weekEnd = D.weekEndOf(weekStart);

  const owner = await plan.getUserForPlan(me);
  const holidays = await plan.getHolidaySet(weekStart, weekEnd);
  const rows = await rpt.getApprovedDays({
    planOwnerIds: [me],
    start: weekStart,
    end: weekEnd,
  });
  const byDate = new Map(rows.map((r) => [r.plan_date, r]));

  let plannedTotal = 0;
  let doneTotal = 0;

  const days = D.weekDates(weekStart).map((date) => {
    const row = byDate.get(date);
    const parties = row ? Number(row.parties) || 0 : 0;
    const done = row ? Number(row.done) || 0 : 0;
    const isFuture = date > today;
    const off = D.nonWorkingReason(date, owner && owner.week_off, holidays);

    let state;
    let percent = null;

    if (!row) {
      state = off ? "OFF" : isFuture ? "FUTURE" : "NO_PLAN";
    } else if (isFuture) {
      state = "PLANNED";
    } else {
      state = date === today ? "TODAY" : "DONE";
      if (parties > 0) {
        percent = Math.min(Math.round((done / parties) * 100), 100);
        plannedTotal += parties;
        doneTotal += done;
      }
    }

    return {
      date,
      label: D.weekdayName(date).slice(0, 3),
      state,
      planned: parties,
      done,
      percent,
    };
  });

  return ok(res, {
    week_start: weekStart,
    week_end: weekEnd,
    planned: plannedTotal,
    done: doneTotal,
    percent:
      plannedTotal > 0
        ? Math.min(Math.round((doneTotal / plannedTotal) * 100), 100)
        : 0,
    days,
  });
});

// GET /reports/beat-performance?week_start=
exports.beatPerformance = wrap(async (req, res) => {
  const me = req.user.id;
  const today = D.todayIST();

  if (req.query.week_start && !D.isValidDate(req.query.week_start)) {
    throw new HttpError(400, "week_start must be YYYY-MM-DD");
  }
  const { weekStart, weekEnd, end } = weekWindow(req.query.week_start, today);

  const team = await myScope(me);
  const beats = await rpt.getTeamBeats(team);
  const days = await rpt.getApprovedDays({
    beatOwnerIds: team,
    start: weekStart,
    end: weekEnd,
  });

  const workers = [...new Set(days.map((d) => d.user_id))];
  const hasPast = end >= weekStart;
  const [salesMap, collMap] = hasPast
    ? await Promise.all([
        rpt.getSalesByUserDate(workers, weekStart, end),
        rpt.getCollectionsByUserDate(workers, weekStart, end),
      ])
    : [new Map(), new Map()];

  const perBeat = new Map(
    beats.map((b) => [
      b.beat_id,
      {
        beat_id: b.beat_id,
        beat_name: b.beat_name,
        owner: b.owner_name || "",
        visits_planned: 0,
        visits_done: 0,
        sales_done: 0,
        sales_target: 0,
        collection_done: 0,
        collection_target: 0,
      },
    ]),
  );

  days.forEach((d) => {
    const item = perBeat.get(d.beat_id);
    if (!item) return;

    // targets: the whole week
    item.sales_target += Number(d.sales_target) || 0;
    item.collection_target += Number(d.collection_target) || 0;

    // achievements: only days that already happened
    if (d.plan_date > end) return;
    const key = `${d.user_id}|${d.plan_date}`;
    const parties = Number(d.parties) || 0;

    item.visits_planned += parties;
    item.visits_done += Number(d.done) || 0;
    item.sales_done += salesMap.get(key) || 0;
    item.collection_done += collMap.get(key) || 0;
  });

  return ok(res, {
    week_start: weekStart,
    week_end: weekEnd,
    items: [...perBeat.values()],
  });
});

// GET /reports/my-kpis   -> "My Beat KPIs" (the logged-in employee, this week)
exports.myKpis = wrap(async (req, res) => {
  const me = req.user.id;
  const today = D.todayIST();
  const { weekStart, weekEnd, end } = weekWindow(null, today);

  const days = await rpt.getApprovedDays({
    planOwnerIds: [me],
    start: weekStart,
    end: weekEnd,
  });

  const hasPast = end >= weekStart;
  const [ordersMap, salesMap, collMap] = hasPast
    ? await Promise.all([
        rpt.getOrdersByUserDate([me], weekStart, end),
        rpt.getSalesByUserDate([me], weekStart, end),
        rpt.getCollectionsByUserDate([me], weekStart, end),
      ])
    : [new Map(), new Map(), new Map()];

  let plannedWeek = 0; // every approved day of the week
  let plannedSoFar = 0; // days up to today
  let completed = 0;
  let productive = 0;
  let salesTarget = 0;
  let collectionTarget = 0;
  let absTarget = 0;

  days.forEach((d) => {
    const parties = Number(d.parties) || 0;
    plannedWeek += parties;
    salesTarget += Number(d.sales_target) || 0;
    collectionTarget += Number(d.collection_target) || 0;
    absTarget += Number(d.abs_target) || 0;

    if (d.plan_date > end) return;
    plannedSoFar += parties;
    const done = Number(d.done) || 0;
    completed += done;

    // a sales order created = an order received = a productive visit
    productive += Math.min(ordersMap.get(`${me}|${d.plan_date}`) || 0, done);
  });

  const sum = (m) => [...m.values()].reduce((t, x) => t + x, 0);
  const salesDone = sum(salesMap);
  const collectionDone = sum(collMap);
  const pct = (a, b) => (b > 0 ? Math.min(Math.round((a / b) * 100), 100) : 0);

  return ok(res, {
    week_start: weekStart,
    week_end: weekEnd,
    rings: {
      compliance: pct(completed, plannedSoFar),
      productive: pct(productive, completed),
      sales_achievement: pct(salesDone, salesTarget),
    },
    sales: { done: salesDone, target: salesTarget },
    collection: { done: collectionDone, target: collectionTarget },
    abs: { done: 0, target: absTarget }, // TODO: what "ABS booking" means / where it is stored
    visits: {
      planned: plannedWeek,
      completed,
      productive,
      remaining: Math.max(plannedWeek - completed, 0),
    },
  });
});

// GET /reports/party-coverage
exports.partyCoverage = wrap(async (req, res) => {
  const me = req.user.id;
  const today = D.todayIST();
  const team = await myScope(me);

  const parties = await rpt.getTeamBeatParties(team);
  const lastVisit = await rpt.getLastVisitDates(parties.map((p) => p.customer_id));

  const items = parties.map((p) => {
    const last = lastVisit.get(p.customer_id) || null;
    const days = last ? D.daysBetween(last, today) : null; // null = never visited
    const every = Number(p.visit_every_days) || 30;
    return {
      customer_id: p.customer_id,
      type: p.type,
      party: p.party_name,
      owner: p.owner_name || "",
      beat: p.beat_name,
      days_since_visit: days,
      every_days: every,
      overdue: days === null || days > every,
    };
  });

  // overdue first, longest gap first
  items.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return (b.days_since_visit ?? 99999) - (a.days_since_visit ?? 99999);
  });

  return ok(res, {
    total: items.length,
    overdue_count: items.filter((i) => i.overdue).length,
    items: items.slice(0, 200),
  });
});

// GET /reports/recovery-priority
exports.recoveryPriority = wrap(async (req, res) => {
  const me = req.user.id;
  const today = D.todayIST();
  const team = await myScope(me);

  const rows = await rpt.getOverdueParties(team, today);
  const items = rows.map((r) => {
    const days = Number(r.days_overdue) || 0;
    return {
      ledger_id: r.ledger_id,
      party: r.ledger_name,
      owner: r.owner_name || "",
      days_overdue: days,
      rating: ratingFor(days),
      amount: Number(r.amount) || 0,
    };
  });

  return ok(res, {
    total_outstanding: items.reduce((t, i) => t + i.amount, 0),
    items, // already ranked by (amount x days overdue)
  });
});

// GET /reports/exceptions
exports.exceptions = wrap(async (req, res) => {
  const me = req.user.id;
  const today = D.todayIST();
  const team = await myScope(me);
  const flags = await buildExceptions(team, today);
  return ok(res, { items: flags });
});

// ------------------------------------------------------------------
//  BEAT CHANGE REQUESTS
// ------------------------------------------------------------------
const mapRequest = (r) => ({
  id: r.id,
  user_id: r.user_id,
  user_name: r.user_name,
  job_role: r.job_role || "",
  reason: r.reason,
  details: r.details,
  status: r.status,
  beat_name: r.beat_name || "",
  manager_remark: r.manager_remark || "",
  created_at: r.created_at,
  decided_at: r.decided_at || "",
});

const managerOf = async (employee) => {
  const id = employee.reporting_under || employee.approver_id || null;
  if (!id || id === employee.id) return null;
  return plan.getUserForPlan(id);
};

// GET /change-requests/context   -> "Current Beat" + "Will be sent to"
exports.changeContext = wrap(async (req, res) => {
  const me = req.user.id;
  const employee = await plan.getUserForPlan(me);
  const manager = await managerOf(employee);
  const todayRow = await plan.getTodayPlanDay(me, D.todayIST());

  return ok(res, {
    reasons: CHANGE_REASONS,
    current_beat: todayRow ? todayRow.beat_name : "",
    sent_to: manager ? manager.name : "",
    sent_to_role: manager ? manager.job_role || "" : "",
  });
});

// POST /change-requests   body: { reason, details }
exports.createChangeRequest = wrap(async (req, res) => {
  const me = req.user.id;

  const reason = clean(req.body.reason, 60);
  if (!CHANGE_REASONS.includes(reason)) {
    throw new HttpError(400, "Please select a valid reason");
  }
  const details = clean(req.body.details, 1000);
  if (details.length < 5) {
    throw new HttpError(400, "Please describe the change you are requesting");
  }

  const employee = await plan.getUserForPlan(me);
  const manager = await managerOf(employee);
  if (!manager) {
    throw new HttpError(400, "You have no reporting manager to send this request to");
  }

  const todayRow = await plan.getTodayPlanDay(me, D.todayIST());
  const id = await rpt.createChangeRequest({
    userId: me,
    beatId: todayRow ? todayRow.beat_id : null,
    reason,
    details,
    approverId: manager.id,
  });

  return ok(
    res,
    mapRequest(await rpt.getChangeRequestById(id)),
    "Request sent to your manager",
    201,
  );
});

// GET /change-requests/mine
exports.myChangeRequests = wrap(async (req, res) => {
  const rows = await rpt.listMyChangeRequests(req.user.id);
  return ok(res, rows.map(mapRequest));
});

// GET /change-requests/pending   (manager)
exports.pendingChangeRequests = wrap(async (req, res) => {
  const rows = await rpt.listPendingChangeRequests(req.user.id);
  return ok(res, rows.map(mapRequest));
});

// POST /change-requests/:id/decide   body: { decision: APPROVED | REJECTED, remark }
exports.decideChangeRequest = wrap(async (req, res) => {
  const me = req.user.id;
  const id = toId(req.params.id, "request id");

  const decision = String(req.body.decision || "").toUpperCase();
  if (!["APPROVED", "REJECTED"].includes(decision)) {
    throw new HttpError(400, "decision must be APPROVED or REJECTED");
  }
  const remark = clean(req.body.remark, 500);
  if (decision === "REJECTED" && remark.length < 3) {
    throw new HttpError(400, "Please give a reason for rejecting");
  }

  const request = await rpt.getChangeRequestById(id);
  if (!request) throw new HttpError(404, "Request not found");
  if (request.user_id === me) {
    throw new HttpError(403, "You cannot decide your own request");
  }

  let allowed = request.approver_id === me;
  if (!allowed) {
    const team = await plan.getSubordinateIds(me);
    allowed = team.includes(request.user_id);
  }
  if (!allowed) throw new HttpError(403, "You are not allowed to decide this request");

  const done = await rpt.decideChangeRequest(id, me, decision, remark);
  if (!done) throw new HttpError(409, "This request has already been decided");

  return ok(
    res,
    mapRequest(await rpt.getChangeRequestById(id)),
    decision === "APPROVED" ? "Request approved" : "Request rejected",
  );
});