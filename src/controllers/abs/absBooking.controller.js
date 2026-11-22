// ABS bookings: create (field staff, for their parties) → submit → reporting-line approval
// → order confirmation (office) → … → cancel / short-close / close.
//
//   DRAFT → SUBMITTED → APPROVED → CONFIRMED → PARTIALLY_DISPATCHED → DISPATCHED → DELIVERED → CLOSED
//                 ↘ RETURNED (edit, resubmit)   ↘ REJECTED
//   any open status → CANCELLED (allocations released, unadjusted advance → refund / carry forward)
//
// Minimum advance (Settings → "Advance with the booking", default on): the field officer
// records the party's advance on the draft (cash / cheque / NEFT / UPI with proof). The
// booking can be submitted only when the advance recorded (pending verification + posted)
// covers the minimum advance; the office confirms it only after accounts have verified it
// (Receipt voucher posted). Minimum advance = the higher of (booking value before GST × the
// season's minimum advance %, else the default % in Settings) and the season's minimum advance
// amount (₹ per booking) — never more than the booking value (absSetup.advanceRequired).
//
// Products: a booking line is a stock item in the season's price list whose crop
// (stock_items.crop_id) is linked to the season's crop season (crop_season_map).
//
// Production plan: submitting reserves the booked quantity against the product's production
// plan (abs_season_products.production_qty) under a row lock; a booking that would go over is
// refused with the quantity still available.
const db = require("../../config/db");
const B = require("../../models/abs/absBooking.model");
const setup = require("../../models/abs/absSetup.model");
const P = require("../../models/abs/absPayment.model");
const AL = require("../../models/abs/absAllocation.model");
const D = require("../../models/abs/absDispatch.model");
const AP = require("../../models/business-plan/bpApproval.model");
const WF = require("../business-plan/bpWorkflow");
const pricing = require("../../services/abs/absPricing");
const A = require("./absHelpers");

const { HttpError, wrap, ok } = A;

const ENTITY = "ABS_BOOKING";
const EDITABLE = ["DRAFT", "RETURNED"];
const OPEN_FOR_CANCEL_BY_OWNER = ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED"];
const SUPPLY_STATUSES = ["CONFIRMED", "PARTIALLY_DISPATCHED"];
const r2 = pricing.round2;
const r3 = pricing.round3;

// ---------------------------------------------------------------------
//  ACCESS
// ---------------------------------------------------------------------
const loadBooking = async (req) => {
  const id = A.toId(req.params.id, "booking id");
  const b = await B.getBooking(id, { today: A.todayIST() });
  if (!b) throw new HttpError(404, "Booking not found");
  const scope = await A.scopeIds(req);
  if (!A.inScope(scope, b) && !(await AP.isApproverOf(ENTITY, b.id, req.user.id))) {
    throw new HttpError(403, "You do not have access to this booking");
  }
  return b;
};

const userName = async (id) => {
  const [rows] = await db.query(`SELECT name FROM users WHERE id = ?`, [id]);
  return rows[0] ? rows[0].name : null;
};

const isOwner = (req, b) => b.booked_by === req.user.id || b.created_by === req.user.id;

// approval authority for the current level (Admin: any level, final; the "Admin" level of a
// chain without an RSM can also be approved by holders of CONFIRM_ABS_BOOKING)
const authority = async (req, state, b) => {
  const cur = state.current;
  if (!cur) return { can: false, reason: "This booking is not waiting for approval" };
  if ([b.booked_by, b.created_by].includes(req.user.id)) return { can: false, reason: "You cannot approve your own booking" };
  const access = await A.getAccess(req);
  if (cur.approver_kind === "ADMIN") {
    if (access.isAdmin) return { can: true, as: "ADMIN", final: true };
    if (access.codes.has(A.CODES.CONFIRM)) return { can: true, as: "APPROVER", final: !!cur.is_final };
  } else if (Number(cur.approver_id) === req.user.id) {
    return { can: true, as: "APPROVER", final: !!cur.is_final };
  }
  if (access.isAdmin) return { can: true, as: "ADMIN", final: true };
  return { can: false, reason: `This booking is waiting for Level ${cur.level_no} approval by ${cur.approver_name || "another approver"}` };
};

const approvalOf = async (req, b) => {
  const state = await WF.getState(ENTITY, b.id);
  const auth = b.status === "SUBMITTED" ? await authority(req, state, b) : null;
  return { state, auth };
};

