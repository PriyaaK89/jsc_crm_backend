// Shared helpers for the Business Plan controllers:
// errors, response format, validation and access (who may see / edit / approve).
const Permission = require("../../models/permission.model");
const userModel = require("../../models/user.model");
const settingsModel = require("../../models/business-plan/bpSettings.model");

class HttpError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError) {
      const body = { success: false, message: err.message };
      if (err.data !== undefined) body.data = err.data;
      return res.status(err.status).json(body);
    }
    console.error("BUSINESS PLAN ERROR:", err);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
};

const ok = (res, data, message = "OK", status = 200) =>
  res.status(status).json({ success: true, message, data });

// ---------------------------------------------------------------------
//  DATES (IST)
// ---------------------------------------------------------------------
const todayIST = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

const isRealDate = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// accepts YYYY-MM-DD or the app's mm/dd/yyyy
const normalizeDate = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).trim();
  if (isRealDate(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    if (isRealDate(iso)) return iso;
  }
  return undefined; // present but invalid
};

// ---------------------------------------------------------------------
//  VALIDATION
// ---------------------------------------------------------------------
const MAX_MONEY = 1e13;

const toId = (value, label = "id") => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${label}`);
  return n;
};

const optId = (value, label = "id") => {
  if (value === undefined || value === null || value === "") return null;
  return toId(value, label);
};

const text = (value, label, { required = false, max = 255 } = {}) => {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${label} is required`);
    return undefined;
  }
  const s = String(value).trim();
  if (required && !s) throw new HttpError(400, `${label} is required`);
  if (s.length > max) throw new HttpError(400, `${label} must be ${max} characters or less`);
  return s;
};

// non-negative amount with 2 decimals. undefined when absent and not required.
const money = (value, label, { required = false, positive = false } = {}) => {
  if (value === undefined || value === null || value === "") {
    if (required) throw new HttpError(400, `${label} is required`);
    return undefined;
  }
  const n = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) {
    throw new HttpError(400, `${label} must be a valid amount`);
  }
  if (positive && n <= 0) throw new HttpError(400, `${label} must be greater than 0`);
  return Math.round(n * 100) / 100;
};

const qty = (value, label, opts = {}) => {
  const n = money(value, label, opts);
  return n === undefined ? undefined : Math.round(n * 1000) / 1000;
};

const intCount = (value, label) => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1000000) throw new HttpError(400, `${label} must be a whole number`);
  return n;
};

const date = (value, label, { required = false } = {}) => {
  const d = normalizeDate(value);
  if (d === undefined) throw new HttpError(400, `${label} must be a valid date (YYYY-MM-DD)`);
  if (d === null && required) throw new HttpError(400, `${label} is required`);
  return d;
};

// case-insensitive enum; aliases map display text to codes
const oneOf = (value, label, allowed, aliases = {}) => {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = String(value).trim();
  const key = raw.toUpperCase().replace(/[\s-]+/g, "_");
  const mapped = aliases[key] || key;
  if (!allowed.includes(mapped)) throw new HttpError(400, `${label} must be one of: ${allowed.join(", ")}`);
  return mapped;
};

// ---------------------------------------------------------------------
//  ACCESS
// ---------------------------------------------------------------------
// req.access is set by permission.middleware; load it when a route has no guard
const getAccess = async (req) => {
  if (req.access) return req.access;
  const access = await Permission.getUserAccess(req.user.id);
  if (!access || !access.isActive) throw new HttpError(403, "Your account is not active. Please contact admin.");
  req.access = access;
  return access;
};

const hasCode = (access, code) => access.isAdmin || access.codes.has(code);

// null = whole company (admin); otherwise me + everybody below me
const visibleIds = async (req) => {
  const access = await getAccess(req);
  if (access.isAdmin) return null;
  if (!req._bpVisible) req._bpVisible = await userModel.getSubordinateIds(req.user.id);
  return req._bpVisible;
};

const canSeeUser = (visible, userId) => visible === null || visible.includes(Number(userId));

const canViewPlan = (visible, plan) =>
  visible === null || visible.includes(plan.assigned_user_id) || visible.includes(plan.created_by);

const EDITABLE = ["DRAFT", "UNDER_REVIEW"];

// lock date from Settings: after it only admins may create / change plans
const assertNotLocked = async (req) => {
  const access = await getAccess(req);
  if (access.isAdmin) return;
  const settings = await settingsModel.getSettings();
  if (settings.lock_date && todayIST() > settings.lock_date) {
    throw new HttpError(403, `Business plans are locked after ${settings.lock_date}. Please contact admin.`);
  }
};

const assertEditable = (plan, statuses = EDITABLE) => {
  if (!statuses.includes(plan.status)) {
    throw new HttpError(
      409,
      `This plan is ${plan.status_label || plan.status}. It can be changed only when it is ${statuses
        .map((s) => s.replace("_", " ").toLowerCase())
        .join(" or ")}.`,
    );
  }
};

// Approver of a SUBMITTED plan: admin, the reporting manager stored at submit,
// or a holder of APPROVE_BUSINESS_PLAN who has the assigned employee in his team.
// Nobody approves a plan he created or that is assigned to him.
const canDecidePlan = async (req, plan) => {
  const me = req.user.id;
  if (plan.assigned_user_id === me || plan.created_by === me) return false;
  const access = await getAccess(req);
  if (access.isAdmin) return true;
  if (plan.approver_id === me) return true;
  if (plan.reporting_manager_id === me) return true;
  if (!access.codes.has("APPROVE_BUSINESS_PLAN")) return false;
  const visible = await visibleIds(req);
  return canSeeUser(visible, plan.assigned_user_id);
};

