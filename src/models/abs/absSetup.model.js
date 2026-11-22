// ABS masters: settings, booking seasons (price list of products, production plan, schemes,
// minimum advance), set-up audit log and lookups.
//
// Products of a booking season: stock items of crops grown in the season's crop season —
//   stock_items.crop_id = crop   and   crop_season_map (crop_id, season) has the season
// (crop season chosen on the Create Crop form, crop chosen on the Create Stock Item form).
//
// Quantity held by bookings ("booked"): every line of a booking that is submitted or later
// (not Draft / Rejected / Cancelled), at the quantity the company will supply:
//   COALESCE(confirmed_qty, qty) - cancelled_qty
// It goes up when a booking is submitted, and down when a booking is rejected, cancelled,
// confirmed for less (short supply) or a line is short-closed.
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
  advance_at_booking: "1",
};

const HELD_STATUSES_SQL = "b.status NOT IN ('DRAFT','REJECTED','CANCELLED')";
const HELD_QTY_SQL = "(COALESCE(bi.confirmed_qty, bi.qty) - bi.cancelled_qty)";

const num = (v) => Number(v) || 0;
const numOrNull = (v) => (v === null || v === undefined ? null : num(v));
const r3 = (v) => Math.round(Number(v) * 1000) / 1000;

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
    // 1 = the minimum advance is collected with the booking (before submit / confirmation)
    advance_at_booking: String(raw.advance_at_booking) !== "0",
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

// ---------------------------------------------------------------- set-up audit log
const log = async (runner, { seasonId = null, entity, entityId = null, action, detail = null, userId = null }) => {
  try {
    await (runner || db).query(
      `INSERT INTO abs_setup_log (season_id, entity, entity_id, action, detail, user_id) VALUES (?, ?, ?, ?, ?, ?)`,
      [seasonId, entity, entityId, action, detail ? String(detail).slice(0, 1000) : null, userId],
    );
  } catch (err) {
    console.error("ABS SETUP LOG ERROR:", err.message);
  }
};

const listLog = async (seasonId, limit = 100) => {
  const [rows] = await db.query(
    `SELECT l.id, l.entity, l.entity_id, l.action, l.detail, l.user_id, u.name AS user_name,
            DATE_FORMAT(l.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM abs_setup_log l LEFT JOIN users u ON u.id = l.user_id
     WHERE l.season_id = ? ORDER BY l.id DESC LIMIT ?`,
    [seasonId, limit],
  );
  return rows;
};

// ---------------------------------------------------------------- seasons
const SEASON_SELECT = `
  SELECT s.id, s.name, s.season, s.financial_year,
         DATE_FORMAT(s.booking_start, '%Y-%m-%d') AS booking_start,
         DATE_FORMAT(s.booking_end, '%Y-%m-%d') AS booking_end,
         DATE_FORMAT(s.delivery_start, '%Y-%m-%d') AS delivery_start,
         DATE_FORMAT(s.delivery_end, '%Y-%m-%d') AS delivery_end,
         s.min_advance_pct, s.min_advance_amount, s.status, s.remarks,
         s.opened_by, uo.name AS opened_by_name, DATE_FORMAT(s.opened_at, '%Y-%m-%d %H:%i:%s') AS opened_at,
         s.closed_by, uc.name AS closed_by_name, DATE_FORMAT(s.closed_at, '%Y-%m-%d %H:%i:%s') AS closed_at,
         DATE_FORMAT(s.completed_at, '%Y-%m-%d %H:%i:%s') AS completed_at,
         (SELECT COUNT(*) FROM abs_season_products sp WHERE sp.season_id = s.id AND sp.is_active = 1) AS product_count,
         (SELECT COUNT(DISTINCT si.crop_id) FROM abs_season_products sp
            INNER JOIN stock_items si ON si.id = sp.stock_item_id WHERE sp.season_id = s.id) AS crop_count,
         (SELECT COUNT(*) FROM abs_bookings b WHERE b.season_id = s.id AND b.is_deleted = 0) AS booking_count,
         (SELECT COUNT(*) FROM abs_bookings b WHERE b.season_id = s.id AND b.is_deleted = 0
            AND b.status NOT IN ('REJECTED','CANCELLED','CLOSED')) AS open_booking_count
  FROM abs_seasons s
  LEFT JOIN users uo ON uo.id = s.opened_by
  LEFT JOIN users uc ON uc.id = s.closed_by`;

