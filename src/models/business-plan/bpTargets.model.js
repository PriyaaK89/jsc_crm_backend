// Business Plan targets: the ONE place where plan, season, monthly and quarterly targets
// are calculated. Used by the plan screens, analytics, revisions and target sheets, so the
// backend, React and the app always show the same numbers.
//
// D1 (season targets)
//   plan months             = calendar months touched by start_date .. end_date
//   line season sales       = seasonal_target            when > 0, else annual_target x months / 12
//   line season collection  = seasonal_collection_target when > 0, else collection_target x months / 12
//                             (collection_target is the line's ANNUAL collection target)
//   plan sales target       = sum of line season sales  (plans with distributors)
//                           = sum of product value targets (no distributors) / retailer targets (neither)
//   monthly default         = season target / plan months; stored overrides win
//   ABS monthly default     = plan ABS target / plan months; stored ABS overrides win
const plan = require("./bpPlan.model");

const num = (v) => Number(v) || 0;
const round2 = (v) => Math.round(num(v) * 100) / 100;
const round3 = (v) => Math.round(num(v) * 1000) / 1000;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

// months touched by a period: ['2026-06', ...]
const monthsOf = (from, to) => {
  const out = [];
  if (!from || !to) return out;
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 60) break;
  }
  return out;
};

// working (proposed) value: differs from the official one only while a revision is open
const live = (p, key) => (p[`proposed_${key}`] !== undefined ? num(p[`proposed_${key}`]) : num(p[key]));

const planMonthCount = (p) => Math.max(monthsOf(p.start_date, p.end_date).length, 1);

const lineSeason = (l, months) => ({
  season_sales_target: num(l.seasonal_target) > 0 ? round2(l.seasonal_target) : round2((num(l.annual_target) * months) / 12),
  season_collection_target:
    num(l.seasonal_collection_target) > 0 ? round2(l.seasonal_collection_target) : round2((num(l.collection_target) * months) / 12),
});

// header totals from the lines (the same rule as the migration's step 8c)
const planTotals = (months, distLines, productLines, retailerLines) => {
  if (distLines.length) {
    let sales = 0;
    let coll = 0;
    let annualSales = 0;
    let annualColl = 0;
    for (const l of distLines) {
      const s = lineSeason(l, months);
      sales += s.season_sales_target;
      coll += s.season_collection_target;
      annualSales += num(l.annual_target);
      annualColl += num(l.collection_target);
    }
    return {
      sales_target: round2(sales),
      collection_target: round2(coll),
      annual_sales_target: round2(annualSales),
      annual_collection_target: round2(annualColl),
    };
  }
  const sales = productLines.length
    ? productLines.reduce((s, l) => s + num(l.value_target), 0)
    : retailerLines.reduce((s, l) => s + num(l.sales_target), 0);
  return { sales_target: round2(sales), collection_target: 0, annual_sales_target: round2(sales), annual_collection_target: 0 };
};

// recalculates and stores the header totals (inside the caller's transaction)
const recalcTotals = async (runner, planId) => {
  const [[p]] = await runner.query(
    `SELECT id, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
     FROM business_plans WHERE id = ?`,
    [planId],
  );
  if (!p) return null;
  const [[dist], [prod], [ret]] = await Promise.all([
    runner.query(
      `SELECT annual_target, seasonal_target, collection_target, seasonal_collection_target
       FROM bp_distributor_lines WHERE plan_id = ?`,
      [planId],
    ),
    runner.query(`SELECT value_target FROM bp_product_lines WHERE plan_id = ?`, [planId]),
    runner.query(`SELECT sales_target FROM bp_retailer_lines WHERE plan_id = ?`, [planId]),
  ]);
  const t = planTotals(planMonthCount(p), dist, prod, ret);
  await runner.query(
    `UPDATE business_plans
     SET sales_target = ?, collection_target = ?, annual_sales_target = ?, annual_collection_target = ?
     WHERE id = ?`,
    [t.sales_target, t.collection_target, t.annual_sales_target, t.annual_collection_target, planId],
  );
  return t;
};

// ---------------------------------------------------------------------
//  MONTHLY TARGETS
// ---------------------------------------------------------------------
// overrides: Map `${line}:${ym}` -> { sales_target, collection_target }  (sales overrides only)
// absOverrides: Map ym -> { abs_booking_target, abs_advance_target }  (null = default)
const monthlyTargets = (p, distLines, overrides, absOverrides) => {
  const months = monthsOf(p.start_date, p.end_date);
  const n = Math.max(months.length, 1);
  const groups = [];
  if (distLines.length) {
    for (const l of distLines) {
      const s = lineSeason(l, n);
      groups.push({
        distributor_line_id: l.id,
        ledger_id: l.ledger_id,
        name: l.name,
        season_sales_target: s.season_sales_target,
        season_collection_target: s.season_collection_target,
        rows: months.map((ym) => {
          const o = overrides.get(`${l.id}:${ym}`);
          return {
            month: ym,
            label: monthLabel(ym),
            sales_target: round2(o ? o.sales_target : s.season_sales_target / n),
            collection_target: round2(o ? o.collection_target : s.season_collection_target / n),
            is_custom: Boolean(o),
          };
        }),
      });
    }
  } else {
    groups.push({
      distributor_line_id: 0,
      ledger_id: null,
      name: p.assigned_user_name || "Plan",
      season_sales_target: round2(live(p, "sales_target")),
      season_collection_target: round2(live(p, "collection_target")),
      rows: months.map((ym) => {
        const o = overrides.get(`0:${ym}`);
        return {
          month: ym,
          label: monthLabel(ym),
          sales_target: round2(o ? o.sales_target : live(p, "sales_target") / n),
          collection_target: round2(o ? o.collection_target : live(p, "collection_target") / n),
          is_custom: Boolean(o),
        };
      }),
    });
  }
  const planRows = months.map((ym, i) => {
    const a = absOverrides.get(ym) || {};
    const booking = a.abs_booking_target !== null && a.abs_booking_target !== undefined;
    const advance = a.abs_advance_target !== null && a.abs_advance_target !== undefined;
    return {
      month: ym,
      label: monthLabel(ym),
      sales_target: round2(groups.reduce((s, g) => s + g.rows[i].sales_target, 0)),
      collection_target: round2(groups.reduce((s, g) => s + g.rows[i].collection_target, 0)),
      abs_booking_target: round2(booking ? a.abs_booking_target : num(p.abs_booking_target) / n),
      abs_advance_target: round2(advance ? a.abs_advance_target : num(p.abs_advance_target) / n),
      abs_custom: booking || advance,
    };
  });
  return { months, groups, plan_rows: planRows };
};

