// ABS dispatches (one Sales invoice each) and delivery confirmation.
const db = require("../../config/db");

const num = (v) => Number(v) || 0;

const STATUS_LABEL = { IN_TRANSIT: "In Transit", DELIVERED: "Delivered", DELIVERED_WITH_ISSUES: "Delivered — Short / Damaged" };

const DISPATCH_SELECT = `
  SELECT d.id, d.dispatch_no, d.booking_id, b.booking_no, b.party_ledger_id, l.ledger_name AS party_name,
         b.booked_by, ub.name AS booked_by_name,
         DATE_FORMAT(d.dispatch_date, '%Y-%m-%d') AS dispatch_date, d.godown_id, g.godown_name,
         d.sale_id, d.invoice_no, d.vehicle_no, d.transport_name, d.driver_name, d.driver_mobile, d.lr_no,
         d.eway_number, d.transport_freight, d.destination, d.tax_mode, d.total_qty, d.taxable_value,
         d.scheme_discount, d.tax_total, d.invoice_amount, d.advance_adjusted, d.status,
         d.dispatched_by, ud.name AS dispatched_by_name,
         DATE_FORMAT(d.delivered_on, '%Y-%m-%d') AS delivered_on, d.received_by_name, d.pod_image, d.delivery_remarks,
         d.delivery_confirmed_by, uc.name AS delivery_confirmed_by_name,
         DATE_FORMAT(d.delivery_confirmed_at, '%Y-%m-%d %H:%i:%s') AS delivery_confirmed_at,
         d.remarks, DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
  FROM abs_dispatches d
  LEFT JOIN abs_bookings b ON b.id = d.booking_id
  LEFT JOIN ledgers l ON l.id = b.party_ledger_id
  LEFT JOIN users ub ON ub.id = b.booked_by
  LEFT JOIN godowns g ON g.id = d.godown_id
  LEFT JOIN users ud ON ud.id = d.dispatched_by
  LEFT JOIN users uc ON uc.id = d.delivery_confirmed_by`;

const shape = (r) => {
  const out = { ...r, status_label: STATUS_LABEL[r.status] || r.status };
  for (const k of ["transport_freight", "total_qty", "taxable_value", "scheme_discount", "tax_total", "invoice_amount", "advance_adjusted"]) out[k] = num(r[k]);
  out.balance_due = Math.round((out.invoice_amount - out.advance_adjusted) * 100) / 100;
  return out;
};

const ITEM_SELECT = `
  SELECT di.id, di.dispatch_id, di.booking_item_id, di.allocation_id, di.stock_item_id, si.item_name, u.symbol AS unit,
         di.godown_id, di.batch_no, di.qty, di.rate, di.discount_per_unit, di.net_rate, di.gst_percent, di.amount,
         di.received_qty, di.damaged_qty, di.short_qty
  FROM abs_dispatch_items di
  LEFT JOIN stock_items si ON si.id = di.stock_item_id
  LEFT JOIN units u ON u.id = si.unit_id`;

const shapeItem = (r) => {
  const out = { ...r };
  for (const k of ["qty", "rate", "discount_per_unit", "net_rate", "gst_percent", "amount", "damaged_qty", "short_qty"]) out[k] = num(r[k]);
  out.received_qty = r.received_qty === null || r.received_qty === undefined ? null : num(r.received_qty);
  return out;
};

const listItems = async (dispatchId, runner = db) => {
  const [rows] = await runner.query(`${ITEM_SELECT} WHERE di.dispatch_id = ? ORDER BY di.id`, [dispatchId]);
  return rows.map(shapeItem);
};

const getDispatch = async (id) => {
  const [rows] = await db.query(`${DISPATCH_SELECT} WHERE d.id = ?`, [id]);
  if (!rows[0]) return null;
  const d = shape(rows[0]);
  d.items = await listItems(id);
  return d;
};

const listForBooking = async (bookingId) => {
  const [rows] = await db.query(`${DISPATCH_SELECT} WHERE d.booking_id = ? ORDER BY d.id DESC`, [bookingId]);
  const out = rows.map(shape);
  for (const d of out) d.items = await listItems(d.id);
  return out;
};

// { status, userIds (booking's booked_by or party's field employee), seasonId, search, page, limit }
const listDispatches = async ({ status, userIds, seasonId, search, page, limit }) => {
  const where = ["1 = 1"];
  const params = [];
  if (status) {
    where.push(Array.isArray(status) ? "d.status IN (?)" : "d.status = ?");
    params.push(status);
  }
  if (userIds) {
    where.push("(b.booked_by IN (?) OR l.employee_under IN (?))");
    const ids = userIds.length ? userIds : [0];
    params.push(ids, ids);
  }
  if (seasonId) {
    where.push("b.season_id = ?");
    params.push(seasonId);
  }
  if (search) {
    where.push("(d.dispatch_no LIKE ? OR d.invoice_no LIKE ? OR b.booking_no LIKE ? OR l.ledger_name LIKE ? OR d.vehicle_no LIKE ?)");
    params.push(...Array(5).fill(`%${search}%`));
  }
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const pg = Math.max(Number(page) || 1, 1);
  const [rows] = await db.query(`${DISPATCH_SELECT} WHERE ${where.join(" AND ")} ORDER BY d.id DESC LIMIT ? OFFSET ?`, [...params, lim, (pg - 1) * lim]);
  const [countRows] = await db.query(
    `SELECT COUNT(*) AS c FROM abs_dispatches d LEFT JOIN abs_bookings b ON b.id = d.booking_id LEFT JOIN ledgers l ON l.id = b.party_ledger_id WHERE ${where.join(" AND ")}`,
    params,
  );
  const total = num(countRows[0] && countRows[0].c);
  return { items: rows.map(shape), total, page: pg, limit: lim, totalPages: Math.max(Math.ceil(total / lim), 1) };
};

