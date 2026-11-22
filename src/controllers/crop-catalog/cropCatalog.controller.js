// Crop catalog API (Crop Management + Advance Booking dropdowns)
//
//   GET  /crop-catalog/seasons                 the season list (Kharif / Rabi / Zaid …)
//   POST /crop-catalog/seasons                 add a season           (Admin / Super Admin / crop_manage)
//   POST /crop-catalog/seasons/:id/status      switch a season on/off (Admin / Super Admin / crop_manage)
//   GET  /crop-catalog/crops?season=Kharif     active crops linked to the season
//   GET  /crop-catalog/products?crop_id=&season=&search=
//                                              stock items of the crop, only when the crop is in that season
//
// The crop and its seasons are saved by the existing crop API (/create-crops, /update-crops/:id
// with `seasons: [...]`); stock items get their crop on the stock item form (stock_items.crop_id).
const crop = require("../../models/product-demo/crop.model");
const bpSettings = require("../../models/business-plan/bpSettings.model");
const C = require("../../models/crop-catalog/cropCatalog.model");
const { getHiddenGroupIdsForRequest } = require("../../utils/stockVisibility");
const H = require("../business-plan/bpHelpers");

const { HttpError, ok } = H;

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError || (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500)) {
      const body = { success: false, message: err.message };
      if (err.data !== undefined) body.data = err.data;
      return res.status(err.status).json(body);
    }
    if (err && err.code === "ER_DUP_ENTRY") return res.status(409).json({ success: false, message: "This record already exists" });
    console.error("CROP CATALOG ERROR:", err);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
};

const canManage = async (req) => crop.canManageCrops(req.user);

const assertManage = async (req) => {
  if (!(await canManage(req))) throw new HttpError(403, "Only Admin / Super Admin (or users with crop management permission) can change the season list");
};

// ---------------------------------------------------------------------
//  SEASONS
// ---------------------------------------------------------------------
// GET /crop-catalog/seasons?include_inactive=1
const listSeasons = wrap(async (req, res) => {
  const all = String(req.query.include_inactive || "") === "1" && (await canManage(req));
  return ok(res, await C.listSeasons({ includeInactive: all }));
});

// POST /crop-catalog/seasons { name }
const addSeason = wrap(async (req, res) => {
  await assertManage(req);
  const name = H.text((req.body || {}).name, "Season name", { required: true, max: 30 }).replace(/\s+/g, " ");
  if (name.length < 2) throw new HttpError(400, "Season name is too short");
  const r = await bpSettings.addOption({ listKey: "SEASON", value: name, userId: req.user.id });
  if (r.duplicate) throw new HttpError(409, `${name} is already in the season list`);
  return ok(res, await C.getSeasonOption(r.id), `${name} added to the season list`, 201);
});

// POST /crop-catalog/seasons/:id/status { is_active }
// (a season is never renamed or deleted: crops, business plans and bookings store the name)
const setSeasonStatus = wrap(async (req, res) => {
  await assertManage(req);
  const opt = await C.getSeasonOption(H.toId(req.params.id, "season id"));
  if (!opt) throw new HttpError(404, "Season not found");
  const body = req.body || {};
  if (body.is_active === undefined) throw new HttpError(400, "is_active is required");
  const active = body.is_active === true || body.is_active === 1 || body.is_active === "1" || body.is_active === "true";
  if (!active) {
    const use = await C.seasonUsage(opt.name);
    if (use.open_booking_seasons > 0) throw new HttpError(409, `${opt.name} is used by ${use.open_booking_seasons} draft / open advance booking season(s); close them first`);
  }
  await bpSettings.updateOption(opt.id, { isActive: active });
  return ok(res, await C.getSeasonOption(opt.id), active ? `${opt.name} switched on` : `${opt.name} switched off (crops keep it in their history)`);
});

// ---------------------------------------------------------------------
//  CROPS of a season
// ---------------------------------------------------------------------
// GET /crop-catalog/crops?season=Kharif&include_inactive=1
const listCrops = wrap(async (req, res) => {
  const season = H.text(req.query.season, "season", { max: 30 }) || undefined;
  const all = String(req.query.include_inactive || "") === "1" && (await canManage(req));
  return ok(res, await C.listCrops({ season, includeInactive: all }));
});

// ---------------------------------------------------------------------
//  PRODUCTS of a crop in a season
// ---------------------------------------------------------------------
// GET /crop-catalog/products?crop_id=3&season=Kharif&search=
const listProducts = wrap(async (req, res) => {
  const cropId = H.toId(req.query.crop_id, "crop");
  const season = H.text(req.query.season, "season", { max: 30 }) || undefined;
  const c = await C.getCrop(cropId);
  if (!c) throw new HttpError(404, "Crop not found");
  if (season && !c.seasons.includes(season)) return ok(res, [], `${c.crop_name} is not a ${season} crop (set its season on the crop)`);
  const hiddenGroupIds = await getHiddenGroupIdsForRequest(req);
  const rows = await C.productsForCropSeason({ cropId, season, search: H.text(req.query.search, "search", { max: 100 }), hiddenGroupIds });
  return ok(res, rows);
});

module.exports = {
  listSeasons,
  addSeason,
  setSeasonStatus,
  listCrops,
  listProducts,
};
