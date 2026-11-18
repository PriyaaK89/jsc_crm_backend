// ABS advance payments (collected in the field, verified by accounts, posted as Receipts)
// and refunds of unadjusted advances.
const db = require("../../config/db");

const PAYMENT_MODES = ["Cash", "Cheque/DD", "E-Fund Transfer", "UPI", "Others"];
const STATUS_LABEL = {
  PENDING_VERIFICATION: "Pending Verification",
  POSTED: "Received (Receipt posted)",
  BOUNCED: "Bounced",
  REJECTED: "Rejected",
};

const num = (v) => Number(v) || 0;

const PAYMENT_SELECT = `
  SELECT p.id, p.booking_id, b.booking_no, p.party_ledger_id, l.ledger_name AS party_name,
         p.amount, p.payment_mode, p.instrument_no,
         DATE_FORMAT(p.instrument_date, '%Y-%m-%d') AS instrument_date, p.bank_name,
         p.collected_by, uc.name AS collected_by_name, DATE_FORMAT(p.collected_on, '%Y-%m-%d') AS collected_on,
         p.proof_image, p.status, p.account_ledger_id, al.ledger_name AS account_ledger_name,
         p.receipt_id, p.receipt_voucher_no, DATE_FORMAT(p.receipt_date, '%Y-%m-%d') AS receipt_date,
         p.verified_by, uv.name AS verified_by_name, DATE_FORMAT(p.verified_at, '%Y-%m-%d %H:%i:%s') AS verified_at,
         p.remarks, p.reject_reason, DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
  FROM abs_payments p
  LEFT JOIN abs_bookings b ON b.id = p.booking_id
  LEFT JOIN ledgers l ON l.id = p.party_ledger_id
  LEFT JOIN ledgers al ON al.id = p.account_ledger_id
  LEFT JOIN users uc ON uc.id = p.collected_by
  LEFT JOIN users uv ON uv.id = p.verified_by`;

const shape = (r) => ({ ...r, amount: num(r.amount), status_label: STATUS_LABEL[r.status] || r.status });

const listForBooking = async (bookingId) => {
  const [rows] = await db.query(`${PAYMENT_SELECT} WHERE p.booking_id = ? ORDER BY p.id DESC`, [bookingId]);
  return rows.map(shape);
};

