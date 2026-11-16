// Business Plan: Dashboard, Alerts, Plan vs Actual, Matrix, Forecast, Reports.
// Every view accepts the same filters: financial_year (or year), season, state_id,
// territory_id, product_id, employee_id, status. Scope = me + my reporting team (admin: all).
const s = require("../../models/business-plan/bpSettings.model");
const plan = require("../../models/business-plan/bpPlan.model");
const analytics = require("../../models/business-plan/bpAnalytics.model");
const H = require("./bpHelpers");

const { HttpError, wrap, ok } = H;

const getDashboard = wrap(async (req, res) => {
  const filters = await H.scopedFilters(req);
  const settings = await s.getSettings();
  return ok(res, await analytics.dashboard(filters, settings, H.todayIST()));
});

const getAlerts = wrap(async (req, res) => {
  const filters = await H.scopedFilters(req);
  const settings = await s.getSettings();
  const today = H.todayIST();
  const plans = await analytics.enrichPlans(
    await plan.listAllPlans({ ...filters, status: ["ACTIVE"] }),
    settings,
    today,
  );
  const alerts = await analytics.buildAlerts(plans, settings, today);
  const severity = req.query.severity ? String(req.query.severity).toUpperCase() : null;
  const list = severity ? alerts.filter((a) => a.severity === severity) : alerts;
  return ok(res, { count: list.length, items: list });
});

const getPlanVsActual = wrap(async (req, res) => {
  const filters = await H.scopedFilters(req);
  const settings = await s.getSettings();
  return ok(res, await analytics.planVsActual(filters, settings, H.todayIST()));
});

// GET /matrix?plan_id=  (one plan) or the usual filters (all plans in scope)
const getMatrix = wrap(async (req, res) => {
  const filters = await H.scopedFilters(req);
  const settings = await s.getSettings();
  const planId = H.optId(req.query.plan_id, "plan_id");
  if (planId) {
    const p = await plan.getPlan(planId);
    if (!p || !H.canViewPlan(filters.userIds, p)) throw new HttpError(404, "Business plan not found");
  }
  return ok(res, await analytics.matrix(filters, settings, H.todayIST(), { planId }));
});

const getForecast = wrap(async (req, res) => {
  const filters = await H.scopedFilters(req);
  const settings = await s.getSettings();
  const items = await analytics.forecast(filters, settings, H.todayIST());
  return ok(res, {
    items,
    message: items.length ? undefined : "No active plans to forecast. Approve a plan first.",
  });
});

const listReports = wrap(async (req, res) =>
  ok(res, Object.entries(analytics.REPORTS).map(([key, label]) => ({ key, label }))),
);

// GET /reports/:key?format=csv
const getReport = wrap(async (req, res) => {
  const key = req.params.key;
  if (!analytics.REPORTS[key]) throw new HttpError(404, "Report not found");
  const filters = await H.scopedFilters(req);
  const settings = await s.getSettings();
  const data = await analytics.report(key, filters, settings, H.todayIST());

  if (String(req.query.format || "").toLowerCase() === "csv") {
    const fileName = `${key}-business-plan-${H.todayIST()}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(analytics.toCsv(data.columns, data.rows));
  }
  return ok(res, data);
});

module.exports = {
  getDashboard,
  getAlerts,
  getPlanVsActual,
  getMatrix,
  getForecast,
  listReports,
  getReport,
};
