const plan = require("../models/beatPlan.model");
const hist = require("../models/beatHistory.model");
const D = require("../utils/beatDates");
const { HttpError, wrap, ok, toId, clean } = require("../utils/beatHttp");

// Read-only screens: an employee sees himself, a manager sees his team at any
// depth, and an admin sees everybody.
const isAdmin = (req) => ["ADMIN", "SUPER_ADMIN"].includes(req.user.role);

const resolveTarget = async (req) => {
  const me = req.user.id;
  const target = req.query.user_id ? toId(req.query.user_id, "user_id") : me;
  if (target === me || isAdmin(req)) return target;

  const team = await plan.getSubordinateIds(me);
  if (!team.includes(target)) {
    throw new HttpError(403, "This employee is not in your team");
  }
  return target;
};

const loadEmployee = async (userId) => {
  const employee = await hist.getEmployee(userId);
  if (!employee) throw new HttpError(404, "Employee not found");
  return {
    id: employee.id,
    name: employee.name,
    job_role: employee.job_role || "",
    reporting_manager: employee.reporting_manager || "",
  };
};

const mapParty = (p, visitedIds = null) => ({
  id: p.id,
  type: p.type || "",
  name: p.display_name || "",
  person: p.person || "",
  location: [p.area, p.town, p.district].filter(Boolean).join(", "),
  contact: p.contact || "",
  owner_name: p.owner_name || "",
  ...(visitedIds ? { visited: visitedIds.has(p.id) } : {}),
});

// APPROVED | PENDING | REJECTED | RESUBMIT_REQUIRED | DRAFT
const dayStatus = (row) => {
  if (row.plan_status === "APPROVED") {
    return !row.amend_status || row.amend_status === "APPROVED"
      ? "APPROVED"
      : row.amend_status;
  }
  if (row.plan_status === "SUBMITTED") return "PENDING";
  return row.plan_status;
};

// GET /beat-history/employees?search=
exports.employees = wrap(async (req, res) => {
  const me = req.user.id;
  const admin = isAdmin(req);
  const rows = await hist.listEmployees({
    userIds: admin ? null : await plan.getSubordinateIds(me),
    search: clean(req.query.search, 100),
  });

  return ok(res, {
    is_admin: admin,
    items: rows.map((u) => ({
      id: u.id,
      name: u.name,
      job_role: u.job_role || "",
      reporting_manager: u.reporting_manager || "",
      is_active: !!u.is_active,
      is_self: u.id === me,
    })),
  });
});

// GET /beat-history/beats?user_id=
exports.beats = wrap(async (req, res) => {
  const userId = await resolveTarget(req);
  const beats = await hist.getAssignedBeats(userId);
  const parties = await hist.getPartiesForBeats(beats.map((b) => b.id));

  return ok(res, {
    employee: await loadEmployee(userId),
    items: beats.map((b) => {
      const list = parties.filter((p) => p.beat_id === b.id);
      return {
        id: b.id,
        name: b.name,
        market_area: b.market_area || "",
        district: b.district || "",
        total_km: Number(b.total_km) || 0,
        is_new_location: b.source === "ADHOC",
        contact_mobile: b.contact_mobile || "",
        is_active: !!b.is_active,
        created_by_name: b.created_by_name || "",
        created_at: b.created_at,
        parties_count: list.length,
        parties: list.map((p) => mapParty(p)),
      };
    }),
  });
});

// GET /beat-history/plan-day?user_id=&date=
exports.planDay = wrap(async (req, res) => {
  const userId = await resolveTarget(req);
  const date = req.query.date || D.todayIST();
  if (!D.isValidDate(date)) throw new HttpError(400, "date must be YYYY-MM-DD");

  const employee = await loadEmployee(userId);
  const row = await hist.getPlanDay(userId, date);
  const newDealers = await hist.getNewDealers(userId, date, date);
  const base = {
    date,
    employee,
    new_dealers_done: newDealers.length,
    new_dealers: newDealers,
  };

  // a draft is not submitted yet, so only its owner sees it
  if (!row || (row.plan_status === "DRAFT" && userId !== req.user.id)) {
    return ok(res, { ...base, plan: null });
  }

  const [parties, visited] = await Promise.all([
    hist.getPartiesForBeats([row.beat_id]),
    hist.getVisitedCustomerIds(userId, date),
  ]);
  const visitedIds = new Set(visited);
  const mapped = parties.map((p) => mapParty(p, visitedIds));

  return ok(res, {
    ...base,
    plan: {
      plan_id: row.plan_id,
      plan_status: row.plan_status,
      day_status: dayStatus(row),
      week_start: row.week_start,
      week_end: row.week_end,
      submitted_at: row.submitted_at || "",
      decided_at: row.decided_at || "",
      approver_name: row.approver_name || "",
      decided_by_name: row.decided_by_name || "",
      manager_remark: row.manager_remark || "",
      amend_remark: row.amend_remark || "",
      beat: {
        id: row.beat_id,
        name: row.beat_name,
        market_area: row.market_area || "",
        district: row.district || "",
        total_km: Number(row.total_km) || 0,
        is_new_location: row.source === "ADHOC",
        contact_mobile: row.contact_mobile || "",
      },
      purpose: row.purpose || "",
      remark: row.remark || "",
      sales_target: Number(row.sales_target) || 0,
      collection_target: Number(row.collection_target) || 0,
      abs_target: Number(row.abs_target) || 0,
      new_dealer_target: Number(row.new_dealer_target) || 0,
      parties: mapped,
      parties_visited: mapped.filter((p) => p.visited).length,
    },
  });
});

// GET /beat-history/plans?user_id=&status=&from_date=&to_date=&page=&limit=
exports.plans = wrap(async (req, res) => {
  const userId = await resolveTarget(req);
  const { from_date: fromDate, to_date: toDate } = req.query;
  if ((fromDate && !D.isValidDate(fromDate)) || (toDate && !D.isValidDate(toDate))) {
    throw new HttpError(400, "Dates must be YYYY-MM-DD");
  }

  const status = String(req.query.status || "").toUpperCase();
  if (status && !["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"].includes(status)) {
    throw new HttpError(400, "Invalid status");
  }

  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const { rows, total } = await hist.listPlans({
    userId,
    status,
    fromDate,
    toDate,
    hideDrafts: userId !== req.user.id,
    page,
    limit,
  });

  const items = await Promise.all(
    rows.map(async (p) => ({
      id: p.id,
      user_id: p.user_id,
      status: p.status,
      week_start: p.week_start,
      week_end: p.week_end,
      submitted_at: p.submitted_at || "",
      decided_at: p.decided_at || "",
      approver_name: p.approver_name || "",
      decided_by_name: p.decided_by_name || "",
      manager_remark: p.manager_remark || "",
      days_planned: Number(p.days_planned) || 0,
      pending_days: Number(p.pending_days) || 0,
      resubmit_days: Number(p.resubmit_days) || 0,
      total_sales: Number(p.total_sales) || 0,
      total_collection: Number(p.total_collection) || 0,
      new_dealer_target: Number(p.new_dealer_target) || 0,
      new_dealers_done: await hist.countNewDealers(userId, p.week_start, p.week_end),
    })),
  );

  return ok(res, {
    employee: await loadEmployee(userId),
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});
