// ABS stock allocation: reserves godown / batch stock for confirmed booking lines.
// Free stock = physical stock (stock_transactions) - ABS stock reserved and not yet dispatched.
const db = require("../../config/db");

const num = (v) => Number(v) || 0;
const r3 = (v) => Math.round(Number(v) * 1000) / 1000;

// serialise allocations of one variety (two planners cannot reserve the same bags)
const lockItem = async (conn, stockItemId) => {
  await conn.query(`SELECT id FROM stock_items WHERE id = ? FOR UPDATE`, [stockItemId]);
};

// -> [{ godown_id, godown_name, batch_no, physical, reserved, free }]
const availability = async (stockItemId, { godownId = null, runner = db } = {}) => {
  const [phys] = await runner.query(
    `SELECT st.godown_id, g.godown_name, st.batch_no,
            COALESCE(SUM(st.qty_in), 0) - COALESCE(SUM(st.qty_out), 0) AS qty
     FROM stock_transactions st LEFT JOIN godowns g ON g.id = st.godown_id
     WHERE st.stock_item_id = ? ${godownId ? "AND st.godown_id = ?" : ""}
     GROUP BY st.godown_id, g.godown_name, st.batch_no`,
    godownId ? [stockItemId, godownId] : [stockItemId],
  );
  const [res] = await runner.query(
    `SELECT godown_id, batch_no, COALESCE(SUM(qty - dispatched_qty), 0) AS reserved
     FROM abs_allocations
     WHERE stock_item_id = ? AND status = 'ACTIVE' ${godownId ? "AND godown_id = ?" : ""}
     GROUP BY godown_id, batch_no`,
    godownId ? [stockItemId, godownId] : [stockItemId],
  );
  const key = (g, b) => `${g}|${b || ""}`;
  const reserved = new Map(res.map((r) => [key(r.godown_id, r.batch_no), num(r.reserved)]));
  return phys
    .map((p) => {
      const physical = r3(num(p.qty));
      const rv = r3(reserved.get(key(p.godown_id, p.batch_no)) || 0);
      return { godown_id: Number(p.godown_id), godown_name: p.godown_name, batch_no: p.batch_no || null, physical, reserved: rv, free: r3(physical - rv) };
    })
    .filter((x) => x.physical > 0 || x.reserved > 0)
    .sort((a, b) => b.free - a.free);
};

const ALLOC_SELECT = `
  SELECT a.id, a.booking_id, a.booking_item_id, a.stock_item_id, si.item_name, a.godown_id, g.godown_name,
         a.batch_no, a.qty, a.dispatched_qty, a.status, a.allocated_by, ua.name AS allocated_by_name,
         DATE_FORMAT(a.allocated_at, '%Y-%m-%d %H:%i:%s') AS allocated_at,
         DATE_FORMAT(a.released_at, '%Y-%m-%d %H:%i:%s') AS released_at, a.release_reason
  FROM abs_allocations a
  LEFT JOIN stock_items si ON si.id = a.stock_item_id
  LEFT JOIN godowns g ON g.id = a.godown_id
  LEFT JOIN users ua ON ua.id = a.allocated_by`;

const shape = (r) => ({ ...r, qty: num(r.qty), dispatched_qty: num(r.dispatched_qty), open_qty: r3(num(r.qty) - num(r.dispatched_qty)) });

const listForBooking = async (bookingId, runner = db) => {
  const [rows] = await runner.query(`${ALLOC_SELECT} WHERE a.booking_id = ? ORDER BY a.id ASC`, [bookingId]);
  return rows.map(shape);
};

const getAllocation = async (id, runner = db) => {
  const [rows] = await runner.query(`${ALLOC_SELECT} WHERE a.id = ?`, [id]);
  return rows[0] ? shape(rows[0]) : null;
};

const lockAllocation = async (conn, id) => {
  const [rows] = await conn.query(`SELECT * FROM abs_allocations WHERE id = ? FOR UPDATE`, [id]);
  return rows[0] ? shape(rows[0]) : null;
};

const lockBookingItem = async (conn, itemId) => {
  const [rows] = await conn.query(`SELECT * FROM abs_booking_items WHERE id = ? FOR UPDATE`, [itemId]);
  if (!rows[0]) return null;
  const r = rows[0];
  const supply = r3((r.confirmed_qty === null ? num(r.qty) : num(r.confirmed_qty)) - num(r.cancelled_qty));
  return { ...r, supply_qty: supply, allocated_qty: num(r.allocated_qty), dispatched_qty: num(r.dispatched_qty), to_allocate: r3(Math.max(supply - num(r.allocated_qty), 0)) };
};

