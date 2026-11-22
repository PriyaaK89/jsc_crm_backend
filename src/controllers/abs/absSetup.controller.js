// ABS setup: masters, settings, booking seasons (price list of products, production plan,
// schemes, minimum advance), season lifecycle, parties.
//
// Which products a booking season offers (no separate master):
//   1. Create Crop form      → the crop's season(s)           crop_season_map (crop_id, season)
//   2. Create Stock Item     → the product's crop             stock_items.crop_id
//   3. Booking season        → its crop season (Kharif / Rabi …). In the price list the user
//      picks a crop of that season and then only the stock items of that crop are listed.
//
// Season lifecycle
//   DRAFT      being set up (dates, minimum advance, price list, production plan, schemes)
//   OPEN       published. Field staff can book between booking_start and booking_end
//              (shown as "Scheduled" before the start and "Booking period over" after the end)
//   CLOSED     no new bookings; existing bookings go on to confirmation, payment and dispatch
//   COMPLETED  closed and every booking settled (delivered / closed / cancelled / rejected)
//   DRAFT ← OPEN / CLOSED only while the season has no booking; CLOSED → OPEN to re-open.
//
// Booking limits of a product (stock item) in a season
//   min_qty            smallest quantity one booking line may have (0 = none)
//   max_qty_per_party  most one party may book in the whole season (all its bookings)
//   production_qty     production plan: the most all parties together may book (NULL = no limit)
// A booking that would exceed a limit is refused when it is saved and again (under a lock)
// when it is submitted.
//
// Minimum advance of a booking = the higher of
//   booking value (before GST, after scheme discount) × minimum advance %   and
//   the season's minimum advance amount (₹ per booking),
// never more than the booking value. % blank = the default % in Booking policy.
const db = require("../../config/db");
const setup = require("../../models/abs/absSetup.model");
const C = require("../../models/crop-catalog/cropCatalog.model");
const { getHiddenGroupIdsForRequest } = require("../../utils/stockVisibility");
const bpSettings = require("../../models/business-plan/bpSettings.model");
const paymentModel = require("../../models/payment.model");
const salesModel = require("../../models/sales.model");
const { getCurrentLedgerBalance } = require("../../models/ledger.model");
const P = require("../../models/abs/absPayment.model");
const A = require("./absHelpers");

const { HttpError, wrap, ok } = A;

const SEASON_STATUSES = ["DRAFT", "OPEN", "CLOSED", "COMPLETED"];
const SCHEME_TYPES = ["EARLY_BOOKING", "QUANTITY_SLAB", "ADVANCE_PAYMENT"];
const EDITABLE_SEASON = ["DRAFT", "OPEN"]; // price list / plan can change
const r3 = (v) => Math.round(Number(v) * 1000) / 1000;
const fmt = (n) => A.fmtQty(n);

// ---------------------------------------------------------------- masters
// GET /abs/masters — everything the booking screens need in one call
const getMasters = wrap(async (req, res) => {
  const me = await A.meBlock(req);
  const office = me.can_view_all;
  const [settings, seasons, godowns, cropSeasons, accountLedgers, salesLedgers] = await Promise.all([
    setup.getSettings(),
    setup.listSeasons(),
    setup.listGodowns(),
    C.listSeasons(),
    me.can_verify_payment ? paymentModel.getPaymentAccountDropdown() : Promise.resolve([]),
    me.can_dispatch || me.can_manage_settings ? salesModel.getSalesLedgerDropdown() : Promise.resolve([]),
  ]);
  return ok(res, {
    me,
    settings,
    // field staff see seasons that are (or were) open; office also sees drafts
    seasons: office ? seasons : seasons.filter((s) => s.status !== "DRAFT"),
    open_seasons: seasons.filter((s) => s.accepting_bookings),
    crop_seasons: cropSeasons.map((s) => s.name),
    godowns,
    payment_modes: P.PAYMENT_MODES,
    account_ledgers: accountLedgers,
    sales_ledgers: salesLedgers,
    today: A.todayIST(),
  });
});

// ---------------------------------------------------------------- settings
const getSettings = wrap(async (req, res) => ok(res, await setup.getSettings()));

