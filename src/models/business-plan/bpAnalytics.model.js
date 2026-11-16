// Business Plan: computed views (plan detail tabs, dashboard, alerts, plan vs actual,
// matrix, forecast, reports). Reads plans + lines and joins them with actuals.
const db = require("../../config/db");
const plan = require("./bpPlan.model");
const actuals = require("./bpActuals.model");
const T = require("./bpTargets.model");
const abs = require("./bpAbs.model");

const num = (v) => Number(v) || 0;
const round = (v) => Math.round(num(v) * 100) / 100;
const pct = (part, whole) => (num(whole) > 0 ? Math.round((num(part) / num(whole)) * 100) : 0);
const DAY_MS = 86400000;
const toUtc = (d) => new Date(`${d}T00:00:00Z`);
const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / DAY_MS);

// ---------------------------------------------------------------------
//  PERFORMANCE BANDS (from Settings -> Performance Thresholds)
// ---------------------------------------------------------------------
const performance = (percent, t) => {
  // names follow Settings: Over Achieved above / Achieved at / On Track at / Attention Required at
  if (percent > t.over_achieved) return { code: "OVER_ACHIEVED", label: "Over Achieved", tone: "green" };
  if (percent >= t.achieved) return { code: "ACHIEVED", label: "Achieved", tone: "green" };
  if (percent >= t.on_track) return { code: "ON_TRACK", label: "On Track", tone: "orange" };
  if (percent >= t.attention) return { code: "ATTENTION_REQUIRED", label: "Attention Required", tone: "orange" };
  return { code: "CRITICAL", label: "Critical", tone: "red" };
};

// a plan whose targets are in force: Active, or Active with an open revision
const isLive = (p) => p.status === "ACTIVE" || !!p.in_revision;

const periodInfo = (p, today) => {
  const total = Math.max(daysBetween(p.start_date, p.end_date) + 1, 1);
  const elapsed = Math.min(Math.max(daysBetween(p.start_date, today) + 1, 0), total);
  return {
    days_total: total,
    days_elapsed: elapsed,
    days_remaining: total - elapsed,
    elapsed_percent: pct(elapsed, total),
  };
};

// adds actual figures and bands to plan rows
const enrichPlans = async (plans, settings, today) => {
  const totals = await actuals.getPlanTotals(plans.map((p) => p.id));
  return plans.map((p) => {
    const a = totals.get(p.id) || { sales: 0, collection: 0 };
    const achievement = pct(a.sales, p.sales_target);
    return {
      ...p,
      achieved: a.sales,
      collection_achieved: a.collection,
      achievement_percent: achievement,
      collection_percent: pct(a.collection, p.collection_target),
      sales_gap: round(p.sales_target - a.sales),
      collection_gap: round(p.collection_target - a.collection),
      performance: performance(achievement, settings.thresholds),
      ...periodInfo(p, today),
    };
  });
};

// ---------------------------------------------------------------------
//  LINES FOR MANY PLANS
// ---------------------------------------------------------------------
const distLinesFor = async (planIds) => {
  if (!planIds.length) return [];
  const [rows] = await db.query(
    `SELECT d.id, d.plan_id, d.ledger_id, l.ledger_name AS name, l.location,
            gd.district_name_english AS district, d.annual_target, d.seasonal_target,
            d.collection_target, d.seasonal_collection_target, d.max_outstanding, d.expected_collection,
            d.previous_year_sales,
            DATE_FORMAT(bp.start_date, '%Y-%m-%d') AS plan_start_date, DATE_FORMAT(bp.end_date, '%Y-%m-%d') AS plan_end_date
     FROM bp_distributor_lines d
     INNER JOIN business_plans bp ON bp.id = d.plan_id
     LEFT JOIN ledgers l ON l.id = d.ledger_id
     LEFT JOIN geo_districts gd ON gd.id = l.district_id
     WHERE d.plan_id IN (?)
     ORDER BY l.ledger_name ASC`,
    [planIds],
  );
  // season targets of each line (D1)
  return rows.map((l) => ({
    ...l,
    ...T.lineSeason(l, Math.max(T.monthsOf(l.plan_start_date, l.plan_end_date).length, 1)),
  }));
};

const distProductsFor = async (planIds) => {
  if (!planIds.length) return [];
  const [rows] = await db.query(
    `SELECT dp.id, d.plan_id, d.id AS distributor_line_id, d.ledger_id, dp.stock_item_id,
            si.item_name AS product_name, dp.planned_qty, dp.planned_value
     FROM bp_distributor_products dp
     INNER JOIN bp_distributor_lines d ON d.id = dp.distributor_line_id
     LEFT JOIN stock_items si ON si.id = dp.stock_item_id
     WHERE d.plan_id IN (?)`,
    [planIds],
  );
  return rows;
};

