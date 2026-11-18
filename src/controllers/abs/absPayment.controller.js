// ABS advance payments.
//   Field staff record what the party paid (cash / cheque / NEFT / UPI, with proof) → PENDING_VERIFICATION
//   Accounts verify (cheque cleared / money in bank) → a Receipt voucher is posted to the party
//   ledger with an ADVANCE bill reference = booking no. → POSTED. Or BOUNCED / REJECTED.
//   Refunds: advance left over after cancellation / closing.
const db = require("../../config/db");
const B = require("../../models/abs/absBooking.model");
const P = require("../../models/abs/absPayment.model");
const paymentModel = require("../../models/payment.model");
const { executeApprovedReceipt } = require("../../services/sales/createReceiptTransaction.service");
const { uploadFileToMinio } = require("../../utils/fileUpload");
const AP = require("../../models/business-plan/bpApproval.model");
const BC = require("./absBooking.controller");
const A = require("./absHelpers");

const { HttpError, wrap, ok } = A;
const r2 = (v) => Math.round(Number(v) * 100) / 100;

const NO_PAYMENT_STATUSES = ["DRAFT", "REJECTED", "CANCELLED", "CLOSED"];

// estimated invoice value of what is still to be supplied + already invoiced (GST included)
const maxReceivable = (b) => {
  const goods = b.items.reduce((s, it) => s + it.supply_qty * it.net_rate * (1 + it.gst_percent / 100), 0);
  return r2(goods);
};

const accountLedgerOk = async (id) => {
  const list = await paymentModel.getPaymentAccountDropdown();
  return list.some((l) => Number(l.id) === Number(id));
};

// receipt voucher through the existing Receipt posting (same as an approved receipt)
const postReceipt = async (conn, { payment, booking, accountLedgerId, receiptDate, userId }) => {
  const payload = {
    receipt_date: receiptDate,
    account_ledger_id: accountLedgerId,
    employee_under_id: booking.booked_by,
    total_amount: payment.amount,
    narration: `Advance for seed booking ${booking.booking_no} (${payment.payment_mode}${payment.instrument_no ? ` ${payment.instrument_no}` : ""})`,
    attachment: payment.proof_image || null,
    entries: [
      {
        ledger_id: booking.party_ledger_id,
        amount: payment.amount,
        transaction_type: payment.payment_mode,
        transaction_no: payment.instrument_no || null,
        bank_name: payment.bank_name || null,
        remarks: `ABS ${booking.booking_no}`,
        bill_references: [{ reference_type: "ADVANCE", reference_no: booking.booking_no, reference_amount: payment.amount, dr_cr: "Cr" }],
      },
    ],
  };
  return executeApprovedReceipt(conn, payload, userId);
};