// lines + overrides of one plan -> monthlyTargets()
const loadMonthly = async (p, distLines = null) => {
  const [lines, overrides, absOverrides] = await Promise.all([
    distLines ? Promise.resolve(distLines) : plan.listDistributorLines(p.id),
    plan.getMonthlyOverrides(p.id),
    plan.getAbsMonthlyOverrides(p.id),
  ]);
  return monthlyTargets(p, lines, overrides, absOverrides);
};

// ---------------------------------------------------------------------
//  SNAPSHOT of a plan's targets (stored with every approved revision)
// ---------------------------------------------------------------------
const buildSnapshot = async (p) => {
  const [dist, products, retailers] = await Promise.all([
    plan.listDistributorLines(p.id),
    plan.listProductLines(p.id),
    plan.listRetailerLines(p.id),
  ]);
  const months = planMonthCount(p);
  const monthly = await loadMonthly(p, dist);
  const byLine = new Map(monthly.groups.map((g) => [g.distributor_line_id, g]));
  return {
    schema: 1,
    plan: {
      id: p.id,
      plan_code: p.plan_code,
      name: p.name,
      financial_year: p.financial_year,
      season: p.season,
      start_date: p.start_date,
      end_date: p.end_date,
      months,
      state_id: p.state_id,
      state_name: p.state_name || null,
      territory_id: p.territory_id || null,
      territory_name: p.territory_name || null,
      assigned_user_id: p.assigned_user_id,
      assigned_user_name: p.assigned_user_name || null,
      plan_type: p.plan_type,
      sales_target: round2(live(p, "sales_target")),
      collection_target: round2(live(p, "collection_target")),
      annual_sales_target: round2(p.annual_sales_target),
      annual_collection_target: round2(p.annual_collection_target),
      new_distributor_target: num(p.new_distributor_target),
      new_retailer_target: num(p.new_retailer_target),
      retailer_expected_business: round2(p.retailer_expected_business),
      abs_booking_target: round2(p.abs_booking_target),
      abs_advance_target: round2(p.abs_advance_target),
      max_outstanding: round2(dist.reduce((s, l) => s + num(l.max_outstanding), 0)),
    },
    distributors: dist.map((l) => {
      const s = lineSeason(l, months);
      return {
        line_id: l.id,
        ledger_id: l.ledger_id,
        name: l.name,
        location: l.location || l.district || "",
        annual_target: round2(l.annual_target),
        seasonal_target: round2(l.seasonal_target),
        season_sales_target: s.season_sales_target,
        annual_collection_target: round2(l.collection_target),
        seasonal_collection_target: round2(l.seasonal_collection_target),
        season_collection_target: s.season_collection_target,
        max_outstanding: round2(l.max_outstanding),
        expected_collection: round2(l.expected_collection),
        products: (l.products || []).map((x) => ({
          stock_item_id: x.stock_item_id,
          name: x.name,
          planned_qty: round3(x.planned_qty),
          planned_value: round2(x.planned_value),
        })),
      };
    }),
    products: products.map((l) => ({
      line_id: l.id,
      stock_item_id: l.stock_item_id,
      name: l.name,
      category: l.category || null,
      crop: l.crop_name || null,
      qty_target: round3(l.qty_target),
      value_target: round2(l.value_target),
    })),
    retailers: retailers.map((l) => ({
      line_id: l.id,
      retailer_id: l.retailer_id,
      name: l.name,
      parent_distributor: l.parent_distributor || null,
      category: l.category,
      sales_target: round2(l.sales_target),
      visit_frequency: l.visit_frequency,
    })),
    monthly: monthly.plan_rows.map((r, i) => ({
      month: r.month,
      label: r.label,
      sales_target: r.sales_target,
      collection_target: r.collection_target,
      abs_booking_target: r.abs_booking_target,
      abs_advance_target: r.abs_advance_target,
      distributors: monthly.groups
        .filter((g) => g.distributor_line_id)
        .map((g) => ({
          line_id: g.distributor_line_id,
          sales_target: byLine.get(g.distributor_line_id).rows[i].sales_target,
          collection_target: byLine.get(g.distributor_line_id).rows[i].collection_target,
        })),
    })),
  };
};

module.exports = {
  MONTH_NAMES,
  monthLabel,
  monthsOf,
  planMonthCount,
  lineSeason,
  planTotals,
  recalcTotals,
  monthlyTargets,
  loadMonthly,
  buildSnapshot,
  round2,
  round3,
  live,
};