// what the users see: an OPEN season before its booking window is "Scheduled", after it
// "Booking period over" (no new bookings; the office closes it)
const displayStatus = (s, today) => {
  if (s.status !== "OPEN" || !today) return s.status;
  if (today < s.booking_start) return "SCHEDULED";
  if (today > s.booking_end) return "BOOKING_OVER";
  return "OPEN";
};
const DISPLAY_LABEL = {
  DRAFT: "Draft (setting up)",
  SCHEDULED: "Scheduled (opens on the booking start date)",
  OPEN: "Open for booking",
  BOOKING_OVER: "Booking period over",
  CLOSED: "Closed (no new bookings)",
  COMPLETED: "Completed",
};

const shapeSeason = (r, today) => {
  const out = {
    ...r,
    min_advance_pct: numOrNull(r.min_advance_pct),
    min_advance_amount: numOrNull(r.min_advance_amount),
    product_count: num(r.product_count),
    crop_count: num(r.crop_count),
    booking_count: num(r.booking_count),
    open_booking_count: num(r.open_booking_count),
  };
  out.display_status = displayStatus(out, today);
  out.display_label = DISPLAY_LABEL[out.display_status] || out.status;
  out.accepting_bookings = out.display_status === "OPEN";
  return out;
};

const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

const listSeasons = async ({ status } = {}) => {
  const [rows] = await db.query(
    `${SEASON_SELECT} ${status ? "WHERE s.status = ?" : ""} ORDER BY s.booking_start DESC, s.id DESC`,
    status ? [status] : [],
  );
  const today = todayIST();
  return rows.map((r) => shapeSeason(r, today));
};

const getSeason = async (id, runner = db) => {
  const [rows] = await runner.query(`${SEASON_SELECT} WHERE s.id = ?`, [id]);
  return rows[0] ? shapeSeason(rows[0], todayIST()) : null;
};

const SEASON_COLS = ["name", "season", "financial_year", "booking_start", "booking_end", "delivery_start", "delivery_end", "min_advance_pct", "min_advance_amount", "remarks"];

const createSeason = async (data, userId) => {
  const [res] = await db.query(
    `INSERT INTO abs_seasons (${SEASON_COLS.join(", ")}, status, created_by) VALUES (${SEASON_COLS.map(() => "?").join(", ")}, 'DRAFT', ?)`,
    [...SEASON_COLS.map((c) => (data[c] === undefined ? null : data[c])), userId],
  );
  await log(db, { seasonId: res.insertId, entity: "SEASON", entityId: res.insertId, action: "CREATED", detail: `${data.name} (${data.season})`, userId });
  return res.insertId;
};

