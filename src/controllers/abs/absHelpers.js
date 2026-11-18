// ABS shared helpers: errors, access, notifications.
// Validation and access primitives come from the Business Plan helpers (same rules, same users).
const H = require("../business-plan/bpHelpers");
const AP = require("../../models/business-plan/bpApproval.model");
const setup = require("../../models/abs/absSetup.model");

const { HttpError, ok, todayIST, toId, optId, text, money, qty, date, oneOf, getAccess, hasCode, visibleIds, canSeeUser } = H;

const CODES = {
  VIEW_ALL: "VIEW_ALL_ABS",
  CONFIRM: "CONFIRM_ABS_BOOKING",
  ALLOCATE: "ALLOCATE_ABS_STOCK",
  VERIFY: "VERIFY_ABS_PAYMENT",
  DISPATCH: "DISPATCH_ABS",
  SETTINGS: "MANAGE_ABS_SETTINGS",
};
const OFFICE_CODES = Object.values(CODES);

// errors from the existing Sales / Receipt posting (credit limit, overdue bills, stock,
// voucher dates) are business rules: show them to the user as 400 with their details
const BUSINESS_ERROR_CODES = ["CREDIT_BALANCE_EXCEEDED", "CREDIT_LIMIT_EXCEEDED", "NO_CREDIT_FACILITY", "OVERDUE_BILLS"];
const BUSINESS_ERROR_TEXT = /Insufficient stock|entries are allowed only between|Active voucher not found|ledger not found|exceeds pending amount/i;

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError) {
      const body = { success: false, message: err.message };
      if (err.data !== undefined) body.data = err.data;
      return res.status(err.status).json(body);
    }
    if (err && (BUSINESS_ERROR_CODES.includes(err.code) || BUSINESS_ERROR_TEXT.test(err.message || ""))) {
      return res.status(400).json({
        success: false,
        message: err.message,
        error_type: err.code || "BUSINESS_RULE",
        ...(err.creditLimitInfo ? { credit_limit_info: err.creditLimitInfo } : {}),
        ...(err.overdueBills ? { overdue_bills: err.overdueBills } : {}),
      });
    }
    console.error("ABS ERROR:", err);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
};

const can = async (req, code) => hasCode(await getAccess(req), code);

const assertCan = async (req, code, message) => {
  if (!(await can(req, code))) throw new HttpError(403, message || "You do not have permission to perform this action");
};

// null = every booking (admin or office staff); otherwise me + my reporting team
const scopeIds = async (req) => {
  const access = await getAccess(req);
  if (access.isAdmin || OFFICE_CODES.some((c) => access.codes.has(c))) return null;
  return visibleIds(req);
};

// field staff: own / team bookings (booked by, or the party's field employee)
const inScope = (scope, booking) =>
  scope === null || canSeeUser(scope, booking.booked_by) || (booking.party_employee_id && canSeeUser(scope, booking.party_employee_id));

const meBlock = async (req) => {
  const access = await getAccess(req);
  const c = (code) => hasCode(access, code);
  return {
    id: req.user.id,
    is_admin: !!access.isAdmin,
    can_view_all: c(CODES.VIEW_ALL) || OFFICE_CODES.some((x) => access.codes.has(x)),
    can_confirm: c(CODES.CONFIRM),
    can_allocate: c(CODES.ALLOCATE),
    can_verify_payment: c(CODES.VERIFY),
    can_dispatch: c(CODES.DISPATCH),
    can_manage_settings: c(CODES.SETTINGS),
  };
};

// in-app bell (beat_notifications, plan_id NULL, ref_id = booking id). Never fails the action.
const notify = (userIds, { type, title, message, bookingId }) => AP.notify(userIds, { type, title, message, refId: bookingId });

const notifyCode = async (code, payload, exceptIds = []) => {
  try {
    const ids = (await setup.usersWithCode(code)).filter((id) => !exceptIds.includes(id));
    await notify(ids, payload);
  } catch (err) {
    console.error("ABS NOTIFICATION ERROR:", err.message);
  }
};

const fmtQty = (n) => (Math.round(Number(n) * 1000) / 1000).toString();
const fmtMoney = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const addDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};

module.exports = {
  HttpError,
  ok,
  wrap,
  todayIST,
  toId,
  optId,
  text,
  money,
  qty,
  date,
  oneOf,
  getAccess,
  hasCode,
  visibleIds,
  canSeeUser,
  CODES,
  can,
  assertCan,
  scopeIds,
  inScope,
  meBlock,
  notify,
  notifyCode,
  fmtQty,
  fmtMoney,
  addDays,
};
