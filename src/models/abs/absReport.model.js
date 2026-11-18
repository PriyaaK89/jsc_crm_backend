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

// demand vs production plan vs supply per variety
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

module.exports = { statusSummary, totals, varieties, employees, parties };
