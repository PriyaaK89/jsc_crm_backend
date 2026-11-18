// ABS setup: masters, settings, booking seasons, booking price list, schemes, parties.
const db = require("../../config/db");
const setup = require("../../models/abs/absSetup.model");
const bpSettings = require("../../models/business-plan/bpSettings.model");
const paymentModel = require("../../models/payment.model");
const salesModel = require("../../models/sales.model");
const { getCurrentLedgerBalance } = require("../../models/ledger.model");
const P = require("../../models/abs/absPayment.model");
const A = require("./absHelpers");

const { HttpError, wrap, ok } = A;

const SEASON_STATUSES = ["DRAFT", "OPEN", "CLOSED"];
const SCHEME_TYPES = ["EARLY_BOOKING", "QUANTITY_SLAB", "ADVANCE_PAYMENT"];

// ---------------------------------------------------------------- masters
// GET /abs/masters — everything the booking screens need in one call
const getMasters = wrap(async (req, res) => {
  const me = await A.meBlock(req);
  const office = me.can_view_all;
  const [settings, seasons, godowns, options, accountLedgers, salesLedgers] = await Promise.all([
    setup.getSettings(),
    setup.listSeasons(),
    setup.listGodowns(),
    bpSettings.listOptions(),
    me.can_verify_payment ? paymentModel.getPaymentAccountDropdown() : Promise.resolve([]),
    me.can_dispatch || me.can_manage_settings ? salesModel.getSalesLedgerDropdown() : Promise.resolve([]),
  ]);
  const today = A.todayIST();
  return ok(res, {
    me,
    settings,
    // field staff see seasons that are (or were) open; office also sees drafts
    seasons: office ? seasons : seasons.filter((s) => s.status !== "DRAFT"),
    open_seasons: seasons.filter((s) => s.status === "OPEN" && s.booking_start <= today && s.booking_end >= today),
    crop_seasons: bpSettings.groupOptions(options).SEASON.map((o) => o.value),
    godowns,
    payment_modes: P.PAYMENT_MODES,
    account_ledgers: accountLedgers,
    sales_ledgers: salesLedgers,
    today,
  });
});

// ---------------------------------------------------------------- settings
const getSettings = wrap(async (req, res) => ok(res, await setup.getSettings()));

const updateSettings = wrap(async (req, res) => {
  const b = req.body || {};
  const v = {};
  const pct = (val, label) => {
    const n = A.money(val, label);
    if (n !== undefined && n > 100) throw new HttpError(400, `${label} must be between 0 and 100`);
    return n;
  };
  if (b.min_advance_pct !== undefined) v.min_advance_pct = pct(b.min_advance_pct, "Minimum advance %");
  if (b.advance_due_days !== undefined) {
    const n = Number(b.advance_due_days);
    if (!Number.isInteger(n) || n < 0 || n > 365) throw new HttpError(400, "Advance due days must be 0 – 365");
    v.advance_due_days = n;
  }
  if (b.require_booking_approval !== undefined) v.require_booking_approval = b.require_booking_approval === true || b.require_booking_approval === 1 || b.require_booking_approval === "1" ? 1 : 0;
  if (b.dispatch_payment_rule !== undefined) v.dispatch_payment_rule = A.oneOf(b.dispatch_payment_rule, "Dispatch payment rule", ["CREDIT_LIMIT", "MIN_PERCENT", "FULL_PAYMENT"]);
  if (b.dispatch_min_paid_pct !== undefined) v.dispatch_min_paid_pct = pct(b.dispatch_min_paid_pct, "Paid % before dispatch");
  if (b.allocation_priority !== undefined) v.allocation_priority = A.oneOf(b.allocation_priority, "Allocation priority", ["ADVANCE_FIRST", "BOOKING_DATE"]);
  if (b.sales_ledger_id !== undefined) {
    const id = A.optId(b.sales_ledger_id, "sales ledger");
    if (id) {
      const list = await salesModel.getSalesLedgerDropdown();
      if (!list.some((l) => Number(l.id) === id)) throw new HttpError(400, "Select a ledger under Sales Account");
    }
    v.sales_ledger_id = id;
  }
  if (b.booking_prefix !== undefined) {
    const p = A.text(b.booking_prefix, "Booking number prefix", { required: true, max: 10 }).toUpperCase();
    if (!/^[A-Z0-9]+$/.test(p)) throw new HttpError(400, "Booking number prefix: letters and digits only");
    v.booking_prefix = p;
  }
  if (b.cancellation_refund_rule !== undefined) v.cancellation_refund_rule = A.oneOf(b.cancellation_refund_rule, "Cancellation rule", ["REFUND", "CARRY_FORWARD"]);
  if (b.company_state_code !== undefined) {
    const s = String(b.company_state_code || "").trim();
    if (s && !/^\d{1,2}$/.test(s)) throw new HttpError(400, "Company state code must be the 2-digit GST state code");
    v.company_state_code = s ? s.padStart(2, "0") : null;
  }
  if (!Object.keys(v).length) throw new HttpError(400, "Nothing to update");
  await setup.saveSettings(v, req.user.id);
  return ok(res, await setup.getSettings(), "Settings saved");
});

