const db = require("../config/db");
const empTargetModel = require("../models/empTarget.model");
const { getHierarchyIds } = require("./rollingUser.controller");

const TARGET_TYPES = ["SALE", "COLLECTION", "NEW_DISTRIBUTOR"];
const DURATION_MONTHS = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };
const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// start_date "YYYY-MM-DD" -> last day of the period (e.g. 2026-10-01 MONTHLY -> 2026-10-31)
function calculateEndDate(start_date, duration_type) {
  const months = DURATION_MONTHS[duration_type];
  const [y, m, d] = String(start_date).slice(0, 10).split("-").map(Number);

  const end = new Date(Date.UTC(y, m - 1 + months, d - 1));
  return end.toISOString().split("T")[0];
}

// Returns an error message or null
function validateTargetBody(body) {
  const { user_id, role, target_type, duration_type, start_date, categories, target_amount } = body;

  if (!user_id || !role || !target_type || !duration_type || !start_date || !target_amount) {
    return "All fields are required";
  }
  if (!TARGET_TYPES.includes(target_type)) {
    return "Invalid target_type";
  }
  if (!DURATION_MONTHS[duration_type]) {
    return "Invalid duration_type";
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(start_date))) {
    return "start_date must be in YYYY-MM-DD format";
  }
  if (Number(target_amount) <= 0) {
    return "target_amount must be greater than 0";
  }
  if (target_type === "SALE" && (!Array.isArray(categories) || categories.length === 0)) {
    return "At least one category is required for a sale target";
  }
  return null;
}

// Categories only apply to SALE targets
const categoriesFor = (target_type, categories) =>
  target_type === "SALE" ? categories : [];

// ================= CREATE =================
exports.createEmployeeTarget = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const error = validateTargetBody(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const { user_id, role, target_type, duration_type, start_date, categories, target_amount } = req.body;

    const created_by = req.user.id;
    const end_date = calculateEndDate(start_date, duration_type);

    await connection.beginTransaction();

    const employeeTargetId = await empTargetModel.createEmployeeTarget(connection, {
      user_id,
      role,
      target_type,
      duration_type,
      start_date: String(start_date).slice(0, 10),
      end_date,
      target_amount,
      created_by
    });

    await empTargetModel.insertTargetCategories(
      connection,
      employeeTargetId,
      categoriesFor(target_type, categories)
    );

    await connection.commit();

    res.status(201).json({
      message: "Employee target created successfully",
      id: employeeTargetId
    });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ message: error.message });
  } finally {
    connection.release();
  }
};

// ================= GET ALL =================
exports.getEmployeeTargets = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      role = "",
      target_type = "",
      duration_type = ""
    } = req.query;

    const targets = await empTargetModel.getEmployeeTargets({
      page, limit, search, role, target_type, duration_type
    });

    res.status(200).json({
      message: "Targets fetched successfully",
      ...targets
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ================= GET SINGLE =================
exports.getEmployeeTargetById = async (req, res) => {
  try {
    const target = await empTargetModel.getEmployeeTargetById(req.params.id);

    if (!target) {
      return res.status(404).json({ message: "Target not found" });
    }

    res.status(200).json({
      message: "Target fetched successfully",
      data: target
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ================= UPDATE =================
exports.updateEmployeeTarget = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const error = validateTargetBody(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const { id } = req.params;
    const { user_id, role, target_type, duration_type, start_date, categories, target_amount } = req.body;

    const end_date = calculateEndDate(start_date, duration_type);

    await connection.beginTransaction();

    const affected = await empTargetModel.updateEmployeeTarget(connection, id, {
      user_id,
      role,
      target_type,
      duration_type,
      start_date: String(start_date).slice(0, 10),
      end_date,
      target_amount
    });

    if (!affected) {
      await connection.rollback();
      return res.status(404).json({ message: "Target not found" });
    }

    await empTargetModel.deleteTargetCategories(connection, id);
    await empTargetModel.insertTargetCategories(
      connection,
      id,
      categoriesFor(target_type, categories)
    );

    await connection.commit();

    res.status(200).json({ message: "Employee target updated successfully" });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ message: error.message });
  } finally {
    connection.release();
  }
};

// ================= DELETE =================
exports.deleteEmployeeTarget = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id } = req.params;

    await connection.beginTransaction();
    await empTargetModel.deleteTargetCategories(connection, id);
    await empTargetModel.deleteEmployeeTarget(connection, id);
    await connection.commit();

    res.status(200).json({ message: "Employee target deleted successfully" });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ message: error.message });
  } finally {
    connection.release();
  }
};

// ================= HELPERS (my targets / team targets) =================
const validateRange = (start_date, end_date) => {
  if (!start_date && !end_date) return null;
  if (!start_date || !end_date) return "Both start_date and end_date are required";
  if (!DATE_RE.test(start_date) || !DATE_RE.test(end_date)) {
    return "Dates must be in YYYY-MM-DD format";
  }
  if (start_date > end_date) return "start_date cannot be after end_date";
  return null;
};