const createAllocation = async (conn, { bookingId, bookingItemId, stockItemId, godownId, batchNo, qty, userId }) => {
  const [res] = await conn.query(
    `INSERT INTO abs_allocations (booking_id, booking_item_id, stock_item_id, godown_id, batch_no, qty, status, allocated_by, allocated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NOW())`,
    [bookingId, bookingItemId, stockItemId, godownId, batchNo || null, qty, userId],
  );
  await conn.query(`UPDATE abs_booking_items SET allocated_qty = allocated_qty + ? WHERE id = ?`, [qty, bookingItemId]);
  return res.insertId;
};

// the undispatched part goes back to free stock
const releaseAllocation = async (conn, alloc, { reason, userId }) => {
  const open = r3(alloc.qty - alloc.dispatched_qty);
  if (open <= 0) return 0;
  if (alloc.dispatched_qty > 0) {
    await conn.query(
      `UPDATE abs_allocations SET qty = dispatched_qty, status = 'CONSUMED', released_by = ?, released_at = NOW(), release_reason = ? WHERE id = ?`,
      [userId, reason, alloc.id],
    );
  } else {
    await conn.query(`UPDATE abs_allocations SET status = 'RELEASED', released_by = ?, released_at = NOW(), release_reason = ? WHERE id = ?`, [userId, reason, alloc.id]);
  }
  await conn.query(`UPDATE abs_booking_items SET allocated_qty = allocated_qty - ? WHERE id = ?`, [open, alloc.booking_item_id]);
  return open;
};

const releaseAllForBooking = async (conn, bookingId, { reason, userId }) => {
  const [rows] = await conn.query(`SELECT * FROM abs_allocations WHERE booking_id = ? AND status = 'ACTIVE' FOR UPDATE`, [bookingId]);
  let total = 0;
  for (const r of rows) total += await releaseAllocation(conn, shape(r), { reason, userId });
  return r3(total);
};

const consume = async (conn, allocationId, qty) => {
  await conn.query(
    // status first: MySQL evaluates SET left to right with already-updated values
    `UPDATE abs_allocations SET status = CASE WHEN dispatched_qty + ? >= qty THEN 'CONSUMED' ELSE status END,
       dispatched_qty = dispatched_qty + ?
     WHERE id = ?`,
    [qty, qty, allocationId],
  );
};

// confirmed lines of a variety still waiting for stock, with the data used for priority
const queue = async ({ seasonId, stockItemId, bookingIds = null }) => {
  const where = [
    "b.is_deleted = 0",
    "b.status IN ('CONFIRMED','PARTIALLY_DISPATCHED')",
    "bi.stock_item_id = ?",
    "COALESCE(bi.confirmed_qty, bi.qty) - bi.cancelled_qty > bi.allocated_qty",
  ];
  const params = [stockItemId];
  if (seasonId) {
    where.push("b.season_id = ?");
    params.push(seasonId);
  }
  if (bookingIds) {
    where.push("b.id IN (?)");
    params.push(bookingIds.length ? bookingIds : [0]);
  }
  const [rows] = await db.query(
    `SELECT bi.id AS booking_item_id, bi.booking_id, b.booking_no, b.party_ledger_id, l.ledger_name AS party_name,
            DATE_FORMAT(b.booking_date, '%Y-%m-%d') AS booking_date,
            DATE_FORMAT(b.confirmed_at, '%Y-%m-%d %H:%i:%s') AS confirmed_at,
            b.preferred_godown_id, b.net_value,
            (SELECT COALESCE(SUM(p.amount), 0) FROM abs_payments p WHERE p.booking_id = b.id AND p.status = 'POSTED') AS advance_received,
            COALESCE(bi.confirmed_qty, bi.qty) - bi.cancelled_qty AS supply_qty, bi.allocated_qty
     FROM abs_booking_items bi
     INNER JOIN abs_bookings b ON b.id = bi.booking_id
     LEFT JOIN ledgers l ON l.id = b.party_ledger_id
     WHERE ${where.join(" AND ")}`,
    params,
  );
  return rows.map((r) => {
    const net = num(r.net_value);
    const adv = num(r.advance_received);
    return {
      ...r,
      net_value: net,
      advance_received: adv,
      paid_pct: net > 0 ? Math.round((adv / net) * 1000) / 10 : 0,
      supply_qty: num(r.supply_qty),
      allocated_qty: num(r.allocated_qty),
      to_allocate: r3(num(r.supply_qty) - num(r.allocated_qty)),
    };
  });
};

module.exports = {
  lockItem,
  availability,
  listForBooking,
  getAllocation,
  lockAllocation,
  lockBookingItem,
  createAllocation,
  releaseAllocation,
  releaseAllForBooking,
  consume,
  queue,
};