// ---------------------------------------------------------------- seasons
const readSeason = async (b, existing) => {
  const out = {
    name: A.text(b.name ?? existing?.name, "Season name", { required: true, max: 100 }),
    season: A.text(b.season ?? existing?.season, "Crop season", { required: true, max: 30 }),
    financial_year: A.text(b.financial_year ?? existing?.financial_year, "Financial year", { max: 20 }) || null,
    booking_start: A.date(b.booking_start ?? existing?.booking_start, "Booking start", { required: true }),
    booking_end: A.date(b.booking_end ?? existing?.booking_end, "Booking end", { required: true }),
    delivery_start: A.date(b.delivery_start ?? existing?.delivery_start, "Delivery start"),
    delivery_end: A.date(b.delivery_end ?? existing?.delivery_end, "Delivery end"),
    min_advance_pct: b.min_advance_pct === "" || b.min_advance_pct === null ? null : A.money(b.min_advance_pct ?? existing?.min_advance_pct, "Minimum advance %") ?? null,
    remarks: A.text(b.remarks ?? existing?.remarks, "Remarks", { max: 500 }) || null,
  };
  if (!(await bpSettings.isActiveOption("SEASON", out.season))) throw new HttpError(400, "Crop season must be one of the seasons in Business Plan Settings (Kharif, Rabi, Zaid)");
  if (out.booking_start > out.booking_end) throw new HttpError(400, "Booking start cannot be after booking end");
  if (out.delivery_start && out.delivery_end && out.delivery_start > out.delivery_end) throw new HttpError(400, "Delivery start cannot be after delivery end");
  if (out.min_advance_pct !== null && out.min_advance_pct > 100) throw new HttpError(400, "Minimum advance % must be 0 – 100");
  return out;
};

const listSeasons = wrap(async (req, res) => {
  const me = await A.meBlock(req);
  const all = await setup.listSeasons();
  return ok(res, me.can_view_all ? all : all.filter((s) => s.status !== "DRAFT"));
});

const loadSeason = async (id) => {
  const s = await setup.getSeason(A.toId(id, "season id"));
  if (!s) throw new HttpError(404, "Booking season not found");
  return s;
};

const getSeason = wrap(async (req, res) => {
  const s = await loadSeason(req.params.id);
  const me = await A.meBlock(req);
  if (s.status === "DRAFT" && !me.can_view_all) throw new HttpError(404, "Booking season not found");
  const [products, schemes] = await Promise.all([setup.listSeasonProducts(s.id, { activeOnly: !me.can_manage_settings }), setup.listSchemes(s.id, { activeOnly: !me.can_manage_settings })]);
  return ok(res, { ...s, products, schemes });
});

const createSeason = wrap(async (req, res) => {
  const data = await readSeason(req.body || {});
  try {
    const id = await setup.createSeason(data, req.user.id);
    return ok(res, await setup.getSeason(id), "Booking season created", 201);
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") throw new HttpError(409, "A season with this name already exists");
    throw err;
  }
});

const updateSeason = wrap(async (req, res) => {
  const s = await loadSeason(req.params.id);
  const data = await readSeason(req.body || {}, s);
  try {
    await setup.updateSeason(s.id, data);
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") throw new HttpError(409, "A season with this name already exists");
    throw err;
  }
  return ok(res, await setup.getSeason(s.id), "Booking season saved");
});