const bool = (v) => v === true || v === 1 || v === "1" || v === "true";

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
  if (b.require_booking_approval !== undefined) v.require_booking_approval = bool(b.require_booking_approval) ? 1 : 0;
  if (b.advance_at_booking !== undefined) v.advance_at_booking = bool(b.advance_at_booking) ? 1 : 0;
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
  await setup.log(db, { entity: "SETTINGS", action: "SAVED", detail: Object.entries(v).map(([k, x]) => `${k}=${x}`).join(", "), userId: req.user.id });
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
    delivery_start: A.date(b.delivery_start !== undefined ? b.delivery_start : existing?.delivery_start, "Delivery start"),
    delivery_end: A.date(b.delivery_end !== undefined ? b.delivery_end : existing?.delivery_end, "Delivery end"),
    min_advance_pct:
      b.min_advance_pct === "" || b.min_advance_pct === null
        ? null
        : A.money(b.min_advance_pct !== undefined ? b.min_advance_pct : existing?.min_advance_pct, "Minimum advance %") ?? null,
    // ₹ per booking; blank / 0 = no fixed minimum
    min_advance_amount:
      b.min_advance_amount === "" || b.min_advance_amount === null
        ? null
        : A.money(b.min_advance_amount !== undefined ? b.min_advance_amount : existing?.min_advance_amount, "Minimum advance amount") ?? null,
    remarks: A.text(b.remarks ?? existing?.remarks, "Remarks", { max: 500 }) || null,
  };
  if (!(await bpSettings.isActiveOption("SEASON", out.season))) throw new HttpError(400, `Crop season "${out.season}" is not in the season list (Crop Management → Crop seasons)`);
  if (out.booking_start > out.booking_end) throw new HttpError(400, "Booking start cannot be after booking end");
  if (out.delivery_start && out.delivery_end && out.delivery_start > out.delivery_end) throw new HttpError(400, "Delivery start cannot be after delivery end");
  if (out.delivery_end && out.delivery_end < out.booking_start) throw new HttpError(400, "Delivery cannot end before booking starts");
  if (out.min_advance_pct !== null && out.min_advance_pct > 100) throw new HttpError(400, "Minimum advance % must be 0 – 100");
  if (out.min_advance_amount !== null && out.min_advance_amount > 100000000) throw new HttpError(400, "Minimum advance amount is too large");
  if (out.min_advance_amount === 0) out.min_advance_amount = null;
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

// readiness of a season for opening: errors block, warnings inform
const checklist = async (s, { products } = {}) => {
  const [prods, settings] = await Promise.all([products || setup.listSeasonProducts(s.id), setup.getSettings()]);
  const errors = [];
  const warnings = [];
  const today = A.todayIST();
  if (!(await bpSettings.isActiveOption("SEASON", s.season))) errors.push(`Crop season "${s.season}" is switched off in the season list`);
  if (s.booking_end < today) errors.push(`The booking window ended on ${s.booking_end}; change the dates first`);
  const active = prods.filter((p) => p.is_active);
  if (!active.length) errors.push("Add at least one product with a booking rate to the price list");
  const wrongCrop = active.filter((p) => !p.crop_in_season);
  if (wrongCrop.length) {
    errors.push(`Not a product of a ${s.season} crop (check the crop of the stock item, or the season of its crop): ${wrongCrop.map((p) => `${p.item_name}${p.crop_name ? ` (${p.crop_name})` : " (no crop)"}`).join(", ")}`);
  }
  const inactiveItem = active.filter((p) => !p.item_active);
  if (inactiveItem.length) errors.push(`Inactive in the product master: ${inactiveItem.map((p) => p.item_name).join(", ")}`);
  const noPlan = active.filter((p) => p.production_qty === null);
  if (noPlan.length) warnings.push(`No production plan (bookings are not limited): ${noPlan.map((p) => p.item_name).join(", ")}`);
  if (s.min_advance_pct === null && !s.min_advance_amount) warnings.push(`Minimum advance: the default ${settings.min_advance_pct}% of Booking policy applies`);
  if (!settings.sales_ledger_id) warnings.push("Booking policy: the Sales ledger for dispatch invoices is not set (needed before the first dispatch)");
  if (s.booking_start > today) warnings.push(`Booking starts on ${s.booking_start}; until then the season shows as Scheduled`);
  return { ready: errors.length === 0, errors, warnings };
};

