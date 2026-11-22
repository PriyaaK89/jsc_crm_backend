// Business Plan: settings, dropdown lists, territories and lookups.
const db = require("../../config/db");

const LIST_KEYS = ["FINANCIAL_YEAR", "SEASON", "PLAN_TYPE", "GAP_REASON"];

const DEFAULT_SETTINGS = {
  threshold_over_achieved: "100",
  threshold_achieved: "85",
  threshold_on_track: "60",
  threshold_attention: "40",
  allow_allocation_override: "0",
  lock_date: null,
  // job roles (users.job_role_id -> job_roles.name) that give the final approval
  // when found in the employee's reporting line. Comma separated, case-insensitive.
  final_approver_roles: "RSM,Regional Sales Manager",
};

const DEBTOR_GROUP = "Sundry Debtors";

// ---------------------------------------------------------------------
//  OPTIONS (Financial Years, Seasons, Plan Types, Gap Reasons)
// ---------------------------------------------------------------------
const listOptions = async ({ includeInactive = false } = {}) => {
  const [rows] = await db.query(
    `SELECT id, list_key, value, sort_order, is_active
     FROM bp_setting_options
     ${includeInactive ? "" : "WHERE is_active = 1"}
     ORDER BY list_key ASC, sort_order ASC, value ASC`,
  );
  return rows;
};

const groupOptions = (rows) => {
  const out = { FINANCIAL_YEAR: [], SEASON: [], PLAN_TYPE: [], GAP_REASON: [] };
  for (const r of rows) {
    if (out[r.list_key]) out[r.list_key].push({ id: r.id, value: r.value, is_active: Number(r.is_active) === 1 });
  }
  return out;
};

const isActiveOption = async (listKey, value) => {
  const [rows] = await db.query(
    `SELECT id FROM bp_setting_options WHERE list_key = ? AND value = ? AND is_active = 1 LIMIT 1`,
    [listKey, value],
  );
  return rows.length > 0;
};

const getOption = async (id) => {
  const [rows] = await db.query(
    `SELECT id, list_key, value, sort_order, is_active FROM bp_setting_options WHERE id = ?`,
    [id],
  );
  return rows[0] || null;
};

// returns { id } or { duplicate: true }. A hidden duplicate is switched back on.
const addOption = async ({ listKey, value, userId }) => {
  const [existing] = await db.query(
    `SELECT id, is_active FROM bp_setting_options WHERE list_key = ? AND value = ?`,
    [listKey, value],
  );
  if (existing.length) {
    if (Number(existing[0].is_active) === 1) return { duplicate: true };
    await db.query(`UPDATE bp_setting_options SET is_active = 1 WHERE id = ?`, [existing[0].id]);
    return { id: existing[0].id };
  }
  const [[seq]] = await db.query(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_no FROM bp_setting_options WHERE list_key = ?`,
    [listKey],
  );
  const [res] = await db.query(
    `INSERT INTO bp_setting_options (list_key, value, sort_order, created_by) VALUES (?, ?, ?, ?)`,
    [listKey, value, seq.next_no, userId],
  );
  return { id: res.insertId };
};

const updateOption = async (id, { value, sortOrder, isActive }) => {
  const sets = [];
  const params = [];
  if (value !== undefined) {
    sets.push("value = ?");
    params.push(value);
  }
  if (sortOrder !== undefined) {
    sets.push("sort_order = ?");
    params.push(sortOrder);
  }
  if (isActive !== undefined) {
    sets.push("is_active = ?");
    params.push(isActive ? 1 : 0);
  }
  if (!sets.length) return;
  params.push(id);
  await db.query(`UPDATE bp_setting_options SET ${sets.join(", ")} WHERE id = ?`, params);
};

const hideOption = async (id) => {
  await db.query(`UPDATE bp_setting_options SET is_active = 0 WHERE id = ?`, [id]);
};

// how many plans / actions already use this text (shown to the admin)
const countOptionUsage = async (option) => {
  const column = {
    FINANCIAL_YEAR: "financial_year",
    SEASON: "season",
    PLAN_TYPE: "plan_type",
  }[option.list_key];
  if (column) {
    const [[r]] = await db.query(
      `SELECT COUNT(*) AS c FROM business_plans WHERE ${column} = ? AND is_deleted = 0`,
      [option.value],
    );
    return Number(r.c) || 0;
  }
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS c FROM bp_corrective_actions WHERE reason = ?`,
    [option.value],
  );
  return Number(r.c) || 0;
};

