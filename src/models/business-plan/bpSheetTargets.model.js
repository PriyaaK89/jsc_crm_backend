// Quarter targets of an employee, taken ONLY from the approved revisions of his Business
// Plans. The target sheet never stores or edits targets of its own: a signed sheet keeps a
// frozen copy (target_snapshot) of what this module returned when it was approved.
//
// Plans used: plans assigned to the employee whose dates overlap the quarter and that are
// approved (ACTIVE, CLOSED, or ACTIVE with an open revision — its last approved revision is
// used). A quarter can use two plans (e.g. Q1 Apr–Jun: Zaid and Kharif).
//
// Quarter figures
//   sales / collection / ABS per month = the revision's monthly targets for that month
//   distributor quarter target         = sum of the line's monthly targets in the quarter
//   product / retailer / development   = season figure x (plan months in the quarter / plan months)
//
// Partial quarters (a plan that starts or ends inside the quarter, e.g. a 1 Nov – 31 Jan plan
// in Q3 Oct–Dec): the quarter structure stays fixed, but only the months covered by an approved
// plan carry targets. Each month says whether it is in a plan (months[i].in_plan,
// month_in_plan[i]); a month outside every plan has no target (it is not a "zero target") and
// needs no commitment. coverage = the part of the quarter the plans cover (first plan day ..
// last plan day, inside the quarter). The month rule is the plan's own (calendar months touched
// by start .. end, bpTargets.monthsOf), so the plan and the sheet always show the same monthly
// figures: 1 Nov – 31 Jan at ₹6,00,000 = ₹2,00,000 for Nov, Dec (Q3) and Jan (Q4).
const db = require("../../config/db");
const plan = require("./bpPlan.model");
const REV = require("./bpRevision.model");
const T = require("./bpTargets.model");
const ABS = require("./bpAbs.model");

const num = (v) => Number(v) || 0;
const { round2, round3 } = T;

const QUARTER_LABEL = { 1: "Q1 (Apr – Jun)", 2: "Q2 (Jul – Sep)", 3: "Q3 (Oct – Dec)", 4: "Q4 (Jan – Mar)" };

// approved plans of the employee overlapping from..to
const linkedPlanRows = async (userId, from, to) => {
  const [rows] = await db.query(
    `SELECT id FROM business_plans
     WHERE assigned_user_id = ? AND is_deleted = 0
       AND start_date <= ? AND end_date >= ?
       AND (status IN ('ACTIVE', 'CLOSED') OR (revision_status = ? AND status IN ('UNDER_REVIEW', 'SUBMITTED')))
     ORDER BY start_date, id`,
    [userId, to, from, plan.REVISION_OPEN],
  );
  return rows.map((r) => r.id);
};

