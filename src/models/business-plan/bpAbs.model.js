// Business Plan <-> Advance Booking (ABS) integration.
//
// The Business Plan never creates or assumes ABS tables. ABS actuals are read only when
// the ABS module's own tables AND every column used below exist in this database
// (checked in information_schema, cached for 10 minutes). Otherwise everything here
// returns "not installed" and the Business Plan works exactly as before.
//
// Integration points (see docs/ABS_INTEGRATION.md):
//   booking value  = abs_bookings.net_value (before GST) by booking_date, booked_by = employee,
//                    counted once the booking is approved (APPROVED ... CLOSED; not CANCELLED)
//   advance        = abs_payments.amount with status POSTED, dated by the Receipt voucher it
//                    created (receipts.receipt_date via abs_payments.receipt_id), not cancelled.
//                    That receipt is ALSO part of collection: the advance is a sub-figure of
//                    collection and is never added to it again.
const db = require("../../config/db");

const REQUIRED = {
  abs_bookings: ["id", "booked_by", "booking_date", "status", "net_value", "is_deleted"],
  abs_payments: ["booking_id", "amount", "status", "receipt_id"],
};
const COUNTED_BOOKING_STATUSES = ["APPROVED", "CONFIRMED", "PARTIALLY_DISPATCHED", "DISPATCHED", "DELIVERED", "CLOSED"];

const CACHE_MS = 10 * 60 * 1000;
let cache = { at: 0, value: null };
let forced = null; // tests only

const num = (v) => Number(v) || 0;
const round = (v) => Math.round(num(v) * 100) / 100;

const notCancelledReceipt = `
  (r.id NOT IN (SELECT lt.reference_id FROM ledger_transactions lt
                WHERE lt.transaction_type = 'RECEIPT' AND lt.is_cancelled = 1 AND lt.reference_id IS NOT NULL))`;

// { installed: bool, missing: [ 'abs_bookings.net_value', ... ] }
const status = async () => {
  if (forced !== null) return { installed: forced, missing: forced ? [] : ["(disabled for tests)"] };
  if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value;
  try {
    const [rows] = await db.query(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
      [Object.keys(REQUIRED)],
    );
    const have = new Set(rows.map((r) => `${r.t}.${r.c}`));
    const missing = [];
    for (const [t, cols] of Object.entries(REQUIRED)) {
      for (const c of cols) if (!have.has(`${t}.${c}`)) missing.push(`${t}.${c}`);
    }
    value = { installed: missing.length === 0, missing };
  } catch (err) {
    value = { installed: false, missing: [`check failed: ${err.message}`] };
  }
  cache = { at: Date.now(), value };
  return value;
};

const isInstalled = async () => (await status()).installed;

// Map 'YYYY-MM' -> { booking, advance } for one employee between two dates (inclusive)
const monthlyActuals = async (userId, from, to) => {
  const out = new Map();
  if (!(await isInstalled())) return out;
  const cell = (k) => {
    if (!out.has(k)) out.set(k, { booking: 0, advance: 0 });
    return out.get(k);
  };
  const [[bookings], [advances]] = await Promise.all([
    db.query(
      `SELECT DATE_FORMAT(b.booking_date, '%Y-%m') AS ym, COALESCE(SUM(b.net_value), 0) AS amount
       FROM abs_bookings b
       WHERE b.booked_by = ? AND b.is_deleted = 0 AND b.status IN (?)
         AND b.booking_date >= ? AND b.booking_date < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY ym`,
      [userId, COUNTED_BOOKING_STATUSES, from, to],
    ),
    db.query(
      `SELECT DATE_FORMAT(r.receipt_date, '%Y-%m') AS ym, COALESCE(SUM(pay.amount), 0) AS amount
       FROM abs_payments pay
       INNER JOIN abs_bookings b ON b.id = pay.booking_id
       INNER JOIN receipts r ON r.id = pay.receipt_id
       WHERE b.booked_by = ? AND pay.status = 'POSTED'
         AND r.receipt_date >= ? AND r.receipt_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND ${notCancelledReceipt}
       GROUP BY ym`,
      [userId, from, to],
    ),
  ]);
  for (const r of bookings) cell(r.ym).booking = round(r.amount);
  for (const r of advances) cell(r.ym).advance = round(r.amount);
  return out;
};

// tests: force installed / not installed (null = real check)
const _force = (v) => {
  forced = v;
  cache = { at: 0, value: null };
};

module.exports = { REQUIRED, COUNTED_BOOKING_STATUSES, status, isInstalled, monthlyActuals, _force };
