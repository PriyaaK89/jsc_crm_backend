// ABS stock allocation: reserve godown / batch stock for confirmed bookings.
//   manual: planner picks godown + batch per booking line
//   auto:   free stock of a variety is shared over the waiting bookings, either by priority
//           (Settings: advance paid first, or booking date) or pro-rata when supply is short
const db = require("../../config/db");
const AL = require("../../models/abs/absAllocation.model");
const B = require("../../models/abs/absBooking.model");
const setup = require("../../models/abs/absSetup.model");
const pricing = require("../../services/abs/absPricing");
const BC = require("./absBooking.controller");
const A = require("./absHelpers");

const { HttpError, wrap, ok } = A;
const r3 = pricing.round3;
const SUPPLY = ["CONFIRMED", "PARTIALLY_DISPATCHED"];

// GET /abs/allocation/availability?stock_item_id&godown_id
const getAvailability = wrap(async (req, res) => {
  await A.assertCan(req, A.CODES.ALLOCATE, "You do not have permission to allocate stock");
  const stockItemId = A.toId(req.query.stock_item_id, "variety");
  const rows = await AL.availability(stockItemId, { godownId: A.optId(req.query.godown_id, "godown") });
  const sum = (k) => r3(rows.reduce((s, r) => s + r[k], 0));
  return ok(res, { stock_item_id: stockItemId, rows, physical: sum("physical"), reserved: sum("reserved"), free: sum("free") });
});

const sortQueue = (rows, priority) =>
  [...rows].sort((a, b) => {
    if (priority === "ADVANCE_FIRST" && b.paid_pct !== a.paid_pct) return b.paid_pct - a.paid_pct;
    if (a.booking_date !== b.booking_date) return a.booking_date < b.booking_date ? -1 : 1;
    if ((a.confirmed_at || "") !== (b.confirmed_at || "")) return (a.confirmed_at || "") < (b.confirmed_at || "") ? -1 : 1;
    return a.booking_id - b.booking_id;
  });

// GET /abs/allocation/queue?season_id&stock_item_id — confirmed lines waiting for this variety
const getQueue = wrap(async (req, res) => {
  await A.assertCan(req, A.CODES.ALLOCATE, "You do not have permission to allocate stock");
  const stockItemId = A.toId(req.query.stock_item_id, "variety");
  const settings = await setup.getSettings();
  const [rows, avail] = await Promise.all([AL.queue({ seasonId: A.optId(req.query.season_id, "season"), stockItemId }), AL.availability(stockItemId)]);
  const queue = sortQueue(rows, settings.allocation_priority);
  const need = r3(queue.reduce((s, q) => s + q.to_allocate, 0));
  const free = r3(avail.reduce((s, r) => s + Math.max(r.free, 0), 0));
  return ok(res, { priority: settings.allocation_priority, queue, availability: avail, need, free, shortfall: r3(Math.max(need - free, 0)) });
});

// allocate qty of a line from the given (godown, batch); re-checks free stock inside the lock
const allocateLine = async (conn, { booking, item, godownId, batchNo, qty, userId }) => {
  const avail = await AL.availability(item.stock_item_id, { godownId, runner: conn });
  const slot = avail.find((a) => a.godown_id === godownId && (a.batch_no || null) === (batchNo || null));
  const free = slot ? slot.free : 0;
  if (qty > free) {
    throw new HttpError(400, `Only ${free} free in ${slot ? slot.godown_name : "that godown"}${batchNo ? ` (batch ${batchNo})` : ""} for this variety`);
  }
  return AL.createAllocation(conn, { bookingId: booking.id, bookingItemId: item.id, stockItemId: item.stock_item_id, godownId, batchNo, qty, userId });
};