const actionsFor = async (req, b, auth) => {
  const access = await A.getAccess(req);
  const c = (code) => A.hasCode(access, code);
  const owner = isOwner(req, b);
  const openSupply = SUPPLY_STATUSES.includes(b.status);
  const settings = await setup.getSettings();
  const recorded = advanceRecorded(b);
  return {
    advance_at_booking: settings.advance_at_booking,
    // advance still to record before the booking can be submitted
    advance_to_record_before_submit: settings.advance_at_booking && EDITABLE.includes(b.status) ? Math.max(r2(b.advance_required - recorded), 0) : 0,
    // advance still to be verified by accounts before the office can confirm
    advance_to_verify_before_confirm: settings.advance_at_booking && ["SUBMITTED", "APPROVED"].includes(b.status) ? Math.max(r2(b.advance_required - b.advance_received), 0) : 0,
    can_edit: owner && EDITABLE.includes(b.status),
    can_submit: owner && EDITABLE.includes(b.status),
    can_delete: owner && b.status === "DRAFT",
    can_approve: !!(auth && auth.can),
    can_return: !!(auth && auth.can),
    can_reject: !!(auth && auth.can),
    approval_level: auth && auth.can ? b.pending_level : null,
    final_if_approved: !!(auth && auth.can && auth.final),
    can_confirm: b.status === "APPROVED" && c(A.CODES.CONFIRM),
    // Admin / Super Admin may confirm before accounts verify the advance (remark required)
    can_override_advance: !!(settings.advance_at_booking && access.isAdmin && b.status === "APPROVED" && c(A.CODES.CONFIRM)),
    can_record_payment: !["REJECTED", "CANCELLED", "CLOSED"].includes(b.status) && (b.status !== "DRAFT" || settings.advance_at_booking) && (owner || c(A.CODES.VERIFY) || A.inScope(await A.scopeIds(req), b)),
    can_allocate: openSupply && c(A.CODES.ALLOCATE) && b.pending_allocation > 0,
    can_dispatch: openSupply && c(A.CODES.DISPATCH) && b.ready_to_dispatch > 0,
    can_short_close: openSupply && c(A.CODES.CONFIRM),
    can_cancel: (OPEN_FOR_CANCEL_BY_OWNER.includes(b.status) && (owner || c(A.CODES.CONFIRM))) || (openSupply && c(A.CODES.CONFIRM)),
    can_close: ["DELIVERED", "DISPATCHED"].includes(b.status) && c(A.CODES.CONFIRM),
  };
};

const respond = async (req, res, id, message, status = 200) => {
  const b = await B.getBooking(id, { today: A.todayIST() });
  const { state, auth } = await approvalOf(req, b);
  const [payments, allocations, dispatches, refunds, events] = await Promise.all([
    P.listForBooking(b.id),
    AL.listForBooking(b.id),
    D.listForBooking(b.id),
    P.listRefunds({ bookingId: b.id }),
    B.listEvents(b.id),
  ]);
  return ok(res, { ...b, payments, allocations, dispatches, refunds, events, actions: await actionsFor(req, b, auth), approval: WF.approvalBlock(state, auth) }, message, status);
};

// minimum advance of booking lines (season % / default %, and the season's minimum amount)
const advanceFor = (lines, rule) => setup.advanceRequired(lines, rule);

const capacityError = (problems) => {
  const parts = problems.map(
    (p) => `${p.name}: production plan ${A.fmtQty(p.limit)} ${p.unit}, already booked ${A.fmtQty(p.held)} — only ${A.fmtQty(p.available)} ${p.unit} left (this booking needs ${A.fmtQty(p.requested)})`,
  );
  return new HttpError(409, `Not enough quantity left for booking. ${parts.join(". ")}.`, { capacity: problems });
};

// advance recorded so far (posted + waiting for verification)
const advanceRecorded = (b) => r2(b.advance_received + b.advance_pending_verification);

// ---------------------------------------------------------------------
//  READ THE BOOKING FORM
// ---------------------------------------------------------------------
// body: { season_id, party_ledger_id, requested_delivery_from, requested_delivery_to, delivery_address,
//         preferred_godown_id, remarks, items: [{ stock_item_id, qty, remarks }] }
const readBooking = async (req, body, existing = null) => {
  const access = await A.getAccess(req);
  const today = A.todayIST();
  const seasonId = A.toId(body.season_id ?? existing?.season_id, "booking season");
  const season = await setup.getSeason(seasonId);
  if (!season) throw new HttpError(400, "Booking season not found");
  if (season.status !== "OPEN") throw new HttpError(400, `Bookings for ${season.name} are not open (season is ${season.display_label})`);
  // booking date = the day it is entered (kept when a draft is edited)
  const bookingDate = existing ? existing.booking_date : today;
  if (!access.isAdmin && (today < season.booking_start || today > season.booking_end)) {
    throw new HttpError(400, `${season.name} bookings are accepted from ${season.booking_start} to ${season.booking_end}`);
  }

  const partyId = A.toId(body.party_ledger_id ?? existing?.party_ledger_id, "party");
  const party = await setup.getParty(partyId);
  if (!party) throw new HttpError(400, "Party not found (select a distributor / dealer ledger)");
  const scope = await A.scopeIds(req);
  if (scope !== null && !(party.employee_under && A.canSeeUser(scope, party.employee_under))) {
    throw new HttpError(403, "You can book only for parties in your area");
  }

  const from = A.date(body.requested_delivery_from, "Requested delivery from");
  const to = A.date(body.requested_delivery_to, "Requested delivery to");
  if (from && to && from > to) throw new HttpError(400, "Requested delivery: From cannot be after To");
  if (season.delivery_start && from && from < season.delivery_start) throw new HttpError(400, `Deliveries for ${season.name} start on ${season.delivery_start}`);
  if (season.delivery_end && to && to > season.delivery_end) throw new HttpError(400, `Deliveries for ${season.name} end on ${season.delivery_end}`);
  const godownId = A.optId(body.preferred_godown_id, "godown");
  if (godownId && !(await setup.godownExists(godownId))) throw new HttpError(400, "Godown not found");

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) throw new HttpError(400, "Add at least one product to the booking");
  if (rawItems.length > 100) throw new HttpError(400, "Too many lines in one booking");
  const seen = new Set();
  const [products, schemes, advRule] = await Promise.all([
    setup.listSeasonProducts(seasonId, { bookableOnly: true }),
    setup.listSchemes(seasonId, { activeOnly: true }),
    setup.advanceRule(seasonId),
  ]);
  const byItem = new Map(products.map((p) => [Number(p.stock_item_id), p]));
  const items = [];
  for (let i = 0; i < rawItems.length; i++) {
    const it = rawItems[i] || {};
    const label = `Line ${i + 1}`;
    const stockItemId = A.toId(it.stock_item_id, `${label}: product`);
    if (seen.has(stockItemId)) throw new HttpError(400, `${label}: this product is already in the booking`);
    seen.add(stockItemId);
    const p = byItem.get(stockItemId);
    if (!p) throw new HttpError(400, `${label}: this product is not open for booking in ${season.name} (not in its price list, switched off, or its crop is not a ${season.season} crop)`);
    const unit = p.unit || "units";
    const q = A.qty(it.qty, `${label} (${p.item_name}): quantity`, { required: true, positive: true });
    if (p.min_qty > 0 && q < p.min_qty) throw new HttpError(400, `${label} (${p.item_name}): minimum per booking is ${A.fmtQty(p.min_qty)} ${unit}`);
    if (p.max_qty_per_party) {
      const already = await B.partyBookedQty(seasonId, partyId, stockItemId, existing ? existing.id : 0);
      if (already + q > p.max_qty_per_party) {
        throw new HttpError(400, `${label} (${p.item_name}): ${party.name} can book at most ${A.fmtQty(p.max_qty_per_party)} ${unit} this season (already booked ${A.fmtQty(already)}, so at most ${A.fmtQty(Math.max(p.max_qty_per_party - already, 0))} more)`);
      }
    }
    items.push({
      stock_item_id: stockItemId,
      crop_id: p.crop_id,
      item_name: p.item_name,
      qty: q,
      rate: p.booking_rate,
      mrp: p.mrp,
      gst_percent: p.gst_percent,
      amount: r2(q * p.booking_rate),
      discount_per_unit: 0,
      remarks: A.text(it.remarks, `${label}: remarks`, { max: 255 }) || null,
    });
  }
  for (const it of items) {
    const disc = pricing.lineDiscount(schemes, { stock_item_id: it.stock_item_id, qty: it.qty, rate: it.rate }, { bookingDate });
    it.discount_per_unit = disc.discount_per_unit;
  }
  // production plan (early, without a lock; checked again under a lock at submit)
  const problems = await setup.capacityProblems(db, seasonId, existing ? existing.id : 0, items);
  if (problems.length) throw capacityError(problems);
  const totals = pricing.bookingTotals(items);
  return {
    header: {
      season_id: seasonId,
      party_ledger_id: partyId,
      booked_by: existing ? existing.booked_by : req.user.id,
      booking_date: bookingDate,
      requested_delivery_from: from,
      requested_delivery_to: to,
      delivery_address: A.text(body.delivery_address, "Delivery address", { max: 500 }) || null,
      preferred_godown_id: godownId,
      ...totals,
      advance_required: advanceFor(items, advRule),
      remarks: A.text(body.remarks, "Remarks", { max: 1000 }) || null,
    },
    items,
    season,
    party,
  };
};