// POST /abs/bookings/:id/payments (multipart: proof_image optional)
// { amount, payment_mode, instrument_no, instrument_date, bank_name, collected_on, remarks,
//   post_now?, account_ledger_id?, receipt_date? }  (post_now: accounts record + post in one step)
const recordPayment = wrap(async (req, res) => {
  const b = await BC.loadBooking(req);
  if (NO_PAYMENT_STATUSES.includes(b.status)) throw new HttpError(409, `Payments cannot be recorded on a ${b.status_label} booking`);
  const body = req.body || {};
  const amount = A.money(body.amount, "Amount", { required: true, positive: true });
  const mode = P.PAYMENT_MODES.find((m) => m.toLowerCase() === String(body.payment_mode || "").trim().toLowerCase());
  if (!mode) throw new HttpError(400, `Payment mode must be one of: ${P.PAYMENT_MODES.join(", ")}`);
  const instrumentNo = A.text(body.instrument_no, "Cheque / reference no.", { max: 60 }) || null;
  if (mode !== "Cash" && !instrumentNo) throw new HttpError(400, `${mode === "Cheque/DD" ? "Cheque / DD number" : "Transaction / UTR reference"} is required`);
  const collectedOn = A.date(body.collected_on, "Collected on") || A.todayIST();
  if (collectedOn > A.todayIST()) throw new HttpError(400, "Collected on cannot be a future date");
  const pending = b.advance_received + b.advance_pending_verification;
  const cap = maxReceivable(b);
  // all money taken for this booking (less refunds) may not exceed its value incl. GST
  if (cap > 0 && r2(pending + amount - b.refund_total) > cap + 1) {
    throw new HttpError(400, `This would take the advance above the booking value (${A.fmtMoney(cap)} incl. GST). Already paid / pending: ${A.fmtMoney(pending)}`);
  }
  let proof = null;
  if (req.file) proof = (await uploadFileToMinio(req.file, "abs_payment")).object_path;

  const postNow = body.post_now === true || body.post_now === "1" || body.post_now === "true";
  if (postNow) await A.assertCan(req, A.CODES.VERIFY, "Only accounts (Verify payment permission) can post a receipt");

  const id = await P.createPayment({
    booking_id: b.id,
    party_ledger_id: b.party_ledger_id,
    amount,
    payment_mode: mode,
    instrument_no: instrumentNo,
    instrument_date: A.date(body.instrument_date, "Cheque / transfer date"),
    bank_name: A.text(body.bank_name, "Bank", { max: 120 }) || null,
    collected_by: req.user.id,
    collected_on: collectedOn,
    proof_image: proof,
    remarks: A.text(body.remarks, "Remarks", { max: 500 }) || null,
  });
  await B.addEvent(db, { bookingId: b.id, event: "PAYMENT_RECORDED", detail: `${A.fmtMoney(amount)} by ${mode}${instrumentNo ? ` (${instrumentNo})` : ""}`, userId: req.user.id });

  if (postNow) {
    req.params.paymentId = id;
    return verify(req, res, { fromRecord: true });
  }
  await A.notifyCode(A.CODES.VERIFY, { type: "ABS_PAYMENT_RECORDED", bookingId: b.id, title: "Advance payment to verify", message: `${A.fmtMoney(amount)} by ${mode}${instrumentNo ? ` ${instrumentNo}` : ""} from ${b.party_name} for ${b.booking_no} — please verify and post the receipt.` }, [req.user.id]);
  return ok(res, await P.getPayment(id), "Payment recorded — waiting for accounts verification", 201);
});

