// Crop catalog (read side used by Crop Management and Advance Booking)
//
// How a product (stock item) belongs to a crop and a season — no extra master:
//   bp_setting_options (list_key SEASON)  the one season list: Kharif / Rabi / Zaid …
//                                         (also used by Business Plans)
//   crops                                 the crop master (Create Crop form)
//   crop_season_map (crop_id, season)     the season(s) chosen for the crop on the Create Crop form
//   stock_items.crop_id                   the crop chosen on the Create Stock Item form
//
//   products of crop C in season S = stock_items WHERE crop_id = C
//                                    AND crop C is linked to S in crop_season_map
//
// Writing the crop and its seasons is done by the existing crop module
// (models/product-demo/crop.model.js: createCrop / updateCrop, one transaction).
const db = require("../../config/db");

const num = (v) => Number(v) || 0;

// ---------------------------------------------------------------------
//  SEASONS (bp_setting_options, list SEASON)
// ---------------------------------------------------------------------
const listSeasons = async ({ includeInactive = false } = {}) => {
  const [rows] = await db.query(
    `SELECT o.id, o.value AS name, o.sort_order, o.is_active,
            (SELECT COUNT(*) FROM crop_season_map m WHERE m.season = o.value) AS crop_count
     FROM bp_setting_options o
     WHERE o.list_key = 'SEASON' ${includeInactive ? "" : "AND o.is_active = 1"}
     ORDER BY o.sort_order ASC, o.value ASC`,
  );
  return rows.map((r) => ({ id: num(r.id), name: r.name, sort_order: num(r.sort_order), is_active: num(r.is_active) === 1, crop_count: num(r.crop_count) }));
};

const getSeasonOption = async (id) => {
  const [rows] = await db.query(`SELECT id, value AS name, is_active FROM bp_setting_options WHERE id = ? AND list_key = 'SEASON'`, [id]);
  return rows[0] ? { id: num(rows[0].id), name: rows[0].name, is_active: num(rows[0].is_active) === 1 } : null;
};

// where a season name is used (checked before switching it off)
const seasonUsage = async (name) => {
  const [[c]] = await db.query(`SELECT COUNT(*) AS n FROM crop_season_map WHERE season = ?`, [name]);
  const [[a]] = await db.query(`SELECT COUNT(*) AS n FROM abs_seasons WHERE season = ? AND status IN ('DRAFT','OPEN')`, [name]);
  return { crops: num(c.n), open_booking_seasons: num(a.n) };
};

// ---------------------------------------------------------------------
//  CROPS of a season
// ---------------------------------------------------------------------
// active crops (default) linked to `season`, each with its seasons and the number of active
// products (stock items) of the crop
const listCrops = async ({ season, includeInactive = false, ids } = {}) => {
  const where = [];
  const params = [];
  if (!includeInactive) where.push("c.is_active = 1");
  if (season) {
    where.push("EXISTS (SELECT 1 FROM crop_season_map m WHERE m.crop_id = c.id AND m.season = ?)");
    params.push(season);
  }
  if (Array.isArray(ids)) {
    where.push("c.id IN (?)");
    params.push(ids.length ? ids : [0]);
  }
  const [rows] = await db.query(
    `SELECT c.id, c.crop_name, c.is_active,
            (SELECT COUNT(*) FROM stock_items si WHERE si.crop_id = c.id AND si.is_active = 1) AS product_count
     FROM crops c ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY c.crop_name ASC`,
    params,
  );
  if (!rows.length) return [];
  const [maps] = await db.query(`SELECT crop_id, season FROM crop_season_map WHERE crop_id IN (?) ORDER BY season`, [rows.map((r) => r.id)]);
  const byCrop = new Map();
  for (const m of maps) {
    const list = byCrop.get(num(m.crop_id)) || [];
    list.push(m.season);
    byCrop.set(num(m.crop_id), list);
  }
  return rows.map((r) => ({
    id: num(r.id),
    crop_name: r.crop_name,
    is_active: num(r.is_active) === 1,
    seasons: byCrop.get(num(r.id)) || [],
    product_count: num(r.product_count),
  }));
};

const getCrop = async (id) => (await listCrops({ includeInactive: true, ids: [Number(id)] }))[0] || null;

// is crop `cropId` linked to `season`?
const cropInSeason = async (cropId, season) => {
  if (!cropId || !season) return false;
  const [rows] = await db.query(`SELECT 1 FROM crop_season_map WHERE crop_id = ? AND season = ? LIMIT 1`, [cropId, season]);
  return rows.length > 0;
};

// ---------------------------------------------------------------------
//  PRODUCTS (stock items) of a crop in a season
// ---------------------------------------------------------------------
// The product dropdown: active stock items of the crop, only when the crop is linked to the
// season. Stock groups hidden from the user's department are left out (utils/stockVisibility).
const productsForCropSeason = async ({ cropId, season, search, hiddenGroupIds = [], limit = 300 }) => {
  const where = ["si.crop_id = ?", "si.is_active = 1", "c.is_active = 1"];
  const params = [cropId];
  if (season) {
    where.push("EXISTS (SELECT 1 FROM crop_season_map m WHERE m.crop_id = si.crop_id AND m.season = ?)");
    params.push(season);
  }
  if (search) {
    where.push("si.item_name LIKE ?");
    params.push(`%${search}%`);
  }
  if (hiddenGroupIds.length) {
    where.push("(si.stock_group_id IS NULL OR si.stock_group_id NOT IN (?))");
    params.push(hiddenGroupIds);
  }
  const [rows] = await db.query(
    `SELECT si.id, si.item_name, si.crop_id, c.crop_name, si.unit_id, u.symbol AS unit,
            si.rate_of_duty AS gst_percent, sg.name AS group_name
     FROM stock_items si
     INNER JOIN crops c ON c.id = si.crop_id
     LEFT JOIN units u ON u.id = si.unit_id
     LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
     WHERE ${where.join(" AND ")}
     ORDER BY si.item_name ASC
     LIMIT ?`,
    [...params, Math.min(Math.max(Number(limit) || 300, 1), 1000)],
  );
  return rows.map((r) => ({
    id: num(r.id),
    stock_item_id: num(r.id),
    item_name: r.item_name,
    crop_id: num(r.crop_id),
    crop_name: r.crop_name,
    unit: r.unit || null,
    gst_percent: num(r.gst_percent),
    group_name: r.group_name || null,
  }));
};

module.exports = {
  listSeasons,
  getSeasonOption,
  seasonUsage,
  listCrops,
  getCrop,
  cropInSeason,
  productsForCropSeason,
};