// ---------------------------------------------------------------------
//  SINGLE SETTINGS
// ---------------------------------------------------------------------
const getSettings = async () => {
  const [rows] = await db.query(`SELECT setting_key, setting_value FROM bp_settings`);
  const raw = { ...DEFAULT_SETTINGS };
  for (const r of rows) raw[r.setting_key] = r.setting_value;
  return {
    thresholds: {
      over_achieved: Number(raw.threshold_over_achieved) || 100,
      achieved: Number(raw.threshold_achieved) || 85,
      on_track: Number(raw.threshold_on_track) || 60,
      attention: Number(raw.threshold_attention) || 40,
    },
    allow_allocation_override: String(raw.allow_allocation_override) === "1",
    lock_date: raw.lock_date || null,
    final_approver_roles: raw.final_approver_roles === null || raw.final_approver_roles === undefined
      ? DEFAULT_SETTINGS.final_approver_roles
      : String(raw.final_approver_roles),
  };
};

const saveSettings = async (values, userId) => {
  const entries = Object.entries(values);
  if (!entries.length) return;
  await db.query(
    `INSERT INTO bp_settings (setting_key, setting_value, updated_by) VALUES ?
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [entries.map(([k, v]) => [k, v === null ? null : String(v), userId])],
  );
};

const resetSettings = async (userId) => {
  await saveSettings(DEFAULT_SETTINGS, userId);
};

// ---------------------------------------------------------------------
//  TERRITORIES
// ---------------------------------------------------------------------
const listTerritories = async ({ stateId, includeInactive = false } = {}) => {
  const where = [];
  const params = [];
  if (!includeInactive) where.push("t.is_active = 1");
  if (stateId) {
    where.push("t.state_id = ?");
    params.push(stateId);
  }
  const [rows] = await db.query(
    `SELECT t.id, t.name, t.state_id, gs.state_name, t.is_active,
            GROUP_CONCAT(td.district_id ORDER BY td.district_id) AS district_ids
     FROM bp_territories t
     LEFT JOIN geo_states gs ON gs.id = t.state_id
     LEFT JOIN bp_territory_districts td ON td.territory_id = t.id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     GROUP BY t.id, t.name, t.state_id, gs.state_name, t.is_active
     ORDER BY gs.state_name ASC, t.name ASC`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    state_id: r.state_id,
    state_name: r.state_name,
    is_active: Number(r.is_active) === 1,
    district_ids: r.district_ids ? String(r.district_ids).split(",").map(Number) : [],
  }));
};

const getTerritory = async (id) => {
  const [rows] = await db.query(
    `SELECT id, name, state_id, is_active FROM bp_territories WHERE id = ?`,
    [id],
  );
  return rows[0] || null;
};

const findTerritoryByName = async (stateId, name, excludeId = 0) => {
  const [rows] = await db.query(
    `SELECT id FROM bp_territories WHERE state_id = ? AND name = ? AND id <> ? LIMIT 1`,
    [stateId, name, excludeId],
  );
  return rows[0] || null;
};

// districts must belong to the territory's state
const validDistrictIds = async (stateId, districtIds) => {
  if (!districtIds.length) return [];
  const [rows] = await db.query(
    `SELECT id FROM geo_districts WHERE state_id = ? AND id IN (?)`,
    [stateId, districtIds],
  );
  return rows.map((r) => r.id);
};

// Territory writes (create / edit / activate / deactivate, each with a version) are in
// bpTerritory.model.js. Territories are never deleted.

const countTerritoryUsage = async (id) => {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS c FROM business_plans WHERE territory_id = ? AND is_deleted = 0`,
    [id],
  );
  return Number(r.c) || 0;
};

