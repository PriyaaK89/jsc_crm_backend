const db = require("../../config/db");
const model = require("../../models/assign-area-to-emp/collectionArea.model");
const { getHierarchyIds } = require("../rollingUser.controller");

const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN"];
// Who may override manager-coverage rules. Change if you have a permission system.
const OVERRIDE_ROLES = ["SUPER_ADMIN"];
const MAX_AREAS = 2000;
// false = any area of the role's level can be assigned, whatever the reporting manager has
const ENFORCE_MANAGER_COVERAGE = false;

// unit        = what one row represents (and what area_ids refer to)
// levels      = what the UI displays
// coverageKey = which column of the manager's active rows must contain the new area's value
const ROLE_AREA_CONFIG = {
  ZSM: { unit: "state",    levels: ["state"],             coverageKey: null },
  RSM: { unit: "district", levels: ["state", "district"], coverageKey: "state_id" },
  ASM: { unit: "district", levels: ["district"],          coverageKey: "district_id" },
  TSM: { unit: "district", levels: ["district"],          coverageKey: "district_id" },
  SM:  { unit: "tehsil",   levels: ["district", "tehsil"], coverageKey: "district_id" },
  FA:  { unit: "village",  levels: ["tehsil", "village"], coverageKey: "tehsil_id" }
};

const MARKETING_DEPARTMENT_ID = 2; // confirm with: SELECT id, name FROM department;
const LEVEL_TO_ROLE = { 1: "ZSM", 2: "RSM", 3: "ASM", 4: "TSM", 5: "SM", 6: "FA" };

// role code sent by the frontend ("RSM", "SO" also accepted for SM)
const normalizeRole = (code) => {
  const key = String(code || "").trim().toUpperCase();
  if (ROLE_AREA_CONFIG[key]) return key;
  return key === "SO" ? "SM" : null;
};

// the employee's real role, taken from the database
const roleOfEmployee = (employee) =>
  Number(employee.department_id) === MARKETING_DEPARTMENT_ID
    ? LEVEL_TO_ROLE[employee.level] || null
    : null;


class AppError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const parseIdList = (v) => {
  if (v === undefined || v === "") return [];
  const ids = String(v).split(",").map((x) => Number(x.trim()));
  return ids.every((n) => Number.isInteger(n) && n > 0) ? [...new Set(ids)] : null;
};

const bad = (res, message) => res.status(400).json({ success: false, message });

// ================= CONFIG (frontend uses this to render the right pickers) =================
exports.getCollectionAreaConfig = (req, res) => {
  const data = Object.entries(ROLE_AREA_CONFIG).map(([role, c]) => ({
    role, unit: c.unit, levels: c.levels
  }));
  res.status(200).json({ success: true, data });
};

// ================= GEO DROPDOWNS =================
exports.getStates = async (req, res) => {
  try {
    res.status(200).json({ success: true, data: await model.getStates() });
  } catch (error) {
    console.error("getStates error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch states" });
  }
};

// GET /geo/districts?state_id=1  or  ?state_id=1,2  (optional)
exports.getDistricts = async (req, res) => {
  try {
    const stateIds = parseIdList(req.query.state_id);
    if (!stateIds) return bad(res, "Invalid state_id");
    res.status(200).json({ success: true, data: await model.getDistricts(stateIds) });
  } catch (error) {
    console.error("getDistricts error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch districts" });
  }
};

// GET /geo/tehsils?district_id=5  or  ?district_id=5,6  (required)
exports.getTehsils = async (req, res) => {
  try {
    const districtIds = parseIdList(req.query.district_id);
    if (!districtIds || !districtIds.length) return bad(res, "district_id is required");
    res.status(200).json({ success: true, data: await model.getTehsils(districtIds) });
  } catch (error) {
    console.error("getTehsils error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch tehsils" });
  }
};

