// Business Plan: masters (dropdowns), settings, territories and lookups.
const s = require("../../models/business-plan/bpSettings.model");
const actuals = require("../../models/business-plan/bpActuals.model");
const plan = require("../../models/business-plan/bpPlan.model");
const ABS = require("../../models/business-plan/bpAbs.model");
const TER = require("../../models/business-plan/bpTerritory.model");
const territoryCtl = require("./bpTerritory.controller");
const H = require("./bpHelpers");

const { HttpError, wrap, ok } = H;

// previous financial year (Apr - Mar) before a date
const previousFy = (today) => {
  const [y, m] = today.split("-").map(Number);
  const startYear = m >= 4 ? y - 1 : y - 2;
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
};

// ---------------------------------------------------------------------
//  GET /business-plan/masters  — everything the forms and filters need
// ---------------------------------------------------------------------
const getMasters = wrap(async (req, res) => {
  const visible = await H.visibleIds(req);
  const [options, settings, states, territories, employees, crops, me, abs, territoryAccess] = await Promise.all([
    s.listOptions(),
    s.getSettings(),
    s.listStates(),
    // only what a plan may select: active territories with at least one district
    TER.listTerritories({ selectableOnly: true }),
    s.listEmployees({ userIds: visible }),
    s.listCrops().catch((err) => {
      console.error("BUSINESS PLAN CROPS ERROR:", err.message);
      return [];
    }),
    H.meBlock(req),
    ABS.status(),
    territoryCtl.accessBlock(req),
  ]);
  const grouped = s.groupOptions(options);
  return ok(res, {
    // generated (previous FY .. today's FY + settings.future_financial_years) + admin-added years
    financial_years: await s.listFinancialYears(settings),
    current_financial_year: H.currentQuarter().financial_year,
    seasons: grouped.SEASON.map((o) => o.value),
    plan_types: grouped.PLAN_TYPE.map((o) => o.value),
    gap_reasons: grouped.GAP_REASON.map((o) => o.value),
    states,
    territories,
    employees,
    statuses: Object.entries(plan.STATUS_LABEL).map(([code, label]) => ({ code, label })),
    retailer_categories: [
      { code: "A", label: "A" },
      { code: "B", label: "B" },
      { code: "C", label: "C" },
      { code: "POTENTIAL", label: "Potential Retailer" },
      { code: "NEW", label: "New Retailer" },
    ],
    visit_frequencies: [
      { code: "WEEKLY", label: "Weekly" },
      { code: "FORTNIGHTLY", label: "Fortnightly" },
      { code: "MONTHLY", label: "Monthly" },
    ],
    priorities: ["HIGH", "MEDIUM", "LOW"],
    action_statuses: ["OPEN", "IN_PROGRESS", "CLOSED"],
    // target sheet: crop master (crops table) and quarters of the financial year
    crops,
    quarters: [1, 2, 3, 4].map((q) => ({ quarter: q, label: H.QUARTER_LABEL[q] })),
    current_quarter: H.currentQuarter(),
    // ABS (Advance Booking): booking / advance targets are enabled only when the ABS tables exist
    abs_enabled: !!abs.installed,
    abs: { installed: !!abs.installed, missing: abs.installed ? [] : abs.missing || [] },
    revision_request_areas: ["SALES", "COLLECTION", "ABS", "PRODUCT", "DISTRIBUTOR", "RETAILER", "DEVELOPMENT", "OTHER"],
    settings,
    // territory_access: who may open Settings -> Territories and manage which states
    me: { ...me, territory_access: territoryAccess },
  });
});

// ---------------------------------------------------------------------
//  SETTINGS
// ---------------------------------------------------------------------
const getSettings = wrap(async (req, res) => {
  const [options, settings] = await Promise.all([
    s.listOptions({ includeInactive: req.query.include_inactive === "1" }),
    s.getSettings(),
  ]);
  return ok(res, { lists: s.groupOptions(options), ...settings });
});