// ---------------------------------------------------------------------
//  GEO + LOOKUPS
// ---------------------------------------------------------------------
const listStates = async () => {
  const [rows] = await db.query(`SELECT id, state_name AS name FROM geo_states ORDER BY state_name ASC`);
  return rows;
};

const getState = async (id) => {
  const [rows] = await db.query(`SELECT id, state_name AS name FROM geo_states WHERE id = ?`, [id]);
  return rows[0] || null;
};

const statesExist = async (ids) => {
  if (!ids.length) return [];
  const [rows] = await db.query(`SELECT id FROM geo_states WHERE id IN (?)`, [ids]);
  return rows.map((r) => r.id);
};

// employees the caller may plan for (null = everybody)
const listEmployees = async ({ userIds, search }) => {
  const where = ["u.is_active = 1"];
  const params = [];
  if (userIds) {
    where.push("u.id IN (?)");
    params.push(userIds);
  }
  if (search) {
    where.push("u.name LIKE ?");
    params.push(`%${search}%`);
  }
  const [rows] = await db.query(
    `SELECT u.id, u.name, jr.name AS job_role, u.headquarter, u.reporting_under,
            m.name AS reporting_manager
     FROM users u
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     LEFT JOIN users m ON m.id = u.reporting_under
     WHERE ${where.join(" AND ")}
     ORDER BY u.name ASC
     LIMIT 500`,
    params,
  );
  return rows;
};

// Crop master (the existing `crops` table, also used by Product Demo)
const listCrops = async () => {
  const [rows] = await db.query(`SELECT id, crop_name FROM crops WHERE is_active = 1 ORDER BY crop_name ASC`);
  return rows.map((r) => ({ id: Number(r.id), name: r.crop_name }));
};