// ---------------------------------------------------------------------
//  LIST / READ
// ---------------------------------------------------------------------
// GET /abs/bookings?scope=mine|team|pending|all&status&season_id&party_id&search&flag=overdue|allocation|dispatch&page&limit
const listBookings = wrap(async (req, res) => {
  const scopeName = String(req.query.scope || "team").toLowerCase();
  const scope = await A.scopeIds(req);
  const STATUSES = Object.keys(B.STATUS_LABEL);
  const statusRaw = req.query.status ? String(req.query.status).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : [];
  for (const s of statusRaw) if (!STATUSES.includes(s)) throw new HttpError(400, `Unknown status ${s}`);
  const f = {
    status: statusRaw.length ? statusRaw : undefined,
    seasonId: A.optId(req.query.season_id, "season"),
    partyId: A.optId(req.query.party_id, "party"),
    search: A.text(req.query.search, "search", { max: 100 }),
    flag: ["overdue", "allocation", "dispatch"].includes(req.query.flag) ? req.query.flag : undefined,
    page: req.query.page,
    limit: req.query.limit,
    today: A.todayIST(),
  };
  if (scopeName === "mine") f.userIds = [req.user.id];
  else if (scopeName === "team") f.userIds = scope;
  else if (scopeName === "pending") {
    const access = await A.getAccess(req);
    f.ids = await AP.pendingEntityIds(ENTITY, req.user.id, { all: access.isAdmin, pool: access.codes.has(A.CODES.CONFIRM) });
    f.status = ["SUBMITTED"];
    f.userIds = null;
  } else if (scopeName === "all") {
    if (scope !== null) throw new HttpError(403, "You do not have permission to view all bookings");
    f.userIds = null;
  } else throw new HttpError(400, "scope must be mine, team, pending or all");
  return ok(res, await B.listBookings(f));
});

const getBooking = wrap(async (req, res) => {
  const b = await loadBooking(req);
  return respond(req, res, b.id);
});

// ---------------------------------------------------------------------
//  CREATE / EDIT / DELETE
// ---------------------------------------------------------------------
const createBooking = wrap(async (req, res) => {
  const { header, items } = await readBooking(req, req.body || {});
  const settings = await setup.getSettings();
  const id = await B.createBooking(header, items, req.user.id, settings.booking_prefix);
  return respond(req, res, id, "Booking saved as draft", 201);
});

const updateBooking = wrap(async (req, res) => {
  const b = await loadBooking(req);
  if (!isOwner(req, b)) throw new HttpError(403, "Only the person who made the booking can edit it");
  if (!EDITABLE.includes(b.status)) throw new HttpError(409, `This booking is ${b.status_label}; it can be edited only as Draft or Returned`);
  const { header, items } = await readBooking(req, req.body || {}, b);
  const r = await B.updateBooking(b.id, header, items, req.user.id);
  if (!r.ok) throw new HttpError(409, "This booking can no longer be edited");
  return respond(req, res, b.id, "Booking saved");
});

