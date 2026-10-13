const db = require("../../config/db");

const nullable = (r) => ({
  state_id: r.state_id ?? null,
  district_id: r.district_id ?? null,
  tehsil_id: r.tehsil_id ?? null,
  village_id: r.village_id ?? null
});

// ================= GEO DROPDOWNS =================
const getStates = async () => {
  const [rows] = await db.query(
    `SELECT id, lgd_code, state_name FROM geo_states ORDER BY state_name`
  );
  return rows;
};

const getDistricts = async (stateIds) => {
  const params = [];
  let where = "";
  if (stateIds.length) {
    where = `WHERE d.state_id IN (?)`;
    params.push(stateIds);
  }
  const [rows] = await db.query(
    `
    SELECT d.id, d.lgd_code, d.district_name_english AS district_name,
           d.state_id, s.state_name
    FROM geo_districts d
    INNER JOIN geo_states s ON s.id = d.state_id
    ${where}
    ORDER BY s.state_name, d.district_name_english
    `,
    params
  );
  return rows;
};

const getTehsils = async (districtIds) => {
  const [rows] = await db.query(
    `
    SELECT t.id, t.lgd_code, t.tehsil_name, t.district_id,
           d.district_name_english AS district_name, d.state_id
    FROM geo_tehsils t
    INNER JOIN geo_districts d ON d.id = t.district_id
    WHERE t.district_id IN (?)
    ORDER BY d.district_name_english, t.tehsil_name
    `,
    [districtIds]
  );
  return rows;
};

const getVillages = async (tehsilIds, search, limit) => {
  const params = [tehsilIds];
  let searchSql = "";
  if (search) {
    searchSql = `AND v.village_name LIKE ?`;
    params.push(`%${search}%`);
  }
  params.push(limit);

  const [rows] = await db.query(
    `
    SELECT v.id, v.lgd_code, v.village_name, v.tehsil_id, t.tehsil_name
    FROM geo_villages v
    INNER JOIN geo_tehsils t ON t.id = v.tehsil_id
    WHERE v.tehsil_id IN (?) ${searchSql}
    ORDER BY t.tehsil_name, v.village_name
    LIMIT ?
    `,
    params
  );
  return rows;
};

// ================= EMPLOYEE =================
// conn can be the pool (read) or a transaction connection (forUpdate = true)
// ASSUMPTIONS TO CONFIRM: users.reporting_under = manager's user id,
// users.job_role_id -> job_roles.name

const getEmployee = async (conn, employeeId, forUpdate = false) => {
  const [rows] = await conn.query(
    `
    SELECT u.id, u.name, u.reporting_under,
           jr.name AS job_role_name, jr.department_id, jr.level
    FROM users u
    LEFT JOIN job_roles jr ON jr.id = u.job_role_id
    WHERE u.id = ?
    ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [employeeId]
  );
  return rows[0] || null;
};

// ================= RESOLVE AREAS (parent IDs come from the DB only) =================
const resolveAreas = async (conn, unit, ids) => {
  let sql;

  if (unit === "state") {
    sql = `SELECT s.id AS state_id FROM geo_states s WHERE s.id IN (?)`;
  } else if (unit === "district") {
    sql = `SELECT d.id AS district_id, d.state_id
           FROM geo_districts d WHERE d.id IN (?)`;
  } else if (unit === "tehsil") {
    sql = `SELECT t.id AS tehsil_id, t.district_id, d.state_id
           FROM geo_tehsils t
           INNER JOIN geo_districts d ON d.id = t.district_id
           WHERE t.id IN (?)`;
  } else if (unit === "village") {
    sql = `SELECT v.id AS village_id, v.tehsil_id, t.district_id, d.state_id
           FROM geo_villages v
           INNER JOIN geo_tehsils t ON t.id = v.tehsil_id
           INNER JOIN geo_districts d ON d.id = t.district_id
           WHERE v.id IN (?)`;
  } else {
    throw new Error(`Unknown unit: ${unit}`);
  }

  const [rows] = await conn.query(sql, [ids]);
  return rows.map(nullable);
};

// ================= MANAGER COVERAGE =================
// key comes from a constant config (never from the request)
const getCoverageValues = async (conn, managerId, key) => {
  const [rows] = await conn.query(
    `
    SELECT DISTINCT ${key} AS v
    FROM employee_collection_areas
    WHERE employee_id = ? AND is_active = 1 AND ${key} IS NOT NULL
    `,
    [managerId]
  );
  return new Set(rows.map((r) => r.v));
};

// ================= WRITE =================
const deactivateActiveAreas = async (conn, employeeId) => {
  await conn.query(
    `UPDATE employee_collection_areas SET is_active = 0
     WHERE employee_id = ? AND is_active = 1`,
    [employeeId]
  );
};

const insertAreas = async (conn, employeeId, assignedBy, rows) => {
  const values = rows.map((r) => [
    employeeId, r.state_id, r.district_id, r.tehsil_id, r.village_id,
    assignedBy, 1, r.is_override ? 1 : 0, r.override_reason || null
  ]);

  await conn.query(
    `
    INSERT INTO employee_collection_areas
      (employee_id, state_id, district_id, tehsil_id, village_id,
       assigned_by, is_active, is_override, override_reason)
    VALUES ?
    `,
    [values]
  );
};

// ================= READ ASSIGNED =================
const getActiveAreas = async (employeeId) => {
  const [rows] = await db.query(
    `
    SELECT a.id, a.state_id, s.state_name,
           a.district_id, d.district_name_english AS district_name,
           a.tehsil_id, t.tehsil_name,
           a.village_id, v.village_name,
           a.is_override, a.override_reason, a.assigned_by, a.created_at
    FROM employee_collection_areas a
    LEFT JOIN geo_states s ON s.id = a.state_id
    LEFT JOIN geo_districts d ON d.id = a.district_id
    LEFT JOIN geo_tehsils t ON t.id = a.tehsil_id
    LEFT JOIN geo_villages v ON v.id = a.village_id
    WHERE a.employee_id = ? AND a.is_active = 1
    ORDER BY s.state_name, d.district_name_english, t.tehsil_name, v.village_name
    `,
    [employeeId]
  );
  return rows;
};

const getEmployeesByLevel = async (departmentId, level) => {
  const [rows] = await db.query(
    `
    SELECT u.id, u.name, u.contact_no
    FROM users u
    INNER JOIN job_roles jr ON jr.id = u.job_role_id
    WHERE u.is_active = 1 AND jr.department_id = ? AND jr.level = ?
    ORDER BY u.name
    `,
    [departmentId, level]
  );
  return rows;
};

module.exports = {
  getStates, getDistricts, getTehsils, getVillages,
  getEmployee, resolveAreas, getCoverageValues,
  deactivateActiveAreas, insertAreas, getActiveAreas, getEmployeesByLevel
};