// PUT /settings { thresholds: {over_achieved, achieved, on_track, attention},
//                 allow_allocation_override, lock_date }
const updateSettings = wrap(async (req, res) => {
  const body = req.body || {};
  const current = await s.getSettings();
  const values = {};

  if (body.thresholds !== undefined) {
    const t = { ...current.thresholds, ...(body.thresholds || {}) };
    for (const k of ["over_achieved", "achieved", "on_track", "attention"]) {
      const n = Number(t[k]);
      if (!Number.isFinite(n) || n < 0 || n > 1000) throw new HttpError(400, `Invalid threshold: ${k}`);
      t[k] = Math.round(n * 100) / 100;
    }
    if (!(t.over_achieved >= t.achieved && t.achieved >= t.on_track && t.on_track >= t.attention)) {
      throw new HttpError(400, "Thresholds must go down in order: Over Achieved ≥ Achieved ≥ On Track ≥ Attention Required");
    }
    values.threshold_over_achieved = t.over_achieved;
    values.threshold_achieved = t.achieved;
    values.threshold_on_track = t.on_track;
    values.threshold_attention = t.attention;
  }
  if (body.allow_allocation_override !== undefined) {
    values.allow_allocation_override = body.allow_allocation_override === true || body.allow_allocation_override === 1 || body.allow_allocation_override === "1" ? "1" : "0";
  }
  if (body.lock_date !== undefined) {
    values.lock_date = body.lock_date === null || body.lock_date === "" ? null : H.date(body.lock_date, "Lock date");
  }
  if (body.future_financial_years !== undefined) {
    const n = Number(body.future_financial_years);
    if (!Number.isInteger(n) || n < 1 || n > s.MAX_FUTURE_FYS) {
      throw new HttpError(400, `Future financial years must be a whole number from 1 to ${s.MAX_FUTURE_FYS}`);
    }
    values.future_financial_years = n;
  }
  if (body.final_approver_roles !== undefined) {
    const list = (Array.isArray(body.final_approver_roles) ? body.final_approver_roles : String(body.final_approver_roles || "").split(","))
      .map((x) => String(x).trim())
      .filter(Boolean);
    const joined = [...new Set(list)].join(",");
    if (joined.length > 255) throw new HttpError(400, "Final approver roles: too long");
    values.final_approver_roles = joined;
  }
  if (!Object.keys(values).length) throw new HttpError(400, "Nothing to update");

  await s.saveSettings(values, req.user.id);
  return ok(res, await s.getSettings(), "Settings saved");
});

const resetSettings = wrap(async (req, res) => {
  await s.resetSettings(req.user.id);
  return ok(res, await s.getSettings(), "Settings reset to default");
});

// POST /settings/options { list_key, value }
const addOption = wrap(async (req, res) => {
  const listKey = H.oneOf(req.body && req.body.list_key, "list_key", s.LIST_KEYS, {
    FINANCIAL_YEARS: "FINANCIAL_YEAR",
    SEASONS: "SEASON",
    PLAN_TYPES: "PLAN_TYPE",
    GAP_REASONS: "GAP_REASON",
    VARIANCE_GAP_REASONS: "GAP_REASON",
  });
  if (!listKey) throw new HttpError(400, "list_key is required");
  const value = H.text(req.body.value, "Value", { required: true, max: 100 });
  if (listKey === "FINANCIAL_YEAR" && !/^\d{4}-\d{2}$/.test(value)) {
    throw new HttpError(400, "Financial year must look like 2026-27");
  }
  if (listKey === "FINANCIAL_YEAR" && (Number(value.slice(0, 4)) + 1) % 100 !== Number(value.slice(5))) {
    throw new HttpError(400, "Financial year must be two consecutive years, e.g. 2026-27");
  }
  const result = await s.addOption({ listKey, value, userId: req.user.id });
  if (result.duplicate) throw new HttpError(409, `"${value}" already exists`);
  return ok(res, await s.getOption(result.id), "Added", 201);
});