// crops shown for the season: active crops linked to its crop season, with how many of their
// products are already in the price list
const seasonCrops = async (s, products) => {
  const crops = await C.listCrops({ season: s.season });
  const inList = new Map();
  for (const p of products) if (p.crop_id) inList.set(p.crop_id, (inList.get(p.crop_id) || 0) + 1);
  return crops.map((c) => ({ crop_id: c.id, crop_name: c.crop_name, product_count: c.product_count, in_price_list: inList.get(c.id) || 0 }));
};

const seasonDetail = async (s, me) => {
  const manage = me.can_manage_settings;
  const [products, schemes] = await Promise.all([
    setup.listSeasonProducts(s.id, manage ? {} : { bookableOnly: true }),
    setup.listSchemes(s.id, { activeOnly: !manage }),
  ]);
  const out = { ...s, products, schemes };
  if (manage) {
    out.crops = await seasonCrops(s, products);
    out.checklist = await checklist(s, { products });
    out.log = await setup.listLog(s.id, 50);
  } else {
    // crops of the bookable products (the booking form groups products by crop)
    const seen = new Map();
    for (const p of products) if (p.crop_id && !seen.has(p.crop_id)) seen.set(p.crop_id, { crop_id: p.crop_id, crop_name: p.crop_name });
    out.crops = [...seen.values()];
  }
  return out;
};

const getSeason = wrap(async (req, res) => {
  const s = await loadSeason(req.params.id);
  const me = await A.meBlock(req);
  if (s.status === "DRAFT" && !me.can_view_all) throw new HttpError(404, "Booking season not found");
  return ok(res, await seasonDetail(s, me));
});

const getChecklist = wrap(async (req, res) => ok(res, await checklist(await loadSeason(req.params.id))));

const createSeason = wrap(async (req, res) => {
  const data = await readSeason(req.body || {});
  let id;
  try {
    id = await setup.createSeason(data, req.user.id);
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") throw new HttpError(409, "A season with this name already exists");
    throw err;
  }
  return ok(res, await seasonDetail(await setup.getSeason(id), await A.meBlock(req)), `Booking season created as Draft. Add ${data.season} products with rates in the price list, then Open it.`, 201);
});

const updateSeason = wrap(async (req, res) => {
  const s = await loadSeason(req.params.id);
  if (s.status === "COMPLETED") throw new HttpError(409, "A completed season cannot be changed");
  const data = await readSeason(req.body || {}, s);
  if (data.season !== s.season && (s.product_count || s.booking_count)) {
    throw new HttpError(409, "The crop season cannot change once products are in the price list; create a new booking season instead");
  }
  try {
    await setup.updateSeason(s.id, data, req.user.id);
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") throw new HttpError(409, "A season with this name already exists");
    throw err;
  }
  // the minimum advance of draft bookings follows the new rule when they are next saved / submitted
  return ok(res, await seasonDetail(await setup.getSeason(s.id), await A.meBlock(req)), "Booking season saved");
});