// { status, userIds (collected_by or booking's booked_by), seasonId, page, limit }
const listPayments = async ({ status, userIds, seasonId, search, page, limit }) => {
  const where = ["1 = 1"];
  const params = [];
  if (status) {
    where.push("p.status = ?");
    params.push(status);
  }
  if (userIds) {
    where.push("(p.collected_by IN (?) OR b.booked_by IN (?))");
    const ids = userIds.length ? userIds : [0];
    params.push(ids, ids);
  }
  if (seasonId) {
    where.push("b.season_id = ?");
    params.push(seasonId);
  }
  if (search) {
    where.push("(b.booking_no LIKE ? OR l.ledger_name LIKE ? OR p.instrument_no LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const pg = Math.max(Number(page) || 1, 1);
  const [rows] = await db.query(`${PAYMENT_SELECT} WHERE ${where.join(" AND ")} ORDER BY p.id DESC LIMIT ? OFFSET ?`, [...params, lim, (pg - 1) * lim]);
  const [countRows] = await db.query(
    `SELECT COUNT(*) AS c FROM abs_payments p LEFT JOIN abs_bookings b ON b.id = p.booking_id LEFT JOIN ledgers l ON l.id = p.party_ledger_id WHERE ${where.join(" AND ")}`,
    params,
  );
  const total = num(countRows[0] && countRows[0].c);
  return { items: rows.map(shape), total, page: pg, limit: lim, totalPages: Math.max(Math.ceil(total / lim), 1) };
};

const getPayment = async (id) => {
  const [rows] = await db.query(`${PAYMENT_SELECT} WHERE p.id = ?`, [id]);
  return rows[0] ? shape(rows[0]) : null;
};

const createPayment = async (data) => {
  const [res] = await db.query(
    `INSERT INTO abs_payments (booking_id, party_ledger_id, amount, payment_mode, instrument_no, instrument_date,
       bank_name, collected_by, collected_on, proof_image, remarks, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_VERIFICATION')`,
    [data.booking_id, data.party_ledger_id, data.amount, data.payment_mode, data.instrument_no, data.instrument_date,
      data.bank_name, data.collected_by, data.collected_on, data.proof_image, data.remarks],
  );
  return res.insertId;
};

const lockPayment = async (conn, id) => {
  const [rows] = await conn.query(`SELECT * FROM abs_payments WHERE id = ? FOR UPDATE`, [id]);
  return rows[0] || null;
};

const markPosted = async (conn, id, { accountLedgerId, receiptId, voucherNo, receiptDate, userId }) => {
  await conn.query(
    `UPDATE abs_payments SET status = 'POSTED', account_ledger_id = ?, receipt_id = ?, receipt_voucher_no = ?,
       receipt_date = ?, verified_by = ?, verified_at = NOW() WHERE id = ?`,
    [accountLedgerId, receiptId, voucherNo, receiptDate, userId, id],
  );
};

const markRefused = async (conn, id, { status, reason, userId }) => {
  await conn.query(`UPDATE abs_payments SET status = ?, reject_reason = ?, verified_by = ?, verified_at = NOW() WHERE id = ?`, [status, reason, userId, id]);
};

// posted advance of a booking; byDate = receipt date on or before (for advance-payment schemes)
const postedTotal = async (bookingId, { byDate = null, runner = db } = {}) => {
  const [rows] = await runner.query(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM abs_payments
     WHERE booking_id = ? AND status = 'POSTED' ${byDate ? "AND receipt_date <= ?" : ""}`,
    byDate ? [bookingId, byDate] : [bookingId],
  );
  return num(rows[0] && rows[0].s);
};

// posted advance not yet adjusted against invoices or refunded
const unadjustedAdvance = async (runner, bookingId) => {
  const [rows] = await runner.query(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0) FROM abs_payments WHERE booking_id = ? AND status = 'POSTED') -
       (SELECT COALESCE(SUM(amount), 0) FROM abs_advance_adjustments WHERE booking_id = ?) -
       (SELECT COALESCE(SUM(amount), 0) FROM abs_refunds WHERE booking_id = ? AND status <> 'CARRIED_FORWARD') AS a`,
    [bookingId, bookingId, bookingId],
  );
  return Math.max(Math.round(num(rows[0] && rows[0].a) * 100) / 100, 0);
};

// ---------------------------------------------------------------- refunds
const REFUND_SELECT = `
  SELECT r.id, r.booking_id, b.booking_no, b.party_ledger_id, l.ledger_name AS party_name, r.amount, r.reason,
         r.status, r.payment_voucher_no, r.settled_by, us.name AS settled_by_name,
         DATE_FORMAT(r.settled_at, '%Y-%m-%d %H:%i:%s') AS settled_at, r.remarks,
         DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
  FROM abs_refunds r
  LEFT JOIN abs_bookings b ON b.id = r.booking_id
  LEFT JOIN ledgers l ON l.id = b.party_ledger_id
  LEFT JOIN users us ON us.id = r.settled_by`;

const createRefund = async (runner, { bookingId, amount, reason, status = "DUE", userId }) => {
  const [res] = await runner.query(
    `INSERT INTO abs_refunds (booking_id, amount, reason, status, created_by) VALUES (?, ?, ?, ?, ?)`,
    [bookingId, amount, reason, status, userId],
  );
  return res.insertId;
};

const listRefunds = async ({ status, bookingId } = {}) => {
  const where = ["1 = 1"];
  const params = [];
  if (status) {
    where.push("r.status = ?");
    params.push(status);
  }
  if (bookingId) {
    where.push("r.booking_id = ?");
    params.push(bookingId);
  }
  const [rows] = await db.query(`${REFUND_SELECT} WHERE ${where.join(" AND ")} ORDER BY r.id DESC LIMIT 500`, params);
  return rows.map((r) => ({ ...r, amount: num(r.amount) }));
};

const getRefund = async (id) => {
  const [rows] = await db.query(`${REFUND_SELECT} WHERE r.id = ?`, [id]);
  return rows[0] ? { ...rows[0], amount: num(rows[0].amount) } : null;
};

const settleRefund = async (id, { status, voucherNo, remarks, userId }) => {
  const [res] = await db.query(
    `UPDATE abs_refunds SET status = ?, payment_voucher_no = ?, remarks = ?, settled_by = ?, settled_at = NOW()
     WHERE id = ? AND status = 'DUE'`,
    [status, voucherNo, remarks, userId, id],
  );
  return res.affectedRows > 0;
};

module.exports = {
  PAYMENT_MODES,
  STATUS_LABEL,
  listForBooking,
  listPayments,
  getPayment,
  createPayment,
  lockPayment,
  markPosted,
  markRefused,
  postedTotal,
  unadjustedAdvance,
  createRefund,
  listRefunds,
  getRefund,
  settleRefund,
};