// POST /abs/seasons/:id/status { status: OPEN | CLOSED | DRAFT }
const setSeasonStatus = wrap(async (req, res) => {
  const s = await loadSeason(req.params.id);
  const status = A.oneOf((req.body || {}).status, "status", SEASON_STATUSES);
  if (!status) throw new HttpError(400, "status is required");
  if (status === "OPEN" && !s.product_count) throw new HttpError(400, "Add at least one variety with a booking price before opening the season");
  if (status === "DRAFT" && s.booking_count) throw new HttpError(409, "This season already has bookings; close it instead");
  await setup.setSeasonStatus(s.id, status);
  return ok(res, await setup.getSeason(s.id), status === "OPEN" ? "Booking season opened" : status === "CLOSED" ? "Booking season closed" : "Season moved to draft");
});

// PUT /abs/seasons/:id/products { products: [{ stock_item_id, booking_rate, mrp, min_qty, max_qty_per_party, production_qty, is_active }] }
const saveSeasonProducts = wrap(async (req, res) => {
  const s = await loadSeason(req.params.id);
  const list = (req.body || {}).products;
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, "products must be a non-empty list");
  if (list.length > 500) throw new HttpError(400, "Too many products in one save");
  const rows = list.map((p, i) => {
    const label = `Row ${i + 1}`;
    const r = {
      stock_item_id: A.toId(p.stock_item_id, `${label}: variety`),
      booking_rate: A.money(p.booking_rate, `${label}: booking rate`, { required: true, positive: true }),
      mrp: A.money(p.mrp, `${label}: MRP`) ?? null,
      min_qty: A.qty(p.min_qty, `${label}: minimum qty`) ?? 0,
      max_qty_per_party: A.qty(p.max_qty_per_party, `${label}: max qty per party`) ?? null,
      production_qty: A.qty(p.production_qty, `${label}: production plan qty`) ?? null,
      is_active: p.is_active === undefined ? true : p.is_active === true || p.is_active === 1 || p.is_active === "1",
    };
    if (r.mrp !== null && r.mrp > 0 && r.booking_rate > r.mrp) throw new HttpError(400, `${label}: booking rate cannot be more than MRP`);
    if (r.max_qty_per_party !== null && r.max_qty_per_party > 0 && r.max_qty_per_party < r.min_qty) throw new HttpError(400, `${label}: max qty per party is below the minimum qty`);
    return r;
  });
  const ids = [...new Set(rows.map((r) => r.stock_item_id))];
  if (ids.length !== rows.length) throw new HttpError(400, "A variety is listed twice");
  const found = await setup.stockItemsExist(ids);
  const missing = ids.filter((id) => !found.includes(id));
  if (missing.length) throw new HttpError(400, `Stock item not found: ${missing.join(", ")}`);
  await setup.upsertSeasonProducts(s.id, rows);
  return ok(res, await setup.listSeasonProducts(s.id), "Booking price list saved");
});

// ---------------------------------------------------------------- schemes
const readScheme = (b) => {
  const out = {
    name: A.text(b.name, "Scheme name", { required: true, max: 120 }),
    scheme_type: A.oneOf(b.scheme_type, "Scheme type", SCHEME_TYPES),
    stock_item_id: A.optId(b.stock_item_id, "variety"),
    valid_from: A.date(b.valid_from, "Valid from"),
    valid_till: A.date(b.valid_till, "Valid till"),
    min_qty: A.qty(b.min_qty, "Minimum qty") ?? 0,
    min_advance_pct: A.money(b.min_advance_pct, "Minimum advance %") ?? 0,
    discount_type: A.oneOf(b.discount_type || "PER_UNIT", "Discount type", ["PERCENT", "PER_UNIT"]),
    discount_value: A.money(b.discount_value, "Discount", { required: true, positive: true }),
    is_active: b.is_active === undefined ? 1 : b.is_active === true || b.is_active === 1 || b.is_active === "1" ? 1 : 0,
  };
  if (!out.scheme_type) throw new HttpError(400, "Scheme type is required");
  if (out.discount_type === "PERCENT" && out.discount_value > 100) throw new HttpError(400, "Discount % must be 100 or less");
  if (out.valid_from && out.valid_till && out.valid_from > out.valid_till) throw new HttpError(400, "Valid from cannot be after valid till");
  if (out.scheme_type === "EARLY_BOOKING" && !out.valid_till) throw new HttpError(400, "Early booking scheme needs the last booking date (valid till)");
  if (out.scheme_type === "QUANTITY_SLAB" && !(out.min_qty > 0)) throw new HttpError(400, "Quantity slab scheme needs a minimum quantity");
  if (out.scheme_type === "ADVANCE_PAYMENT" && (!(out.min_advance_pct > 0) || !out.valid_till)) throw new HttpError(400, "Advance payment scheme needs the advance % and the date by which it must be paid");
  if (out.min_advance_pct > 100) throw new HttpError(400, "Minimum advance % must be 0 – 100");
  return out;
};

