// ABS pricing rules (pure functions, no database).
//
// Scheme discounts are trade discounts known at the time of booking, so they reduce
// the rate BEFORE GST (taxable value = qty x (booking rate - discount)), as on a GST invoice.
//   EARLY_BOOKING    booking date within valid_from .. valid_till
//   QUANTITY_SLAB    line qty >= min_qty (the highest slab that applies wins)
//   ADVANCE_PAYMENT  advance posted on or before valid_till >= min_advance_pct of net value
// One scheme of each type can apply to a line (the best of that type); types add up.
// The total discount never goes below a rate of 0.

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const round3 = (v) => Math.round((Number(v) + Number.EPSILON) * 1000) / 1000;
const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const inWindow = (date, from, till) => (!from || date >= from) && (!till || date <= till);

const perUnit = (scheme, rate) =>
  scheme.discount_type === "PERCENT" ? round2((rate * num(scheme.discount_value)) / 100) : round2(num(scheme.discount_value));

// schemes: active schemes of the season. line: { stock_item_id, qty, rate }
// ctx: { bookingDate: 'YYYY-MM-DD', advancePctBy: (date) => % of net value paid by that date (or null) }
// -> { discount_per_unit, applied: [{ id, name, scheme_type, per_unit }] }
const lineDiscount = (schemes, line, ctx = {}) => {
  const rate = num(line.rate);
  const qty = num(line.qty);
  const best = {};
  for (const sc of schemes || []) {
    if (Number(sc.is_active) === 0) continue;
    if (sc.stock_item_id && Number(sc.stock_item_id) !== Number(line.stock_item_id)) continue;
    let ok = false;
    if (sc.scheme_type === "EARLY_BOOKING") ok = !!ctx.bookingDate && inWindow(ctx.bookingDate, sc.valid_from, sc.valid_till);
    else if (sc.scheme_type === "QUANTITY_SLAB") ok = qty >= num(sc.min_qty) && (!ctx.bookingDate || inWindow(ctx.bookingDate, sc.valid_from, sc.valid_till));
    else if (sc.scheme_type === "ADVANCE_PAYMENT") {
      const pct = typeof ctx.advancePctBy === "function" ? ctx.advancePctBy(sc.valid_till || null) : null;
      ok = pct !== null && pct !== undefined && pct >= num(sc.min_advance_pct);
    }
    if (!ok) continue;
    const pu = perUnit(sc, rate);
    if (!best[sc.scheme_type] || pu > best[sc.scheme_type].per_unit) {
      best[sc.scheme_type] = { id: sc.id, name: sc.name, scheme_type: sc.scheme_type, per_unit: pu };
    }
  }
  const applied = Object.values(best);
  const total = Math.min(round2(applied.reduce((s, a) => s + a.per_unit, 0)), rate);
  return { discount_per_unit: total, applied };
};

// booking value: items [{ qty, rate, discount_per_unit }]
const bookingTotals = (items) => {
  let gross = 0;
  let discount = 0;
  for (const it of items) {
    gross += num(it.qty) * num(it.rate);
    discount += num(it.qty) * num(it.discount_per_unit);
  }
  gross = round2(gross);
  discount = round2(discount);
  return { gross_value: gross, scheme_discount: discount, net_value: round2(gross - discount) };
};

// GST: same state -> CGST + SGST, different state -> IGST. State code = first 2 digits of GSTIN.
const stateCodeOf = (gstin) => {
  const m = String(gstin || "").trim().match(/^(\d{2})/);
  return m ? m[1] : null;
};
const taxModeFor = (companyStateCode, partyGstin) => {
  const party = stateCodeOf(partyGstin);
  if (!companyStateCode || !party) return "CGST_SGST";
  return String(companyStateCode).padStart(2, "0") === party ? "CGST_SGST" : "IGST";
};

// invoice line for the existing Sales posting (sales_items columns)
const invoiceLine = ({ stock_item_id, godown_id, batch_no, unit_id, qty, net_rate, gst_percent, available_qty }, taxMode) => {
  const amount = round2(num(qty) * num(net_rate));
  const gst = num(gst_percent);
  const igst_percent = taxMode === "IGST" ? gst : 0;
  const cgst_percent = taxMode === "IGST" ? 0 : gst / 2;
  const sgst_percent = cgst_percent;
  const igst_amount = round2((amount * igst_percent) / 100);
  const cgst_amount = round2((amount * cgst_percent) / 100);
  const sgst_amount = round2((amount * sgst_percent) / 100);
  return {
    stock_item_id,
    godown_id,
    batch_no: batch_no || null,
    available_qty: available_qty ?? null,
    billed_qty: round3(qty),
    rate: round2(net_rate),
    supercash_rate: 0,
    unit_id: unit_id || null,
    alt_unit_id: null,
    alt_unit_qty: null,
    bulk_unit_id: null,
    bulk_unit_value: null,
    calculated_alt_unit: null,
    amount,
    igst_percent,
    igst_amount,
    cgst_percent,
    cgst_amount,
    sgst_percent,
    sgst_amount,
    total_amount: round2(amount + igst_amount + cgst_amount + sgst_amount),
  };
};

const invoiceTotals = (lines) => {
  const t = { subtotal: 0, igst_total: 0, cgst_total: 0, sgst_total: 0 };
  for (const l of lines) {
    t.subtotal += l.amount;
    t.igst_total += l.igst_amount;
    t.cgst_total += l.cgst_amount;
    t.sgst_total += l.sgst_amount;
  }
  for (const k of Object.keys(t)) t[k] = round2(t[k]);
  t.tax_total = round2(t.igst_total + t.cgst_total + t.sgst_total);
  t.total_amount = round2(t.subtotal + t.tax_total);
  return t;
};

// pro-rata split of `available` over requests [{ key, need }] (whole units first, remainder by order)
const proRata = (available, requests, step = 1) => {
  const totalNeed = requests.reduce((s, r) => s + num(r.need), 0);
  if (totalNeed <= available) return requests.map((r) => ({ key: r.key, qty: num(r.need) }));
  const out = requests.map((r) => ({ key: r.key, qty: Math.floor(((num(r.need) * available) / totalNeed) / step) * step }));
  let left = round3(available - out.reduce((s, o) => s + o.qty, 0));
  for (let i = 0; left >= step && i < out.length; i++) {
    if (out[i].qty + step <= num(requests[i].need)) {
      out[i].qty = round3(out[i].qty + step);
      left = round3(left - step);
    }
  }
  return out;
};

module.exports = { round2, round3, num, lineDiscount, bookingTotals, stateCodeOf, taxModeFor, invoiceLine, invoiceTotals, proRata };