// bounds: { from, to, months: [{year, month, label}] } (bpHelpers.quarterBounds)
const quarterTargets = async (userId, financialYear, quarter, bounds) => {
  const qMonths = bounds.months.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`);
  const ids = await linkedPlanRows(userId, bounds.from, bounds.to);
  const absEnabled = await ABS.isInstalled();

  const out = {
    financial_year: financialYear,
    quarter,
    quarter_label: QUARTER_LABEL[quarter],
    from: bounds.from,
    to: bounds.to,
    months: qMonths.map((ym) => ({ month: ym, label: T.monthLabel(ym) })),
    abs_enabled: absEnabled,
    plans: [],
    kpis: {
      sales: [0, 0, 0],
      collection: [0, 0, 0],
      abs_booking: [0, 0, 0],
      abs_advance: [0, 0, 0],
    },
    distributors: [],
    products: [],
    retailers: [],
    development: { new_distributor_target: 0, new_retailer_target: 0, quarter_new_distributor_target: 0, quarter_new_retailer_target: 0 },
    summary: {
      season_sales_target: 0,
      season_collection_target: 0,
      annual_sales_target: 0,
      annual_collection_target: 0,
      quarter_sales_target: 0,
      quarter_collection_target: 0,
      abs_booking_target: 0,
      abs_advance_target: 0,
      quarter_abs_booking_target: 0,
      quarter_abs_advance_target: 0,
      max_outstanding: 0,
    },
    links: [],
  };

  const covered = [false, false, false];
  const planCodes = [[], [], []];
  const devMonthly = { new_distributors: [0, 0, 0], new_retailers: [0, 0, 0] };
  let coverFrom = null;
  let coverTo = null;

  for (const id of ids) {
    const p = await plan.getPlan(id);
    if (!p) continue;
    const rev = (await REV.ensureBaseline(p)) || (await REV.latestRevision(p.id));
    if (!rev || !rev.snapshot) continue;
    const snap = rev.snapshot;
    const sp = snap.plan;
    const planMonths = T.monthsOf(sp.start_date, sp.end_date);
    const inQuarter = qMonths.filter((ym) => planMonths.includes(ym));
    if (!inQuarter.length) continue;
    const share = inQuarter.length / Math.max(planMonths.length, 1);
    qMonths.forEach((ym, i) => {
      if (!planMonths.includes(ym)) return;
      covered[i] = true;
      planCodes[i].push(sp.plan_code);
      devMonthly.new_distributors[i] += num(sp.new_distributor_target) / Math.max(planMonths.length, 1);
      devMonthly.new_retailers[i] += num(sp.new_retailer_target) / Math.max(planMonths.length, 1);
    });
    const pFrom = sp.start_date > bounds.from ? sp.start_date : bounds.from;
    const pTo = sp.end_date < bounds.to ? sp.end_date : bounds.to;
    if (!coverFrom || pFrom < coverFrom) coverFrom = pFrom;
    if (!coverTo || pTo > coverTo) coverTo = pTo;
    out.links.push({ plan_id: p.id, revision_no: rev.revision_no });
    out.plans.push({
      plan_id: p.id,
      plan_code: sp.plan_code,
      name: sp.name,
      season: sp.season,
      financial_year: sp.financial_year,
      start_date: sp.start_date,
      end_date: sp.end_date,
      plan_months: planMonths.length,
      months_in_quarter: inQuarter,
      revision_no: rev.revision_no,
      approved_at: rev.approved_at,
      approved_by_name: rev.approved_by_name,
      in_revision: !!p.in_revision,
      territory_name: sp.territory_name,
      // districts of the territory as approved (revision snapshot; plans approved before the
      // territory versions existed: the plan's frozen territory snapshot)
      territory_district_names: (sp.territory && sp.territory.district_names) || p.territory_district_names || [],
      state_name: sp.state_name,
    });

    const byMonth = new Map((snap.monthly || []).map((m) => [m.month, m]));
    qMonths.forEach((ym, i) => {
      const m = byMonth.get(ym);
      if (!m) return;
      out.kpis.sales[i] = round2(out.kpis.sales[i] + num(m.sales_target));
      out.kpis.collection[i] = round2(out.kpis.collection[i] + num(m.collection_target));
      out.kpis.abs_booking[i] = round2(out.kpis.abs_booking[i] + num(m.abs_booking_target));
      out.kpis.abs_advance[i] = round2(out.kpis.abs_advance[i] + num(m.abs_advance_target));
    });

    for (const d of snap.distributors || []) {
      let qs = 0;
      let qc = 0;
      for (const ym of inQuarter) {
        const m = byMonth.get(ym);
        const x = m && (m.distributors || []).find((y) => y.line_id === d.line_id);
        if (x) {
          qs += num(x.sales_target);
          qc += num(x.collection_target);
        }
      }
      out.distributors.push({
        plan_id: p.id,
        plan_code: sp.plan_code,
        season: sp.season,
        ledger_id: d.ledger_id,
        name: d.name,
        location: d.location,
        annual_target: d.annual_target,
        season_sales_target: d.season_sales_target,
        season_collection_target: d.season_collection_target,
        quarter_sales_target: round2(qs),
        quarter_collection_target: round2(qc),
        max_outstanding: d.max_outstanding,
      });
    }
    for (const x of snap.products || []) {
      out.products.push({
        plan_id: p.id,
        plan_code: sp.plan_code,
        season: sp.season,
        stock_item_id: x.stock_item_id,
        name: x.name,
        crop: x.crop || x.category || null,
        season_qty_target: x.qty_target,
        season_value_target: x.value_target,
        quarter_qty_target: round3(num(x.qty_target) * share),
        quarter_value_target: round2(num(x.value_target) * share),
      });
    }
    for (const r of snap.retailers || []) {
      out.retailers.push({
        plan_id: p.id,
        plan_code: sp.plan_code,
        retailer_id: r.retailer_id,
        name: r.name,
        parent_distributor: r.parent_distributor,
        category: r.category,
        visit_frequency: r.visit_frequency,
        season_sales_target: r.sales_target,
        quarter_sales_target: round2(num(r.sales_target) * share),
      });
    }
    out.development.new_distributor_target += num(sp.new_distributor_target);
    out.development.new_retailer_target += num(sp.new_retailer_target);
    out.development.quarter_new_distributor_target = round2(out.development.quarter_new_distributor_target + num(sp.new_distributor_target) * share);
    out.development.quarter_new_retailer_target = round2(out.development.quarter_new_retailer_target + num(sp.new_retailer_target) * share);
    const sm = out.summary;
    sm.season_sales_target = round2(sm.season_sales_target + num(sp.sales_target));
    sm.season_collection_target = round2(sm.season_collection_target + num(sp.collection_target));
    sm.annual_sales_target = round2(sm.annual_sales_target + num(sp.annual_sales_target));
    sm.annual_collection_target = round2(sm.annual_collection_target + num(sp.annual_collection_target));
    sm.abs_booking_target = round2(sm.abs_booking_target + num(sp.abs_booking_target));
    sm.abs_advance_target = round2(sm.abs_advance_target + num(sp.abs_advance_target));
    sm.max_outstanding = round2(sm.max_outstanding + num(sp.max_outstanding));
  }
  const sm = out.summary;
  sm.quarter_sales_target = round2(out.kpis.sales.reduce((a, b) => a + b, 0));
  sm.quarter_collection_target = round2(out.kpis.collection.reduce((a, b) => a + b, 0));
  sm.quarter_abs_booking_target = round2(out.kpis.abs_booking.reduce((a, b) => a + b, 0));
  sm.quarter_abs_advance_target = round2(out.kpis.abs_advance.reduce((a, b) => a + b, 0));
  if (!absEnabled) {
    // ABS is not installed: ABS figures are not shown or used
    out.kpis.abs_booking = [0, 0, 0];
    out.kpis.abs_advance = [0, 0, 0];
  }
  out.month_in_plan = covered;
  out.months = out.months.map((m, i) => ({ ...m, in_plan: covered[i], plan_codes: planCodes[i] }));
  out.active_months = covered.filter(Boolean).length;
  out.coverage = coverFrom ? { from: coverFrom, to: coverTo, full_quarter: coverFrom === bounds.from && coverTo === bounds.to } : null;
  out.kpis.new_distributors = devMonthly.new_distributors.map(round2);
  out.kpis.new_retailers = devMonthly.new_retailers.map(round2);
  out.revision_key = out.links.map((l) => `${l.plan_id}:${l.revision_no}`).join(",");
  return out;
};

// Targets frozen before the month flags existed (signed sheets): derive them from the plans'
// months_in_quarter, so old sheets show and review partial quarters the same way.
const withCoverage = (t) => {
  if (!t || !Array.isArray(t.months)) return t;
  if (Array.isArray(t.month_in_plan) && t.coverage !== undefined && t.kpis && t.kpis.new_distributors) return t;
  const plans = t.plans || [];
  const months = t.months.map((m) => {
    const codes = plans.filter((p) => (p.months_in_quarter || []).includes(m.month)).map((p) => p.plan_code);
    return { ...m, in_plan: codes.length > 0, plan_codes: codes };
  });
  const covered = months.map((m) => m.in_plan);
  let coverFrom = null;
  let coverTo = null;
  for (const p of plans) {
    const f = p.start_date > t.from ? p.start_date : t.from;
    const to = p.end_date < t.to ? p.end_date : t.to;
    if (!coverFrom || f < coverFrom) coverFrom = f;
    if (!coverTo || to > coverTo) coverTo = to;
  }
  const dev = t.development || {};
  const active = covered.filter(Boolean).length;
  const spread = (total) => covered.map((c) => (c && active ? round2(num(total) / active) : 0));
  return {
    ...t,
    months,
    month_in_plan: covered,
    active_months: active,
    coverage: coverFrom ? { from: coverFrom, to: coverTo, full_quarter: coverFrom === t.from && coverTo === t.to } : null,
    kpis: {
      ...(t.kpis || {}),
      new_distributors: (t.kpis && t.kpis.new_distributors) || spread(dev.quarter_new_distributor_target),
      new_retailers: (t.kpis && t.kpis.new_retailers) || spread(dev.quarter_new_retailer_target),
    },
  };
};

module.exports = { QUARTER_LABEL, linkedPlanRows, quarterTargets, withCoverage };