// common analytics filters from the query string
const parseFilters = (q) => {
  const f = {};
  const s = (v) => (v === undefined || v === null || String(v).trim() === "" || v === "All" ? undefined : String(v).trim());
  f.financial_year = s(q.financial_year || q.year);
  f.season = s(q.season);
  f.state_id = optId(q.state_id, "state_id") || undefined;
  f.territory_id = optId(q.territory_id, "territory_id") || undefined;
  f.assigned_user_id = optId(q.employee_id || q.assigned_user_id, "employee_id") || undefined;
  f.product_id = optId(q.product_id, "product_id") || undefined;
  f.search = s(q.search);
  if (q.status) {
    const list = String(q.status)
      .split(",")
      .map((x) => x.trim().toUpperCase().replace(/\s+/g, "_"))
      .filter(Boolean);
    const allowed = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACTIVE", "REJECTED", "CLOSED"];
    const bad = list.find((x) => !allowed.includes(x));
    if (bad) throw new HttpError(400, `Invalid status: ${bad}`);
    f.status = list;
  }
  return f;
};

// filters + scope; an employee filter outside the team is refused
const scopedFilters = async (req) => {
  const f = parseFilters(req.query);
  const visible = await visibleIds(req);
  if (f.assigned_user_id && !canSeeUser(visible, f.assigned_user_id)) {
    throw new HttpError(403, "You can only view employees in your reporting team");
  }
  f.userIds = visible;
  // ?pending_approval=1 is resolved by the plan list (approval steps), see bpPlan.controller
  return f;
};

// May this user change the plan (header, lines, monthly plan, submit)?
// Owner (assigned employee or creator), a CREATE_BUSINESS_PLAN holder above the
// assigned employee, or an admin.
const canEditPlanOf = async (req, plan) => {
  const me = req.user.id;
  const access = await getAccess(req);
  if (access.isAdmin) return true;
  if (plan.assigned_user_id === me || plan.created_by === me) return true;
  if (!access.codes.has("CREATE_BUSINESS_PLAN")) return false;
  const visible = await visibleIds(req);
  return canSeeUser(visible, plan.assigned_user_id);
};

const assertCanEditPlan = async (req, plan) => {
  if (!(await canEditPlanOf(req, plan))) {
    throw new HttpError(403, "Only the employee, the plan creator or an admin can change this business plan");
  }
};

// what the logged-in user may do in the module (masters.me; the apps show / hide tabs and buttons)
const meBlock = async (req) => {
  const access = await getAccess(req);
  return {
    id: req.user.id,
    role: access.role || null,
    is_admin: !!access.isAdmin,
    can_manage_settings: hasCode(access, "MANAGE_BUSINESS_PLAN_SETTINGS"),
    can_create_for_others: hasCode(access, "CREATE_BUSINESS_PLAN"),
    can_approve_all_levels: !!access.isAdmin,
    can_view_all: !!access.isAdmin,
  };
};

// ---------------------------------------------------------------------
//  QUARTERS (Indian financial year April - March)
// ---------------------------------------------------------------------
//  Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec (same year), Q4 Jan-Mar (next year)
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const QUARTER_LABEL = { 1: "Q1 (Apr – Jun)", 2: "Q2 (Jul – Sep)", 3: "Q3 (Oct – Dec)", 4: "Q4 (Jan – Mar)" };

// "2026-27" | "FY 2026-27" | "2026" -> 2026
const fyStartYear = (fy) => {
  const m = String(fy || "").match(/(\d{4})/);
  return m ? Number(m[1]) : null;
};

const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

// -> { from: 'YYYY-MM-DD', to, months: [{ year, month, label }] }
const quarterBounds = (fy, quarter) => {
  const y = fyStartYear(fy);
  const q = Number(quarter);
  if (!y || ![1, 2, 3, 4].includes(q)) return null;
  const startMonth = [4, 7, 10, 1][q - 1];
  const year = q === 4 ? y + 1 : y;
  const months = [0, 1, 2].map((i) => {
    const month = startMonth + i;
    return { year, month, label: `${MONTH_SHORT[month - 1]} ${year}` };
  });
  const pad = (n) => String(n).padStart(2, "0");
  const endMonth = startMonth + 2;
  return {
    from: `${year}-${pad(startMonth)}-01`,
    to: `${year}-${pad(endMonth)}-${pad(lastDay(year, endMonth))}`,
    months,
  };
};

// today's FY ("2026-27") and quarter
const currentQuarter = (iso = todayIST()) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  const quarter = m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4;
  return { financial_year: `${start}-${String((start + 1) % 100).padStart(2, "0")}`, quarter };
};

module.exports = {
  HttpError,
  wrap,
  ok,
  todayIST,
  isRealDate,
  normalizeDate,
  toId,
  optId,
  text,
  money,
  qty,
  intCount,
  date,
  oneOf,
  getAccess,
  hasCode,
  visibleIds,
  canSeeUser,
  canViewPlan,
  EDITABLE,
  assertNotLocked,
  assertEditable,
  canDecidePlan,
  parseFilters,
  scopedFilters,
  canEditPlanOf,
  assertCanEditPlan,
  meBlock,
  QUARTER_LABEL,
  fyStartYear,
  quarterBounds,
  currentQuarter,
};