const createScheme = wrap(async (req, res) => {
  const s = await loadSeason(req.params.id);
  const data = readScheme(req.body || {});
  if (data.stock_item_id && !(await setup.getSeasonProduct(s.id, data.stock_item_id))) throw new HttpError(400, "That variety is not in this season's booking price list");
  const id = await setup.createScheme(s.id, data, req.user.id);
  return ok(res, await setup.getScheme(id), "Scheme added", 201);
});

const updateScheme = wrap(async (req, res) => {
  const sc = await setup.getScheme(A.toId(req.params.schemeId, "scheme id"));
  if (!sc || sc.season_id !== Number(req.params.id)) throw new HttpError(404, "Scheme not found");
  const data = readScheme({ ...sc, ...(req.body || {}) });
  await setup.updateScheme(sc.id, data);
  return ok(res, await setup.getScheme(sc.id), "Scheme saved");
});

const deleteScheme = wrap(async (req, res) => {
  const sc = await setup.getScheme(A.toId(req.params.schemeId, "scheme id"));
  if (!sc || sc.season_id !== Number(req.params.id)) throw new HttpError(404, "Scheme not found");
  await setup.deleteScheme(sc.id);
  return ok(res, { id: sc.id }, "Scheme switched off");
});

// ---------------------------------------------------------------- parties
// GET /abs/parties?search — distributors / dealers this user may book for
const listParties = wrap(async (req, res) => {
  const scope = await A.scopeIds(req);
  const rows = await bpSettings.listDistributors({ userIds: scope, search: A.text(req.query.search, "search", { max: 100 }), page: req.query.page, limit: req.query.limit || 50 });
  return ok(res, rows);
});

// GET /abs/parties/:ledgerId — balance, credit limit, overdue bills, open bookings
const getPartySummary = wrap(async (req, res) => {
  const id = A.toId(req.params.ledgerId, "party");
  const party = await setup.getParty(id);
  if (!party) throw new HttpError(404, "Party not found (a ledger under Sundry Debtors)");
  const scope = await A.scopeIds(req);
  if (scope !== null && !(party.employee_under && A.canSeeUser(scope, party.employee_under))) {
    throw new HttpError(403, "This party is not in your area");
  }
  const conn = await db.getConnection();
  try {
    const balance = await getCurrentLedgerBalance(conn, id);
    const overdue = await salesModel.checkOverdueBills(conn, id, A.todayIST());
    const [[open]] = await conn.query(
      `SELECT COUNT(*) AS c, COALESCE(SUM(net_value), 0) AS v FROM abs_bookings
       WHERE party_ledger_id = ? AND is_deleted = 0 AND status NOT IN ('DRAFT','REJECTED','CANCELLED','CLOSED','DELIVERED')`,
      [id],
    );
    return ok(res, {
      ...party,
      balance: Math.round(Number(balance) * 100) / 100, // + = party owes us (Dr), - = party in credit (Cr)
      balance_type: Number(balance) >= 0 ? "Dr" : "Cr",
      overdue_bills: overdue,
      overdue_amount: Math.round(overdue.reduce((s, b) => s + Number(b.pending_amount || 0), 0) * 100) / 100,
      open_bookings: Number(open.c) || 0,
      open_booking_value: Number(open.v) || 0,
    });
  } finally {
    conn.release();
  }
});

module.exports = {
  getMasters,
  getSettings,
  updateSettings,
  listSeasons,
  getSeason,
  createSeason,
  updateSeason,
  setSeasonStatus,
  saveSeasonProducts,
  createScheme,
  updateScheme,
  deleteScheme,
  listParties,
  getPartySummary,
};
