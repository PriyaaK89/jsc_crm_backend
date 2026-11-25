// Dealer List (Flutter "Dealer List" screen).
// A dealer = a ledger in the "Sundry Debtors" account group (ledgers.group_id -> account_groups).
//
// Balance of a dealer (same rule as ledger.model.getCurrentLedgerBalance):
//   opening balance (Dr = +, Cr = -) + every non-cancelled ledger_transactions row
//   (entry_type Dr = +amount, Cr = -amount).
//   Positive = Dr (the dealer owes us), negative = Cr (the dealer is in credit).
//
// Summary over the WHOLE filtered set (not only the page):
//   total_dealers = number of dealers
//   total_debit   = sum of the Dr balances
//   total_credit  = sum of the Cr balances (shown as a positive amount)
const db = require("../config/db");

const DEBTOR_GROUP = "Sundry Debtors";
const MAX_LIMIT = 100;

// signed balance of ledger l (correlated: one indexed lookup per dealer)
const BALANCE_SQL = `
  (CASE WHEN l.balance_type = 'Cr' THEN -COALESCE(l.opening_balance, 0) ELSE COALESCE(l.opening_balance, 0) END)
  + COALESCE((
      SELECT SUM(CASE WHEN lt.entry_type = 'Dr' THEN lt.amount ELSE -lt.amount END)
      FROM ledger_transactions lt
      WHERE lt.ledger_id = l.id AND lt.is_cancelled = 0
    ), 0)`;

// filters: { userIds: [ids] | null (null = every dealer), search }
const buildWhere = ({ userIds, search }) => {
  const where = ["ag.group_name = ?"];
  const params = [DEBTOR_GROUP];
  if (userIds) {
    if (!userIds.length) return null;
    where.push("l.employee_under IN (?)");
    params.push(userIds);
  }
  if (search) {
    const s = `%${search}%`;
    where.push(`(
      l.ledger_name LIKE ? OR l.location LIKE ? OR l.state LIKE ? OR l.pincode LIKE ?
      OR u.name LIKE ? OR lod.contact LIKE ? OR lod.address LIKE ? OR lod.customer_name LIKE ?
    )`);
    params.push(s, s, s, s, s, s, s, s);
  }
  return { sql: where.join(" AND "), params };
};

// one ledger_other_details row per ledger (the first one), same as ledger.model
const FROM_SQL = `
  FROM ledgers l
  INNER JOIN account_groups ag ON ag.id = l.group_id
  LEFT JOIN users u ON u.id = l.employee_under
  LEFT JOIN ledger_other_details lod ON lod.id = (
    SELECT MIN(lod2.id) FROM ledger_other_details lod2 WHERE lod2.ledger_id = l.id
  )`;

const num = (v) => Number(v) || 0;
const round2 = (v) => Math.round(num(v) * 100) / 100;

// "9828734645 / 9414731234" , "98287 34645" -> ["9828734645", "9414731234"]
const splitPhones = (...values) => {
  const out = [];
  for (const v of values) {
    if (v === null || v === undefined) continue;
    for (const part of String(v).split(/[\/,;|]+/)) {
      const digits = part.replace(/[^\d+]/g, "");
      if (digits.replace(/\D/g, "").length >= 6 && !out.includes(digits)) out.push(digits);
    }
  }
  return out;
};

const joinAddress = (...parts) => {
  const out = [];
  for (const p of parts) {
    const t = String(p === null || p === undefined ? "" : p).trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.join(", ");
};

const shapeDealer = (r) => {
  const balance = round2(r.balance);
  return {
    id: r.id,
    ledger_id: r.id,
    ledger_name: r.ledger_name,
    location: r.location || "",
    contact_person: r.contact_person || "",
    phones: splitPhones(r.contact, r.customer_contact),
    address: joinAddress(r.address, r.location, r.district, r.state, r.pincode),
    state: r.state || "",
    pincode: r.pincode || "",
    officer_id: r.employee_under || null,
    officer_name: r.officer_name || "",
    credit_limit: round2(r.credit_limit),
    balance, // signed: + Dr, - Cr
    balance_amount: Math.abs(balance),
    balance_type: balance < 0 ? "Cr" : "Dr",
    gst_no: r.gst_no || "",
    // GPS of the latest visit to this dealer (visits are made at the dealer's shop);
    // null when the dealer was never visited with GPS. Find Location falls back to the address.
    latitude: coord(r.last_visit_lat, 90),
    longitude: coord(r.last_visit_lng, 180),
  };
};

// a usable coordinate, or null (0 / empty / out of range = not a real GPS fix)
const coord = (v, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 && Math.abs(n) <= max ? n : null;
};

/**
 * @param {{ userIds: number[]|null, search?: string, page?: number, limit?: number }} f
 * @returns {{ items, summary, pagination }}
 */
const listDealers = async ({ userIds, search = "", page = 1, limit = 20 }) => {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), MAX_LIMIT);
  const pg = Math.max(Number(page) || 1, 1);
  const w = buildWhere({ userIds, search: String(search || "").trim() });
  const empty = {
    items: [],
    summary: { total_dealers: 0, total_debit: 0, total_credit: 0, net_balance: 0 },
    pagination: { page: pg, limit: lim, total: 0, total_pages: 1, has_more: false },
  };
  if (!w) return empty;

  const [rows] = await db.query(
    `SELECT l.id, l.ledger_name, l.location, l.state, l.pincode, l.gst_no, l.credit_limit, l.employee_under,
            u.name AS officer_name,
            lod.contact, lod.customer_name AS contact_person, lod.address, lod.district,
            (SELECT c.contact_number FROM customers c
              WHERE c.type = 'distributor' AND c.distributor_ledger_id = l.id
              LIMIT 1) AS customer_contact,
            (SELECT v.latitude FROM visits v
              INNER JOIN customers vc ON vc.id = v.customer_id
              WHERE vc.type = 'distributor' AND vc.distributor_ledger_id = l.id
                AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL
                AND v.latitude <> 0 AND v.longitude <> 0
              ORDER BY v.id DESC LIMIT 1) AS last_visit_lat,
            (SELECT v.longitude FROM visits v
              INNER JOIN customers vc ON vc.id = v.customer_id
              WHERE vc.type = 'distributor' AND vc.distributor_ledger_id = l.id
                AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL
                AND v.latitude <> 0 AND v.longitude <> 0
              ORDER BY v.id DESC LIMIT 1) AS last_visit_lng,
            ${BALANCE_SQL} AS balance
     ${FROM_SQL}
     WHERE ${w.sql}
     ORDER BY l.ledger_name ASC, l.id ASC
     LIMIT ? OFFSET ?`,
    [...w.params, lim, (pg - 1) * lim],
  );

  // summary of the whole filtered set (all pages)
  const [[s]] = await db.query(
    `SELECT COUNT(*) AS total_dealers,
            COALESCE(SUM(CASE WHEN x.balance > 0 THEN x.balance ELSE 0 END), 0) AS total_debit,
            COALESCE(SUM(CASE WHEN x.balance < 0 THEN -x.balance ELSE 0 END), 0) AS total_credit
     FROM (
       SELECT ${BALANCE_SQL} AS balance
       ${FROM_SQL}
       WHERE ${w.sql}
     ) x`,
    w.params,
  );

  const total = num(s && s.total_dealers);
  const totalPages = Math.max(Math.ceil(total / lim), 1);
  const totalDebit = round2(s && s.total_debit);
  const totalCredit = round2(s && s.total_credit);
  return {
    items: rows.map(shapeDealer),
    summary: {
      total_dealers: total,
      total_debit: totalDebit,
      total_credit: totalCredit,
      net_balance: round2(totalDebit - totalCredit),
    },
    pagination: { page: pg, limit: lim, total, total_pages: totalPages, has_more: pg < totalPages },
  };
};