const deleteBooking = wrap(async (req, res) => {
  const b = await loadBooking(req);
  if (!isOwner(req, b) || b.status !== "DRAFT") throw new HttpError(409, "Only your own draft booking can be deleted");
  if ((await B.livePaymentCount(b.id)) > 0) throw new HttpError(409, "An advance is recorded on this booking; cancel the booking instead so the advance is refunded or carried forward");
  await B.softDelete(b.id);
  return ok(res, { id: b.id }, "Draft deleted");
});

// ---------------------------------------------------------------------
//  WORKFLOW
// ---------------------------------------------------------------------
const notifyConfirmers = (b, title, message) =>
  A.notifyCode(A.CODES.CONFIRM, { type: "ABS_APPROVED", bookingId: b.id, title, message }, [b.booked_by]);

// POST /abs/bookings/:id/submit
const submitBooking = wrap(async (req, res) => {
  const b = await loadBooking(req);
  if (!isOwner(req, b)) throw new HttpError(403, "Only the person who made the booking can submit it");
  if (!EDITABLE.includes(b.status)) throw new HttpError(409, `This booking is already ${b.status_label}`);
  if (!b.items.length) throw new HttpError(400, "Add at least one product before submitting");
  const season = await setup.getSeason(b.season_id);
  if (!season || season.status !== "OPEN") throw new HttpError(400, "This booking season is not open any more");
  const access = await A.getAccess(req);
  if (!access.isAdmin && !season.accepting_bookings) throw new HttpError(400, `${season.name}: ${season.display_label}`);
  const settings = await setup.getSettings();
  // the season's minimum advance (% / amount) may have changed since the draft was saved
  const required = advanceFor(b.items.map((it) => ({ qty: it.qty, rate: it.rate, discount_per_unit: it.discount_per_unit })), await setup.advanceRule(b.season_id));
  if (Math.abs(required - b.advance_required) > 0.005) {
    await db.query(`UPDATE abs_bookings SET advance_required = ? WHERE id = ? AND status IN ('DRAFT','RETURNED')`, [required, b.id]);
    b.advance_required = required;
  }
  if (settings.advance_at_booking) {
    const recorded = advanceRecorded(b);
    if (recorded + 0.005 < required) {
      throw new HttpError(400, `Collect the minimum advance before submitting: required ${A.fmtMoney(required)}, recorded ${A.fmtMoney(recorded)} — record ${A.fmtMoney(r2(required - recorded))} more`, {
        advance_required: required,
        advance_recorded: recorded,
      });
    }
  }
  // reserve the quantity against the production plan (under a lock, in the status change)
  const reserve = async (conn) => {
    const problems = await setup.capacityProblems(conn, b.season_id, b.id, b.items.map((it) => ({ stock_item_id: it.stock_item_id, qty: it.qty, item_name: it.item_name })));
    if (problems.length) throw capacityError(problems);
  };

  if (!settings.require_booking_approval) {
    const r = await B.moveBooking(b.id, { allowedFrom: EDITABLE, to: "APPROVED", sets: ["submitted_at = NOW()", "approved_at = NOW()", "return_remark = NULL"], event: "SUBMITTED", detail: "No approval needed (Settings)", userId: req.user.id, extra: reserve });
    if (!r.ok) throw new HttpError(409, "This booking was already submitted");
    await notifyConfirmers(b, "Advance booking to confirm", `${b.booked_by_name}'s booking ${b.booking_no} for ${b.party_name} (${A.fmtMoney(b.net_value)}) is ready for order confirmation.`);
    return respond(req, res, b.id, "Submitted — waiting for order confirmation");
  }

  const levels = await WF.chainFor(b.booked_by, { excludeIds: b.created_by !== b.booked_by ? [b.created_by] : [] });
  const r = await B.moveBooking(b.id, {
    allowedFrom: EDITABLE,
    to: "SUBMITTED",
    sets: ["submitted_at = NOW()", "return_remark = NULL"],
    event: "SUBMITTED",
    detail: `Approval levels: ${levels.map((l) => `L${l.level_no} ${l.approver_name || l.approver_role}`).join(" → ")}`,
    userId: req.user.id,
    extra: async (conn) => {
      await reserve(conn);
      return AP.createRound(conn, ENTITY, b.id, levels);
    },
  });
  if (!r.ok) throw new HttpError(409, "This booking was already submitted");
  const state = await WF.getState(ENTITY, b.id);
  if (state.current) {
    const to = state.current.approver_id ? [state.current.approver_id] : await AP.adminUserIds();
    await A.notify(to, {
      type: "ABS_SUBMITTED",
      bookingId: b.id,
      title: "Advance booking for approval",
      message: `${b.booked_by_name} booked ${A.fmtQty(b.total_qty)} units (${A.fmtMoney(b.net_value)}) for ${b.party_name} — ${b.booking_no}. Level ${state.current.level_no} of ${state.total_levels}.`,
    });
  }
  return respond(req, res, b.id, levels[0] && levels[0].approver_name ? `Submitted for approval to ${levels[0].approver_name}` : "Submitted for approval");
});

