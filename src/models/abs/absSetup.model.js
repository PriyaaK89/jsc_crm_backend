// ABS masters: settings, booking seasons, season price list, schemes, lookups.
const db = require("../../config/db");

const DEFAULT_SETTINGS = {
  min_advance_pct: "25",
  advance_due_days: "7",
  require_booking_approval: "1",
  dispatch_payment_rule: "CREDIT_LIMIT",
  dispatch_min_paid_pct: "50",
  allocation_priority: "ADVANCE_FIRST",
  sales_ledger_id: null,
  booking_prefix: "ABS",
  cancellation_refund_rule: "REFUND",
  company_state_code: null,
};

const num = (v) => Number(v) || 0;

// ---------------------------------------------------------------- settings
const getSettings = async () => {
  const [rows] = await db.query(`SELECT setting_key, setting_value FROM abs_settings`);
  const raw = { ...DEFAULT_SETTINGS };
  for (const r of rows) raw[r.setting_key] = r.setting_value;
  return {
    min_advance_pct: num(raw.min_advance_pct),
    advance_due_days: Math.max(0, Math.round(num(raw.advance_due_days))),
    require_booking_approval: String(raw.require_booking_approval) !== "0",
    dispatch_payment_rule: ["CREDIT_LIMIT", "MIN_PERCENT", "FULL_PAYMENT"].includes(raw.dispatch_payment_rule) ? raw.dispatch_payment_rule : "CREDIT_LIMIT",
    dispatch_min_paid_pct: num(raw.dispatch_min_paid_pct),
    allocation_priority: raw.allocation_priority === "BOOKING_DATE" ? "BOOKING_DATE" : "ADVANCE_FIRST",
    sales_ledger_id: raw.sales_ledger_id ? Number(raw.sales_ledger_id) : null,
    booking_prefix: String(raw.booking_prefix || "ABS").slice(0, 10),
    cancellation_refund_rule: raw.cancellation_refund_rule === "CARRY_FORWARD" ? "CARRY_FORWARD" : "REFUND",
    company_state_code: raw.company_state_code ? String(raw.company_state_code).padStart(2, "0") : null,
  };
};