// owner of a ledger (for the party-ledger access check); null when it does not exist
const getLedgerOwner = async (ledgerId) => {
  const [rows] = await db.query(
    `SELECT l.id, l.employee_under, ag.group_name
     FROM ledgers l
     LEFT JOIN account_groups ag ON ag.id = l.group_id
     WHERE l.id = ?`,
    [ledgerId],
  );
  return rows[0] || null;
};

/**
 * Visits made to one dealer (newest first).
 * A distributor visit is stored against the dealer's `customers` row
 * (type = 'distributor', distributor_ledger_id = the ledger), see customer.model.findOrCreateDistributorCustomer.
 * @param {{ ledgerId: number, userIds: number[]|null, page?: number, limit?: number }} f
 *   userIds = whose visits may be shown (null = everybody's)
 */
const listDealerVisits = async ({ ledgerId, userIds, page = 1, limit = 20 }) => {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), MAX_LIMIT);
  const pg = Math.max(Number(page) || 1, 1);
  if (userIds && !userIds.length) {
    return { items: [], pagination: { page: pg, limit: lim, total: 0, total_pages: 1, has_more: false } };
  }

  const where = ["c.type = 'distributor'", "c.distributor_ledger_id = ?"];
  const params = [ledgerId];
  if (userIds) {
    where.push("v.user_id IN (?)");
    params.push(userIds);
  }
  const from = `
    FROM visits v
    INNER JOIN customers c ON c.id = v.customer_id
    LEFT JOIN users u ON u.id = v.user_id
    WHERE ${where.join(" AND ")}`;

  const [[cnt]] = await db.query(`SELECT COUNT(*) AS total ${from}`, params);
  const [rows] = await db.query(
    `SELECT v.id, v.user_id, u.name AS employee_name, v.visit_type, v.visit_purpose, v.visit_outcome,
            v.comment, v.reminder_date, v.reminder_time, v.reminder_reason, v.priority,
            v.latitude, v.longitude, v.visit_start_time, v.visit_duration_seconds, v.created_at
     ${from}
     ORDER BY v.created_at DESC, v.id DESC
     LIMIT ? OFFSET ?`,
    [...params, lim, (pg - 1) * lim],
  );

  const total = num(cnt && cnt.total);
  const totalPages = Math.max(Math.ceil(total / lim), 1);
  return {
    items: rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      employee_name: r.employee_name || "",
      visit_type: r.visit_type || "",
      visit_purpose: r.visit_purpose || "",
      visit_outcome: r.visit_outcome || "",
      comment: r.comment || "",
      reminder_date: r.reminder_date || null,
      reminder_time: r.reminder_time || null,
      reminder_reason: r.reminder_reason || "",
      priority: r.priority || "",
      latitude: coord(r.latitude, 90),
      longitude: coord(r.longitude, 180),
      visit_start_time: r.visit_start_time || null,
      visit_duration_seconds: r.visit_duration_seconds === null || r.visit_duration_seconds === undefined
        ? null
        : num(r.visit_duration_seconds),
      created_at: r.created_at,
    })),
    pagination: { page: pg, limit: lim, total, total_pages: totalPages, has_more: pg < totalPages },
  };
};

module.exports = { DEBTOR_GROUP, listDealers, listDealerVisits, getLedgerOwner, _splitPhones: splitPhones };