const decide = (decision) =>
  wrap(async (req, res) => {
    const b = await loadBooking(req);
    if (b.status !== "SUBMITTED") throw new HttpError(409, `This booking is ${b.status_label}`);
    const { state, auth } = await approvalOf(req, b);
    if (!auth || !auth.can) throw new HttpError(403, (auth && auth.reason) || "You cannot decide this booking");
    const remark = A.text(req.body && (req.body.remark ?? req.body.comment), "Comment", { max: 500 }) || null;
    if (decision !== "APPROVE" && (!remark || remark.length < 3)) throw new HttpError(400, "Please add a comment");
    const step = state.current;
    const final = decision === "APPROVE" && auth.final;
    const level = `Level ${step.level_no} of ${state.total_levels}${auth.as === "ADMIN" && step.approver_kind !== "ADMIN" ? " (admin approval)" : ""}`;
    const to = decision === "APPROVE" ? (final ? "APPROVED" : "SUBMITTED") : decision === "RETURN" ? "RETURNED" : "REJECTED";
    let refunded = 0;
    const sets = [];
    const params = [];
    if (final) sets.push("approved_at = NOW()");
    if (decision !== "APPROVE") {
      sets.push("return_remark = ?");
      params.push(remark);
    }
    const r = await B.moveBooking(b.id, {
      allowedFrom: ["SUBMITTED"],
      to,
      sets,
      params,
      event: decision === "APPROVE" ? (final ? "APPROVED" : "LEVEL_APPROVED") : decision === "RETURN" ? "RETURNED" : "REJECTED",
      detail: level,
      remark,
      userId: req.user.id,
      extra: async (conn) => {
        const out = await WF.applyDecision(conn, ENTITY, b.id, { expectedStepId: step.id, decision, actorId: req.user.id, actedAs: auth.as, remark, final });
        // a rejected booking will not be supplied: its posted advance is refunded / carried forward
        if (decision === "REJECT") refunded = await settleAdvance(conn, b, { rule: (await setup.getSettings()).cancellation_refund_rule, reason: `Booking rejected: ${remark}`, userId: req.user.id });
        return out;
      },
    });
    if (!r.ok) throw new HttpError(409, "This booking was already decided");
    const actorName = (await userName(req.user.id)) || "the approver";
    await AP.clearActionNotifications(b.id, ["ABS_SUBMITTED"]);
    if (decision === "APPROVE" && final) {
      await A.notify([b.booked_by], { type: "ABS_APPROVED", bookingId: b.id, title: "Booking approved", message: `${b.booking_no} for ${b.party_name} was approved by ${actorName}. It now goes for order confirmation.` });
      await notifyConfirmers(b, "Advance booking to confirm", `${b.booking_no} — ${b.party_name}, ${A.fmtMoney(b.net_value)} (booked by ${b.booked_by_name}) is approved and waiting for order confirmation.`);
    } else if (decision === "APPROVE") {
      const next = (await WF.getState(ENTITY, b.id)).current;
      await A.notify([b.booked_by], { type: "ABS_LEVEL_APPROVED", bookingId: b.id, title: `Booking approved at Level ${step.level_no}`, message: `${b.booking_no} was approved by ${actorName}; now with ${next ? next.approver_name || "Admin / Super Admin" : "the next approver"}.` });
      if (next) {
        await A.notify(next.approver_id ? [next.approver_id] : await AP.adminUserIds(), {
          type: "ABS_SUBMITTED",
          bookingId: b.id,
          title: "Advance booking for approval",
          message: `${b.booked_by_name}'s booking ${b.booking_no} for ${b.party_name} (${A.fmtMoney(b.net_value)}) was approved by ${actorName} and needs your approval — Level ${next.level_no} of ${state.total_levels}.`,
        });
      }
    } else {
      await A.notify([b.booked_by], {
        type: decision === "RETURN" ? "ABS_RETURNED" : "ABS_REJECTED",
        bookingId: b.id,
        title: decision === "RETURN" ? "Booking returned for changes" : "Booking rejected",
        message: `${b.booking_no} (${b.party_name}) was ${decision === "RETURN" ? "returned" : "rejected"} by ${actorName}: ${remark}`,
      });
    }
    const message = decision === "APPROVE" ? (final ? "Booking approved — sent for order confirmation" : `Approved at Level ${step.level_no}. Sent to the next approver.`) : decision === "RETURN" ? "Returned for changes" : `Booking rejected${refunded > 0 ? `; advance ${A.fmtMoney(refunded)} marked for refund / carry forward` : ""}`;
    return respond(req, res, b.id, message);
  });

// recompute booking value on the quantity the company will supply
// (minimum advance: season % / minimum amount — see advanceFor)
const recalcValues = async (conn, bookingId, advRule) => {
  const [rows] = await conn.query(`SELECT stock_item_id, qty, confirmed_qty, cancelled_qty, rate, discount_per_unit FROM abs_booking_items WHERE booking_id = ?`, [bookingId]);
  const lines = rows.map((r) => ({ stock_item_id: r.stock_item_id, qty: (r.confirmed_qty === null ? Number(r.qty) : Number(r.confirmed_qty)) - Number(r.cancelled_qty), rate: r.rate, discount_per_unit: r.discount_per_unit }));
  const t = pricing.bookingTotals(lines);
  const advance = advanceFor(lines, advRule);
  await conn.query(`UPDATE abs_bookings SET gross_value = ?, scheme_discount = ?, net_value = ?, advance_required = ? WHERE id = ?`, [t.gross_value, t.scheme_discount, t.net_value, advance, bookingId]);
  return { ...t, advance_required: advance };
};

