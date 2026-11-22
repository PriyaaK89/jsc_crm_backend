// ABS dashboard and reports (one season; scoped to the user's team unless userIds = null).
const db = require("../../config/db");

const num = (v) => Number(v) || 0;
const LIVE = "b.status NOT IN ('DRAFT','REJECTED','CANCELLED')";

const scopeSql = (userIds) =>
  userIds ? { sql: " AND (b.booked_by IN (?) OR pl.employee_under IN (?))", params: [userIds.length ? userIds : [0], userIds.length ? userIds : [0]] } : { sql: "", params: [] };

const FROM = `FROM abs_bookings b LEFT JOIN ledgers pl ON pl.id = b.party_ledger_id`;

const statusSummary = async (seasonId, userIds) => {
  const sc = scopeSql(userIds);
  const [rows] = await db.query(
    `SELECT b.status, COUNT(*) AS bookings, COALESCE(SUM(b.net_value), 0) AS value
     ${FROM} WHERE b.is_deleted = 0 AND b.season_id = ?${sc.sql} GROUP BY b.status`,
    [seasonId, ...sc.params],
  );
  return rows.map((r) => ({ status: r.status, bookings: num(r.bookings), value: num(r.value) }));
};

const totals = async (seasonId, userIds, today) => {
  const sc = scopeSql(userIds);
  const [[t]] = await db.query(
    `SELECT COUNT(*) AS bookings,
            COUNT(DISTINCT b.party_ledger_id) AS parties,
            COALESCE(SUM(b.net_value), 0) AS booking_value,
            COALESCE(SUM(b.advance_required), 0) AS advance_required,
            COALESCE(SUM((SELECT COALESCE(SUM(p.amount), 0) FROM abs_payments p WHERE p.booking_id = b.id AND p.status = 'POSTED')), 0) AS advance_received,
            COALESCE(SUM((SELECT COALESCE(SUM(p.amount), 0) FROM abs_payments p WHERE p.booking_id = b.id AND p.status = 'PENDING_VERIFICATION')), 0) AS advance_pending_verification,
            COALESCE(SUM((SELECT COALESCE(SUM(d.invoice_amount), 0) FROM abs_dispatches d WHERE d.booking_id = b.id)), 0) AS invoiced_value,
            SUM(CASE WHEN b.status = 'SUBMITTED' THEN 1 ELSE 0 END) AS pending_approval,
            SUM(CASE WHEN b.status = 'APPROVED' THEN 1 ELSE 0 END) AS awaiting_confirmation,
            SUM(CASE WHEN b.status IN ('CONFIRMED','PARTIALLY_DISPATCHED') AND b.advance_due_date < ?
                      AND b.advance_required > (SELECT COALESCE(SUM(p.amount), 0) FROM abs_payments p WHERE p.booking_id = b.id AND p.status = 'POSTED')
                     THEN 1 ELSE 0 END) AS advance_overdue,
            SUM(CASE WHEN b.status IN ('CONFIRMED','PARTIALLY_DISPATCHED') AND EXISTS (SELECT 1 FROM abs_booking_items bi
                      WHERE bi.booking_id = b.id AND COALESCE(bi.confirmed_qty, bi.qty) - bi.cancelled_qty > bi.allocated_qty) THEN 1 ELSE 0 END) AS to_allocate,
            SUM(CASE WHEN b.status IN ('CONFIRMED','PARTIALLY_DISPATCHED') AND EXISTS (SELECT 1 FROM abs_booking_items bi
                      WHERE bi.booking_id = b.id AND bi.allocated_qty > bi.dispatched_qty) THEN 1 ELSE 0 END) AS ready_to_dispatch
     ${FROM} WHERE b.is_deleted = 0 AND b.season_id = ? AND ${LIVE}${sc.sql}`,
    [today, seasonId, ...sc.params],
  );
  const [[d]] = await db.query(
    `SELECT SUM(CASE WHEN d.status = 'IN_TRANSIT' THEN 1 ELSE 0 END) AS in_transit,
            SUM(CASE WHEN d.status = 'DELIVERED_WITH_ISSUES' THEN 1 ELSE 0 END) AS delivery_issues
     FROM abs_dispatches d INNER JOIN abs_bookings b ON b.id = d.booking_id LEFT JOIN ledgers pl ON pl.id = b.party_ledger_id
     WHERE b.season_id = ?${sc.sql}`,
    [seasonId, ...sc.params],
  );
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS c, COALESCE(SUM(r.amount), 0) AS amount FROM abs_refunds r
     INNER JOIN abs_bookings b ON b.id = r.booking_id LEFT JOIN ledgers pl ON pl.id = b.party_ledger_id
     WHERE r.status = 'DUE' AND b.season_id = ?${sc.sql}`,
    [seasonId, ...sc.params],
  );
  const out = {};
  for (const [k, v] of Object.entries({ ...t, ...d })) out[k] = num(v);
  out.refunds_due = num(r && r.c);
  out.refunds_due_amount = num(r && r.amount);
  out.collection_pct = out.booking_value > 0 ? Math.round((out.advance_received / out.booking_value) * 1000) / 10 : 0;
  return out;
};

// demand vs production plan vs supply per product (stock item)
const varieties = async (seasonId, userIds) => {
  const sc = scopeSql(userIds);
  const [rows] = await db.query(
    `SELECT bi.stock_item_id, si.item_name, cr.crop_name, u.symbol AS unit,
            COUNT(DISTINCT b.id) AS bookings,
            COALESCE(SUM(bi.qty), 0) AS booked_qty,
            COALESCE(SUM(COALESCE(bi.confirmed_qty, bi.qty) - bi.cancelled_qty), 0) AS supply_qty,
            COALESCE(SUM(bi.allocated_qty), 0) AS allocated_qty,
            COALESCE(SUM(bi.dispatched_qty), 0) AS dispatched_qty,
            COALESCE(SUM(bi.delivered_qty), 0) AS delivered_qty,
            COALESCE(SUM(bi.qty * (bi.rate - bi.discount_per_unit)), 0) AS booking_value,
            (SELECT sp.production_qty FROM abs_season_products sp WHERE sp.season_id = b.season_id AND sp.stock_item_id = bi.stock_item_id LIMIT 1) AS production_qty
     FROM abs_booking_items bi
     INNER JOIN abs_bookings b ON b.id = bi.booking_id
     LEFT JOIN ledgers pl ON pl.id = b.party_ledger_id
     LEFT JOIN stock_items si ON si.id = bi.stock_item_id
     LEFT JOIN crops cr ON cr.id = si.crop_id
     LEFT JOIN units u ON u.id = si.unit_id
     WHERE b.is_deleted = 0 AND b.season_id = ? AND ${LIVE}${sc.sql}
     GROUP BY bi.stock_item_id, si.item_name, cr.crop_name, u.symbol, b.season_id
     ORDER BY booked_qty DESC`,
    [seasonId, ...sc.params],
  );
  return rows.map((r) => {
    const out = { ...r };
    for (const k of ["bookings", "booked_qty", "supply_qty", "allocated_qty", "dispatched_qty", "delivered_qty", "booking_value"]) out[k] = num(r[k]);
    out.production_qty = r.production_qty === null || r.production_qty === undefined ? null : num(r.production_qty);
    out.demand_gap = out.production_qty === null ? null : Math.round((out.production_qty - out.supply_qty) * 1000) / 1000;
    return out;
  });
};

const employees = async (seasonId, userIds) => {
  const sc = scopeSql(userIds);
  const [rows] = await db.query(
    `SELECT b.booked_by, u.name AS employee_name, COUNT(*) AS bookings, COUNT(DISTINCT b.party_ledger_id) AS parties,
            COALESCE(SUM(b.net_value), 0) AS booking_value,
            COALESCE(SUM((SELECT COALESCE(SUM(p.amount), 0) FROM abs_payments p WHERE p.booking_id = b.id AND p.status = 'POSTED')), 0) AS advance_received
     ${FROM} LEFT JOIN users u ON u.id = b.booked_by
     WHERE b.is_deleted = 0 AND b.season_id = ? AND ${LIVE}${sc.sql}
     GROUP BY b.booked_by, u.name ORDER BY booking_value DESC`,
    [seasonId, ...sc.params],
  );
  return rows.map((r) => ({ ...r, bookings: num(r.bookings), parties: num(r.parties), booking_value: num(r.booking_value), advance_received: num(r.advance_received) }));
};

const parties = async (seasonId, userIds, limit = 50) => {
  const sc = scopeSql(userIds);
  const [rows] = await db.query(
    `SELECT b.party_ledger_id, pl.ledger_name AS party_name, pl.location, COUNT(*) AS bookings,
            COALESCE(SUM(b.net_value), 0) AS booking_value,
            COALESCE(SUM((SELECT COALESCE(SUM(p.amount), 0) FROM abs_payments p WHERE p.booking_id = b.id AND p.status = 'POSTED')), 0) AS advance_received,
            COALESCE(SUM((SELECT COALESCE(SUM(d.invoice_amount), 0) FROM abs_dispatches d WHERE d.booking_id = b.id)), 0) AS invoiced_value
     ${FROM}
     WHERE b.is_deleted = 0 AND b.season_id = ? AND ${LIVE}${sc.sql}
     GROUP BY b.party_ledger_id, pl.ledger_name, pl.location ORDER BY booking_value DESC LIMIT ?`,
    [seasonId, ...sc.params, limit],
  );
  return rows.map((r) => ({ ...r, bookings: num(r.bookings), booking_value: num(r.booking_value), advance_received: num(r.advance_received), invoiced_value: num(r.invoiced_value) }));
};

// production plan vs bookings per product of the season price list (company-wide), by crop.
// booked = submitted and later bookings at the quantity to be supplied (as the capacity check)
const plan = async (seasonId) => {
  const [rows] = await db.query(
    `SELECT sp.stock_item_id, si.item_name, si.crop_id, c.crop_name, u.symbol AS unit, sp.production_qty, sp.is_active,
            COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN COALESCE(bi.confirmed_qty, bi.qty) - bi.cancelled_qty ELSE 0 END), 0) AS held_qty,
            COALESCE(SUM(CASE WHEN b.id IS NOT NULL AND b.status NOT IN ('SUBMITTED','RETURNED','APPROVED')
                              THEN COALESCE(bi.confirmed_qty, bi.qty) - bi.cancelled_qty ELSE 0 END), 0) AS confirmed_qty,
            COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN bi.allocated_qty ELSE 0 END), 0) AS allocated_qty,
            COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN bi.dispatched_qty ELSE 0 END), 0) AS dispatched_qty,
            COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN bi.delivered_qty ELSE 0 END), 0) AS delivered_qty,
            COUNT(DISTINCT b.id) AS bookings
     FROM abs_season_products sp
     INNER JOIN stock_items si ON si.id = sp.stock_item_id
     LEFT JOIN crops c ON c.id = si.crop_id
     LEFT JOIN units u ON u.id = si.unit_id
     LEFT JOIN abs_booking_items bi ON bi.stock_item_id = sp.stock_item_id
       AND bi.booking_id IN (SELECT b2.id FROM abs_bookings b2 WHERE b2.season_id = sp.season_id)
     LEFT JOIN abs_bookings b ON b.id = bi.booking_id AND b.is_deleted = 0 AND ${LIVE}
     WHERE sp.season_id = ?
     GROUP BY sp.stock_item_id, si.item_name, si.crop_id, c.crop_name, u.symbol, sp.production_qty, sp.is_active
     ORDER BY c.crop_name ASC, si.item_name ASC`,
    [seasonId],
  );
  return rows.map((r) => {
    const out = { ...r };
    for (const k of ["held_qty", "confirmed_qty", "allocated_qty", "dispatched_qty", "delivered_qty", "bookings"]) out[k] = Math.round(num(r[k]) * 1000) / 1000;
    out.stock_item_id = num(r.stock_item_id);
    out.crop_id = r.crop_id === null || r.crop_id === undefined ? null : num(r.crop_id);
    out.production_qty = r.production_qty === null || r.production_qty === undefined ? null : num(r.production_qty);
    out.is_active = num(r.is_active) === 1;
    out.available_qty = out.production_qty === null ? null : Math.max(Math.round((out.production_qty - out.held_qty) * 1000) / 1000, 0);
    out.booked_pct = out.production_qty ? Math.round((out.held_qty / out.production_qty) * 1000) / 10 : null;
    return out;
  });
};

// bookings with money still to collect: minimum advance short, or invoices more than the advance
const pendingPayments = async (seasonId, userIds, today) => {
  const sc = scopeSql(userIds);
  const [rows] = await db.query(
    `SELECT b.id, b.booking_no, b.status, b.party_ledger_id, pl.ledger_name AS party_name, pl.location,
            b.booked_by, u.name AS booked_by_name, b.net_value, b.advance_required,
            DATE_FORMAT(b.advance_due_date, '%Y-%m-%d') AS advance_due_date,
            (SELECT COALESCE(SUM(p.amount), 0) FROM abs_payments p WHERE p.booking_id = b.id AND p.status = 'POSTED') AS advance_received,
            (SELECT COALESCE(SUM(p.amount), 0) FROM abs_payments p WHERE p.booking_id = b.id AND p.status = 'PENDING_VERIFICATION') AS pending_verification,
            (SELECT COALESCE(SUM(d.invoice_amount), 0) FROM abs_dispatches d WHERE d.booking_id = b.id) AS invoiced_value,
            (SELECT COALESCE(SUM(a.amount), 0) FROM abs_advance_adjustments a WHERE a.booking_id = b.id) AS advance_adjusted
     ${FROM} LEFT JOIN users u ON u.id = b.booked_by
     WHERE b.is_deleted = 0 AND b.season_id = ? AND b.status NOT IN ('DRAFT','REJECTED','CANCELLED')${sc.sql}
     ORDER BY b.advance_due_date IS NULL, b.advance_due_date ASC, b.id ASC`,
    [seasonId, ...sc.params],
  );
  const out = [];
  for (const r of rows) {
    const x = { ...r };
    for (const k of ["net_value", "advance_required", "advance_received", "pending_verification", "invoiced_value", "advance_adjusted"]) x[k] = num(r[k]);
    x.advance_shortfall = Math.max(Math.round((x.advance_required - x.advance_received) * 100) / 100, 0);
    // invoiced but not covered by the adjusted advance = billed amount the party still owes
    x.invoice_balance = Math.max(Math.round((x.invoiced_value - x.advance_adjusted) * 100) / 100, 0);
    x.overdue_days = x.advance_shortfall > 0 && x.advance_due_date && today && x.advance_due_date < today
      ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${x.advance_due_date}T00:00:00Z`)) / 86400000)
      : 0;
    if (x.advance_shortfall > 0 || x.invoice_balance > 0 || x.pending_verification > 0) out.push(x);
  }
  return out;
};

module.exports = { statusSummary, totals, varieties, employees, parties, plan, pendingPayments };
