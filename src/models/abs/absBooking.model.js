// ABS bookings, booking lines and the booking timeline.
const db = require("../../config/db");

const STATUS_LABEL = {
  DRAFT: "Draft",
  SUBMITTED: "Pending Approval",
  RETURNED: "Returned for Changes",
  REJECTED: "Rejected",
  APPROVED: "Approved — Awaiting Confirmation",
  CONFIRMED: "Confirmed",
  PARTIALLY_DISPATCHED: "Partially Dispatched",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

const num = (v) => Number(v) || 0;

const BOOKING_SELECT = `
  SELECT b.id, b.booking_no, b.season_id, se.name AS season_name, se.season AS crop_season,
         b.party_ledger_id, pl.ledger_name AS party_name, pl.location AS party_location, pl.gst_no AS party_gstin,
         pl.employee_under AS party_employee_id,
         b.booked_by, ub.name AS booked_by_name,
         DATE_FORMAT(b.booking_date, '%Y-%m-%d') AS booking_date,
         DATE_FORMAT(b.requested_delivery_from, '%Y-%m-%d') AS requested_delivery_from,
         DATE_FORMAT(b.requested_delivery_to, '%Y-%m-%d') AS requested_delivery_to,
         b.delivery_address, b.preferred_godown_id, g.godown_name AS preferred_godown,
         b.status, b.gross_value, b.scheme_discount, b.net_value, b.advance_required,
         DATE_FORMAT(b.advance_due_date, '%Y-%m-%d') AS advance_due_date,
         DATE_FORMAT(b.submitted_at, '%Y-%m-%d %H:%i:%s') AS submitted_at,
         DATE_FORMAT(b.approved_at, '%Y-%m-%d %H:%i:%s') AS approved_at,
         b.confirmed_by, uc.name AS confirmed_by_name,
         DATE_FORMAT(b.confirmed_at, '%Y-%m-%d %H:%i:%s') AS confirmed_at, b.confirmation_remark,
         b.cancelled_by, DATE_FORMAT(b.cancelled_at, '%Y-%m-%d %H:%i:%s') AS cancelled_at, b.cancel_reason,
         DATE_FORMAT(b.closed_at, '%Y-%m-%d %H:%i:%s') AS closed_at,
         b.return_remark, b.remarks, b.booking_form_image, b.created_by,
         DATE_FORMAT(b.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
         DATE_FORMAT(b.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
         (SELECT COALESCE(SUM(p.amount), 0) FROM abs_payments p WHERE p.booking_id = b.id AND p.status = 'POSTED') AS advance_received,
         (SELECT COALESCE(SUM(p.amount), 0) FROM abs_payments p WHERE p.booking_id = b.id AND p.status = 'PENDING_VERIFICATION') AS advance_pending_verification,
         (SELECT COALESCE(SUM(a.amount), 0) FROM abs_advance_adjustments a WHERE a.booking_id = b.id) AS advance_adjusted,
         (SELECT COALESCE(SUM(r.amount), 0) FROM abs_refunds r WHERE r.booking_id = b.id AND r.status <> 'CARRIED_FORWARD') AS refund_total,
         (SELECT COALESCE(SUM(d.invoice_amount), 0) FROM abs_dispatches d WHERE d.booking_id = b.id) AS invoiced_value,
         (SELECT COALESCE(SUM(COALESCE(bi.confirmed_qty, bi.qty) - bi.cancelled_qty), 0) FROM abs_booking_items bi WHERE bi.booking_id = b.id) AS total_qty,
         (SELECT COALESCE(SUM(bi.allocated_qty), 0) FROM abs_booking_items bi WHERE bi.booking_id = b.id) AS allocated_qty,
         (SELECT COALESCE(SUM(bi.dispatched_qty), 0) FROM abs_booking_items bi WHERE bi.booking_id = b.id) AS dispatched_qty,
         (SELECT COALESCE(SUM(bi.delivered_qty), 0) FROM abs_booking_items bi WHERE bi.booking_id = b.id) AS delivered_qty,
         (SELECT st.level_no FROM bp_approval_steps st
           WHERE st.entity_type = 'ABS_BOOKING' AND st.entity_id = b.id AND st.status = 'PENDING'
           ORDER BY st.round_no DESC LIMIT 1) AS pending_level,
         (SELECT COALESCE(su.name, 'Admin / Super Admin') FROM bp_approval_steps st LEFT JOIN users su ON su.id = st.approver_id
           WHERE st.entity_type = 'ABS_BOOKING' AND st.entity_id = b.id AND st.status = 'PENDING'
           ORDER BY st.round_no DESC LIMIT 1) AS pending_with`;

const BOOKING_FROM = `
  FROM abs_bookings b
  LEFT JOIN abs_seasons se ON se.id = b.season_id
  LEFT JOIN ledgers pl ON pl.id = b.party_ledger_id
  LEFT JOIN users ub ON ub.id = b.booked_by
  LEFT JOIN users uc ON uc.id = b.confirmed_by
  LEFT JOIN godowns g ON g.id = b.preferred_godown_id`;

const shape = (r, today) => {
  const out = { ...r, status_label: STATUS_LABEL[r.status] || r.status };
  for (const k of ["gross_value", "scheme_discount", "net_value", "advance_required", "advance_received", "advance_pending_verification",
    "advance_adjusted", "refund_total", "invoiced_value", "total_qty", "allocated_qty", "dispatched_qty", "delivered_qty"]) out[k] = num(r[k]);
  out.pending_level = r.pending_level === null || r.pending_level === undefined ? null : num(r.pending_level);
  // advance still to collect for confirmation; balance after invoices
  out.advance_shortfall = Math.max(Math.round((out.advance_required - out.advance_received) * 100) / 100, 0);
  out.advance_unadjusted = Math.round((out.advance_received - out.advance_adjusted - out.refund_total) * 100) / 100;
  out.paid_pct = out.net_value > 0 ? Math.round((out.advance_received / out.net_value) * 1000) / 10 : 0;
  out.advance_overdue = !!(r.advance_due_date && today && r.advance_due_date < today && out.advance_shortfall > 0 &&
    ["CONFIRMED", "PARTIALLY_DISPATCHED"].includes(r.status));
  out.pending_allocation = Math.max(Math.round((out.total_qty - out.allocated_qty) * 1000) / 1000, 0);
  out.ready_to_dispatch = Math.max(Math.round((out.allocated_qty - out.dispatched_qty) * 1000) / 1000, 0);
  return out;
};

// f: { userIds (null = all; matched to booked_by or the party's field employee), ids, status (one or list),
//      seasonId, partyId, search, flag: overdue | allocation | dispatch, page, limit, today }
const buildWhere = (f) => {
  const where = ["b.is_deleted = 0"];
  const params = [];
  if (f.userIds) {
    where.push("(b.booked_by IN (?) OR pl.employee_under IN (?))");
    const ids = f.userIds.length ? f.userIds : [0];
    params.push(ids, ids);
  }
  if (Array.isArray(f.ids)) {
    where.push("b.id IN (?)");
    params.push(f.ids.length ? f.ids : [0]);
  }
  if (f.status) {
    where.push(Array.isArray(f.status) ? "b.status IN (?)" : "b.status = ?");
    params.push(f.status);
  }
  if (f.seasonId) {
    where.push("b.season_id = ?");
    params.push(f.seasonId);
  }
  if (f.partyId) {
    where.push("b.party_ledger_id = ?");
    params.push(f.partyId);
  }
  if (f.search) {
    where.push("(b.booking_no LIKE ? OR pl.ledger_name LIKE ?)");
    params.push(`%${f.search}%`, `%${f.search}%`);
  }
  if (f.flag === "overdue") {
    where.push("b.status IN ('CONFIRMED','PARTIALLY_DISPATCHED') AND b.advance_due_date < ? AND b.advance_required > (SELECT COALESCE(SUM(p.amount), 0) FROM abs_payments p WHERE p.booking_id = b.id AND p.status = 'POSTED')");
    params.push(f.today);
  } else if (f.flag === "allocation") {
    where.push("b.status IN ('CONFIRMED','PARTIALLY_DISPATCHED') AND EXISTS (SELECT 1 FROM abs_booking_items bi WHERE bi.booking_id = b.id AND COALESCE(bi.confirmed_qty, bi.qty) - bi.cancelled_qty > bi.allocated_qty)");
  } else if (f.flag === "dispatch") {
    where.push("b.status IN ('CONFIRMED','PARTIALLY_DISPATCHED') AND EXISTS (SELECT 1 FROM abs_booking_items bi WHERE bi.booking_id = b.id AND bi.allocated_qty > bi.dispatched_qty)");
  }
  return { where: where.join(" AND "), params };
};

const listBookings = async (f) => {
  const { where, params } = buildWhere(f);
  const lim = Math.min(Math.max(Number(f.limit) || 20, 1), 200);
  const pg = Math.max(Number(f.page) || 1, 1);
  const [rows] = await db.query(
    `${BOOKING_SELECT} ${BOOKING_FROM} WHERE ${where} ORDER BY b.booking_date DESC, b.id DESC LIMIT ? OFFSET ?`,
    [...params, lim, (pg - 1) * lim],
  );
  const [countRows] = await db.query(`SELECT COUNT(*) AS c ${BOOKING_FROM} WHERE ${where}`, params);
  const total = num(countRows[0] && countRows[0].c);
  return { items: rows.map((r) => shape(r, f.today)), total, page: pg, limit: lim, totalPages: Math.max(Math.ceil(total / lim), 1) };
};

const ITEM_SELECT = `
  SELECT bi.id, bi.booking_id, bi.stock_item_id, si.item_name, si.unit_id, u.symbol AS unit, cr.crop_name,
         bi.qty, bi.confirmed_qty, bi.allocated_qty, bi.dispatched_qty, bi.delivered_qty, bi.cancelled_qty,
         bi.rate, bi.mrp, bi.gst_percent, bi.amount, bi.discount_per_unit, bi.remarks
  FROM abs_booking_items bi
  LEFT JOIN stock_items si ON si.id = bi.stock_item_id
  LEFT JOIN units u ON u.id = si.unit_id
  LEFT JOIN crops cr ON cr.id = si.crop_id`;

const shapeItem = (r) => {
  const out = { ...r };
  for (const k of ["qty", "allocated_qty", "dispatched_qty", "delivered_qty", "cancelled_qty", "rate", "gst_percent", "amount", "discount_per_unit"]) out[k] = num(r[k]);
  out.mrp = r.mrp === null ? null : num(r.mrp);
  out.confirmed_qty = r.confirmed_qty === null || r.confirmed_qty === undefined ? null : num(r.confirmed_qty);
  // the quantity the company will supply: confirmed (or booked) minus short-closed
  out.supply_qty = Math.round(((out.confirmed_qty ?? out.qty) - out.cancelled_qty) * 1000) / 1000;
  out.to_allocate = Math.max(Math.round((out.supply_qty - out.allocated_qty) * 1000) / 1000, 0);
  out.to_dispatch = Math.max(Math.round((out.allocated_qty - out.dispatched_qty) * 1000) / 1000, 0);
  out.net_rate = Math.round((out.rate - out.discount_per_unit) * 100) / 100;
  return out;
};

const listItems = async (bookingId, runner = db) => {
  const [rows] = await runner.query(`${ITEM_SELECT} WHERE bi.booking_id = ? ORDER BY bi.id ASC`, [bookingId]);
  return rows.map(shapeItem);
};

const getBooking = async (id, { today } = {}) => {
  const [rows] = await db.query(`${BOOKING_SELECT} ${BOOKING_FROM} WHERE b.id = ? AND b.is_deleted = 0`, [id]);
  if (!rows[0]) return null;
  const b = shape(rows[0], today);
  b.items = await listItems(id);
  return b;
};

// ABS-2026-00001 (prefix from Settings, year of the booking)
const nextBookingNo = async (conn, prefix, year) => {
  const head = `${prefix}-${year}-`;
  const [rows] = await conn.query(
    `SELECT booking_no FROM abs_bookings WHERE booking_no LIKE ? ORDER BY booking_no DESC LIMIT 1 FOR UPDATE`,
    [`${head}%`],
  );
  const last = rows[0] ? Number(String(rows[0].booking_no).slice(head.length)) || 0 : 0;
  return `${head}${String(last + 1).padStart(5, "0")}`;
};

const HEADER_COLS = ["season_id", "party_ledger_id", "booking_date", "requested_delivery_from", "requested_delivery_to",
  "delivery_address", "preferred_godown_id", "gross_value", "scheme_discount", "net_value", "advance_required", "remarks"];

const insertItems = async (conn, bookingId, items) => {
  if (!items.length) return;
  await conn.query(
    `INSERT INTO abs_booking_items (booking_id, stock_item_id, qty, rate, mrp, gst_percent, amount, discount_per_unit, remarks) VALUES ?`,
    [items.map((i) => [bookingId, i.stock_item_id, i.qty, i.rate, i.mrp, i.gst_percent, i.amount, i.discount_per_unit, i.remarks || null])],
  );
};

// data: HEADER_COLS + booked_by; items: [{ stock_item_id, qty, rate, mrp, gst_percent, amount, discount_per_unit, remarks }]
const createBooking = async (data, items, userId, prefix) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const no = await nextBookingNo(conn, prefix, String(data.booking_date).slice(0, 4));
      const [res] = await conn.query(
        `INSERT INTO abs_bookings (booking_no, booked_by, created_by, status, ${HEADER_COLS.join(", ")})
         VALUES (?, ?, ?, 'DRAFT', ${HEADER_COLS.map(() => "?").join(", ")})`,
        [no, data.booked_by, userId, ...HEADER_COLS.map((c) => (data[c] === undefined ? null : data[c]))],
      );
      await insertItems(conn, res.insertId, items);
      await addEvent(conn, { bookingId: res.insertId, event: "CREATED", toStatus: "DRAFT", detail: `${items.length} item(s)`, userId });
      await conn.commit();
      return res.insertId;
    } catch (err) {
      await conn.rollback();
      if (err && err.code === "ER_DUP_ENTRY" && attempt < 2) continue;
      throw err;
    } finally {
      conn.release();
    }
  }
  throw new Error("Could not generate a booking number");
};