const productLinesFor = async (planIds) => {
  if (!planIds.length) return [];
  const [rows] = await db.query(
    `SELECT pl.id, pl.plan_id, pl.stock_item_id, si.item_name AS name, sc.name AS category,
            pl.qty_target, pl.value_target, pl.prev_year_qty, pl.prev_year_value
     FROM bp_product_lines pl
     LEFT JOIN stock_items si ON si.id = pl.stock_item_id
     LEFT JOIN stock_categories sc ON sc.id = si.stock_category_id
     WHERE pl.plan_id IN (?)
     ORDER BY si.item_name ASC`,
    [planIds],
  );
  return rows;
};

const retailerLinesFor = async (planIds) => {
  if (!planIds.length) return [];
  const [rows] = await db.query(
    `SELECT r.id, r.plan_id, r.retailer_id, COALESCE(NULLIF(c.firm_name, ''), c.name) AS name,
            r.category, r.parent_ledger_id, l.ledger_name AS parent_distributor,
            r.sales_target, r.reported_actual, r.previous_business
     FROM bp_retailer_lines r
     LEFT JOIN customers c ON c.id = r.retailer_id
     LEFT JOIN ledgers l ON l.id = r.parent_ledger_id
     WHERE r.plan_id IN (?)
     ORDER BY name ASC`,
    [planIds],
  );
  return rows;
};

// distributor lines + actuals + outstanding
const distributorPerformance = async (planIds, settings) => {
  const lines = await distLinesFor(planIds);
  const [act, outstanding] = await Promise.all([
    actuals.getDistributorLineActuals(planIds),
    actuals.getLedgerOutstanding([...new Set(lines.map((l) => l.ledger_id))]),
  ]);
  return lines.map((l) => {
    const a = act.get(l.id) || { sales: 0, collection: 0, prev_sales: 0 };
    // target of the plan period (season), D1
    const target = num(l.season_sales_target);
    const collTarget = num(l.season_collection_target);
    const achievement = pct(a.sales, target);
    const prevBase = num(l.previous_year_sales) || a.prev_sales;
    return {
      line_id: l.id,
      plan_id: l.plan_id,
      ledger_id: l.ledger_id,
      name: l.name,
      market: l.location || l.district || "",
      district: l.district,
      type: "Distributor",
      target,
      annual_target: num(l.annual_target),
      seasonal_target: num(l.seasonal_target),
      season_sales_target: target,
      actual: a.sales,
      variance: round(a.sales - target),
      achievement_percent: achievement,
      performance: performance(achievement, settings.thresholds),
      collection_target: collTarget,
      annual_collection_target: num(l.collection_target),
      seasonal_collection_target: num(l.seasonal_collection_target),
      season_collection_target: collTarget,
      collection_actual: a.collection,
      collection_percent: pct(a.collection, collTarget),
      expected_collection: num(l.expected_collection),
      outstanding: outstanding.get(l.ledger_id) || 0,
      max_outstanding: num(l.max_outstanding),
      previous_year_sales: prevBase,
      planned_growth_percent: prevBase > 0 ? Math.round((num(l.annual_target) / prevBase - 1) * 100) : null,
      actual_growth_percent: a.prev_sales > 0 ? Math.round((a.sales / a.prev_sales - 1) * 100) : null,
    };
  });
};

const productPerformance = async (planIds, settings) => {
  const lines = await productLinesFor(planIds);
  const act = await actuals.getProductLineActuals(planIds);
  return lines.map((l) => {
    const a = act.get(l.id) || { qty: 0, value: 0, prev_qty: 0, prev_value: 0 };
    const achievement = pct(a.qty, l.qty_target);
    return {
      line_id: l.id,
      plan_id: l.plan_id,
      stock_item_id: l.stock_item_id,
      name: l.name,
      crop: l.category || "",
      qty_target: num(l.qty_target),
      actual_qty: a.qty,
      value_target: num(l.value_target),
      actual_value: a.value,
      achievement_percent: achievement,
      value_percent: pct(a.value, l.value_target),
      performance: performance(achievement, settings.thresholds),
      prev_year_qty: num(l.prev_year_qty) || a.prev_qty,
      prev_year_value: num(l.prev_year_value) || a.prev_value,
    };
  });
};

const retailerPerformance = async (planIds, settings) => {
  const lines = await retailerLinesFor(planIds);
  return lines.map((l) => {
    const achievement = pct(l.reported_actual, l.sales_target);
    const prev = num(l.previous_business);
    return {
      line_id: l.id,
      plan_id: l.plan_id,
      retailer_id: l.retailer_id,
      name: l.name,
      category: l.category,
      under: l.parent_distributor || "",
      target: num(l.sales_target),
      actual: num(l.reported_actual),
      actual_source: "REPORTED",
      // employee-reported, not from transactions: never part of official achievement (D5)
      verified: false,
      achievement_percent: achievement,
      performance: performance(achievement, settings.thresholds),
      growth_percent: prev > 0 ? Math.round((num(l.sales_target) / prev - 1) * 100) : null,
    };
  });
};