// POST /abs/bookings/:id/confirm { items: [{ id, confirmed_qty }], advance_due_date, remark }
// Order confirmation after checking the production / stock position. Less than booked = short supply.
const confirmBooking = wrap(async (req, res) => {
  await A.assertCan(req, A.CODES.CONFIRM, "You do not have permission to confirm bookings");
  const b = await loadBooking(req);
  if (b.status !== "APPROVED") throw new HttpError(409, `Only an approved booking can be confirmed (this one is ${b.status_label})`);
  const body = req.body || {};
  const given = new Map((Array.isArray(body.items) ? body.items : []).map((x) => [Number(x.id), x]));
  for (const id of given.keys()) {
    if (!b.items.some((it) => it.id === id)) throw new HttpError(400, "A confirmed line does not belong to this booking. Refresh and try again.");
  }
  const lines = b.items.map((it) => {
    const g = given.get(it.id);
    const q = g && g.confirmed_qty !== undefined && g.confirmed_qty !== "" ? A.qty(g.confirmed_qty, `${it.item_name}: confirmed qty`, { required: true }) : it.qty;
    if (q > it.qty) throw new HttpError(400, `${it.item_name}: confirmed qty cannot be more than booked (${it.qty})`);
    return { id: it.id, item_name: it.item_name, qty: it.qty, confirmed: q };
  });
  if (!lines.some((l) => l.confirmed > 0)) throw new HttpError(400, "Confirm at least one product, or reject / cancel the booking");
  const settings = await setup.getSettings();
  const advRule = await setup.advanceRule(b.season_id);
  const dueDate = A.date(body.advance_due_date, "Advance due date") || (settings.advance_at_booking ? A.todayIST() : A.addDays(A.todayIST(), settings.advance_due_days));
  const remark = A.text(body.remark, "Remark", { max: 500 }) || null;
  const short = lines.filter((l) => l.confirmed < l.qty);
  const access = await A.getAccess(req);
  // advance with the booking: confirm only after accounts verified it (Admin may override with a remark)
  const override = !!(body.override_advance === true || body.override_advance === "1" || body.override_advance === "true");
  if (override && !access.isAdmin) throw new HttpError(403, "Only Admin / Super Admin can confirm without the verified advance");
  if (override && (!remark || remark.length < 3)) throw new HttpError(400, "Give the reason for confirming without the verified advance");
  const r = await B.moveBooking(b.id, {
    allowedFrom: ["APPROVED"],
    to: "CONFIRMED",
    sets: ["confirmed_by = ?", "confirmed_at = NOW()", "confirmation_remark = ?", "advance_due_date = ?"],
    params: [req.user.id, remark, dueDate],
    event: "CONFIRMED",
    detail: `${short.length ? `Short supply: ${short.map((l) => `${l.item_name} ${l.confirmed}/${l.qty}`).join(", ")}` : "Confirmed in full"}${override ? " — confirmed WITHOUT the verified advance (admin)" : ""}`,
    remark,
    userId: req.user.id,
    extra: async (conn) => {
      for (const l of lines) await conn.query(`UPDATE abs_booking_items SET confirmed_qty = ? WHERE id = ? AND booking_id = ?`, [l.confirmed, l.id, b.id]);
      const t = await recalcValues(conn, b.id, advRule);
      if (settings.advance_at_booking && !override) {
        const posted = await P.postedTotal(b.id, { runner: conn });
        if (posted + 0.005 < t.advance_required) {
          throw new HttpError(409, `The minimum advance is not verified yet: required ${A.fmtMoney(t.advance_required)}, posted by accounts ${A.fmtMoney(posted)}${b.advance_pending_verification > 0 ? ` (${A.fmtMoney(b.advance_pending_verification)} waiting for verification)` : ""}`, {
            advance_required: t.advance_required,
            advance_received: posted,
          });
        }
      }
      return t;
    },
  });
  if (!r.ok) throw new HttpError(409, "This booking was already confirmed");
  const fresh = await B.getBooking(b.id, { today: A.todayIST() });
  await AP.clearActionNotifications(b.id, ["ABS_APPROVED"]);
  await A.notify([b.booked_by], {
    type: "ABS_CONFIRMED",
    bookingId: b.id,
    title: "Booking confirmed",
    message: `${b.booking_no} for ${b.party_name} is confirmed${short.length ? " (part quantity — short supply)" : ""}. Value ${A.fmtMoney(fresh.net_value)}; advance ${A.fmtMoney(fresh.advance_required)} due by ${dueDate}${fresh.advance_shortfall > 0 ? ` (pending ${A.fmtMoney(fresh.advance_shortfall)})` : ""}.`,
  });
  await A.notifyCode(A.CODES.ALLOCATE, { type: "ABS_CONFIRMED", bookingId: b.id, title: "Booking confirmed — allocate stock", message: `${b.booking_no} (${b.party_name}) is confirmed and needs stock allocation.` }, [b.booked_by]);
  return respond(req, res, b.id, "Booking confirmed");
});

// status from quantities: nothing dispatched → CONFIRMED; part → PARTIALLY_DISPATCHED;
// all → DISPATCHED; all dispatched and every dispatch delivered → DELIVERED
const recalcStatus = async (conn, bookingId) => {
  const [[row]] = await conn.query(`SELECT status FROM abs_bookings WHERE id = ? FOR UPDATE`, [bookingId]);
  if (!row || !["CONFIRMED", "PARTIALLY_DISPATCHED", "DISPATCHED", "DELIVERED"].includes(row.status)) return row ? row.status : null;
  const [[q]] = await conn.query(
    `SELECT COALESCE(SUM(COALESCE(confirmed_qty, qty) - cancelled_qty), 0) AS supply, COALESCE(SUM(dispatched_qty), 0) AS dispatched
     FROM abs_booking_items WHERE booking_id = ?`,
    [bookingId],
  );
  const supply = r3(Number(q.supply));
  const dispatched = r3(Number(q.dispatched));
  let status = "CONFIRMED";
  if (dispatched > 0 && dispatched < supply) status = "PARTIALLY_DISPATCHED";
  if (supply > 0 && dispatched >= supply) {
    status = (await D.openDispatchCount(conn, bookingId)) === 0 ? "DELIVERED" : "DISPATCHED";
  }
  if (status !== row.status) {
    await conn.query(`UPDATE abs_bookings SET status = ? WHERE id = ?`, [status, bookingId]);
    await B.addEvent(conn, { bookingId, event: "STATUS", fromStatus: row.status, toStatus: status, detail: `Dispatched ${dispatched} of ${supply}` });
  }
  return status;
};

