const model = require("../models/dashboardAnalytics.model");
const userModel = require("../models/user.model");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 1830; // 5 years
const DAY_MS = 86400000;

const todayIst = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

const isRealDate = (value) => {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const badRequest = (message, status = 400) => Object.assign(new Error(message), { status });

const getRange = (query) => {
  const today = todayIst();
  const from = query.from || `${today.slice(0, 7)}-01`;
  const to = query.to || today;

  if (!isRealDate(from) || !isRealDate(to)) {
    throw badRequest("from and to must be valid dates (YYYY-MM-DD)");
  }
  if (from > to) throw badRequest("from date cannot be after to date");
  if ((new Date(to) - new Date(from)) / DAY_MS > MAX_RANGE_DAYS) {
    throw badRequest("Please select a range of 5 years or less");
  }
  return { from, to, today };
};

// Role comes from the database (req.access), never from the request.
// Admins see the company; everyone else sees themselves and their reporting tree.
const getVisibleIds = async (req) => {
  if (req.access?.isAdmin) return null;
  return userModel.getSubordinateIds(req.user.id);
};

const getUserIds = async (req) => {
  const visible = await getVisibleIds(req);
  const { employee_id: employeeId } = req.query;

  if (employeeId === undefined || employeeId === "") return visible;

  const id = Number(employeeId);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("Invalid employee_id");
  if (visible && !visible.includes(id)) {
    throw badRequest("You can only view employees in your reporting team", 403);
  }
  return [id];
};

const sendError = (res, error) => {
  if (error.status) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  console.error("Dashboard analytics error:", error);
  return res.status(500).json({ success: false, message: "Unable to load dashboard data" });
};

const section = (load) => async (req, res) => {
  try {
    const range = getRange(req.query);
    const userIds = await getUserIds(req);
    const data = await load({ ...range, userIds });
    return res.json({ success: true, filters: { from: range.from, to: range.to }, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getFilters = async (req, res) => {
  try {
    const visible = await getVisibleIds(req);
    const employees = await model.getEmployees(visible);
    return res.json({
      success: true,
      data: { scope: visible ? "TEAM" : "ALL", employees },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getOrders = section(model.getOrders);
exports.getApprovals = section(model.getApprovals);
exports.getVisits = section(model.getVisits);
exports.getSales = section(model.getSales);
exports.getCollections = section(model.getCollections);
exports.getBusiness = section(model.getBusiness);