// POST /abs/bookings/:id/allocations { lines: [{ booking_item_id, godown_id, batch_no, qty }] }
const allocateBooking = wrap(async (req, res) => {
  await A.assertCan(req, A.CODES.ALLOCATE, "You do not have permission to allocate stock");
  const b = await BC.loadBooking(req);
  if (!SUPPLY.includes(b.status)) throw new HttpError(409, `Stock can be allocated only to a confirmed booking (this one is ${b.status_label})`);
  const lines = Array.isArray((req.body || {}).lines) ? req.body.lines : [];
  if (!lines.length) throw new HttpError(400, "Add at least one allocation line");
  const parsed = lines.map((l, i) => ({
    itemId: A.toId(l.booking_item_id, `Line ${i + 1}: booking line`),
    godownId: A.toId(l.godown_id, `Line ${i + 1}: godown`),
    batchNo: A.text(l.batch_no, `Line ${i + 1}: batch`, { max: 60 }) || null,
    qty: A.qty(l.qty, `Line ${i + 1}: quantity`, { required: true, positive: true }),
  }));
  const conn = await db.getConnection();
  const done = [];
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(`SELECT status FROM abs_bookings WHERE id = ? FOR UPDATE`, [b.id]);
    if (!row || !SUPPLY.includes(row.status)) throw new HttpError(409, "This booking changed; please refresh");
    for (const l of parsed) {
      const item = b.items.find((x) => x.id === l.itemId);
      if (!item) throw new HttpError(400, "Booking line not found in this booking");
      await AL.lockItem(conn, item.stock_item_id);
      const live = await AL.lockBookingItem(conn, item.id);
      if (l.qty > live.to_allocate) throw new HttpError(400, `${item.item_name}: only ${live.to_allocate} still to allocate`);
      await allocateLine(conn, { booking: b, item, godownId: l.godownId, batchNo: l.batchNo, qty: l.qty, userId: req.user.id });
      done.push(`${item.item_name} ${l.qty}`);
    }
    await B.addEvent(conn, { bookingId: b.id, event: "ALLOCATED", detail: done.join(", "), userId: req.user.id });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  await A.notify([b.booked_by], { type: "ABS_ALLOCATED", bookingId: b.id, title: "Stock allocated", message: `Stock reserved for ${b.booking_no} (${b.party_name}): ${done.join(", ")}.` });
  await A.notifyCode(A.CODES.DISPATCH, { type: "ABS_ALLOCATED", bookingId: b.id, title: "Booking ready to dispatch", message: `${b.booking_no} — ${b.party_name}: ${done.join(", ")} allocated.` }, [b.booked_by, req.user.id]);
  return BC.respond(req, res, b.id, "Stock allocated");
});