// unadjusted advance of a booking that will not be supplied any more → refund (or carry forward)
const settleAdvance = async (conn, booking, { rule, reason, userId }) => {
  const left = await P.unadjustedAdvance(conn, booking.id);
  if (left <= 0) return 0;
  await P.createRefund(conn, { bookingId: booking.id, amount: left, reason, status: rule === "CARRY_FORWARD" ? "CARRIED_FORWARD" : "DUE", userId });
  return left;
};

// POST /abs/bookings/:id/cancel { reason, refund_rule?: REFUND | CARRY_FORWARD }
const cancelBooking = wrap(async (req, res) => {
  const b = await loadBooking(req);
  const access = await A.getAccess(req);
  const office = A.hasCode(access, A.CODES.CONFIRM);
  const ownerAllowed = OPEN_FOR_CANCEL_BY_OWNER.includes(b.status) && isOwner(req, b);
  const officeAllowed = (OPEN_FOR_CANCEL_BY_OWNER.includes(b.status) || SUPPLY_STATUSES.includes(b.status)) && office;
  if (!ownerAllowed && !officeAllowed) {
    throw new HttpError(SUPPLY_STATUSES.includes(b.status) ? 403 : 409, SUPPLY_STATUSES.includes(b.status) ? "A confirmed booking can be cancelled only by the office (Confirm permission)" : `This booking is ${b.status_label} and cannot be cancelled`);
  }
  const body = req.body || {};
  const reason = A.text(body.reason ?? body.comment, "Reason", { required: true, max: 500 });
  if (reason.length < 3) throw new HttpError(400, "Please give the reason for cancelling");
  const settings = await setup.getSettings();
  const rule = body.refund_rule ? A.oneOf(body.refund_rule, "Refund rule", ["REFUND", "CARRY_FORWARD"]) : settings.cancellation_refund_rule;
  const anyDispatched = b.dispatched_qty > 0;
  let released = 0;
  let advance = 0;
  const r = await B.moveBooking(b.id, {
    allowedFrom: [...OPEN_FOR_CANCEL_BY_OWNER, ...SUPPLY_STATUSES],
    to: anyDispatched ? "CLOSED" : "CANCELLED",
    sets: ["cancelled_by = ?", "cancelled_at = NOW()", "cancel_reason = ?", ...(anyDispatched ? ["closed_by = ?", "closed_at = NOW()"] : [])],
    params: [req.user.id, reason, ...(anyDispatched ? [req.user.id] : [])],
    event: anyDispatched ? "SHORT_CLOSED" : "CANCELLED",
    remark: reason,
    userId: req.user.id,
    extra: async (conn, row) => {
      released = await AL.releaseAllForBooking(conn, b.id, { reason: `Booking cancelled: ${reason}`, userId: req.user.id });
      // what is not dispatched will not be supplied
      await conn.query(`UPDATE abs_booking_items SET cancelled_qty = GREATEST(COALESCE(confirmed_qty, qty) - dispatched_qty, 0) WHERE booking_id = ?`, [b.id]);
      if (row.status === "SUBMITTED") {
        const round = await AP.lastRound(conn, ENTITY, b.id);
        await AP.skipOpen(conn, ENTITY, b.id, round);
      }
      advance = await settleAdvance(conn, b, { rule, reason: `Cancelled: ${reason}`, userId: req.user.id });
    },
  });
  if (!r.ok) throw new HttpError(409, `This booking is ${B.STATUS_LABEL[r.current] || r.current}`);
  await AP.clearActionNotifications(b.id, ["ABS_SUBMITTED", "ABS_APPROVED"]);
  if (b.booked_by !== req.user.id) {
    await A.notify([b.booked_by], { type: "ABS_CANCELLED", bookingId: b.id, title: anyDispatched ? "Booking short-closed" : "Booking cancelled", message: `${b.booking_no} (${b.party_name}) was ${anyDispatched ? "closed for the balance quantity" : "cancelled"}: ${reason}.${advance > 0 ? ` Advance ${A.fmtMoney(advance)} ${rule === "CARRY_FORWARD" ? "carried forward" : "to be refunded"}.` : ""}` });
  }
  return respond(req, res, b.id, `${anyDispatched ? "Balance quantity closed" : "Booking cancelled"}${released > 0 ? `; ${released} units of stock released` : ""}${advance > 0 ? `; advance ${A.fmtMoney(advance)} ${rule === "CARRY_FORWARD" ? "carried forward" : "marked for refund"}` : ""}`);
});