const toTargetItem = (t) => ({
  id: t.id,
  target_type: t.target_type,
  duration_type: t.duration_type,
  start_date: t.start_date,
  end_date: t.end_date,
  target_amount: Number(t.target_amount),
  achieved_amount: t.achieved_amount,
  pending_amount: t.pending_amount,
  achievement_percent: t.achievement_percent, // not capped; clamp to 100 for the chart if needed
  category_ids: t.category_ids ? String(t.category_ids).split(",").map(Number) : []
});

// One row per target_type + duration_type (e.g. SALE MONTHLY) -> used by the donut cards
const buildSummary = (targets) => {
  const map = new Map();

  targets.forEach((t) => {
    const key = `${t.target_type}|${t.duration_type}`;

    if (!map.has(key)) {
      map.set(key, {
        target_type: t.target_type,
        duration_type: t.duration_type,
        target_amount: 0,
        achieved_amount: 0
      });
    }

    const s = map.get(key);
    s.target_amount += t.target_amount;
    s.achieved_amount += t.achieved_amount;
  });

  return Array.from(map.values()).map((s) => ({
    ...s,
    pending_amount: Math.max(s.target_amount - s.achieved_amount, 0),
    achievement_percent:
      s.target_amount > 0
        ? Number(((s.achieved_amount / s.target_amount) * 100).toFixed(2))
        : 0
  }));
};

// ================= MY TARGETS (employee APK) =================
// GET /my-targets?duration_type=MONTHLY&target_type=SALE&start_date=&end_date=
exports.getMyTargets = async (req, res) => {
  try {
    const { target_type, duration_type, start_date, end_date } = req.query;

    const rangeError = validateRange(start_date, end_date);
    if (rangeError) {
      return res.status(400).json({ success: false, message: rangeError });
    }

    const rows = await empTargetModel.getTargetsByFilters({
      userId: req.user.id,
      targetType: target_type || undefined,
      durationType: duration_type || undefined,
      startDate: start_date || undefined,
      endDate: end_date || undefined
    });

    const targets = rows.map(toTargetItem);

    return res.status(200).json({
      success: true,
      data: targets,
      summary: buildSummary(targets)
    });
  } catch (error) {
    console.error("getMyTargets error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch targets" });
  }
};

// ================= TEAM TARGETS (admin panel + manager APK) =================
// GET /team-targets?level=2&user_id=&target_type=&duration_type=&start_date=&end_date=
exports.getTeamTargets = async (req, res) => {
  try {
    const { level, user_id, target_type, duration_type, start_date, end_date } = req.query;

    const rangeError = validateRange(start_date, end_date);
    if (rangeError) {
      return res.status(400).json({ success: false, message: rangeError });
    }

    // admins see everyone; others see themselves + their subordinates
    // const userIds = ADMIN_ROLES.includes(req.user.role) ? null : await getHierarchyIds(req.user.id);

          const userIds = await getHierarchyIds(req.user.id);

    const rows = await empTargetModel.getTargetsByFilters({
      userIds,
      userId: user_id ? Number(user_id) : undefined,
      level: level ? Number(level) : undefined,
      targetType: target_type || undefined,
      durationType: duration_type || undefined,
      startDate: start_date || undefined,
      endDate: end_date || undefined
    });

    const userMap = new Map();

    rows.forEach((r) => {
      if (!userMap.has(r.user_id)) {
        userMap.set(r.user_id, {
          id: r.user_id,
          name: r.user_name,
          contact_no: r.contact_no,
          role_name: r.role_name,
          level: r.level,
          targets: []
        });
      }
      userMap.get(r.user_id).targets.push(toTargetItem(r));
    });

    const data = Array.from(userMap.values()).map((u) => ({
      ...u,
      summary: buildSummary(u.targets)
    }));

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("getTeamTargets error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch team targets" });
  }
};

// ================= ALL TARGETS (admin: every employee, no hierarchy) =================
// GET /all-targets?level=&user_id=&target_type=&duration_type=&search=&start_date=&end_date=&period=all
exports.getAllTargets = async (req, res) => {
  try {
    const {
      level, user_id, target_type, duration_type,
      search, start_date, end_date, period
    } = req.query;

    const rangeError = validateRange(start_date, end_date);
    if (rangeError) {
      return res.status(400).json({ success: false, message: rangeError });
    }

    const rows = await empTargetModel.getTargetsByFilters({
      userIds: null, // admin: no restriction
      userId: user_id ? Number(user_id) : undefined,
      level: level ? Number(level) : undefined,
      targetType: target_type || undefined,
      durationType: duration_type || undefined,
      search: search || undefined,
      startDate: start_date || undefined,
      endDate: end_date || undefined,
      allPeriods: period === "all"
    });

    // flat list: one row per target, with employee info (table friendly)
    const data = rows.map((r) => ({
      ...toTargetItem(r),
      user_id: r.user_id,
      user_name: r.user_name,
      contact_no: r.contact_no,
      role_name: r.role_name,
      level: r.level
    }));

    // company-wide totals per target type + duration (for dashboard cards)
    return res.status(200).json({
      success: true,
      data,
      summary: buildSummary(data)
    });
  } catch (error) {
    console.error("getAllTargets error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch targets" });
  }
};