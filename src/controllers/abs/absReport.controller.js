// ABS dashboard and season reports (field staff: their team; office / admin: everything).
const R = require("../../models/abs/absReport.model");
const setup = require("../../models/abs/absSetup.model");
const A = require("./absHelpers");

const { HttpError, wrap, ok } = A;

// season from ?season_id, else the latest open season, else the latest season
const pickSeason = async (req) => {
  const id = A.optId(req.query.season_id, "season");
  if (id) {
    const s = await setup.getSeason(id);
    if (!s) throw new HttpError(404, "Booking season not found");
    return s;
  }
  const all = await setup.listSeasons();
  return all.find((s) => s.status === "OPEN") || all.find((s) => s.status !== "DRAFT") || all[0] || null;
};

// GET /abs/dashboard?season_id
const dashboard = wrap(async (req, res) => {
  const season = await pickSeason(req);
  if (!season) return ok(res, { season: null, totals: null, statuses: [], varieties: [], employees: [], parties: [] });
  const scope = await A.scopeIds(req);
  const [totals, statuses, varieties, employees, parties] = await Promise.all([
    R.totals(season.id, scope, A.todayIST()),
    R.statusSummary(season.id, scope),
    R.varieties(season.id, scope),
    R.employees(season.id, scope),
    R.parties(season.id, scope, 10),
  ]);
  return ok(res, { season, totals, statuses, varieties, employees, parties });
});

// GET /abs/reports/:kind?season_id   kind = varieties | employees | parties
const report = wrap(async (req, res) => {
  const kind = String(req.params.kind || "");
  if (!["varieties", "employees", "parties"].includes(kind)) throw new HttpError(400, "Report must be varieties, employees or parties");
  const season = await pickSeason(req);
  if (!season) throw new HttpError(404, "No booking season yet");
  const scope = await A.scopeIds(req);
  const rows = kind === "varieties" ? await R.varieties(season.id, scope) : kind === "employees" ? await R.employees(season.id, scope) : await R.parties(season.id, scope, 1000);
  return ok(res, { season, rows });
});

module.exports = { dashboard, report };