// group rows by key and sum targets/actuals
const groupSum = (rows, keyFn, labelFn, settings, targetKey = "target", actualKey = "actual") => {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, { key: k, name: labelFn(r), target: 0, actual: 0, count: 0 });
    const g = map.get(k);
    g.target += num(r[targetKey]);
    g.actual += num(r[actualKey]);
    g.count += 1;
  }
  return [...map.values()].map((g) => {
    const achievement = pct(g.actual, g.target);
    return {
      ...g,
      target: round(g.target),
      actual: round(g.actual),
      variance: round(g.actual - g.target),
      achievement_percent: achievement,
      performance: performance(achievement, settings.thresholds),
    };
  });
};

// ---------------------------------------------------------------------
//  PLAN DETAIL TABS
// ---------------------------------------------------------------------
const planOverview = async (p, settings, today) => {
  const [enriched] = await enrichPlans([p], settings, today);
  const [newDist, retailers] = await Promise.all([
    actuals.getNewDistributorStats(p.assigned_user_id, p.start_date, p.end_date),
    retailerLinesFor([p.id]),
  ]);
  const actualBusiness = retailers.reduce((s, r) => s + num(r.reported_actual), 0);
  const [overlaps, absStatus] = await Promise.all([plan.findOverlaps(p.id), abs.status()]);
  return {
    plan: enriched,
    targets: {
      // D1: season (plan period) targets are used for achievement; annual shown for reference
      plan_months: T.planMonthCount(p),
      season_sales_target: enriched.sales_target,
      season_collection_target: enriched.collection_target,
      annual_sales_target: num(p.annual_sales_target),
      annual_collection_target: num(p.annual_collection_target),
      proposed_sales_target: num(p.proposed_sales_target),
      proposed_collection_target: num(p.proposed_collection_target),
      in_revision: !!p.in_revision,
      revision_no: num(p.revision_no),
      abs_enabled: absStatus.installed,
      abs_booking_target: num(p.abs_booking_target),
      abs_advance_target: num(p.abs_advance_target),
    },
    // the same distributor in another plan of this employee with overlapping dates (warning only).
    // Each plan is measured in its own dates; combined figures count a transaction once.
    overlap_warnings: overlaps,
    kpis: {
      sales_target: enriched.sales_target,
      sales_achieved: enriched.achieved,
      collection_target: enriched.collection_target,
      collection_achieved: enriched.collection_achieved,
      achievement_percent: enriched.achievement_percent,
      collection_percent: enriched.collection_percent,
    },
    new_distributor_acquisition: {
      target: num(p.new_distributor_target),
      actual: newDist.billed,
      opened: newDist.created,
      pending: Math.max(num(p.new_distributor_target) - newDist.billed, 0),
      conversion_percent: pct(newDist.billed, p.new_distributor_target),
    },
    new_retailer_development: {
      acquisition_target: num(p.new_retailer_target),
      contacted: num(p.retailer_contacted),
      qualified: num(p.retailer_qualified),
      onboarded: num(p.retailer_onboarded),
      ordered: num(p.retailer_ordered),
      conversion_percent: pct(p.retailer_ordered, p.retailer_contacted),
      expected_business: num(p.retailer_expected_business),
      actual_business: round(actualBusiness),
      actual_business_source: "REPORTED",
      actual_business_verified: false,
    },
    employee_business_plan: [
      {
        user_id: p.assigned_user_id,
        name: p.assigned_user_name,
        job_role: p.assigned_job_role,
        sales_target: enriched.sales_target,
        sales_actual: enriched.achieved,
        collection_target: enriched.collection_target,
        collection_actual: enriched.collection_achieved,
        new_distributor_target: num(p.new_distributor_target),
        new_retailer_target: num(p.new_retailer_target),
      },
    ],
  };
};

const planDistributors = async (p, settings) => {
  const [perf, lines] = await Promise.all([
    distributorPerformance([p.id], settings),
    plan.listDistributorLines(p.id),
  ]);
  const byLine = new Map(perf.map((x) => [x.line_id, x]));
  return lines.map((l) => ({ ...l, performance_data: byLine.get(l.id) || null }));
};

const planProducts = async (p, settings) => {
  const [perf, lines] = await Promise.all([
    productPerformance([p.id], settings),
    plan.listProductLines(p.id),
  ]);
  const byLine = new Map(perf.map((x) => [x.line_id, x]));
  return lines.map((l) => ({ ...l, performance_data: byLine.get(l.id) || null }));
};

