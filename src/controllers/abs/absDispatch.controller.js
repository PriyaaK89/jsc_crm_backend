// ABS dispatch and delivery.
//   Dispatch = one vehicle from one godown: reserved stock goes out on a normal Sales invoice
//   (the existing Sales posting: stock out, GST, party ledger, bill reference), and the
//   booking advance is adjusted against that invoice.
//   Delivery = the field officer / party confirms receipt (received, damaged, short) with POD.
const db = require("../../config/db");
const B = require("../../models/abs/absBooking.model");
const AL = require("../../models/abs/absAllocation.model");
const D = require("../../models/abs/absDispatch.model");
const P = require("../../models/abs/absPayment.model");
const setup = require("../../models/abs/absSetup.model");
const { executeApprovedSales } = require("../../services/sales/createSalesTransaction.service");
const { uploadFileToMinio } = require("../../utils/fileUpload");
const pricing = require("../../services/abs/absPricing");
const BC = require("./absBooking.controller");
const A = require("./absHelpers");

const { HttpError, wrap, ok } = A;
const r2 = pricing.round2;
const r3 = pricing.round3;
const SUPPLY = ["CONFIRMED", "PARTIALLY_DISPATCHED"];

const parseList = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) {
    try {
      const x = JSON.parse(v);
      return Array.isArray(x) ? x : [];
    } catch (_) {
      throw new HttpError(400, "items must be a JSON list");
    }
  }
  return [];
};

const companyStateCode = async (settings) => settings.company_state_code || pricing.stateCodeOf(await setup.companyGstin());

// ---------------------------------------------------------------------
//  DISPATCH
// ---------------------------------------------------------------------
// GET /abs/bookings/:id/dispatch-preview?godown_id — open allocations + the invoice it would make
const previewDispatch = wrap(async (req, res) => {
  await A.assertCan(req, A.CODES.DISPATCH, "You do not have permission to dispatch");
  const b = await BC.loadBooking(req);
  const allocs = (await AL.listForBooking(b.id)).filter((a) => a.status === "ACTIVE" && a.open_qty > 0);
  const settings = await setup.getSettings();
  const party = await setup.getParty(b.party_ledger_id);
  const taxMode = pricing.taxModeFor(await companyStateCode(settings), party && party.gst_no);
  const godowns = [...new Map(allocs.map((a) => [a.godown_id, { godown_id: a.godown_id, godown_name: a.godown_name }])).values()];
  return ok(res, { booking_id: b.id, tax_mode: taxMode, sales_ledger_id: settings.sales_ledger_id, payment_rule: settings.dispatch_payment_rule, godowns, allocations: allocs, advance_unadjusted: b.advance_unadjusted });
});