// POST /abs/bookings/:id/items/:itemId/short-close { qty, reason } — supply less than confirmed
const shortCloseItem = wrap(async (req, res) => {
  await A.assertCan(req, A.CODES.CONFIRM, "You do not have permission to change confirmed quantities");
  const b = await loadBooking(req);
  if (!SUPPLY_STATUSES.includes(b.status)) throw new HttpError(409, `This booking is ${b.status_label}`);
  const item = b.items.find((x) => x.id === Number(req.params.itemId));
  if (!item) throw new HttpError(404, "Booking line not found");
  const body = req.body || {};
  const q = A.qty(body.qty, "Quantity to close", { required: true, positive: true });
  const reason = A.text(body.reason, "Reason", { required: true, max: 255 });
  const notDispatched = r3(item.supply_qty - item.dispatched_qty);
  if (q > notDispatched) throw new HttpError(400, `Only ${notDispatched} of ${item.item_name} is not yet dispatched`);
  const advRule = await setup.advanceRule(b.season_id);
  const r = await B.moveBooking(b.id, {
    allowedFrom: SUPPLY_STATUSES,
    event: "LINE_SHORT_CLOSED",
    detail: `${item.item_name}: ${q} closed`,
    remark: reason,
    userId: req.user.id,
    extra: async (conn) => {
      // release reservations that would exceed the new supply quantity
      const after = r3(item.supply_qty - q);
      let excess = r3(item.allocated_qty - after);
      if (excess > 0) {
        const [allocs] = await conn.query(`SELECT * FROM abs_allocations WHERE booking_item_id = ? AND status = 'ACTIVE' ORDER BY id DESC FOR UPDATE`, [item.id]);
        for (const a of allocs) {
          if (excess <= 0) break;
          const open = r3(Number(a.qty) - Number(a.dispatched_qty));
          if (open <= excess) {
            excess = r3(excess - (await AL.releaseAllocation(conn, { ...a, qty: Number(a.qty), dispatched_qty: Number(a.dispatched_qty) }, { reason, userId: req.user.id })));
          } else {
            await conn.query(`UPDATE abs_allocations SET qty = qty - ? WHERE id = ?`, [excess, a.id]);
            await conn.query(`UPDATE abs_booking_items SET allocated_qty = allocated_qty - ? WHERE id = ?`, [excess, item.id]);
            excess = 0;
          }
        }
      }
      await conn.query(`UPDATE abs_booking_items SET cancelled_qty = cancelled_qty + ? WHERE id = ?`, [q, item.id]);
      await recalcValues(conn, b.id, advRule);
      await recalcStatus(conn, b.id);
    },
  });
  if (!r.ok) throw new HttpError(409, "This booking changed; please refresh");
  return respond(req, res, b.id, `${q} of ${item.item_name} closed`);
});

// POST /abs/bookings/:id/close — after delivery; unadjusted advance becomes a refund
const closeBooking = wrap(async (req, res) => {
  await A.assertCan(req, A.CODES.CONFIRM, "You do not have permission to close bookings");
  const b = await loadBooking(req);
  if (!["DELIVERED", "DISPATCHED"].includes(b.status)) throw new HttpError(409, "Only a fully dispatched / delivered booking can be closed");
  const settings = await setup.getSettings();
  const remark = A.text((req.body || {}).remark, "Remark", { max: 500 }) || null;
  let advance = 0;
  const r = await B.moveBooking(b.id, {
    allowedFrom: ["DELIVERED", "DISPATCHED"],
    to: "CLOSED",
    sets: ["closed_by = ?", "closed_at = NOW()"],
    params: [req.user.id],
    event: "CLOSED",
    remark,
    userId: req.user.id,
    extra: async (conn) => {
      advance = await settleAdvance(conn, b, { rule: settings.cancellation_refund_rule, reason: "Booking closed with unadjusted advance", userId: req.user.id });
    },
  });
  if (!r.ok) throw new HttpError(409, "This booking changed; please refresh");
  return respond(req, res, b.id, advance > 0 ? `Booking closed; ${A.fmtMoney(advance)} advance left over (${settings.cancellation_refund_rule === "CARRY_FORWARD" ? "carried forward" : "refund due"})` : "Booking closed");
});

// GET /abs/seasons/:id/availability — per product: production plan, booked, still available
// (the booking form shows it; figures come from the live bookings)
const getAvailability = wrap(async (req, res) => {
  const s = await setup.getSeason(A.toId(req.params.id, "season id"));
  const me = await A.meBlock(req);
  if (!s || (s.status === "DRAFT" && !me.can_view_all)) throw new HttpError(404, "Booking season not found");
  const [products, rule] = await Promise.all([setup.listSeasonProducts(s.id, { bookableOnly: true }), setup.advanceRule(s.id)]);
  return ok(res, {
    season_id: s.id,
    accepting_bookings: s.accepting_bookings,
    min_advance_pct: rule.pct,
    min_advance_amount: rule.min_amount,
    products: products.map((p) => ({
      stock_item_id: p.stock_item_id,
      item_name: p.item_name,
      crop_id: p.crop_id,
      crop_name: p.crop_name,
      production_qty: p.production_qty,
      booked_qty: p.booked_qty,
      available_qty: p.available_qty,
    })),
  });
});

const getHistory = wrap(async (req, res) => {
  const b = await loadBooking(req);
  const { state, auth } = await approvalOf(req, b);
  return ok(res, { events: await B.listEvents(b.id), approval: WF.approvalBlock(state, auth) });
});

module.exports = {
  ENTITY,
  userName,
  loadBooking,
  respond,
  recalcStatus,
  listBookings,
  getBooking,
  createBooking,
  updateBooking,
  deleteBooking,
  submitBooking,
  approveBooking: decide("APPROVE"),
  returnBooking: decide("RETURN"),
  rejectBooking: decide("REJECT"),
  confirmBooking,
  cancelBooking,
  shortCloseItem,
  closeBooking,
  getHistory,
  getAvailability,
  advanceFor,
};