// GET /geo/villages?tehsil_id=10&search=ram&limit=1000  (tehsil_id required: table has 262k rows)
exports.getVillages = async (req, res) => {
  try {
    const tehsilIds = parseIdList(req.query.tehsil_id);
    if (!tehsilIds || !tehsilIds.length) return bad(res, "tehsil_id is required");

    const limit = Math.min(Math.max(Number(req.query.limit) || 1000, 1), 2000);
    const search = String(req.query.search || "").trim();

    res.status(200).json({
      success: true,
      data: await model.getVillages(tehsilIds, search, limit)
    });
  } catch (error) {
    console.error("getVillages error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch villages" });
  }
};

// ================= GET EMPLOYEE'S ASSIGNED AREAS =================
// GET /employee-collection-areas/:employeeId   (dropdown on the target form)
exports.getEmployeeCollectionAreas = async (req, res) => {
  try {
    const employeeId = Number(req.params.employeeId);
    if (!Number.isInteger(employeeId) || employeeId <= 0) return bad(res, "Invalid employeeId");

    if (!ADMIN_ROLES.includes(req.user.role) && employeeId !== req.user.id) {
      const ids = await getHierarchyIds(req.user.id);
      if (!ids.includes(employeeId)) {
        return res.status(403).json({ success: false, message: "Not allowed" });
      }
    }

    const employee = await model.getEmployee(db, employeeId);
    if (!employee) return res.status(404).json({ success: false, message: "Employee not found" });

    // const role = normalizeRole(employee.job_role_name);
    const role = roleOfEmployee(employee);
    const cfg = role ? ROLE_AREA_CONFIG[role] : null;
    const rows = await model.getActiveAreas(employeeId);

    const nameOf = {
      state: "state_name", district: "district_name",
      tehsil: "tehsil_name", village: "village_name"
    };

    const areas = rows.map((r) => ({
      ...r,
      area_id: cfg ? r[`${cfg.unit}_id`] : null,
      label: cfg ? cfg.levels.map((l) => r[nameOf[l]]).join(" / ") : null
    }));

    res.status(200).json({
      success: true,
      employee: { id: employee.id, name: employee.name, role },
      unit: cfg ? cfg.unit : null,
      levels: cfg ? cfg.levels : [],
      data: areas
    });
  } catch (error) {
    console.error("getEmployeeCollectionAreas error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch assigned areas" });
  }
};

// ================= MANAGER COVERAGE CHECK =================
// Returns the Set of area ids (of cfg.unit) that fall outside the manager's coverage.
const findOutsideCoverage = async (connection, employee, cfg, rows) => {
  const unitKey = `${cfg.unit}_id`;
  const all = () => new Set(rows.map((r) => r[unitKey]));

  // if (!cfg.coverageKey) return { outside: new Set(), message: null };
    if (!ENFORCE_MANAGER_COVERAGE || !cfg.coverageKey) return { outside: new Set(), message: null };

  if (!employee.reporting_under) {
    return { outside: all(), message: `${employee.name} has no reporting manager, so coverage cannot be validated` };
  }

  const covered = await model.getCoverageValues(connection, employee.reporting_under, cfg.coverageKey);

  if (!covered.size) {
    return { outside: all(), message: "The reporting manager has no matching area assignment, so coverage cannot be validated" };
  }

  const outside = new Set(
    rows.filter((r) => !covered.has(r[cfg.coverageKey])).map((r) => r[unitKey])
  );

  return {
    outside,
    message: outside.size ? "Some selected areas are outside the reporting manager's coverage" : null
  };
};