const getEmployee = async (id) => {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.is_active, u.reporting_under, u.approver_id, u.headquarter,
            u.state, u.date_of_joining, jr.name AS job_role, m.name AS reporting_manager
     FROM users u
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     LEFT JOIN users m ON m.id = u.reporting_under
     WHERE u.id = ?`,
    [id],
  );
  return rows[0] || null;
};

// Distributors = ledgers under "Sundry Debtors"
const listDistributors = async ({ userIds, search, page, limit }) => {
  const where = ["ag.group_name = ?"];
  const params = [DEBTOR_GROUP];
  if (userIds) {
    where.push("l.employee_under IN (?)");
    params.push(userIds);
  }
  if (search) {
    where.push("l.ledger_name LIKE ?");
    params.push(`%${search}%`);
  }
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const off = (Math.max(Number(page) || 1, 1) - 1) * lim;
  const [rows] = await db.query(
    `SELECT l.id AS ledger_id, l.ledger_name AS name, l.location, 'ACTIVE' AS status, l.credit_limit,
        l.employee_under, l.state_id, gd.district_name_english AS district,
        gs.state_name AS state,
            u.name AS employee_name
     FROM ledgers l
     INNER JOIN account_groups ag ON ag.id = l.group_id
     LEFT JOIN geo_districts gd ON gd.id = l.district_id
     LEFT JOIN geo_states gs ON gs.id = l.state_id
     LEFT JOIN users u ON u.id = l.employee_under
     WHERE ${where.join(" AND ")}
     ORDER BY l.ledger_name ASC
     LIMIT ? OFFSET ?`,
    [...params, lim, off],
  );
  return rows;
};

const getDistributorLedger = async (ledgerId) => {
  const [rows] = await db.query(
    `SELECT l.id AS ledger_id, l.ledger_name AS name, l.location, 'ACTIVE' AS status, l.credit_limit,
            l.employee_under, l.state_id, gd.district_name_english AS district,
            gs.state_name AS state,
            (SELECT c.contact_number FROM customers c
              WHERE c.type = 'distributor' AND c.distributor_ledger_id = l.id
              LIMIT 1) AS contact_number
     FROM ledgers l
     INNER JOIN account_groups ag ON ag.id = l.group_id AND ag.group_name = ?
     LEFT JOIN geo_districts gd ON gd.id = l.district_id
     LEFT JOIN geo_states gs ON gs.id = l.state_id
     WHERE l.id = ?`,
    [DEBTOR_GROUP, ledgerId],
  );
  return rows[0] || null;
};

const listRetailers = async ({ search, distributorLedgerId, page, limit }) => {
  const where = ["c.type = 'retailer'"];
  const params = [];
  if (search) {
    where.push("(c.name LIKE ? OR c.firm_name LIKE ? OR c.contact_number LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (distributorLedgerId) {
    where.push(
      "EXISTS (SELECT 1 FROM retailer_distributors rd WHERE rd.retailer_id = c.id AND rd.distributor_ledger_id = ?)",
    );
    params.push(distributorLedgerId);
  }
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const off = (Math.max(Number(page) || 1, 1) - 1) * lim;
  const [rows] = await db.query(
    `SELECT c.id, COALESCE(NULLIF(c.firm_name, ''), c.name) AS name, c.name AS owner_name,
            c.contact_number, c.area, c.district
     FROM customers c
     WHERE ${where.join(" AND ")}
     ORDER BY name ASC
     LIMIT ? OFFSET ?`,
    [...params, lim, off],
  );
  return rows;
};

const getRetailer = async (id) => {
  const [rows] = await db.query(
    `SELECT c.id, COALESCE(NULLIF(c.firm_name, ''), c.name) AS name, c.name AS owner_name,
            c.contact_number, c.area, c.district,
            (SELECT rd.distributor_ledger_id FROM retailer_distributors rd
              WHERE rd.retailer_id = c.id ORDER BY rd.distributor_ledger_id LIMIT 1) AS mapped_ledger_id
     FROM customers c
     WHERE c.id = ? AND c.type = 'retailer'`,
    [id],
  );
  return rows[0] || null;
};

// latest reported business of a retailer in an approved / closed plan
const getLastRetailerBusiness = async (retailerId) => {
  const [rows] = await db.query(
    `SELECT rl.reported_actual, p.plan_code, p.status
     FROM bp_retailer_lines rl
     INNER JOIN business_plans p ON p.id = rl.plan_id AND p.is_deleted = 0
     WHERE rl.retailer_id = ? AND p.status IN ('ACTIVE','CLOSED')
     ORDER BY p.end_date DESC LIMIT 1`,
    [retailerId],
  );
  return rows[0] || null;
};

const listProducts = async ({ search, page, limit }) => {
  const where = ["si.is_active = 1"];
  const params = [];
  if (search) {
    where.push("si.item_name LIKE ?");
    params.push(`%${search}%`);
  }
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = (Math.max(Number(page) || 1, 1) - 1) * lim;
  const [rows] = await db.query(
    `SELECT si.id, si.item_name AS name, sc.name AS category
     FROM stock_items si
     LEFT JOIN stock_categories sc ON sc.id = si.stock_category_id
     WHERE ${where.join(" AND ")}
     ORDER BY si.item_name ASC
     LIMIT ? OFFSET ?`,
    [...params, lim, off],
  );
  return rows;
};

const getProduct = async (id) => {
  const [rows] = await db.query(
    `SELECT si.id, si.item_name AS name, si.is_active, sc.name AS category
     FROM stock_items si
     LEFT JOIN stock_categories sc ON sc.id = si.stock_category_id
     WHERE si.id = ?`,
    [id],
  );
  return rows[0] || null;
};

const productsExist = async (ids) => {
  if (!ids.length) return [];
  const [rows] = await db.query(`SELECT id FROM stock_items WHERE id IN (?)`, [ids]);
  return rows.map((r) => r.id);
};

module.exports = {
  LIST_KEYS,
  DEFAULT_SETTINGS,
  DEBTOR_GROUP,
  listOptions,
  groupOptions,
  isActiveOption,
  getOption,
  addOption,
  updateOption,
  hideOption,
  countOptionUsage,
  getSettings,
  saveSettings,
  resetSettings,
  listTerritories,
  getTerritory,
  findTerritoryByName,
  validDistrictIds,
  countTerritoryUsage,
  listStates,
  getState,
  statesExist,
  listEmployees,
  getEmployee,
  listCrops,
  listDistributors,
  getDistributorLedger,
  listRetailers,
  getRetailer,
  getLastRetailerBusiness,
  listProducts,
  getProduct,
  productsExist,
};