// POST /abs/bookings/:id/dispatches
// { godown_id, dispatch_date, lines: [{ allocation_id, qty }] (default: everything reserved in that godown),
//   vehicle_no, transport_name, driver_name, driver_mobile, lr_no, eway_number, transport_freight,
//   destination, remarks, tax_mode?, sales_ledger_id? }
const createDispatch = wrap(async (req, res) => {
  await A.assertCan(req, A.CODES.DISPATCH, "You do not have permission to dispatch");
  const b = await BC.loadBooking(req);
  if (!SUPPLY.includes(b.status)) throw new HttpError(409, `Only a confirmed booking can be dispatched (this one is ${b.status_label})`);
  const body = req.body || {};
  const settings = await setup.getSettings();
  const godownId = A.toId(body.godown_id, "dispatch godown");
  const dispatchDate = A.date(body.dispatch_date, "Dispatch date") || A.todayIST();
  if (dispatchDate > A.todayIST()) throw new HttpError(400, "Dispatch date cannot be in the future");
  const salesLedgerId = A.optId(body.sales_ledger_id, "sales ledger") || settings.sales_ledger_id;
  if (!salesLedgerId) throw new HttpError(400, "Select the Sales ledger (or set it in Advance Booking Settings)");
  const vehicleNo = A.text(body.vehicle_no, "Vehicle no.", { required: true, max: 30 }).toUpperCase();
  const party = await setup.getParty(b.party_ledger_id);
  if (!party) throw new HttpError(400, "Party ledger not found");
  const autoMode = pricing.taxModeFor(await companyStateCode(settings), party.gst_no);
  const taxMode = body.tax_mode ? A.oneOf(body.tax_mode, "Tax mode", ["CGST_SGST", "IGST"]) : autoMode;

  const allAllocs = (await AL.listForBooking(b.id)).filter((a) => a.status === "ACTIVE" && a.godown_id === godownId && a.open_qty > 0);
  if (!allAllocs.length) throw new HttpError(400, "No stock is reserved for this booking in that godown. Allocate stock first.");
  const reqLines = parseList(body.lines);
  const lines = reqLines.length
    ? reqLines.map((l, i) => ({ allocationId: A.toId(l.allocation_id, `Line ${i + 1}: allocation`), qty: A.qty(l.qty, `Line ${i + 1}: quantity`, { required: true, positive: true }) }))
    : allAllocs.map((a) => ({ allocationId: a.id, qty: a.open_qty }));

  const transport = {
    vehicle_no: vehicleNo,
    transport_name: A.text(body.transport_name, "Transporter", { max: 120 }) || null,
    driver_name: A.text(body.driver_name, "Driver name", { max: 100 }) || null,
    driver_mobile: A.text(body.driver_mobile, "Driver mobile", { max: 20 }) || null,
    lr_no: A.text(body.lr_no, "LR / bilty no.", { max: 60 }) || null,
    eway_number: A.text(body.eway_number, "E-way bill no.", { max: 30 }) || null,
    transport_freight: A.money(body.transport_freight, "Freight") ?? 0,
    destination: A.text(body.destination, "Destination", { max: 200 }) || b.delivery_address || party.location || null,
    remarks: A.text(body.remarks, "Remarks", { max: 500 }) || null,
  };
  const schemes = (await setup.listSchemes(b.season_id, { activeOnly: true })).filter((s) => s.scheme_type === "ADVANCE_PAYMENT");

  const conn = await db.getConnection();
  let dispatchId;
  let summary;
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(`SELECT status FROM abs_bookings WHERE id = ? FOR UPDATE`, [b.id]);
    if (!row || !SUPPLY.includes(row.status)) throw new HttpError(409, "This booking changed; please refresh");

    // advance-payment scheme: % of booking value paid by the scheme date
    const advancePctBy = async (date) => (b.net_value > 0 ? ((await P.postedTotal(b.id, { byDate: date, runner: conn })) / b.net_value) * 100 : 0);
    const advPct = {};
    for (const s of schemes) advPct[s.valid_till || ""] = await advancePctBy(s.valid_till || null);

    const dLines = [];
    for (const l of lines) {
      const a = await AL.lockAllocation(conn, l.allocationId);
      if (!a || a.booking_id !== b.id) throw new HttpError(400, "Allocation does not belong to this booking");
      if (a.status !== "ACTIVE" || a.godown_id !== godownId) throw new HttpError(400, `Allocation ${a.id} is not open stock in this godown`);
      if (l.qty > a.open_qty) throw new HttpError(400, `Only ${a.open_qty} reserved on allocation ${a.id}`);
      const item = b.items.find((x) => x.id === a.booking_item_id);
      const extra = pricing.lineDiscount(schemes, { stock_item_id: item.stock_item_id, qty: item.supply_qty, rate: item.rate }, { advancePctBy: (d) => advPct[d || ""] });
      const discount = Math.min(r2(item.discount_per_unit + extra.discount_per_unit), item.rate);
      const netRate = r2(item.rate - discount);
      dLines.push({
        booking_item_id: item.id,
        allocation_id: a.id,
        stock_item_id: item.stock_item_id,
        unit_id: item.unit_id,
        godown_id: godownId,
        batch_no: a.batch_no,
        qty: l.qty,
        rate: item.rate,
        discount_per_unit: discount,
        net_rate: netRate,
        gst_percent: item.gst_percent,
        amount: r2(l.qty * netRate),
        item_name: item.item_name,
      });
    }
    const invLines = dLines.map((l) => pricing.invoiceLine(l, taxMode));
    const totals = pricing.invoiceTotals(invLines);

    // payment rule before goods leave
    const unadjusted = await P.unadjustedAdvance(conn, b.id);
    if (settings.dispatch_payment_rule === "FULL_PAYMENT" && unadjusted + 0.5 < totals.total_amount) {
      throw new HttpError(400, `Full payment is required before dispatch. Invoice ${A.fmtMoney(totals.total_amount)}, advance available ${A.fmtMoney(unadjusted)}`);
    }
    if (settings.dispatch_payment_rule === "MIN_PERCENT") {
      const paid = await P.postedTotal(b.id, { runner: conn });
      const pct = b.net_value > 0 ? (paid / b.net_value) * 100 : 0;
      if (pct + 0.001 < settings.dispatch_min_paid_pct) {
        throw new HttpError(400, `At least ${settings.dispatch_min_paid_pct}% of the booking value must be received before dispatch (received ${Math.round(pct * 10) / 10}%)`);
      }
    }

    const creditDays = Number(party.default_credit_period || 0);
    const payload = {
      sales_date: dispatchDate,
      reference_no: b.booking_no,
      customer_ledger_id: b.party_ledger_id,
      sales_ledger_id: salesLedgerId,
      assign_employee_id: b.booked_by,
      employee_under_id: null,
      is_consignee: 0,
      dispatch_doc_no: transport.lr_no,
      transport_name: transport.transport_name,
      destination: transport.destination,
      bill_t_no: transport.lr_no,
      vehicle_no: transport.vehicle_no,
      transport_freight: transport.transport_freight,
      local_freight: 0,
      load_freight: 0,
      unload_freight: 0,
      eway_number: transport.eway_number,
      transporter_gst: null,
      delivery_place: transport.destination,
      is_supercash_sale: 0,
      ...totals,
      tax_mode: taxMode,
      narration: `Advance booking ${b.booking_no} (${b.season_name})`,
      items: invLines,
      extra_ledgers: [],
      reference_type: "NEW REF",
      due_date: creditDays > 0 ? A.addDays(dispatchDate, creditDays) : dispatchDate,
    };
    const sale = await executeApprovedSales(conn, payload, req.user.id);

    const no = await D.nextDispatchNo(conn, dispatchDate.slice(0, 4));
    const adjust = r2(Math.min(unadjusted, totals.total_amount));
    dispatchId = await D.insertDispatch(
      conn,
      {
        dispatch_no: no,
        booking_id: b.id,
        dispatch_date: dispatchDate,
        godown_id: godownId,
        sale_id: sale.saleId,
        invoice_no: sale.voucher_no || null,
        ...transport,
        tax_mode: taxMode,
        total_qty: r3(dLines.reduce((s, l) => s + l.qty, 0)),
        taxable_value: totals.subtotal,
        scheme_discount: r2(dLines.reduce((s, l) => s + l.qty * l.discount_per_unit, 0)),
        tax_total: totals.tax_total,
        invoice_amount: totals.total_amount,
        advance_adjusted: adjust,
        dispatched_by: req.user.id,
      },
      dLines,
    );
    for (const l of dLines) {
      await AL.consume(conn, l.allocation_id, l.qty);
      await conn.query(`UPDATE abs_booking_items SET dispatched_qty = dispatched_qty + ? WHERE id = ?`, [l.qty, l.booking_item_id]);
    }
    // the booking advance pays (part of) this invoice
    if (adjust > 0) {
      const sbr = await D.salesBillRefOf(conn, sale.saleId);
      if (sbr) await D.adjustBillPending(conn, sbr.id, r2(Math.min(adjust, Number(sbr.pending_amount))));
      await D.insertAdjustment(conn, { bookingId: b.id, dispatchId, saleId: sale.saleId, sbrId: sbr ? sbr.id : null, amount: adjust, userId: req.user.id });
    }
    await B.addEvent(conn, {
      bookingId: b.id,
      event: "DISPATCHED",
      detail: `${no} · Invoice ${sale.voucher_no || sale.saleId} · ${A.fmtMoney(totals.total_amount)} · ${transport.vehicle_no}${adjust > 0 ? ` · advance adjusted ${A.fmtMoney(adjust)}` : ""}`,
      userId: req.user.id,
    });
    await BC.recalcStatus(conn, b.id);
    await conn.commit();
    summary = { no, invoice: sale.voucher_no || sale.saleId, total: totals.total_amount, adjust };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  await A.notify([b.booked_by], {
    type: "ABS_DISPATCHED",
    bookingId: b.id,
    title: "Booking dispatched",
    message: `${b.booking_no} (${b.party_name}): ${summary.no}, invoice ${summary.invoice} ${A.fmtMoney(summary.total)} on vehicle ${transport.vehicle_no}${transport.lr_no ? `, LR ${transport.lr_no}` : ""}. Please confirm delivery with the party.`,
  });
  return ok(res, await D.getDispatch(dispatchId), `Dispatched — invoice ${summary.invoice} created${summary.adjust > 0 ? `, advance ${A.fmtMoney(summary.adjust)} adjusted` : ""}`, 201);
});