// POST /abs/allocation/auto { season_id, stock_item_id, godown_id?, mode: PRIORITY | PRO_RATA, booking_ids? }
const autoAllocate = wrap(async (req, res) => {
  await A.assertCan(req, A.CODES.ALLOCATE, "You do not have permission to allocate stock");
  const body = req.body || {};
  const stockItemId = A.toId(body.stock_item_id, "variety");
  const seasonId = A.optId(body.season_id, "season");
  const godownId = A.optId(body.godown_id, "godown");
  const mode = A.oneOf(body.mode || "PRIORITY", "mode", ["PRIORITY", "PRO_RATA"]);
  const bookingIds = Array.isArray(body.booking_ids) ? body.booking_ids.map((x) => A.toId(x, "booking")) : null;
  const settings = await setup.getSettings();
  const results = [];
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await AL.lockItem(conn, stockItemId);
    const queue = sortQueue(await AL.queue({ seasonId, stockItemId, bookingIds }), settings.allocation_priority);
    if (!queue.length) throw new HttpError(400, "No confirmed booking is waiting for this variety");
    // free stock slots, best first (bigger free qty first)
    const slots = (await AL.availability(stockItemId, { godownId, runner: conn })).filter((s) => s.free > 0);
    let totalFree = r3(slots.reduce((s, x) => s + x.free, 0));
    if (totalFree <= 0) throw new HttpError(400, "No free stock of this variety in the selected godown(s)");
    const share = mode === "PRO_RATA" ? pricing.proRata(totalFree, queue.map((q) => ({ key: q.booking_item_id, need: q.to_allocate }))) : null;
    for (const q of queue) {
      if (totalFree <= 0) break;
      let want = share ? share.find((s) => s.key === q.booking_item_id).qty : Math.min(q.to_allocate, totalFree);
      if (want <= 0) continue;
      const live = await AL.lockBookingItem(conn, q.booking_item_id);
      want = Math.min(want, live.to_allocate);
      // the booking's preferred godown first
      const order = [...slots].sort((a, b) => (b.godown_id === q.preferred_godown_id) - (a.godown_id === q.preferred_godown_id) || b.free - a.free);
      for (const s of order) {
        if (want <= 0) break;
        const take = r3(Math.min(want, s.free));
        if (take <= 0) continue;
        await AL.createAllocation(conn, { bookingId: q.booking_id, bookingItemId: q.booking_item_id, stockItemId, godownId: s.godown_id, batchNo: s.batch_no, qty: take, userId: req.user.id });
        await B.addEvent(conn, { bookingId: q.booking_id, event: "ALLOCATED", detail: `Auto (${mode === "PRO_RATA" ? "pro-rata" : settings.allocation_priority === "ADVANCE_FIRST" ? "advance paid first" : "booking date"}): ${take} from ${s.godown_name}${s.batch_no ? ` / ${s.batch_no}` : ""}`, userId: req.user.id });
        s.free = r3(s.free - take);
        totalFree = r3(totalFree - take);
        want = r3(want - take);
        results.push({ booking_id: q.booking_id, booking_no: q.booking_no, party_name: q.party_name, godown_id: s.godown_id, godown_name: s.godown_name, batch_no: s.batch_no, qty: take });
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  const byBooking = new Map();
  for (const r of results) byBooking.set(r.booking_id, (byBooking.get(r.booking_id) || 0) + r.qty);
  for (const [bookingId, q] of byBooking) {
    const bk = await B.getBooking(bookingId);
    if (bk) await A.notify([bk.booked_by], { type: "ABS_ALLOCATED", bookingId, title: "Stock allocated", message: `${r3(q)} units reserved for ${bk.booking_no} (${bk.party_name}).` });
  }
  const allocated = r3(results.reduce((s, r) => s + r.qty, 0));
  return ok(res, { mode, allocated, allocations: results }, results.length ? `${allocated} units allocated to ${byBooking.size} booking(s)` : "Nothing could be allocated");
});

// POST /abs/allocations/:allocationId/release { reason }
const releaseAllocation = wrap(async (req, res) => {
  await A.assertCan(req, A.CODES.ALLOCATE, "You do not have permission to release stock");
  const id = A.toId(req.params.allocationId, "allocation id");
  const reason = A.text((req.body || {}).reason, "Reason", { required: true, max: 255 });
  const conn = await db.getConnection();
  let alloc;
  let released = 0;
  try {
    await conn.beginTransaction();
    alloc = await AL.lockAllocation(conn, id);
    if (!alloc) throw new HttpError(404, "Allocation not found");
    if (alloc.status !== "ACTIVE") throw new HttpError(409, "This allocation is already released or fully dispatched");
    released = await AL.releaseAllocation(conn, alloc, { reason, userId: req.user.id });
    await B.addEvent(conn, { bookingId: alloc.booking_id, event: "ALLOCATION_RELEASED", detail: `${released} released`, remark: reason, userId: req.user.id });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  req.params.id = alloc.booking_id;
  return BC.respond(req, res, alloc.booking_id, `${released} units released back to free stock`);
});

module.exports = { getAvailability, getQueue, allocateBooking, autoAllocate, releaseAllocation, _sortQueue: sortQueue };