// ================= ASSIGN / REPLACE AREAS =================
// PUT /employee-collection-areas/:employeeId
// body: { area_ids: [..], role?: "RSM", override?: { enabled: true, reason: "..." } }
// area_ids must be present. [] clears all active areas; a missing field is rejected.
exports.saveEmployeeCollectionAreas = async (req, res) => {
  const employeeId = Number(req.params.employeeId);
  const { area_ids, role, override } = req.body || {};

  if (!Number.isInteger(employeeId) || employeeId <= 0) return bad(res, "Invalid employeeId");
  if (!Array.isArray(area_ids)) {
    return bad(res, "area_ids is required (send [] to clear all assignments)");
  }

  const ids = [...new Set(area_ids.map(Number))];
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return bad(res, "area_ids must be positive integers");
  if (ids.length > MAX_AREAS) return bad(res, `A maximum of ${MAX_AREAS} areas can be assigned at once`);

  const wantsOverride = !!override && override.enabled === true;
  const reason = wantsOverride ? String(override.reason || "").trim() : "";

  if (wantsOverride) {
    if (!OVERRIDE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "You are not allowed to override coverage rules" });
    }
    if (reason.length < 5) return bad(res, "An override reason is required");
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // lock the employee row so two admins cannot save at the same time
    const employee = await model.getEmployee(connection, employeeId, true);
    if (!employee) throw new AppError(404, "Employee not found");

    const empRole = roleOfEmployee(employee);
if (!empRole) {
  throw new AppError(400, `"${employee.job_role_name}" is not a collection-area role`);
}

    if (role && normalizeRole(role) !== empRole) {
      throw new AppError(400, `Selected role does not match the employee's role (${empRole})`);
    }

    const cfg = ROLE_AREA_CONFIG[empRole];
    const unitKey = `${cfg.unit}_id`;

    // ---- validate everything BEFORE touching existing rows ----
    let rows = [];

    if (ids.length) {
      rows = await model.resolveAreas(connection, cfg.unit, ids);

      const found = new Set(rows.map((r) => r[unitKey]));
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length) {
        throw new AppError(400, `Invalid ${cfg.unit} id(s) for role ${empRole}: ${missing.join(", ")}`);
      }

      const { outside, message } = await findOutsideCoverage(connection, employee, cfg, rows);

      if (outside.size && !wantsOverride) {
        throw new AppError(422, message, {
          code: "OUTSIDE_MANAGER_COVERAGE",
          outside_area_ids: [...outside],
          can_override: OVERRIDE_ROLES.includes(req.user.role)
        });
      }

      rows = rows.map((r) => ({
        ...r,
        is_override: outside.has(r[unitKey]),
        override_reason: outside.has(r[unitKey]) ? reason : null
      }));
    }

    // ---- replace with soft-deactivation ----
    await model.deactivateActiveAreas(connection, employeeId);
    if (rows.length) await model.insertAreas(connection, employeeId, req.user.id, rows);

    await connection.commit();

    res.status(200).json({
      success: true,
      message: rows.length ? "Collection areas assigned successfully" : "All collection areas cleared",
      count: rows.length
    });
  } catch (error) {
    await connection.rollback();

    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, message: error.message, ...error.extra });
    }
    console.error("saveEmployeeCollectionAreas error:", error);
    res.status(500).json({ success: false, message: "Failed to save collection areas" });
  } finally {
    connection.release();
  }
};

// GET /collection-area-employees?role=RSM  -> employees of the selected role
// GET /collection-area-employees?role=RSM
exports.getEmployeesByRole = async (req, res) => {
  try {
    const role = normalizeRole(req.query.role);
    if (!role) return bad(res, "Invalid role");

    const level = Number(Object.keys(LEVEL_TO_ROLE).find((k) => LEVEL_TO_ROLE[k] === role));
    const rows = await model.getEmployeesByLevel(MARKETING_DEPARTMENT_ID, level);

    const cfg = ROLE_AREA_CONFIG[role];
    const data = rows.map((r) => ({ ...r, role, unit: cfg.unit, levels: cfg.levels }));

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("getEmployeesByRole error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch employees" });
  }
};

// POST /assign-collection-areas
// body: { employee_id, role, area_ids, override? } -- same replace logic as the PUT
exports.assignCollectionAreas = (req, res) => {
  req.params.employeeId = req.body?.employee_id;
  return exports.saveEmployeeCollectionAreas(req, res);
};