// POST /abs/seasons/:id/status { status: OPEN | CLOSED | DRAFT | COMPLETED }
const setSeasonStatus = wrap(async (req, res) => {
  const s = await loadSeason(req.params.id);
  const status = A.oneOf((req.body || {}).status, "status", SEASON_STATUSES);
  if (!status) throw new HttpError(400, "status is required");
  if (status === s.status) throw new HttpError(409, `The season is already ${s.status.toLowerCase()}`);
  let allowedFrom;
  if (status === "OPEN") {
    allowedFrom = ["DRAFT", "CLOSED"];
    const c = await checklist(s);
    if (!c.ready) throw new HttpError(400, `The season cannot be opened yet: ${c.errors.join("; ")}`, { checklist: c });
  } else if (status === "CLOSED") {
    allowedFrom = ["OPEN"];
  } else if (status === "DRAFT") {
    allowedFrom = ["OPEN", "CLOSED"];
    if (s.booking_count) throw new HttpError(409, "This season already has bookings; close it instead");
  } else {
    allowedFrom = ["CLOSED"];
    if (s.open_booking_count) throw new HttpError(409, `${s.open_booking_count} booking(s) are still in progress; finish, close or cancel them first`);
  }
  if (!allowedFrom.includes(s.status)) {
    const hint = status === "COMPLETED" ? "Close the season first" : status === "CLOSED" ? "Only an open season can be closed" : "";
    throw new HttpError(409, `A ${s.status.toLowerCase()} season cannot be moved to ${status.toLowerCase()}${hint ? `. ${hint}` : ""}`);
  }
  const r = await setup.setSeasonStatus(s.id, status, req.user.id, { allowedFrom });
  if (!r.ok) throw new HttpError(409, "The season changed meanwhile; please refresh");
  const fresh = await setup.getSeason(s.id);
  const message = {
    OPEN: fresh.display_status === "SCHEDULED" ? `Season published — bookings open on ${fresh.booking_start}` : "Season opened for booking",
    CLOSED: "Season closed: no new bookings. Existing bookings carry on to dispatch.",
    DRAFT: "Season moved back to draft",
    COMPLETED: "Season completed",
  }[status];
  return ok(res, await seasonDetail(fresh, await A.meBlock(req)), message);
});

// ---------------------------------------------------------------- price list (products)
// PUT /abs/seasons/:id/products { products: [{ stock_item_id, booking_rate, mrp, min_qty,
//   max_qty_per_party, production_qty (production plan), is_active }] }
// Only stock items whose crop is linked to the season's crop season are accepted.
const saveSeasonProducts = wrap(async (req, res) => {
  const s = await loadSeason(req.params.id);
  if (!EDITABLE_SEASON.includes(s.status) && s.status !== "CLOSED") throw new HttpError(409, "A completed season cannot be changed");
  const list = (req.body || {}).products;
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, "products must be a non-empty list");
  if (list.length > 500) throw new HttpError(400, "Too many products in one save");
  const ids = list.map((p, i) => A.toId(p && p.stock_item_id, `Row ${i + 1}: product`));
  if (new Set(ids).size !== ids.length) {
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    throw new HttpError(400, `A product is listed twice (stock item ${dup})`);
  }
  const info = await setup.stockItemInfo(ids);
  const missing = ids.filter((id) => !info.has(id));
  if (missing.length) throw new HttpError(400, `Product not found in the product master: ${missing.join(", ")}`);
  const existing = new Map((await setup.listSeasonProducts(s.id)).map((p) => [p.stock_item_id, p]));

  const rows = list.map((p, i) => {
    const id = ids[i];
    const it = info.get(id);
    const L = it.item_name;
    const before = existing.get(id);
    const isActive = p.is_active === undefined ? true : bool(p.is_active);
    // a product can join (or stay switched on in) the price list only when it belongs to a crop
    // of this crop season; a row already in the list may still be switched off
    if (isActive || !before) {
      if (!it.crop_id) throw new HttpError(400, `${L}: no crop is set on this stock item (Inventory → Stock Item → Crop)`);
      if (!it.seasons.includes(s.season)) {
        throw new HttpError(400, `${L}: its crop ${it.crop_name || ""} is not a ${s.season} crop (Crop Management → edit the crop → Season)`);
      }
      if (!it.is_active && !before) throw new HttpError(400, `${L}: this stock item is inactive in the product master`);
    }
    const r = {
      stock_item_id: id,
      booking_rate: A.money(p.booking_rate, `${L}: booking rate`, { required: true, positive: true }),
      mrp: A.money(p.mrp, `${L}: MRP`) ?? null,
      min_qty: A.qty(p.min_qty, `${L}: minimum qty per booking`) ?? 0,
      max_qty_per_party: A.qty(p.max_qty_per_party, `${L}: maximum qty per party`) ?? null,
      production_qty: A.qty(p.production_qty ?? p.max_total_qty, `${L}: production plan qty`) ?? null,
      is_active: isActive,
    };
    if (r.max_qty_per_party === 0) r.max_qty_per_party = null;
    if (r.production_qty === 0) r.production_qty = null;
    if (r.mrp !== null && r.mrp > 0 && r.booking_rate > r.mrp) throw new HttpError(400, `${L}: booking rate (${r.booking_rate}) cannot be more than MRP (${r.mrp})`);
    if (r.max_qty_per_party !== null && r.max_qty_per_party < r.min_qty) {
      throw new HttpError(400, `${L}: maximum per party (${fmt(r.max_qty_per_party)}) cannot be less than the minimum per booking (${fmt(r.min_qty)}). Raise the maximum or lower the minimum — or leave the maximum empty for no limit.`);
    }
    if (r.production_qty !== null) {
      if (r.production_qty < r.min_qty) throw new HttpError(400, `${L}: production plan (${fmt(r.production_qty)}) cannot be less than the minimum per booking (${fmt(r.min_qty)})`);
      if (r.max_qty_per_party !== null && r.production_qty < r.max_qty_per_party) {
        throw new HttpError(400, `${L}: production plan (${fmt(r.production_qty)}) cannot be less than the maximum per party (${fmt(r.max_qty_per_party)})`);
      }
      if (before && before.booked_qty > r.production_qty) {
        throw new HttpError(400, `${L}: production plan cannot be lower than the ${fmt(before.booked_qty)} already booked`);
      }
    }
    return r;
  });
  await setup.upsertSeasonProducts(s.id, rows, req.user.id);
  return ok(res, await seasonDetail(await setup.getSeason(s.id), await A.meBlock(req)), "Booking price list saved");
});