// verify + post a Receipt voucher
const verify = async (req, res, { fromRecord = false } = {}) => {
  await A.assertCan(req, A.CODES.VERIFY, "You do not have permission to verify payments");
  const id = A.toId(req.params.paymentId, "payment id");
  const body = req.body || {};
  const accountLedgerId = A.toId(body.account_ledger_id, "cash / bank ledger");
  if (!(await accountLedgerOk(accountLedgerId))) throw new HttpError(400, "Select a Cash-in-Hand or Bank Account ledger");
  const receiptDate = A.date(body.receipt_date, "Receipt date") || A.todayIST();
  const pay = await P.getPayment(id);
  if (!pay) throw new HttpError(404, "Payment not found");
  const booking = await B.getBooking(pay.booking_id, { today: A.todayIST() });
  if (!booking) throw new HttpError(404, "Booking not found");

  const conn = await db.getConnection();
  let posted;
  try {
    await conn.beginTransaction();
    const locked = await P.lockPayment(conn, id);
    if (!locked || locked.status !== "PENDING_VERIFICATION") {
      throw new HttpError(409, `This payment is already ${P.STATUS_LABEL[locked && locked.status] || "processed"}`);
    }
    posted = await postReceipt(conn, { payment: { ...pay, amount: Number(locked.amount) }, booking, accountLedgerId, receiptDate, userId: req.user.id });
    await P.markPosted(conn, id, { accountLedgerId, receiptId: posted.receiptId, voucherNo: posted.voucher_no, receiptDate, userId: req.user.id });
    await B.addEvent(conn, { bookingId: booking.id, event: "PAYMENT_POSTED", detail: `${A.fmtMoney(pay.amount)} — Receipt ${posted.voucher_no || posted.receiptId}`, userId: req.user.id });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  await AP.clearActionNotifications(booking.id, ["ABS_PAYMENT_RECORDED"]);
  if (booking.booked_by !== req.user.id) {
    await A.notify([booking.booked_by], { type: "ABS_PAYMENT_POSTED", bookingId: booking.id, title: "Advance received", message: `${A.fmtMoney(pay.amount)} from ${booking.party_name} for ${booking.booking_no} is verified (Receipt ${posted.voucher_no || posted.receiptId}).` });
  }
  return ok(res, await P.getPayment(id), `Receipt ${posted.voucher_no || posted.receiptId} posted`, fromRecord ? 201 : 200);
};

const verifyPayment = wrap((req, res) => verify(req, res));

const refuse = (status) =>
  wrap(async (req, res) => {
    await A.assertCan(req, A.CODES.VERIFY, "You do not have permission to verify payments");
    const id = A.toId(req.params.paymentId, "payment id");
    const reason = A.text((req.body || {}).reason, "Reason", { required: true, max: 500 });
    const pay = await P.getPayment(id);
    if (!pay) throw new HttpError(404, "Payment not found");
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const locked = await P.lockPayment(conn, id);
      if (!locked || locked.status !== "PENDING_VERIFICATION") throw new HttpError(409, "Only a payment waiting for verification can be marked bounced / rejected");
      await P.markRefused(conn, id, { status, reason, userId: req.user.id });
      await B.addEvent(conn, { bookingId: pay.booking_id, event: status === "BOUNCED" ? "PAYMENT_BOUNCED" : "PAYMENT_REJECTED", detail: `${A.fmtMoney(pay.amount)} ${pay.payment_mode}${pay.instrument_no ? ` ${pay.instrument_no}` : ""}`, remark: reason, userId: req.user.id });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    const booking = await B.getBooking(pay.booking_id);
    await AP.clearActionNotifications(pay.booking_id, ["ABS_PAYMENT_RECORDED"]);
    await A.notify([booking.booked_by, pay.collected_by], { type: "ABS_PAYMENT_BOUNCED", bookingId: booking.id, title: status === "BOUNCED" ? "Cheque bounced" : "Payment not accepted", message: `${A.fmtMoney(pay.amount)} (${pay.payment_mode}${pay.instrument_no ? ` ${pay.instrument_no}` : ""}) for ${booking.booking_no} — ${booking.party_name}: ${reason}` });
    return ok(res, await P.getPayment(id), status === "BOUNCED" ? "Marked as bounced" : "Payment rejected");
  });

// GET /abs/payments?status&season_id&search&page&limit
const listPayments = wrap(async (req, res) => {
  const access = await A.getAccess(req);
  const status = A.oneOf(req.query.status, "status", Object.keys(P.STATUS_LABEL));
  const scope = A.hasCode(access, A.CODES.VERIFY) ? null : await A.scopeIds(req);
  return ok(res, await P.listPayments({ status, userIds: scope, seasonId: A.optId(req.query.season_id, "season"), search: A.text(req.query.search, "search", { max: 100 }), page: req.query.page, limit: req.query.limit }));
});

// ---------------------------------------------------------------- refunds
const listRefunds = wrap(async (req, res) => {
  await A.assertCan(req, A.CODES.VERIFY, "You do not have permission to view refunds");
  const status = A.oneOf(req.query.status, "status", ["DUE", "PAID", "CARRIED_FORWARD", "FORFEITED"]);
  return ok(res, await P.listRefunds({ status }));
});

// POST /abs/refunds/:refundId/settle { status: PAID | CARRIED_FORWARD | FORFEITED, payment_voucher_no, remarks }
const settleRefund = wrap(async (req, res) => {
  await A.assertCan(req, A.CODES.VERIFY, "You do not have permission to settle refunds");
  const id = A.toId(req.params.refundId, "refund id");
  const body = req.body || {};
  const status = A.oneOf(body.status, "status", ["PAID", "CARRIED_FORWARD", "FORFEITED"]);
  if (!status) throw new HttpError(400, "status is required");
  const voucherNo = A.text(body.payment_voucher_no, "Payment voucher no.", { max: 60 }) || null;
  if (status === "PAID" && !voucherNo) throw new HttpError(400, "Enter the Payment voucher no. used for the refund");
  const remarks = A.text(body.remarks, "Remarks", { max: 500 }) || null;
  if (status === "FORFEITED" && !remarks) throw new HttpError(400, "Give the reason for forfeiting the advance");
  const refund = await P.getRefund(id);
  if (!refund) throw new HttpError(404, "Refund not found");
  if (!(await P.settleRefund(id, { status, voucherNo, remarks, userId: req.user.id }))) throw new HttpError(409, "This refund is already settled");
  await B.addEvent(db, { bookingId: refund.booking_id, event: `REFUND_${status}`, detail: `${A.fmtMoney(refund.amount)}${voucherNo ? ` — ${voucherNo}` : ""}`, remark: remarks, userId: req.user.id });
  return ok(res, await P.getRefund(id), "Refund updated");
});

module.exports = {
  recordPayment,
  verifyPayment,
  bouncePayment: refuse("BOUNCED"),
  rejectPayment: refuse("REJECTED"),
  listPayments,
  listRefunds,
  settleRefund,
};