// PUT /settings/options/:id { value?, sort_order?, is_active? }
const updateOption = wrap(async (req, res) => {
  const id = H.toId(req.params.id);
  const option = await s.getOption(id);
  if (!option) throw new HttpError(404, "Option not found");
  const body = req.body || {};
  const value = H.text(body.value, "Value", { max: 100 });
  if (value !== undefined && !value) throw new HttpError(400, "Value cannot be empty");
  if (value !== undefined && value !== option.value) {
    const used = await s.countOptionUsage(option);
    if (used) {
      throw new HttpError(409, `"${option.value}" is used by ${used} record(s). Add a new value and hide this one instead.`);
    }
  }
  const sortOrder = body.sort_order === undefined ? undefined : H.intCount(body.sort_order, "sort_order");
  const isActive = body.is_active === undefined ? undefined : Boolean(Number(body.is_active) || body.is_active === true);
  try {
    await s.updateOption(id, { value, sortOrder, isActive });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw new HttpError(409, `"${value}" already exists`);
    throw err;
  }
  return ok(res, await s.getOption(id), "Updated");
});

// DELETE /settings/options/:id  -> hidden (plans keep their text)
const deleteOption = wrap(async (req, res) => {
  const id = H.toId(req.params.id);
  const option = await s.getOption(id);
  if (!option) throw new HttpError(404, "Option not found");
  await s.hideOption(id);
  const used = await s.countOptionUsage(option);
  return ok(res, { id, used_by: used }, used ? `Removed from the list. ${used} existing record(s) keep the value.` : "Removed");
});

// TERRITORIES: see bpTerritory.controller.js (versions, state scopes, territory managers)

// ---------------------------------------------------------------------
//  LOOKUPS (editor dropdowns)
// ---------------------------------------------------------------------
const lookupEmployees = wrap(async (req, res) => {
  const visible = await H.visibleIds(req);
  return ok(res, await s.listEmployees({ userIds: visible, search: H.text(req.query.search, "search", { max: 100 }) }));
});

// GET /lookups/distributors?search&plan_id|employee_id&include_in_plan=1
//   plan_id / employee_id: only the distributors assigned to the plan's employee or to his
//   reporting team (Add Distributor / Parent Distributor). Without them: the caller's list, as
//   before (older app versions).
const lookupDistributors = wrap(async (req, res) => {
  const search = H.text(req.query.search, "search", { max: 100 });
  const planId = H.optId(req.query.plan_id, "plan_id");
  const employeeParam = H.optId(req.query.employee_id, "employee_id");
  if (planId || employeeParam) {
    let employeeId = employeeParam;
    if (planId) {
      const p = await plan.getPlan(planId);
      if (!p) throw new HttpError(404, "Business plan not found");
      if (!H.canViewPlan(await H.visibleIds(req), p)) throw new HttpError(403, "You do not have access to this business plan");
      employeeId = p.assigned_user_id;
    } else {
      await H.assertCanPlanFor(req, employeeId);
    }
    const owners = await H.planPartyOwners(employeeId);
    return ok(
      res,
      await s.listDistributors({
        userIds: owners,
        // the person preparing an employee's plan: his own parties are not offered
        excludeOwnerIds: Number(employeeId) === req.user.id ? [] : [req.user.id].filter((id) => !owners.includes(id)),
        excludePlanId: planId && req.query.include_in_plan !== "1" ? planId : null,
        search,
        page: req.query.page,
        limit: req.query.limit,
      }),
    );
  }
  const visible = await H.visibleIds(req);
  return ok(
    res,
    await s.listDistributors({
      userIds: req.query.all === "1" ? null : visible,
      search,
      page: req.query.page,
      limit: req.query.limit,
    }),
  );
});