// DELETE /abs/seasons/:id/products/:stockItemId — only when no booking uses it
const deleteSeasonProduct = wrap(async (req, res) => {
  const s = await loadSeason(req.params.id);
  const id = A.toId(req.params.stockItemId, "product");
  const p = await setup.getSeasonProduct(s.id, id);
  if (!p) throw new HttpError(404, "This product is not in the price list");
  const lines = await setup.productBookingLines(s.id, id);
  if (lines) throw new HttpError(409, `${p.item_name} is used in ${lines} booking line(s); switch it off instead`);
  await setup.deleteSeasonProduct(s.id, id, req.user.id, p.item_name);
  return ok(res, await seasonDetail(await setup.getSeason(s.id), await A.meBlock(req)), `${p.item_name} removed from the price list`);
});

// GET /abs/seasons/:id/crops — crops of the season's crop season (price-list crop dropdown)
const getSeasonCropList = wrap(async (req, res) => {
  const s = await loadSeason(req.params.id);
  const products = await setup.listSeasonProducts(s.id);
  return ok(res, { season_id: s.id, crop_season: s.season, crops: await seasonCrops(s, products) });
});

// GET /abs/seasons/:id/crop-products?crop_id=&search= — stock items of the crop (crop must be
// in the season's crop season), marked when already in the price list
const getSeasonCropProducts = wrap(async (req, res) => {
  const s = await loadSeason(req.params.id);
  const cropId = A.toId(req.query.crop_id, "crop");
  const crop = await C.getCrop(cropId);
  if (!crop) throw new HttpError(404, "Crop not found");
  if (!crop.seasons.includes(s.season)) {
    throw new HttpError(400, `${crop.crop_name} is not a ${s.season} crop. Set its season in Crop Management first.`);
  }
  const hiddenGroupIds = await getHiddenGroupIdsForRequest(req);
  const items = await C.productsForCropSeason({ cropId, season: s.season, search: A.text(req.query.search, "search", { max: 100 }), hiddenGroupIds });
  const inList = new Map((await setup.listSeasonProducts(s.id)).map((p) => [p.stock_item_id, p]));
  return ok(res, {
    crop: { crop_id: crop.id, crop_name: crop.crop_name },
    products: items.map((it) => ({ ...it, in_price_list: inList.has(it.stock_item_id) })),
  });
});