const planRetailers = async (p, settings) => {
  const lines = await plan.listRetailerLines(p.id);
  return lines.map((l) => {
    const achievement = pct(l.reported_actual, l.sales_target);
    // reported by the employee, not from transactions: shown, never part of official achievement (D5)
    return { ...l, actual_source: "REPORTED", verified: false, achievement_percent: achievement, performance: performance(achievement, settings.thresholds) };
  });
};

// months touched by the plan: ['2026-06', ...]  (one implementation: bpTargets.model)
const monthsOf = T.monthsOf;
const monthLabel = T.monthLabel;

// Monthly plan: default = season target / plan months (D1) unless overridden; ABS columns
// only when the ABS module is installed
const planMonthly = async (p, settings) => {
  const lines = await plan.listDistributorLines(p.id);
  const mt = await T.loadMonthly(p, lines);
  const absStatus = await abs.status();
  const [ledgerMonthly, ownMonthly, absMonthly] = await Promise.all([
    lines.length ? actuals.getLedgerMonthly([...new Set(lines.map((l) => l.ledger_id))], p.start_date, p.end_date) : Promise.resolve(new Map()),
    lines.length ? Promise.resolve(new Map()) : actuals.getEmployeeMonthly(p.assigned_user_id, p.start_date, p.end_date),
    absStatus.installed ? abs.monthlyActuals(p.assigned_user_id, p.start_date, p.end_date) : Promise.resolve(new Map()),
  ]);
  const withActuals = (row, a) => ({
    ...row,
    actual_sales: a.sales,
    actual_collection: a.collection,
    achievement_percent: pct(a.sales, row.sales_target),
    performance: performance(pct(a.sales, row.sales_target), settings.thresholds),
  });
  return {
    months: mt.months.map((ym) => ({ month: ym, label: monthLabel(ym) })),
    rule: "Default month target = season target ÷ plan months. Season target = seasonal target, or annual target × plan months ÷ 12.",
    abs_enabled: absStatus.installed,
    groups: mt.groups.map((g) => ({
      distributor_line_id: g.distributor_line_id,
      ledger_id: g.ledger_id,
      name: g.name,
      season_sales_target: g.season_sales_target,
      season_collection_target: g.season_collection_target,
      rows: g.rows.map((r) =>
        withActuals(
          r,
          g.distributor_line_id
            ? ledgerMonthly.get(`${g.ledger_id}:${r.month}`) || { sales: 0, collection: 0 }
            : ownMonthly.get(r.month) || { sales: 0, collection: 0 },
        ),
      ),
    })),
    plan_rows: mt.plan_rows.map((r) => {
      const a = absMonthly.get(r.month) || { booking: 0, advance: 0 };
      return absStatus.installed
        ? { ...r, actual_abs_booking: a.booking, actual_abs_advance: a.advance }
        : { month: r.month, label: r.label, sales_target: r.sales_target, collection_target: r.collection_target };
    }),
  };
};

const planCollection = async (p, settings, today) => {
  const [[enriched], dist] = await Promise.all([
    enrichPlans([p], settings, today),
    distributorPerformance([p.id], settings),
  ]);
  return {
    summary: {
      collection_target: enriched.collection_target,
      achieved: enriched.collection_achieved,
      collection_gap: enriched.collection_gap,
      achievement_percent: enriched.collection_percent,
    },
    distributors: dist.map((d) => ({
      line_id: d.line_id,
      ledger_id: d.ledger_id,
      name: d.name,
      target: d.collection_target,
      actual: d.collection_actual,
      outstanding: d.outstanding,
      max_outstanding: d.max_outstanding,
      achievement_percent: d.collection_percent,
      performance: performance(d.collection_percent, settings.thresholds),
    })),
  };
};

const planAchievement = async (p, settings, today) => {
  const [[enriched], dist] = await Promise.all([
    enrichPlans([p], settings, today),
    distributorPerformance([p.id], settings),
  ]);
  return {
    target: enriched.sales_target,
    achieved: enriched.achieved,
    achievement_percent: enriched.achievement_percent,
    performance: enriched.performance,
    elapsed_percent: enriched.elapsed_percent,
    distributors: dist.map((d) => ({
      line_id: d.line_id,
      ledger_id: d.ledger_id,
      name: d.name,
      target: d.target,
      actual: d.actual,
      achievement_percent: d.achievement_percent,
      performance: d.performance,
    })),
  };
};