// GET /lookups/distributors/:ledgerId/profile?from=&to=
// "Auto-fetched from Distributor Master": contact, outstanding, credit limit,
// previous year sales, last order date, status
const distributorProfile = wrap(async (req, res) => {
  const ledgerId = H.toId(req.params.ledgerId, "ledger id");
  const ledger = await s.getDistributorLedger(ledgerId);
  if (!ledger) throw new HttpError(404, "Distributor not found");

  const from = H.date(req.query.from, "from");
  const to = H.date(req.query.to, "to");
  if (from && to && from > to) throw new HttpError(400, "from date cannot be after to date");

  // previous sales: same window last year when plan dates are given, else last financial year
  let previous;
  let previousSales;
  const current = await actuals.getLedgerActuals([ledgerId], H.todayIST(), H.todayIST());
  if (from && to) {
    previous = { from: actuals.minusYear(from), to: actuals.minusYear(to), basis: "Same period last year" };
    previousSales = (await actuals.getLedgerPreviousSales([ledgerId], from, to)).get(ledgerId) || 0;
  } else {
    previous = { ...previousFy(H.todayIST()), basis: "Previous financial year" };
    previousSales = (await actuals.getLedgerActuals([ledgerId], previous.from, previous.to)).get(ledgerId).sales;
  }
  const c = current.get(ledgerId);
  return ok(res, {
    ledger_id: ledger.ledger_id,
    name: ledger.name,
    market: ledger.location || ledger.district || "",
    district: ledger.district,
    state: ledger.state,
    contact: ledger.contact_number || null,
    existing_outstanding: c.outstanding,
    credit_limit: Number(ledger.credit_limit) || 0,
    previous_year_sales: previousSales,
    previous_year_basis: previous,
    last_order_date: c.last_order_date,
    status: ledger.status || "ACTIVE",
  });
});

// GET /lookups/retailers?search&distributor_ledger_id&plan_id|employee_id
//   plan_id / employee_id: only the retailers created by the plan's employee
//   (customers.created_by), not yet in the plan. Without them: every retailer, as before.
const lookupRetailers = wrap(async (req, res) => {
  const planId = H.optId(req.query.plan_id, "plan_id");
  let employeeId = H.optId(req.query.employee_id, "employee_id");
  if (planId) {
    const p = await plan.getPlan(planId);
    if (!p) throw new HttpError(404, "Business plan not found");
    if (!H.canViewPlan(await H.visibleIds(req), p)) throw new HttpError(403, "You do not have access to this business plan");
    employeeId = p.assigned_user_id;
  } else if (employeeId) {
    await H.assertCanPlanFor(req, employeeId);
  }
  return ok(
    res,
    await s.listRetailers({
      search: H.text(req.query.search, "search", { max: 100 }),
      distributorLedgerId: H.optId(req.query.distributor_ledger_id, "distributor_ledger_id"),
      createdBy: employeeId || null,
      excludePlanId: planId || null,
      page: req.query.page,
      limit: req.query.limit,
    }),
  );
});

// contact, previous business (reported in the latest plan line), mapped distributor
const retailerProfile = wrap(async (req, res) => {
  const id = H.toId(req.params.id, "retailer id");
  const r = await s.getRetailer(id);
  if (!r) throw new HttpError(404, "Retailer not found");
  const [parent, last] = await Promise.all([
    r.mapped_ledger_id ? s.getDistributorLedger(r.mapped_ledger_id) : null,
    s.getLastRetailerBusiness(id),
  ]);
  return ok(res, {
    id: r.id,
    name: r.name,
    owner_name: r.owner_name,
    contact: r.contact_number,
    area: r.area,
    district: r.district,
    parent_distributor: parent ? { ledger_id: parent.ledger_id, name: parent.name } : null,
    previous_business: last ? Number(last.reported_actual) || 0 : 0,
    previous_business_source: last ? `Reported in ${last.plan_code}` : "No earlier plan",
    current_status: "Active",
  });
});

const lookupProducts = wrap(async (req, res) => {
  return ok(
    res,
    await s.listProducts({
      search: H.text(req.query.search, "search", { max: 100 }),
      page: req.query.page,
      limit: req.query.limit,
    }),
  );
});

const lookupStates = wrap(async (req, res) => ok(res, await s.listStates()));

module.exports = {
  getMasters,
  getSettings,
  updateSettings,
  resetSettings,
  addOption,
  updateOption,
  deleteOption,
  lookupEmployees,
  lookupDistributors,
  distributorProfile,
  lookupRetailers,
  retailerProfile,
  lookupProducts,
  lookupStates,
};