// header + lines replaced (Draft / Returned only — checked by the controller, re-checked here)
const updateBooking = async (id, data, items, userId) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(`SELECT id, status FROM abs_bookings WHERE id = ? AND is_deleted = 0 FOR UPDATE`, [id]);
    if (!row || !["DRAFT", "RETURNED"].includes(row.status)) {
      await conn.rollback();
      return { ok: false, current: row ? row.status : null };
    }
    await conn.query(`UPDATE abs_bookings SET ${HEADER_COLS.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...HEADER_COLS.map((c) => (data[c] === undefined ? null : data[c])), id]);
    await conn.query(`DELETE FROM abs_booking_items WHERE booking_id = ?`, [id]);
    await insertItems(conn, id, items);
    await addEvent(conn, { bookingId: id, event: "UPDATED", fromStatus: row.status, toStatus: row.status, detail: `${items.length} item(s)`, userId });
    await conn.commit();
    return { ok: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// status move with a row lock. extra(conn, row) runs in the same transaction.
const moveBooking = async (id, { allowedFrom, to, sets = [], params = [], event, detail = null, remark = null, userId, extra }) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(`SELECT id, status FROM abs_bookings WHERE id = ? AND is_deleted = 0 FOR UPDATE`, [id]);
    if (!row || (allowedFrom && !allowedFrom.includes(row.status))) {
      await conn.rollback();
      return { ok: false, current: row ? row.status : null };
    }
    const target = to || row.status;
    await conn.query(`UPDATE abs_bookings SET status = ?${sets.length ? `, ${sets.join(", ")}` : ""} WHERE id = ?`, [target, ...params, id]);
    const extraResult = extra ? await extra(conn, row) : undefined;
    if (event) await addEvent(conn, { bookingId: id, event, fromStatus: row.status, toStatus: target, detail, remark, userId });
    await conn.commit();
    return { ok: true, from: row.status, extra: extraResult };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const softDelete = async (id) => {
  await db.query(`UPDATE abs_bookings SET is_deleted = 1 WHERE id = ? AND status = 'DRAFT'`, [id]);
};

const addEvent = async (runner, { bookingId, event, fromStatus = null, toStatus = null, detail = null, remark = null, userId = null }) => {
  await runner.query(
    `INSERT INTO abs_booking_events (booking_id, event, from_status, to_status, detail, remark, acted_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [bookingId, event, fromStatus, toStatus, detail ? String(detail).slice(0, 500) : null, remark ? String(remark).slice(0, 500) : null, userId],
  );
};