const planVariance = async (p, settings, today) => {
  const [[enriched], dist, openByLine] = await Promise.all([
    enrichPlans([p], settings, today),
    distributorPerformance([p.id], settings),
    db.query(
      `SELECT distributor_line_id, COUNT(*) AS c FROM bp_corrective_actions
       WHERE plan_id = ? AND status <> 'CLOSED' AND distributor_line_id IS NOT NULL
       GROUP BY distributor_line_id`,
      [p.id],
    ),
  ]);
  const open = new Map(openByLine[0].map((r) => [r.distributor_line_id, num(r.c)]));
  return {
    overall: {
      target: enriched.sales_target,
      actual: enriched.achieved,
      variance: round(enriched.achieved - enriched.sales_target),
      achievement_percent: enriched.achievement_percent,
      performance: enriched.performance,
    },
    distributors: dist.map((d) => ({
      line_id: d.line_id,
      ledger_id: d.ledger_id,
      name: d.name,
      target: d.target,
      actual: d.actual,
      variance: d.variance,
      achievement_percent: d.achievement_percent,
      performance: d.performance,
      needs_corrective_action: d.achievement_percent < settings.thresholds.achieved,
      open_corrective_actions: open.get(d.line_id) || 0,
    })),
  };
};

// ---------------------------------------------------------------------
//  ALERTS (computed; nothing stored)
// ---------------------------------------------------------------------
const buildAlerts = async (enrichedPlans, settings, today) => {
  const active = enrichedPlans.filter((p) => isLive(p) && p.days_elapsed > 0);
  if (!active.length) return [];
  const ids = active.map((p) => p.id);
  const [dist, [overdue]] = await Promise.all([
    distributorPerformance(ids, settings),
    db.query(
      `SELECT ca.plan_id, ca.scope_label, DATE_FORMAT(ca.due_date, '%Y-%m-%d') AS due_date
       FROM bp_corrective_actions ca
       WHERE ca.plan_id IN (?) AND ca.status <> 'CLOSED' AND ca.due_date IS NOT NULL AND ca.due_date < ?`,
      [ids, today],
    ),
  ]);
  const byPlan = new Map(active.map((p) => [p.id, p]));
  const alerts = [];
  const push = (p, type, severity, text) =>
    alerts.push({ plan_id: p.id, plan_code: p.plan_code, plan_name: p.name, type, severity, high: severity === "HIGH", text });

  for (const p of active) {
    const lag = p.elapsed_percent - p.achievement_percent;
    if (p.sales_target > 0 && lag >= 10) {
      push(
        p,
        "SALES_BEHIND",
        lag >= 25 ? "HIGH" : "MEDIUM",
        `${p.territory_name || p.state_name || p.name} has achieved ${p.achievement_percent}% of its ${p.season} sales target while ${p.elapsed_percent}% of the plan period has elapsed.`,
      );
    }
    const collLag = p.elapsed_percent - p.collection_percent;
    if (p.collection_target > 0 && collLag >= 10) {
      push(
        p,
        "COLLECTION_BEHIND",
        collLag >= 25 ? "HIGH" : "MEDIUM",
        `Collection is behind plan: ${p.collection_percent}% achieved vs ${p.elapsed_percent}% of period elapsed.`,
      );
    }
  }
  for (const d of dist) {
    const p = byPlan.get(d.plan_id);
    if (!p) continue;
    if (d.actual <= 0 && p.elapsed_percent >= 15) {
      push(p, "NO_ORDER", "MEDIUM", `${d.name} has not placed any order yet this period.`);
    }
    if (d.max_outstanding > 0 && d.outstanding > d.max_outstanding) {
      push(
        p,
        "OUTSTANDING_EXCEEDED",
        "HIGH",
        `${d.name} outstanding ₹${Math.round(d.outstanding).toLocaleString("en-IN")} exceeds the allowed ₹${Math.round(d.max_outstanding).toLocaleString("en-IN")}.`,
      );
    }
  }
  for (const o of overdue) {
    const p = byPlan.get(o.plan_id);
    if (p) push(p, "ACTION_OVERDUE", "MEDIUM", `Corrective action for ${o.scope_label} is overdue (due ${o.due_date}).`);
  }
  const rank = { HIGH: 0, MEDIUM: 1 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
};

// ---------------------------------------------------------------------
//  DASHBOARD
// ---------------------------------------------------------------------
const dashboard = async (filters, settings, today) => {
  const plans = await enrichPlans(await plan.listAllPlans(filters), settings, today);
  const ids = plans.map((p) => p.id);
  const live = plans.filter((p) => isLive(p) || p.status === "CLOSED");
  const liveIds = live.map((p) => p.id);

  const [dist, products, retailers, alerts, combined] = await Promise.all([
    distributorPerformance(liveIds, settings),
    productPerformance(liveIds, settings),
    retailerLinesFor(liveIds),
    buildAlerts(plans, settings, today),
    // D2: an invoice / receipt in two overlapping plans is counted once in the totals
    actuals.getCombinedTotals(liveIds),
  ]);

  const sum = (rows, k) => round(rows.reduce((s, r) => s + num(r[k]), 0));
  const totalTarget = sum(live, "sales_target");
  const achieved = combined.sales;
  const collTarget = sum(live, "collection_target");
  const collAchieved = combined.collection;
  const achievement = pct(achieved, totalTarget);

  const statusCounts = {};
  for (const p of plans) statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;

  return {
    // value of every plan in scope (all statuses) shown in the hero card
    total_business_plan_value: sum(plans, "sales_target"),
    note: "KPIs use Active and Closed plans; Draft / Submitted plans are not yet committed. Achieved figures count each invoice / receipt once, even when plans overlap.",
    plans_sum_achieved_sales: sum(live, "achieved"),
    kpis: {
      achievement_percent: achievement,
      performance: performance(achievement, settings.thresholds),
      total_sales_target: totalTarget,
      achieved_sales: achieved,
      total_collection_target: collTarget,
      achieved_collection: collAchieved,
      pending_sales_target: round(Math.max(totalTarget - achieved, 0)),
      pending_collection: round(Math.max(collTarget - collAchieved, 0)),
      business_plan_gap: round(totalTarget - achieved),
      collection_achievement_percent: pct(collAchieved, collTarget),
    },
    coverage: {
      planned_distributors: new Set(dist.map((d) => d.ledger_id)).size,
      active_distributors: new Set(dist.filter((d) => d.actual > 0).map((d) => d.ledger_id)).size,
      planned_retailers: new Set(retailers.map((r) => r.retailer_id)).size,
      // employee-reported business (not verified by transactions)
      active_retailers: new Set(retailers.filter((r) => num(r.reported_actual) > 0).map((r) => r.retailer_id)).size,
      active_retailers_source: "REPORTED",
      total_planned_qty: sum(products, "qty_target"),
      actual_sold_qty: sum(products, "actual_qty"),
    },
    status_counts: statusCounts,
    alerts: alerts.slice(0, 3),
    alert_count: alerts.length,
    plans: plans.slice(0, 20),
    total_plans: ids.length,
  };
};

// ---------------------------------------------------------------------
//  PLAN VS ACTUAL
// ---------------------------------------------------------------------
const planVsActual = async (filters, settings, today) => {
  const plans = await enrichPlans(await plan.listAllPlans(filters), settings, today);
  const ids = plans.map((p) => p.id);
  const [dist, products] = await Promise.all([
    distributorPerformance(ids, settings),
    productPerformance(ids, settings),
  ]);
  const totalActual = dist.reduce((s, d) => s + d.actual, 0);
  const productGroups = groupSum(
    products,
    (r) => r.stock_item_id,
    (r) => r.name,
    settings,
    "qty_target",
    "actual_qty",
  ).map((g) => ({ stock_item_id: g.key, name: g.name, qty_target: g.target, actual_qty: g.actual, achievement_percent: g.achievement_percent, performance: g.performance }));

  return {
    chart: plans.map((p) => ({
      plan_id: p.id,
      label: (p.territory_name || p.name).split(" ")[0],
      territory: p.territory_name,
      target: p.sales_target,
      actual: p.achieved,
      achievement_percent: p.achievement_percent,
      performance: p.performance,
    })),
    plans: plans.map((p) => ({
      plan_id: p.id,
      plan_code: p.plan_code,
      name: p.name,
      status: p.status,
      status_label: p.status_label,
      target: p.sales_target,
      actual: p.achieved,
      difference: round(p.achieved - p.sales_target),
      achievement_percent: p.achievement_percent,
      performance: p.performance,
    })),
    products: productGroups,
    distributor_contribution: groupSum(dist, (r) => r.ledger_id, (r) => r.name, settings).map((g) => ({
      ledger_id: g.key,
      name: g.name,
      target: g.target,
      actual: g.actual,
      achievement_percent: g.achievement_percent,
      share_percent: pct(g.actual, totalActual),
      performance: g.performance,
    })),
  };
};

// ---------------------------------------------------------------------
//  MATRIX  (party x product from distributor "Product Planning")
// ---------------------------------------------------------------------
const matrix = async (filters, settings, today, { planId } = {}) => {
  const plans = planId ? [await plan.getPlan(planId)].filter(Boolean) : await plan.listAllPlans(filters);
  const ids = plans.map((p) => p.id);
  const [lines, dp, act] = await Promise.all([
    distLinesFor(ids),
    distProductsFor(ids),
    actuals.getDistributorProductActuals(ids),
  ]);

  const products = new Map();
  for (const r of dp) products.set(r.stock_item_id, r.product_name);
  const productList = [...products.entries()]
    .map(([id, name]) => ({ stock_item_id: id, name }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  // one row per distributor ledger (summed over plans)
  const rows = new Map();
  for (const l of lines) {
    if (!rows.has(l.ledger_id)) rows.set(l.ledger_id, { ledger_id: l.ledger_id, name: l.name, total_target: 0, cells: new Map() });
    rows.get(l.ledger_id).total_target += num(l.season_sales_target);
  }
  for (const r of dp) {
    const row = rows.get(r.ledger_id);
    if (!row) continue;
    if (!row.cells.has(r.stock_item_id)) {
      row.cells.set(r.stock_item_id, { planned_qty: 0, planned_value: 0, actual_qty: 0, actual_value: 0, prev_qty: 0 });
    }
    const c = row.cells.get(r.stock_item_id);
    const a = act.get(r.id) || { qty: 0, value: 0, prev_qty: 0 };
    c.planned_qty += num(r.planned_qty);
    c.planned_value += num(r.planned_value);
    c.actual_qty += a.qty;
    c.actual_value += a.value;
    c.prev_qty += a.prev_qty;
  }

  return {
    metrics: ["QUANTITY", "SALES_VALUE", "ACHIEVEMENT", "GROWTH"],
    products: productList,
    rows: [...rows.values()]
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((row) => ({
        ledger_id: row.ledger_id,
        name: row.name,
        total_target: round(row.total_target),
        cells: productList.map((p) => {
          const c = row.cells.get(p.stock_item_id);
          if (!c) return { stock_item_id: p.stock_item_id, planned: false };
          return {
            stock_item_id: p.stock_item_id,
            planned: true,
            planned_qty: round(c.planned_qty),
            planned_value: round(c.planned_value),
            actual_qty: round(c.actual_qty),
            actual_value: round(c.actual_value),
            achievement_percent: pct(c.actual_qty, c.planned_qty),
            growth_percent: c.prev_qty > 0 ? Math.round((c.actual_qty / c.prev_qty - 1) * 100) : null,
          };
        }),
      })),
  };
};

// ---------------------------------------------------------------------
//  FORECAST (run-rate)
// ---------------------------------------------------------------------
const forecast = async (filters, settings, today) => {
  const plans = await enrichPlans(
    await plan.listAllPlans({ ...filters, status: ["ACTIVE"] }),
    settings,
    today,
  );
  return plans.map((p) => {
    const remainingAmount = round(Math.max(p.sales_target - p.achieved, 0));
    const projected = p.days_elapsed > 0 ? round((p.achieved / p.days_elapsed) * p.days_total) : 0;
    const onPace = p.days_elapsed > 0 && projected >= p.sales_target;
    return {
      plan_id: p.id,
      plan_code: p.plan_code,
      name: p.name,
      target: p.sales_target,
      achieved: p.achieved,
      remaining: remainingAmount,
      days_total: p.days_total,
      days_elapsed: p.days_elapsed,
      days_remaining: p.days_remaining,
      current_run_rate: p.days_elapsed > 0 ? round(p.achieved / p.days_elapsed) : 0,
      required_run_rate: p.days_remaining > 0 ? round(remainingAmount / p.days_remaining) : remainingAmount,
      projected_final: projected,
      projected_percent: pct(projected, p.sales_target),
      on_pace: onPace,
      on_pace_label: p.days_elapsed === 0 ? "Not started" : onPace ? "Yes — on pace" : "No — behind pace",
    };
  });
};

// ---------------------------------------------------------------------
//  REPORTS
// ---------------------------------------------------------------------
const REPORTS = {
  company: "Company Business Plan",
  state: "State-wise Business Plan",
  territory: "Territory-wise Business Plan",
  employee: "Employee-wise Business Plan",
  distributor: "Distributor-wise Business Plan",
  retailer: "Retailer-wise Business Plan",
  product: "Product-wise Business Plan",
  variance: "Variance Report",
  underDist: "Underperforming Distributor Report",
  underProduct: "Underperforming Product Report",
  growth: "Business Growth Report",
};

const TARGET_COLS = (first) => [
  { key: "name", label: first },
  { key: "target", label: "Target" },
  { key: "actual", label: "Achieved" },
  { key: "achievement_percent", label: "Achv%" },
];

const report = async (key, filters, settings, today) => {
  const plans = await enrichPlans(await plan.listAllPlans(filters), settings, today);
  const ids = plans.map((p) => p.id);
  const planRows = plans.map((p) => ({ ...p, target: p.sales_target, actual: p.achieved }));
  const base = { key, title: REPORTS[key] };

  switch (key) {
    case "company": {
      const target = planRows.reduce((s, p) => s + p.target, 0);
      // D2: each invoice counted once across overlapping plans
      const actual = (await actuals.getCombinedTotals(ids)).sales;
      return {
        ...base,
        columns: [
          { key: "metric", label: "Metric" },
          { key: "value", label: "Value" },
        ],
        rows: [
          { metric: "Company Target", value: round(target) },
          { metric: "Company Achieved", value: round(actual) },
          { metric: "Achievement %", value: pct(actual, target) },
          { metric: "Total Plans", value: planRows.length },
        ],
      };
    }
    case "state":
      return { ...base, columns: TARGET_COLS("State"), rows: groupSum(planRows, (p) => p.state_id, (p) => p.state_name || "-", settings) };
    case "territory":
      return {
        ...base,
        columns: TARGET_COLS("Territory"),
        rows: groupSum(planRows, (p) => p.territory_id || 0, (p) => p.territory_name || "No territory", settings),
      };
    case "employee": {
      // D2: an employee's plans may overlap (seasons): his achieved figure counts each invoice once
      const rows = groupSum(planRows, (p) => p.assigned_user_id, (p) => p.assigned_user_name || "-", settings);
      for (const r of rows) {
        const own = planRows.filter((p) => p.assigned_user_id === r.key).map((p) => p.id);
        r.actual = (await actuals.getCombinedTotals(own)).sales;
        r.variance = round(r.actual - r.target);
        r.achievement_percent = pct(r.actual, r.target);
        r.performance = performance(r.achievement_percent, settings.thresholds);
      }
      return { ...base, columns: TARGET_COLS("Employee"), rows };
    }
    case "variance":
      return {
        ...base,
        columns: [
          { key: "name", label: "Plan" },
          { key: "target", label: "Target" },
          { key: "actual", label: "Actual" },
          { key: "variance", label: "Variance" },
        ],
        rows: planRows.map((p) => ({
          plan_id: p.id,
          name: p.name,
          target: p.target,
          actual: p.actual,
          variance: round(p.actual - p.target),
          achievement_percent: p.achievement_percent,
          performance: p.performance,
        })),
      };
    case "distributor":
    case "underDist":
    case "growth": {
      const dist = await distributorPerformance(ids, settings);
      if (key === "growth") {
        const rows = new Map();
        for (const d of dist) {
          if (!rows.has(d.ledger_id)) rows.set(d.ledger_id, { ledger_id: d.ledger_id, name: d.name, actual: 0, previous: 0 });
          const r = rows.get(d.ledger_id);
          r.actual += d.actual;
          r.previous += d.previous_year_sales;
        }
        return {
          ...base,
          columns: [
            { key: "name", label: "Distributor" },
            { key: "previous", label: "Previous Year" },
            { key: "actual", label: "This Period" },
            { key: "growth_percent", label: "Growth %" },
          ],
          rows: [...rows.values()].map((r) => ({
            ...r,
            actual: round(r.actual),
            previous: round(r.previous),
            growth_percent: r.previous > 0 ? Math.round((r.actual / r.previous - 1) * 100) : null,
          })),
        };
      }
      let rows = groupSum(dist, (d) => d.ledger_id, (d) => d.name, settings);
      if (key === "underDist") {
        rows = rows
          .filter((r) => r.achievement_percent < settings.thresholds.achieved)
          .sort((a, b) => a.achievement_percent - b.achievement_percent);
      }
      return { ...base, columns: TARGET_COLS("Distributor"), rows };
    }
    case "retailer": {
      const rows = await retailerPerformance(ids, settings);
      return {
        ...base,
        columns: [
          { key: "name", label: "Retailer" },
          { key: "target", label: "Target" },
          { key: "actual", label: "Actual (reported)" },
          { key: "achievement_percent", label: "Achv%" },
        ],
        rows,
      };
    }
    case "product":
    case "underProduct": {
      const products = await productPerformance(ids, settings);
      let rows = groupSum(products, (r) => r.stock_item_id, (r) => r.name, settings, "qty_target", "actual_qty");
      if (key === "underProduct") {
        rows = rows
          .filter((r) => r.achievement_percent < settings.thresholds.achieved)
          .sort((a, b) => a.achievement_percent - b.achievement_percent);
      }
      return {
        ...base,
        columns: [
          { key: "name", label: "Product" },
          { key: "target", label: "Target Qty" },
          { key: "actual", label: "Actual Qty" },
          { key: "achievement_percent", label: "Achv%" },
        ],
        rows,
      };
    }
    default:
      return null;
  }
};

// rows -> CSV text (Excel opens it); values with comma/quote/newline are quoted
const toCsv = (columns, rows) => {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? v.label || JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c.key])).join(","));
  return `﻿${lines.join("\r\n")}`;
};

module.exports = {
  REPORTS,
  performance,
  enrichPlans,
  planOverview,
  planDistributors,
  planProducts,
  planRetailers,
  planMonthly,
  planCollection,
  planAchievement,
  planVariance,
  buildAlerts,
  dashboard,
  planVsActual,
  matrix,
  forecast,
  report,
  toCsv,
  monthsOf,
  isLive,
  distributorPerformance,
};