// DSP-2026-00001
const nextDispatchNo = async (conn, year) => {
  const head = `DSP-${year}-`;
  const [rows] = await conn.query(`SELECT dispatch_no FROM abs_dispatches WHERE dispatch_no LIKE ? ORDER BY dispatch_no DESC LIMIT 1 FOR UPDATE`, [`${head}%`]);
  const last = rows[0] ? Number(String(rows[0].dispatch_no).slice(head.length)) || 0 : 0;
  return `${head}${String(last + 1).padStart(5, "0")}`;
};

const DISPATCH_COLS = ["dispatch_no", "booking_id", "dispatch_date", "godown_id", "sale_id", "invoice_no", "vehicle_no", "transport_name",
  "driver_name", "driver_mobile", "lr_no", "eway_number", "transport_freight", "destination", "tax_mode", "total_qty", "taxable_value",
  "scheme_discount", "tax_total", "invoice_amount", "advance_adjusted", "dispatched_by", "remarks"];

const insertDispatch = async (conn, data, items) => {
  const [res] = await conn.query(
    `INSERT INTO abs_dispatches (${DISPATCH_COLS.join(", ")}, status) VALUES (${DISPATCH_COLS.map(() => "?").join(", ")}, 'IN_TRANSIT')`,
    DISPATCH_COLS.map((c) => (data[c] === undefined ? null : data[c])),
  );
  await conn.query(
    `INSERT INTO abs_dispatch_items (dispatch_id, booking_item_id, allocation_id, stock_item_id, godown_id, batch_no, qty, rate,
       discount_per_unit, net_rate, gst_percent, amount) VALUES ?`,
    [items.map((i) => [res.insertId, i.booking_item_id, i.allocation_id, i.stock_item_id, i.godown_id, i.batch_no || null, i.qty, i.rate,
      i.discount_per_unit, i.net_rate, i.gst_percent, i.amount])],
  );
  return res.insertId;
};

const insertAdjustment = async (conn, { bookingId, dispatchId, saleId, sbrId, amount, userId }) => {
  await conn.query(
    `INSERT INTO abs_advance_adjustments (booking_id, dispatch_id, sale_id, sales_bill_reference_id, amount, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
    [bookingId, dispatchId, saleId, sbrId, amount, userId],
  );
};

const salesBillRefOf = async (conn, saleId) => {
  const [rows] = await conn.query(`SELECT id, pending_amount FROM sales_bill_references WHERE sale_id = ? ORDER BY id ASC LIMIT 1 FOR UPDATE`, [saleId]);
  return rows[0] || null;
};

// reduce the invoice's pending amount by the adjusted advance.
// status is computed first (MySQL evaluates SET left to right with already-updated values)
const adjustBillPending = async (conn, sbrId, amount) => {
  await conn.query(
    `UPDATE sales_bill_references
     SET status = CASE WHEN pending_amount - ? <= 0 THEN 'RECEIVED'
                       WHEN pending_amount - ? < bill_amount THEN 'PARTIAL'
                       ELSE 'PENDING' END,
         pending_amount = pending_amount - ?
     WHERE id = ?`,
    [amount, amount, amount, sbrId],
  );
};

const lockDispatch = async (conn, id) => {
  const [rows] = await conn.query(`SELECT * FROM abs_dispatches WHERE id = ? FOR UPDATE`, [id]);
  return rows[0] || null;
};

// items: [{ id, received_qty, damaged_qty, short_qty }]
const markDelivered = async (conn, id, { status, deliveredOn, receivedBy, podImage, remarks, userId }, items) => {
  for (const it of items) {
    await conn.query(`UPDATE abs_dispatch_items SET received_qty = ?, damaged_qty = ?, short_qty = ? WHERE id = ? AND dispatch_id = ?`, [it.received_qty, it.damaged_qty, it.short_qty, it.id, id]);
  }
  await conn.query(
    `UPDATE abs_dispatches SET status = ?, delivered_on = ?, received_by_name = ?, pod_image = COALESCE(?, pod_image),
       delivery_remarks = ?, delivery_confirmed_by = ?, delivery_confirmed_at = NOW() WHERE id = ?`,
    [status, deliveredOn, receivedBy, podImage, remarks, userId, id],
  );
};

// any dispatch of the booking still on the road?
const openDispatchCount = async (runner, bookingId) => {
  const [rows] = await runner.query(`SELECT COUNT(*) AS c FROM abs_dispatches WHERE booking_id = ? AND status = 'IN_TRANSIT'`, [bookingId]);
  return num(rows[0] && rows[0].c);
};

module.exports = {
  STATUS_LABEL,
  getDispatch,
  listItems,
  listForBooking,
  listDispatches,
  nextDispatchNo,
  insertDispatch,
  insertAdjustment,
  salesBillRefOf,
  adjustBillPending,
  lockDispatch,
  markDelivered,
  openDispatchCount,
};
