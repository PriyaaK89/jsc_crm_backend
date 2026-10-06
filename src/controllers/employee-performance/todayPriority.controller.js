const model = require("../../models/employee-performance/todayPriority.model");
const empTargetModel = require("../../models/empTarget.model");

// ---------- helpers ----------
const getTodayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); // YYYY-MM-DD

const DAY_MS = 86400000;
const ymdMs = (s) => new Date(`${s}T00:00:00Z`).getTime();
const daysBetween = (fromYmd, toYmd) => Math.round((ymdMs(toYmd) - ymdMs(fromYmd)) / DAY_MS);

const inr = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const inrShort = (n) => {
  n = Number(n) || 0;
  if (n >= 1e7) return `₹${+(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${+(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `₹${+(n / 1e3).toFixed(1)}K`;
  return `₹${n}`;
};

const titleCase = (s = "") =>
  String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const to12h = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

const fmtDate = (ymd) =>
  new Date(`${ymd}T00:00:00+05:30`).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", timeZone: "Asia/Kolkata",
  });

// one failing section must not blank the whole home screen
const safe = (promise, fallback, label) =>
  promise.catch((err) => {
    console.error(`[today-priorities] ${label} failed:`, err.message);
    return fallback;
  });

// handles flat payloads and the nested { payload_json: "<string>" } shape
const parsePayload = (raw) => {
  try {
    let obj = typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
    if (typeof obj.payload_json === "string") obj = JSON.parse(obj.payload_json);
    else if (obj.payload_json && typeof obj.payload_json === "object") obj = obj.payload_json;
    return obj || {};
  } catch {
    return {};
  }
};

// ---------- card builders ----------
const buildOverdueCard = (r) => ({
  type: "OVERDUE",
  key: `overdue-${r.ledger_id}`,
  badge: "Overdue",
  amount: Number(r.overdue_amount),
  amount_label: `${inr(r.overdue_amount)} Due`,
  party_id: r.ledger_id,
  party_name: r.party_name,
  area: r.area || null,
  contact_number: r.contact_number || null,
  overdue_bills: Number(r.overdue_bills),
  oldest_due_date: r.oldest_due_date,
  due_since_days: Number(r.overdue_days),
  due_since_label: `${r.overdue_days} Day${Number(r.overdue_days) === 1 ? "" : "s"}`,
});

const buildFollowUpCard = (r, today) => {
  const isToday = r.reminder_date === today;
  const time = to12h(r.reminder_time);
  const dateLabel = isToday ? "Today" : fmtDate(r.reminder_date);
  return {
    type: "FOLLOW_UP",
    key: `followup-${r.visit_id}`,
    badge: isToday ? "Follow-up" : "Missed",
    is_missed: !isToday,
    visit_id: r.visit_id,
    customer_id: r.customer_id,
    party_name: r.party_name,
    contact_person: r.contact_person,
    title: r.reminder_reason || `${titleCase(r.visit_purpose)} Pending`,
    reminder_date: r.reminder_date,
    reminder_time: r.reminder_time,
    reminder_label: time ? `${dateLabel}, ${time}` : dateLabel,
    priority: r.priority,
    priority_label: r.priority ? titleCase(r.priority) : null,
    contact_number: r.contact_number,
    area: r.area || r.district || null,
    address: r.address,
    latitude: r.latitude,   // last visit location, Navigate fallback
    longitude: r.longitude,
  };
};

const mapOrders = (rows) =>
  rows.map((r) => {
    const p = parsePayload(r.payload_json);
    return {
      approval_id: r.id,
      order_no: r.order_no,
      customer_ledger_id: p.customer_ledger_id || null,
      total_amount: Number(p.total_amount) || 0,
      status_message: r.current_status_message,
      current_approver_name: r.current_approver_name,
      created_at: r.created_at,
    };
  });

const mapReturned = (rows) =>
  rows.map((r) => {
    const p = parsePayload(r.payload_json);
    return {
      approval_id: r.id,
      order_no: r.order_no,
      outcome: r.status === model.RETURNED_STATUS ? "RETURNED" : "REJECTED",
      reason: r.remarks || null,
      returned_from_level: r.returned_from_level,
      customer_ledger_id: p.customer_ledger_id || null,
      total_amount: Number(p.total_amount) || 0,
      action_at: r.action_at,
    };
  });

const buildPendingApprovalCard = (orders) => {
  const total = orders.reduce((s, o) => s + o.total_amount, 0);
  return {
    type: "PENDING_APPROVAL",
    key: "pending-approval",
    badge: "Approval",
    count: orders.length,
    title: `${orders.length} Pending Order${orders.length > 1 ? "s" : ""}`,
    subtitle: "Awaiting Senior Accountant Approval",
    total_amount: total,
    total_amount_label: `Total Value: ${inr(total)}`,
  };
};

const buildReturnedCard = (orders) => {
  const returned = orders.filter((o) => o.outcome === "RETURNED").length;
  const rejected = orders.length - returned;
  return {
    type: "RETURNED_ORDER",
    key: "returned-orders",
    badge: returned ? "Returned" : "Rejected",
    count: orders.length,
    title: `${orders.length} Order${orders.length > 1 ? "s" : ""} Need Attention`,
    subtitle: [returned && `${returned} returned`, rejected && `${rejected} rejected`]
      .filter(Boolean).join(" · "),
    latest_reason: orders[0].reason,
    total_amount: orders.reduce((s, o) => s + o.total_amount, 0),
  };
};

// ---- target card (row shape comes from empTargetModel.getTargetsByFilters) ----
const TARGET_LABELS = { SALE: "Sales", COLLECTION: "Collection", NEW_DISTRIBUTOR: "New distributor" };
const BEHIND_RATIO = 0.7;      // achieved < 70% of the expected-by-now amount => warning
const WARN_AFTER_DAYS = 5;     // no warning in the first few days of a period
const ENDING_SOON_DAYS = 7;

const buildTargetCard = (t, today) => {
  const target = Number(t.target_amount) || 0;
  const achieved = Number(t.achieved_amount) || 0;
  if (target <= 0) return null;

  const totalDays = daysBetween(t.start_date, t.end_date) + 1;
  const elapsedDays = Math.min(Math.max(daysBetween(t.start_date, today) + 1, 0), totalDays);
  const daysLeft = Math.max(daysBetween(today, t.end_date), 0);
  const percent = Math.round((achieved / target) * 100);
  const expected = target * (elapsedDays / totalDays);
  const paceRatio = expected > 0 ? achieved / expected : 1;

  const isBehind = elapsedDays >= WARN_AFTER_DAYS && paceRatio < BEHIND_RATIO && percent < 100;
  const endingSoon = daysLeft <= ENDING_SOON_DAYS && percent < 100;
  if (!isBehind && !endingSoon) return null; // only actionable targets reach Today's Priorities

  const isCount = t.target_type === "NEW_DISTRIBUTOR";
  const fmt = (n) => (isCount ? String(n) : inrShort(n));
  const remaining = Math.max(target - achieved, 0);
  const perDay = remaining / Math.max(daysLeft, 1);

  return {
    type: "TARGET",
    key: `target-${t.id}`,
    badge: isBehind ? "Behind" : "Target",
    severity: isBehind ? "WARNING" : "INFO",
    target_type: t.target_type,
    duration_type: t.duration_type,
    title: `${TARGET_LABELS[t.target_type] || titleCase(t.target_type)} target: ${fmt(achieved)} of ${fmt(target)}`,
    subtitle: daysLeft === 0 ? "Last day" : `${daysLeft} day${daysLeft > 1 ? "s" : ""} left`,
    percent,
    days_left: daysLeft,
    required_label: isCount
      ? `Need ${remaining} more`
      : `Need ${inrShort(Math.ceil(perDay))}/day to finish`,
  };
};

// ---- demo card ----
const buildDemoCard = (r, today) => {
  const isToday = r.due_date === today;
  const daysLate = isToday ? 0 : daysBetween(r.due_date, today);
  const extra = Number(r.customer_count) - 1;
  const party = r.party_name
    ? extra > 0 ? `${r.party_name} +${extra} more` : r.party_name
    : "Demo";

  return {
    type: "DEMO",
    key: `demo-${r.demo_id}`,
    badge: isToday ? "Demo" : "Result Due",
    is_overdue: !isToday,
    demo_id: r.demo_id,
    demo_no: r.demo_no,
    status: r.status,
    party_name: party,
    crop_name: r.crop_name || null,
    title: `Result ${r.next_result_no} of ${model.DEMO_MAX_RESULTS} Pending`,
    subtitle: [r.demo_no, r.crop_name].filter(Boolean).join(" · "),
    due_date: r.due_date,
    due_label: isToday
      ? "Follow-up due today"
      : `Overdue by ${daysLate} day${daysLate > 1 ? "s" : ""}`,
    next_result_no: Number(r.next_result_no),
    results_count: Number(r.results_count),
    max_results: model.DEMO_MAX_RESULTS,
    location: [r.village, r.district].filter(Boolean).join(", ") || null,
  };
};

// ---------- handlers ----------
exports.getTodayPriorities = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const today = getTodayIST();
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);

    const [overdueRows, followUpRows, approvalRows, returnedRows, targetRows, demoRows] =
      await Promise.all([
        safe(model.getOverdueParties(employeeId, today), [], "overdue"),
        safe(model.getFollowUps(employeeId, today), [], "follow-ups"),
        safe(model.getPendingApprovals(employeeId), [], "pending approvals"),
        safe(model.getReturnedOrders(employeeId, today), [], "returned orders"),
        safe(
          empTargetModel.getTargetsByFilters({ userId: employeeId, startDate: today, endDate: today }),
          [], "targets"
        ),
        safe(model.getDemoFollowUps(employeeId, today), [], "demos"),
      ]);

    const orders = mapOrders(approvalRows);
    const returnedOrders = mapReturned(returnedRows);
    const followUps = followUpRows.map((r) => buildFollowUpCard(r, today));
    const demoCards = demoRows.map((r) => buildDemoCard(r, today));
    const targetCards = targetRows
      .map((t) => buildTargetCard(t, today))
      .filter(Boolean)
      .sort((a, b) => (a.severity === "WARNING" ? -1 : 1) - (b.severity === "WARNING" ? -1 : 1) || a.percent - b.percent);

    const overdueTotal = overdueRows.reduce((s, r) => s + Number(r.overdue_amount), 0);

    const data = [
      ...overdueRows.slice(0, limit).map(buildOverdueCard),
      ...(returnedOrders.length ? [buildReturnedCard(returnedOrders)] : []),
      ...followUps.slice(0, limit),
      ...demoCards.slice(0, limit),
      ...(orders.length ? [buildPendingApprovalCard(orders)] : []),
      ...targetCards,
    ];

    return res.status(200).json({
      success: true,
      date: today,
      summary: {
        overdue_parties: overdueRows.length,
        overdue_amount: overdueTotal,
        returned_orders: returnedOrders.length,
        follow_ups_today: followUps.filter((f) => !f.is_missed).length,
        follow_ups_missed: followUps.filter((f) => f.is_missed).length,
        demos_due_today: demoCards.filter((d) => !d.is_overdue).length,
        demos_overdue: demoCards.filter((d) => d.is_overdue).length,
        pending_orders: orders.length,
        pending_orders_amount: orders.reduce((s, o) => s + o.total_amount, 0),
        targets_behind: targetCards.filter((t) => t.severity === "WARNING").length,
        total_items:
          overdueRows.length + (returnedOrders.length ? 1 : 0) + followUps.length +
          demoCards.length + (orders.length ? 1 : 0) + targetCards.length,
      },
      data,
    });
  } catch (err) {
    console.error("getTodayPriorities error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// "View Orders" on the pending-approval card
exports.getPendingOrders = async (req, res) => {
  try {
    const orders = mapOrders(await model.getPendingApprovals(req.user.id));
    const names = await model.getLedgerNames([
      ...new Set(orders.map((o) => o.customer_ledger_id).filter(Boolean)),
    ]);
    const data = orders.map((o) => ({ ...o, customer_name: names[o.customer_ledger_id] || null }));

    return res.status(200).json({
      success: true,
      count: data.length,
      total_amount: data.reduce((s, o) => s + o.total_amount, 0),
      data,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// "View Orders" on the returned/rejected card
exports.getReturnedOrders = async (req, res) => {
  try {
    const orders = mapReturned(await model.getReturnedOrders(req.user.id, getTodayIST()));
    const names = await model.getLedgerNames([
      ...new Set(orders.map((o) => o.customer_ledger_id).filter(Boolean)),
    ]);
    return res.status(200).json({
      success: true,
      count: orders.length,
      data: orders.map((o) => ({ ...o, customer_name: names[o.customer_ledger_id] || null })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// "Mark Visited" on the follow-up card
exports.markFollowUpDone = async (req, res) => {
  try {
    const affected = await model.markReminderDone(req.params.visitId, req.user.id);
    if (!affected) {
      return res.status(404).json({ success: false, message: "Reminder not found" });
    }
    return res.status(200).json({ success: true, message: "Marked as visited" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};