// ---------------------------------------------------------------------
//  DELIVERY
// ---------------------------------------------------------------------
const loadDispatch = async (req) => {
  const d = await D.getDispatch(A.toId(req.params.dispatchId, "dispatch id"));
  if (!d) throw new HttpError(404, "Dispatch not found");
  req.params.id = d.booking_id;
  const b = await BC.loadBooking(req); // access check through the booking
  return { d, b };
};

const getDispatch = wrap(async (req, res) => {
  const { d } = await loadDispatch(req);
  return ok(res, d);
});

// POST /abs/dispatches/:dispatchId/deliver (multipart: pod_image)
// { delivered_on, received_by_name, items: [{ id, received_qty, damaged_qty }], remarks }
const confirmDelivery = wrap(async (req, res) => {
  const { d, b } = await loadDispatch(req);
  const access = await A.getAccess(req);
  const scope = await A.scopeIds(req);
  if (!A.hasCode(access, A.CODES.DISPATCH) && !A.inScope(scope, b)) throw new HttpError(403, "You cannot confirm this delivery");
  if (d.status !== "IN_TRANSIT") throw new HttpError(409, "Delivery is already confirmed for this dispatch");
  const body = req.body || {};
  const deliveredOn = A.date(body.delivered_on, "Delivered on") || A.todayIST();
  if (deliveredOn > A.todayIST()) throw new HttpError(400, "Delivered on cannot be a future date");
  if (deliveredOn < d.dispatch_date) throw new HttpError(400, "Delivered on cannot be before the dispatch date");
  const receivedBy = A.text(body.received_by_name, "Received by", { required: true, max: 120 });
  const given = new Map(parseList(body.items).map((x) => [Number(x.id), x]));
  const lines = d.items.map((it) => {
    const g = given.get(it.id) || {};
    const received = g.received_qty === undefined || g.received_qty === "" ? it.qty : A.qty(g.received_qty, `${it.item_name}: received qty`, { required: true });
    const damaged = A.qty(g.damaged_qty, `${it.item_name}: damaged qty`) ?? 0;
    if (received > it.qty) throw new HttpError(400, `${it.item_name}: received cannot be more than dispatched (${it.qty})`);
    if (damaged > received) throw new HttpError(400, `${it.item_name}: damaged cannot be more than received`);
    return { id: it.id, booking_item_id: it.booking_item_id, item_name: it.item_name, received_qty: received, damaged_qty: damaged, short_qty: r3(it.qty - received) };
  });
  const issues = lines.filter((l) => l.short_qty > 0 || l.damaged_qty > 0);
  const status = issues.length ? "DELIVERED_WITH_ISSUES" : "DELIVERED";
  let pod = null;
  if (req.file) pod = (await uploadFileToMinio(req.file, "abs_delivery")).object_path;
  const remarks = A.text(body.remarks, "Remarks", { max: 500 }) || null;
  if (issues.length && !remarks) throw new HttpError(400, "Describe the shortage / damage in remarks");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const locked = await D.lockDispatch(conn, d.id);
    if (!locked || locked.status !== "IN_TRANSIT") throw new HttpError(409, "Delivery is already confirmed for this dispatch");
    await D.markDelivered(conn, d.id, { status, deliveredOn, receivedBy, podImage: pod, remarks, userId: req.user.id }, lines);
    for (const l of lines) await conn.query(`UPDATE abs_booking_items SET delivered_qty = delivered_qty + ? WHERE id = ?`, [r3(l.received_qty - l.damaged_qty), l.booking_item_id]);
    await B.addEvent(conn, {
      bookingId: b.id,
      event: status,
      detail: `${d.dispatch_no} received by ${receivedBy} on ${deliveredOn}${issues.length ? ` — ${issues.map((l) => `${l.item_name}: short ${l.short_qty}, damaged ${l.damaged_qty}`).join("; ")}` : ""}`,
      remark: remarks,
      userId: req.user.id,
    });
    await BC.recalcStatus(conn, b.id);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  if (issues.length) {
    await A.notifyCode(A.CODES.DISPATCH, { type: "ABS_DELIVERED", bookingId: b.id, title: "Delivery with shortage / damage", message: `${d.dispatch_no} (${b.booking_no}, ${b.party_name}): ${issues.map((l) => `${l.item_name} short ${l.short_qty}, damaged ${l.damaged_qty}`).join("; ")}. Raise a credit note / transport claim if needed.` }, [req.user.id]);
  } else if (b.booked_by !== req.user.id) {
    await A.notify([b.booked_by], { type: "ABS_DELIVERED", bookingId: b.id, title: "Booking delivered", message: `${d.dispatch_no} for ${b.booking_no} (${b.party_name}) was delivered on ${deliveredOn}.` });
  }
  return ok(res, await D.getDispatch(d.id), issues.length ? "Delivery recorded with shortage / damage — office notified" : "Delivery confirmed");
});

// GET /abs/dispatches?status&season_id&search&page&limit
const listDispatches = wrap(async (req, res) => {
  const access = await A.getAccess(req);
  const scope = A.hasCode(access, A.CODES.DISPATCH) ? null : await A.scopeIds(req);
  const statusRaw = req.query.status ? String(req.query.status).split(",").map((s) => s.trim().toUpperCase()) : null;
  if (statusRaw) for (const s of statusRaw) if (!Object.keys(D.STATUS_LABEL).includes(s)) throw new HttpError(400, `Unknown status ${s}`);
  return ok(res, await D.listDispatches({ status: statusRaw || undefined, userIds: scope, seasonId: A.optId(req.query.season_id, "season"), search: A.text(req.query.search, "search", { max: 100 }), page: req.query.page, limit: req.query.limit }));
});

module.exports = { previewDispatch, createDispatch, getDispatch, confirmDelivery, listDispatches };
