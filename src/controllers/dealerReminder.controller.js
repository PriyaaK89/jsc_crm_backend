// Dealer reminders (Dealer List -> Add Reminder, History -> Reminders)
//
//   POST  /dealer-reminders              { ledger_id, remind_date: "YYYY-MM-DD", remind_time?: "HH:mm", note }
//   GET   /dealer-reminders?ledger_id=&status=&page=&limit=
//   PATCH /dealer-reminders/:id/status   { status: "DONE" | "CANCELLED" }
//
// The routes check the dealer with allowOwnLedgerOr (own / team dealer, any dealer for
// VIEW_ALL_DISTRIBUTORS, admin). A reminder belongs to the user who created it:
//   - list: the user's own + his team's reminders (everybody's for admin / view-all)
//   - status change: only the creator, or Admin / Super Admin
const reminders = require("../models/dealerReminder.model");
const { _resolveScope: resolveScope } = require("./dealerList.controller");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const NOTE_MAX = 500;

// today in India, "YYYY-MM-DD"
const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const isRealDate = (s) => {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const bad = (res, message) => res.status(400).json({ success: false, message });

// is_mine: the logged-in user added it (only he, or an admin, can mark it done / cancel it)
const withMine = (req, r) => (r ? { ...r, is_mine: Number(r.user_id) === Number(req.user.id) } : r);

exports.createReminder = async (req, res) => {
  try {
    const ledgerId = Number(req.body.ledger_id);
    const remindDate = String(req.body.remind_date || "").trim();
    const remindTimeRaw = String(req.body.remind_time || "").trim();
    const note = String(req.body.note || "").trim();

    if (!Number.isInteger(ledgerId) || ledgerId <= 0) return bad(res, "Please select a dealer");
    if (!isRealDate(remindDate)) return bad(res, "Please select a valid reminder date");
    if (remindDate < todayIST()) return bad(res, "Reminder date cannot be in the past");
    if (remindTimeRaw && !TIME_RE.test(remindTimeRaw)) return bad(res, "Please select a valid reminder time");
    if (!note) return bad(res, "Please enter what to be reminded about");
    if (note.length > NOTE_MAX) return bad(res, `Note can be at most ${NOTE_MAX} characters`);

    const reminder = await reminders.createReminder({
      ledgerId,
      userId: req.user.id,
      remindDate,
      remindTime: remindTimeRaw ? remindTimeRaw.slice(0, 5) : null,
      note,
    });

    return res.status(201).json({
      success: true,
      message: "Reminder added",
      data: withMine(req, reminder),
    });
  } catch (error) {
    console.error("createDealerReminder Error:", error);
    return res.status(500).json({ success: false, message: "Failed to add reminder", error: error.message });
  }
};

exports.listReminders = async (req, res) => {
  try {
    const ledgerId = Number(req.query.ledger_id);
    if (!Number.isInteger(ledgerId) || ledgerId <= 0) return bad(res, "Please select a dealer");
    const status = req.query.status ? String(req.query.status).toUpperCase() : "";
    if (status && !reminders.STATUSES.includes(status)) {
      return bad(res, `Invalid status. Use one of: ${reminders.STATUSES.join(", ")}`);
    }

    const scope = await resolveScope(req);
    if (!scope) {
      return res.status(403).json({ success: false, message: "Your account is not active. Please contact admin." });
    }

    const result = await reminders.listReminders({
      ledgerId,
      userIds: scope.userIds,
      status: status || undefined,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.status(200).json({
      success: true,
      message: "Reminders fetched successfully",
      data: { items: result.items.map((r) => withMine(req, r)), pagination: result.pagination },
    });
  } catch (error) {
    console.error("listDealerReminders Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch reminders", error: error.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body.status || "").toUpperCase();
    if (!Number.isInteger(id) || id <= 0) return bad(res, "Invalid reminder");
    if (!["DONE", "CANCELLED"].includes(status)) return bad(res, "Status must be DONE or CANCELLED");

    const scope = await resolveScope(req);
    if (!scope) {
      return res.status(403).json({ success: false, message: "Your account is not active. Please contact admin." });
    }

    const reminder = await reminders.getReminderById(id);
    if (!reminder) return res.status(404).json({ success: false, message: "Reminder not found" });
    if (Number(reminder.user_id) !== Number(req.user.id) && !scope.access.isAdmin) {
      return res.status(403).json({ success: false, message: "Only the person who added this reminder can change it" });
    }
    if (reminder.status !== "PENDING") {
      return res.status(409).json({ success: false, message: `This reminder is already ${reminder.status.toLowerCase()}` });
    }

    const updated = await reminders.setStatus(id, status);
    if (!updated) {
      return res.status(409).json({ success: false, message: "This reminder was already changed" });
    }
    return res.status(200).json({
      success: true,
      message: status === "DONE" ? "Reminder marked as done" : "Reminder cancelled",
      data: withMine(req, updated),
    });
  } catch (error) {
    console.error("updateDealerReminderStatus Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update reminder", error: error.message });
  }
};