const saveSettings = async (values, userId) => {
  const entries = Object.entries(values);
  if (!entries.length) return;
  await db.query(
    `INSERT INTO abs_settings (setting_key, setting_value, updated_by) VALUES ?
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [entries.map(([k, v]) => [k, v === null || v === undefined ? null : String(v), userId])],
  );
};

// ---------------------------------------------------------------- seasons
const SEASON_SELECT = `
  SELECT s.id, s.name, s.season, s.financial_year,
         DATE_FORMAT(s.booking_start, '%Y-%m-%d') AS booking_start,
         DATE_FORMAT(s.booking_end, '%Y-%m-%d') AS booking_end,
         DATE_FORMAT(s.delivery_start, '%Y-%m-%d') AS delivery_start,
         DATE_FORMAT(s.delivery_end, '%Y-%m-%d') AS delivery_end,
         s.min_advance_pct, s.status, s.remarks,
         (SELECT COUNT(*) FROM abs_season_products sp WHERE sp.season_id = s.id AND sp.is_active = 1) AS product_count,
         (SELECT COUNT(*) FROM abs_bookings b WHERE b.season_id = s.id AND b.is_deleted = 0) AS booking_count
  FROM abs_seasons s`;

const shapeSeason = (r) => ({ ...r, min_advance_pct: r.min_advance_pct === null ? null : num(r.min_advance_pct), product_count: num(r.product_count), booking_count: num(r.booking_count) });

const listSeasons = async ({ status } = {}) => {
  const [rows] = await db.query(
    `${SEASON_SELECT} ${status ? "WHERE s.status = ?" : ""} ORDER BY s.booking_start DESC, s.id DESC`,
    status ? [status] : [],
  );
  return rows.map(shapeSeason);
};

const getSeason = async (id) => {
  const [rows] = await db.query(`${SEASON_SELECT} WHERE s.id = ?`, [id]);
  return rows[0] ? shapeSeason(rows[0]) : null;
};

const SEASON_COLS = ["name", "season", "financial_year", "booking_start", "booking_end", "delivery_start", "delivery_end", "min_advance_pct", "remarks"];

const createSeason = async (data, userId) => {
  const [res] = await db.query(
    `INSERT INTO abs_seasons (${SEASON_COLS.join(", ")}, status, created_by) VALUES (${SEASON_COLS.map(() => "?").join(", ")}, 'DRAFT', ?)`,
    [...SEASON_COLS.map((c) => (data[c] === undefined ? null : data[c])), userId],
  );
  return res.insertId;
};

const updateSeason = async (id, data) => {
  await db.query(
    `UPDATE abs_seasons SET ${SEASON_COLS.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
    [...SEASON_COLS.map((c) => (data[c] === undefined ? null : data[c])), id],
  );
};

const setSeasonStatus = async (id, status) => {
  await db.query(`UPDATE abs_seasons SET status = ? WHERE id = ?`, [status, id]);
};

// ---------------------------------------------------------------- price list
const ITEM_COLS = `si.item_name, si.unit_id, u.symbol AS unit, si.rate_of_duty AS gst_percent,
         si.crop_id, cr.crop_name, sg.name AS group_name`;
const ITEM_JOINS = `
  LEFT JOIN units u ON u.id = si.unit_id
  LEFT JOIN crops cr ON cr.id = si.crop_id
  LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id`;

const shapeProduct = (r) => ({
  ...r,
  booking_rate: num(r.booking_rate),
  mrp: r.mrp === null ? null : num(r.mrp),
  min_qty: num(r.min_qty),
  max_qty_per_party: r.max_qty_per_party === null ? null : num(r.max_qty_per_party),
  production_qty: r.production_qty === null ? null : num(r.production_qty),
  gst_percent: num(r.gst_percent),
  is_active: Number(r.is_active) === 1,
  booked_qty: num(r.booked_qty),
});

// with total booked qty (live bookings) so planners see demand vs production plan
const listSeasonProducts = async (seasonId, { activeOnly = false } = {}) => {
  const [rows] = await db.query(
    `SELECT sp.id, sp.season_id, sp.stock_item_id, sp.booking_rate, sp.mrp, sp.min_qty,
            sp.max_qty_per_party, sp.production_qty, sp.is_active, ${ITEM_COLS},
            (SELECT COALESCE(SUM(COALESCE(bi.confirmed_qty, bi.qty) - bi.cancelled_qty), 0)
               FROM abs_booking_items bi INNER JOIN abs_bookings b ON b.id = bi.booking_id
              WHERE b.season_id = sp.season_id AND bi.stock_item_id = sp.stock_item_id AND b.is_deleted = 0
                AND b.status NOT IN ('DRAFT','REJECTED','CANCELLED')) AS booked_qty
     FROM abs_season_products sp
     INNER JOIN stock_items si ON si.id = sp.stock_item_id
     ${ITEM_JOINS}
     WHERE sp.season_id = ? ${activeOnly ? "AND sp.is_active = 1" : ""}
     ORDER BY si.item_name ASC`,
    [seasonId],
  );
  return rows.map(shapeProduct);
};

const getSeasonProduct = async (seasonId, stockItemId) => {
  const [rows] = await db.query(
    `SELECT sp.*, ${ITEM_COLS}, 0 AS booked_qty
     FROM abs_season_products sp INNER JOIN stock_items si ON si.id = sp.stock_item_id ${ITEM_JOINS}
     WHERE sp.season_id = ? AND sp.stock_item_id = ?`,
    [seasonId, stockItemId],
  );
  return rows[0] ? shapeProduct(rows[0]) : null;
};

// rows: [{ stock_item_id, booking_rate, mrp, min_qty, max_qty_per_party, production_qty, is_active }]
const upsertSeasonProducts = async (seasonId, rows) => {
  if (!rows.length) return;
  await db.query(
    `INSERT INTO abs_season_products
       (season_id, stock_item_id, booking_rate, mrp, min_qty, max_qty_per_party, production_qty, is_active)
     VALUES ?
     ON DUPLICATE KEY UPDATE booking_rate = VALUES(booking_rate), mrp = VALUES(mrp), min_qty = VALUES(min_qty),
       max_qty_per_party = VALUES(max_qty_per_party), production_qty = VALUES(production_qty), is_active = VALUES(is_active)`,
    [rows.map((r) => [seasonId, r.stock_item_id, r.booking_rate, r.mrp, r.min_qty, r.max_qty_per_party, r.production_qty, r.is_active ? 1 : 0])],
  );
};

const stockItemsExist = async (ids) => {
  if (!ids.length) return [];
  const [rows] = await db.query(`SELECT id FROM stock_items WHERE id IN (?)`, [ids]);
  return rows.map((r) => Number(r.id));
};

// ---------------------------------------------------------------- schemes
const SCHEME_SELECT = `
  SELECT sc.id, sc.season_id, sc.name, sc.scheme_type, sc.stock_item_id, si.item_name,
         DATE_FORMAT(sc.valid_from, '%Y-%m-%d') AS valid_from,
         DATE_FORMAT(sc.valid_till, '%Y-%m-%d') AS valid_till,
         sc.min_qty, sc.min_advance_pct, sc.discount_type, sc.discount_value, sc.is_active
  FROM abs_schemes sc LEFT JOIN stock_items si ON si.id = sc.stock_item_id`;

const shapeScheme = (r) => ({ ...r, min_qty: num(r.min_qty), min_advance_pct: num(r.min_advance_pct), discount_value: num(r.discount_value), is_active: Number(r.is_active) === 1 });

const listSchemes = async (seasonId, { activeOnly = false } = {}) => {
  const [rows] = await db.query(
    `${SCHEME_SELECT} WHERE sc.season_id = ? ${activeOnly ? "AND sc.is_active = 1" : ""} ORDER BY sc.scheme_type, sc.id`,
    [seasonId],
  );
  return rows.map(shapeScheme);
};

const SCHEME_COLS = ["name", "scheme_type", "stock_item_id", "valid_from", "valid_till", "min_qty", "min_advance_pct", "discount_type", "discount_value", "is_active"];

const createScheme = async (seasonId, data, userId) => {
  const [res] = await db.query(
    `INSERT INTO abs_schemes (season_id, ${SCHEME_COLS.join(", ")}, created_by) VALUES (?, ${SCHEME_COLS.map(() => "?").join(", ")}, ?)`,
    [seasonId, ...SCHEME_COLS.map((c) => data[c]), userId],
  );
  return res.insertId;
};

const updateScheme = async (id, data) => {
  await db.query(`UPDATE abs_schemes SET ${SCHEME_COLS.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...SCHEME_COLS.map((c) => data[c]), id]);
};

const getScheme = async (id) => {
  const [rows] = await db.query(`${SCHEME_SELECT} WHERE sc.id = ?`, [id]);
  return rows[0] ? shapeScheme(rows[0]) : null;
};

const deleteScheme = async (id) => {
  await db.query(`UPDATE abs_schemes SET is_active = 0 WHERE id = ?`, [id]);
};

// ---------------------------------------------------------------- lookups
const listGodowns = async () => {
  const [rows] = await db.query(`SELECT id, godown_name AS name FROM godowns ORDER BY godown_name ASC`);
  return rows;
};

const godownExists = async (id) => {
  const [rows] = await db.query(`SELECT id FROM godowns WHERE id = ?`, [id]);
  return rows.length > 0;
};

const companyGstin = async () => {
  try {
    const [rows] = await db.query(`SELECT gstin FROM companies ORDER BY id ASC LIMIT 1`);
    return rows[0] ? rows[0].gstin : null;
  } catch (_) {
    return null;
  }
};

// party ledger for bookings (Sundry Debtors), with what a booking officer needs to see
const getParty = async (ledgerId, runner = db) => {
  const [rows] = await runner.query(
    `SELECT l.id AS ledger_id, l.ledger_name AS name, l.location, l.gst_no, l.credit_limit,
            l.default_credit_period, l.employee_under, l.state_id, gs.state_name AS state,
            gd.district_name_english AS district, eu.name AS employee_name,
            (SELECT c.contact_number FROM customers c WHERE c.type = 'distributor' AND c.distributor_ledger_id = l.id LIMIT 1) AS contact_number
     FROM ledgers l
     INNER JOIN account_groups ag ON ag.id = l.group_id AND ag.group_name = 'Sundry Debtors'
     LEFT JOIN geo_states gs ON gs.id = l.state_id
     LEFT JOIN geo_districts gd ON gd.id = l.district_id
     LEFT JOIN users eu ON eu.id = l.employee_under
     WHERE l.id = ?`,
    [ledgerId],
  );
  if (!rows[0]) return null;
  return { ...rows[0], credit_limit: num(rows[0].credit_limit), default_credit_period: num(rows[0].default_credit_period) };
};

// users who hold a permission code (+ admins) — for "please act" notifications
const usersWithCode = async (code) => {
  const [rows] = await db.query(
    `SELECT DISTINCT u.id FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = 1 AND (
       r.name IN ('ADMIN', 'SUPER_ADMIN')
       OR EXISTS (SELECT 1 FROM user_permissions up INNER JOIN permissions p ON p.id = up.permission_id
                  WHERE up.user_id = u.id AND up.is_allowed = 1 AND p.code = ?))`,
    [code],
  );
  return rows.map((r) => Number(r.id));
};

module.exports = {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  listSeasons,
  getSeason,
  createSeason,
  updateSeason,
  setSeasonStatus,
  listSeasonProducts,
  getSeasonProduct,
  upsertSeasonProducts,
  stockItemsExist,
  listSchemes,
  getScheme,
  createScheme,
  updateScheme,
  deleteScheme,
  listGodowns,
  godownExists,
  companyGstin,
  getParty,
  usersWithCode,
};