const updateSeason = async (id, data, userId) => {
  await db.query(
    `UPDATE abs_seasons SET ${SEASON_COLS.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
    [...SEASON_COLS.map((c) => (data[c] === undefined ? null : data[c])), id],
  );
  await log(db, { seasonId: id, entity: "SEASON", entityId: id, action: "EDITED", detail: `${data.name}: booking ${data.booking_start} – ${data.booking_end}, min advance ${data.min_advance_pct ?? "default"}% / ₹${data.min_advance_amount ?? 0}`, userId });
};

// status change with a row lock: { ok, from } or { ok: false, current }
const setSeasonStatus = async (id, status, userId, { allowedFrom }) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(`SELECT id, status FROM abs_seasons WHERE id = ? FOR UPDATE`, [id]);
    if (!row || (allowedFrom && !allowedFrom.includes(row.status))) {
      await conn.rollback();
      return { ok: false, current: row ? row.status : null };
    }
    const sets = ["status = ?"];
    const params = [status];
    if (status === "OPEN") {
      sets.push("opened_by = ?", "opened_at = NOW()");
      params.push(userId);
    }
    if (status === "CLOSED") {
      sets.push("closed_by = ?", "closed_at = NOW()");
      params.push(userId);
    }
    if (status === "COMPLETED") sets.push("completed_at = NOW()");
    await conn.query(`UPDATE abs_seasons SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    await log(conn, { seasonId: id, entity: "SEASON", entityId: id, action: `STATUS_${status}`, detail: `${row.status} → ${status}`, userId });
    await conn.commit();
    return { ok: true, from: row.status };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ---------------------------------------------------------------- price list (products)
// crop_in_season = the product's crop (stock_items.crop_id) is linked to the season's crop
// season; a product whose crop was changed afterwards is not bookable until it is fixed
const ITEM_COLS = `si.item_name, si.unit_id, u.symbol AS unit, si.rate_of_duty AS gst_percent,
         si.crop_id, cr.crop_name, sg.name AS group_name, si.is_active AS item_active,
         CASE WHEN EXISTS (SELECT 1 FROM crop_season_map m WHERE m.crop_id = si.crop_id AND m.season = ss.season)
              THEN 1 ELSE 0 END AS crop_in_season`;
const ITEM_JOINS = `
  INNER JOIN abs_seasons ss ON ss.id = sp.season_id
  LEFT JOIN units u ON u.id = si.unit_id
  LEFT JOIN crops cr ON cr.id = si.crop_id
  LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id`;

const shapeProduct = (r) => {
  const out = {
    id: num(r.id),
    season_id: num(r.season_id),
    stock_item_id: num(r.stock_item_id),
    item_name: r.item_name,
    unit_id: numOrNull(r.unit_id),
    unit: r.unit || null,
    crop_id: numOrNull(r.crop_id),
    crop_name: r.crop_name || null,
    group_name: r.group_name || null,
    booking_rate: num(r.booking_rate),
    mrp: numOrNull(r.mrp),
    min_qty: num(r.min_qty),
    max_qty_per_party: numOrNull(r.max_qty_per_party),
    // production plan of the product for the season (all parties together); NULL = no limit
    production_qty: numOrNull(r.production_qty),
    gst_percent: num(r.gst_percent),
    is_active: Number(r.is_active) === 1,
    item_active: r.item_active === null || r.item_active === undefined ? true : Number(r.item_active) === 1,
    crop_in_season: Number(r.crop_in_season) === 1,
    booked_qty: r3(num(r.booked_qty)),
  };
  out.available_qty = out.production_qty === null ? null : Math.max(r3(out.production_qty - out.booked_qty), 0);
  out.booked_pct = out.production_qty ? Math.round((out.booked_qty / out.production_qty) * 1000) / 10 : null;
  // what field staff can book: switched on here, active in the product master, crop in season
  out.bookable = out.is_active && out.item_active && out.crop_in_season;
  return out;
};

const BOOKED_QTY_SUB = `(SELECT COALESCE(SUM(${HELD_QTY_SQL}), 0)
     FROM abs_booking_items bi INNER JOIN abs_bookings b ON b.id = bi.booking_id
     WHERE b.season_id = sp.season_id AND bi.stock_item_id = sp.stock_item_id AND b.is_deleted = 0
       AND ${HELD_STATUSES_SQL})`;

// bookableOnly: rows field staff may book (see shapeProduct.bookable)
const listSeasonProducts = async (seasonId, { activeOnly = false, bookableOnly = false } = {}) => {
  const [rows] = await db.query(
    `SELECT sp.id, sp.season_id, sp.stock_item_id, sp.booking_rate, sp.mrp, sp.min_qty,
            sp.max_qty_per_party, sp.production_qty, sp.is_active, ${ITEM_COLS},
            ${BOOKED_QTY_SUB} AS booked_qty
     FROM abs_season_products sp
     INNER JOIN stock_items si ON si.id = sp.stock_item_id
     ${ITEM_JOINS}
     WHERE sp.season_id = ? ${activeOnly || bookableOnly ? "AND sp.is_active = 1" : ""}
     ORDER BY cr.crop_name ASC, si.item_name ASC`,
    [seasonId],
  );
  const out = rows.map(shapeProduct);
  return bookableOnly ? out.filter((p) => p.bookable) : out;
};

const getSeasonProduct = async (seasonId, stockItemId) => {
  const [rows] = await db.query(
    `SELECT sp.id, sp.season_id, sp.stock_item_id, sp.booking_rate, sp.mrp, sp.min_qty,
            sp.max_qty_per_party, sp.production_qty, sp.is_active, ${ITEM_COLS}, ${BOOKED_QTY_SUB} AS booked_qty
     FROM abs_season_products sp INNER JOIN stock_items si ON si.id = sp.stock_item_id ${ITEM_JOINS}
     WHERE sp.season_id = ? AND sp.stock_item_id = ?`,
    [seasonId, stockItemId],
  );
  return rows[0] ? shapeProduct(rows[0]) : null;
};

// rows: [{ stock_item_id, booking_rate, mrp, min_qty, max_qty_per_party, production_qty, is_active }]
const upsertSeasonProducts = async (seasonId, rows, userId) => {
  if (!rows.length) return;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO abs_season_products
         (season_id, stock_item_id, booking_rate, mrp, min_qty, max_qty_per_party, production_qty, is_active)
       VALUES ?
       ON DUPLICATE KEY UPDATE booking_rate = VALUES(booking_rate), mrp = VALUES(mrp), min_qty = VALUES(min_qty),
         max_qty_per_party = VALUES(max_qty_per_party), production_qty = VALUES(production_qty), is_active = VALUES(is_active)`,
      [rows.map((r) => [seasonId, r.stock_item_id, r.booking_rate, r.mrp, r.min_qty, r.max_qty_per_party, r.production_qty, r.is_active ? 1 : 0])],
    );
    await log(conn, {
      seasonId,
      entity: "PRICE_LIST",
      action: "SAVED",
      detail: rows.map((r) => `#${r.stock_item_id} ₹${r.booking_rate} min ${r.min_qty} max/party ${r.max_qty_per_party ?? "-"} plan ${r.production_qty ?? "-"}${r.is_active ? "" : " (off)"}`).join("; "),
      userId,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// a row can be removed only when no booking (not even a draft) uses it
const productBookingLines = async (seasonId, stockItemId) => {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM abs_booking_items bi INNER JOIN abs_bookings b ON b.id = bi.booking_id
     WHERE b.season_id = ? AND bi.stock_item_id = ? AND b.is_deleted = 0`,
    [seasonId, stockItemId],
  );
  return num(r.n);
};

const deleteSeasonProduct = async (seasonId, stockItemId, userId, itemName) => {
  await db.query(`DELETE FROM abs_season_products WHERE season_id = ? AND stock_item_id = ?`, [seasonId, stockItemId]);
  await log(db, { seasonId, entity: "PRICE_LIST", entityId: stockItemId, action: "REMOVED", detail: itemName, userId });
};

const stockItemsExist = async (ids) => {
  if (!ids.length) return [];
  const [rows] = await db.query(`SELECT id FROM stock_items WHERE id IN (?)`, [ids]);
  return rows.map((r) => Number(r.id));
};

// stock_item_id -> { item_name, crop_id, crop_name, is_active, seasons: [...] (of its crop) }
const stockItemInfo = async (ids) => {
  const out = new Map();
  if (!ids.length) return out;
  const [rows] = await db.query(
    `SELECT si.id, si.item_name, si.crop_id, si.is_active, c.crop_name
     FROM stock_items si LEFT JOIN crops c ON c.id = si.crop_id WHERE si.id IN (?)`,
    [ids],
  );
  const cropIds = [...new Set(rows.map((r) => r.crop_id).filter((c) => c !== null && c !== undefined).map(Number))];
  const seasons = new Map();
  if (cropIds.length) {
    const [maps] = await db.query(`SELECT crop_id, season FROM crop_season_map WHERE crop_id IN (?)`, [cropIds]);
    for (const m of maps) {
      if (!seasons.has(num(m.crop_id))) seasons.set(num(m.crop_id), []);
      seasons.get(num(m.crop_id)).push(m.season);
    }
  }
  for (const r of rows) {
    out.set(num(r.id), {
      item_name: r.item_name,
      crop_id: numOrNull(r.crop_id),
      crop_name: r.crop_name || null,
      is_active: r.is_active === null || r.is_active === undefined ? true : num(r.is_active) === 1,
      seasons: r.crop_id ? seasons.get(num(r.crop_id)) || [] : [],
    });
  }
  return out;
};

// ---------------------------------------------------------------- production plan (capacity)
// Capacity check under row locks (inside the caller's transaction): the season's price-list
// rows of the booked products are locked, then what other bookings hold is summed.
// lines: [{ stock_item_id, qty }] of the booking being saved / submitted.
// -> [] when it fits, else [{ kind: 'PRODUCT', name, unit, limit, held, requested, available }]
const capacityProblems = async (conn, seasonId, bookingId, lines) => {
  if (!lines.length) return [];
  const itemIds = [...new Set(lines.map((l) => Number(l.stock_item_id)))];
  // lock only the season's price-list rows (not the product master)
  const [rowsLocked] = await conn.query(
    `SELECT stock_item_id, production_qty FROM abs_season_products
     WHERE season_id = ? AND stock_item_id IN (?) FOR UPDATE`,
    [seasonId, itemIds],
  );
  const [names] = await conn.query(
    `SELECT si.id, si.item_name, u.symbol AS unit FROM stock_items si LEFT JOIN units u ON u.id = si.unit_id WHERE si.id IN (?)`,
    [itemIds],
  );
  const nameOf = new Map(names.map((x) => [num(x.id), x]));
  const byItem = new Map(rowsLocked.map((p) => [num(p.stock_item_id), p]));
  const requested = new Map();
  for (const l of lines) requested.set(Number(l.stock_item_id), r3((requested.get(Number(l.stock_item_id)) || 0) + num(l.qty)));
  const problems = [];
  for (const [itemId, qty] of requested) {
    const p = byItem.get(itemId);
    if (!p || p.production_qty === null || p.production_qty === undefined) continue;
    const [[h]] = await conn.query(
      `SELECT COALESCE(SUM(${HELD_QTY_SQL}), 0) AS q FROM abs_booking_items bi INNER JOIN abs_bookings b ON b.id = bi.booking_id
       WHERE b.season_id = ? AND bi.stock_item_id = ? AND b.id <> ? AND b.is_deleted = 0 AND ${HELD_STATUSES_SQL}`,
      [seasonId, itemId, bookingId || 0],
    );
    const held = r3(num(h.q));
    const limit = num(p.production_qty);
    if (r3(held + qty) > limit) {
      const n = nameOf.get(itemId) || {};
      problems.push({ kind: "PRODUCT", stock_item_id: itemId, name: n.item_name || `#${itemId}`, unit: n.unit || "units", limit, held, requested: qty, available: Math.max(r3(limit - held), 0) });
    }
  }
  return problems;
};

// ---------------------------------------------------------------- minimum advance
// Minimum advance of a booking (see advanceRequired):
//   pct        season's minimum advance %, else the default % in Booking policy
//   min_amount season's minimum advance amount (₹ per booking; 0 = none)
const advanceRule = async (seasonId, runner = db) => {
  const [[s]] = await runner.query(`SELECT min_advance_pct, min_advance_amount FROM abs_seasons WHERE id = ?`, [seasonId]);
  const settings = await getSettings();
  const pct = s && s.min_advance_pct !== null && s.min_advance_pct !== undefined ? num(s.min_advance_pct) : settings.min_advance_pct;
  const minAmount = s && s.min_advance_amount !== null && s.min_advance_amount !== undefined ? num(s.min_advance_amount) : 0;
  return { pct, min_amount: minAmount };
};

// required = the higher of (value × %) and the minimum amount, never more than the booking value
// (value = Σ qty × (rate − scheme discount), before GST)
const advanceRequired = (lines, rule) => {
  const value = lines.reduce((s, l) => s + num(l.qty) * (num(l.rate) - num(l.discount_per_unit)), 0);
  if (value <= 0) return 0;
  const byPct = (value * num(rule.pct)) / 100;
  const req = Math.min(value, Math.max(byPct, num(rule.min_amount)));
  return Math.round(req * 100) / 100;
};

// ---------------------------------------------------------------- schemes
const SCHEME_SELECT = `
  SELECT sc.id, sc.season_id, sc.name, sc.scheme_type, sc.stock_item_id, si.item_name,
         DATE_FORMAT(sc.valid_from, '%Y-%m-%d') AS valid_from,
         DATE_FORMAT(sc.valid_till, '%Y-%m-%d') AS valid_till,
         sc.min_qty, sc.min_advance_pct, sc.discount_type, sc.discount_value, sc.is_active
  FROM abs_schemes sc
  LEFT JOIN stock_items si ON si.id = sc.stock_item_id`;

const shapeScheme = (r) => ({
  ...r,
  stock_item_id: numOrNull(r.stock_item_id),
  min_qty: num(r.min_qty),
  min_advance_pct: num(r.min_advance_pct),
  discount_value: num(r.discount_value),
  is_active: Number(r.is_active) === 1,
});

const listSchemes = async (seasonId, { activeOnly = false } = {}) => {
  const [rows] = await db.query(
    `${SCHEME_SELECT} WHERE sc.season_id = ? ${activeOnly ? "AND sc.is_active = 1" : ""} ORDER BY sc.scheme_type, sc.min_qty, sc.id`,
    [seasonId],
  );
  return rows.map(shapeScheme);
};

const SCHEME_COLS = ["name", "scheme_type", "stock_item_id", "valid_from", "valid_till", "min_qty", "min_advance_pct", "discount_type", "discount_value", "is_active"];

const createScheme = async (seasonId, data, userId) => {
  const [res] = await db.query(
    `INSERT INTO abs_schemes (season_id, ${SCHEME_COLS.join(", ")}, created_by) VALUES (?, ${SCHEME_COLS.map(() => "?").join(", ")}, ?)`,
    [seasonId, ...SCHEME_COLS.map((c) => (data[c] === undefined ? null : data[c])), userId],
  );
  await log(db, { seasonId, entity: "SCHEME", entityId: res.insertId, action: "CREATED", detail: `${data.name} (${data.scheme_type}, ${data.discount_value}${data.discount_type === "PERCENT" ? "%" : " ₹/unit"})`, userId });
  return res.insertId;
};

const updateScheme = async (id, data, userId, seasonId) => {
  await db.query(`UPDATE abs_schemes SET ${SCHEME_COLS.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...SCHEME_COLS.map((c) => (data[c] === undefined ? null : data[c])), id]);
  await log(db, { seasonId, entity: "SCHEME", entityId: id, action: "EDITED", detail: `${data.name} (${data.scheme_type}, ${data.discount_value}${data.discount_type === "PERCENT" ? "%" : " ₹/unit"})${data.is_active ? "" : " off"}`, userId });
};

const getScheme = async (id) => {
  const [rows] = await db.query(`${SCHEME_SELECT} WHERE sc.id = ?`, [id]);
  return rows[0] ? shapeScheme(rows[0]) : null;
};

const deleteScheme = async (id, userId, seasonId) => {
  await db.query(`UPDATE abs_schemes SET is_active = 0 WHERE id = ?`, [id]);
  await log(db, { seasonId, entity: "SCHEME", entityId: id, action: "SWITCHED_OFF", userId });
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
  HELD_STATUSES_SQL,
  HELD_QTY_SQL,
  DISPLAY_LABEL,
  getSettings,
  saveSettings,
  log,
  listLog,
  listSeasons,
  getSeason,
  createSeason,
  updateSeason,
  setSeasonStatus,
  listSeasonProducts,
  getSeasonProduct,
  upsertSeasonProducts,
  productBookingLines,
  deleteSeasonProduct,
  stockItemsExist,
  stockItemInfo,
  capacityProblems,
  advanceRule,
  advanceRequired,
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