const listEvents = async (bookingId) => {
  const [rows] = await db.query(
    `SELECT e.id, e.event, e.from_status, e.to_status, e.detail, e.remark, e.acted_by, u.name AS acted_by_name,
            DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM abs_booking_events e LEFT JOIN users u ON u.id = e.acted_by
     WHERE e.booking_id = ? ORDER BY e.id DESC`,
    [bookingId],
  );
  return rows;
};

// already booked by this party for this variety in the season (other live bookings)
const partyBookedQty = async (seasonId, partyId, stockItemId, excludeBookingId = 0) => {
  const [rows] = await db.query(
    `SELECT COALESCE(SUM(COALESCE(bi.confirmed_qty, bi.qty) - bi.cancelled_qty), 0) AS q
     FROM abs_booking_items bi INNER JOIN abs_bookings b ON b.id = bi.booking_id
     WHERE b.season_id = ? AND b.party_ledger_id = ? AND bi.stock_item_id = ? AND b.id <> ?
       AND b.is_deleted = 0 AND b.status NOT IN ('DRAFT','REJECTED','CANCELLED')`,
    [seasonId, partyId, stockItemId, excludeBookingId || 0],
  );
  return num(rows[0] && rows[0].q);
};

module.exports = {
  STATUS_LABEL,
  listBookings,
  getBooking,
  listItems,
  createBooking,
  updateBooking,
  moveBooking,
  softDelete,
  addEvent,
  listEvents,
  partyBookedQty,
};