// ---------------------------------------------------------------- schemes
const readScheme = (b) => {
  const out = {
    name: A.text(b.name, "Scheme name", { required: true, max: 120 }),
    scheme_type: A.oneOf(b.scheme_type, "Scheme type", SCHEME_TYPES),
    stock_item_id: A.optId(b.stock_item_id, "product"),
    valid_from: A.date(b.valid_from, "Valid from"),
    valid_till: A.date(b.valid_till, "Valid till"),
    min_qty: A.qty(b.min_qty, "Minimum qty") ?? 0,
    min_advance_pct: A.money(b.min_advance_pct, "Minimum advance %") ?? 0,
    discount_type: A.oneOf(b.discount_type || "PER_UNIT", "Discount type", ["PERCENT", "PER_UNIT"]),
    discount_value: A.money(b.discount_value, "Discount", { required: true, positive: true }),
    is_active: b.is_active === undefined ? 1 : bool(b.is_active) ? 1 : 0,
  };
  if (!out.scheme_type) throw new HttpError(400, "Scheme type is required");
  if (out.discount_type === "PERCENT" && out.discount_value > 100) throw new HttpError(400, "Discount % must be 100 or less");
  if (out.valid_from && out.valid_till && out.valid_from > out.valid_till) throw new HttpError(400, "Valid from cannot be after valid till");
  if (out.scheme_type === "EARLY_BOOKING" && !out.valid_till) throw new HttpError(400, "Early booking scheme needs the last booking date (Booked on or before)");
  if (out.scheme_type === "QUANTITY_SLAB" && !(out.min_qty > 0)) throw new HttpError(400, "Quantity slab scheme needs the quantity from which it applies");
  if (out.scheme_type === "ADVANCE_PAYMENT" && (!(out.min_advance_pct > 0) || !out.valid_till)) throw new HttpError(400, "Advance payment scheme needs the advance % and the date by which it must be paid");
  if (out.min_advance_pct > 100) throw new HttpError(400, "Minimum advance % must be 0 – 100");
  if (out.scheme_type !== "QUANTITY_SLAB") out.min_qty = 0;
  if (out.scheme_type !== "ADVANCE_PAYMENT") out.min_advance_pct = 0;
  return out;
};

const checkSchemeScope = async (s, data) => {
  if (data.stock_item_id && !(await setup.getSeasonProduct(s.id, data.stock_item_id))) throw new HttpError(400, "That product is not in this season's price list");
};

const createScheme = wrap(async (req, res) => {
  const s = await loadSeason(req.params.id);
  if (s.status === "COMPLETED") throw new HttpError(409, "A completed season cannot be changed");
  const data = readScheme(req.body || {});
  await checkSchemeScope(s, data);
  const id = await setup.createScheme(s.id, data, req.user.id);
  return ok(res, await setup.getScheme(id), "Scheme added", 201);
});

const updateScheme = wrap(async (req, res) => {
  const sc = await setup.getScheme(A.toId(req.params.schemeId, "scheme id"));
  if (!sc || sc.season_id !== Number(req.params.id)) throw new HttpError(404, "Scheme not found");
  const s = await loadSeason(req.params.id);
  if (s.status === "COMPLETED") throw new HttpError(409, "A completed season cannot be changed");
  const data = readScheme({ ...sc, ...(req.body || {}) });
  await checkSchemeScope(s, data);
  await setup.updateScheme(sc.id, data, req.user.id, s.id);
  return ok(res, await setup.getScheme(sc.id), "Scheme saved");
});

const deleteScheme = wrap(async (req, res) => {
  const sc = await setup.getScheme(A.toId(req.params.schemeId, "scheme id"));
  if (!sc || sc.season_id !== Number(req.params.id)) throw new HttpError(404, "Scheme not found");
  await setup.deleteScheme(sc.id, req.user.id, sc.season_id);
  return ok(res, { id: sc.id }, "Scheme switched off (bookings already made keep their discount)");
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
  getChecklist,
  createSeason,
  updateSeason,
  setSeasonStatus,
  saveSeasonProducts,
  deleteSeasonProduct,
  getSeasonCropList,
  getSeasonCropProducts,
  createScheme,
  updateScheme,
  deleteScheme,
  listParties,
  getPartySummary,
  r3,
};
