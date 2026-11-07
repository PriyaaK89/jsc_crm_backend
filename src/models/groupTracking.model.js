const db = require("../config/db");

// Highest level number in job_roles (the lowest designation, FA).
// Used so the "FA has no access" rule is not hardcoded.
exports.getLowestLevel = async () => {
  const [rows] = await db.query("SELECT MAX(level) AS lowest_level FROM job_roles");
  return rows[0] && rows[0].lowest_level !== null ? Number(rows[0].lowest_level) : null;
};

// Route points of many employees for one time window, in a single query.
exports.getLocationsForEmployees = async (employeeIds, start, end) => {
  if (!employeeIds.length) return [];

  const placeholders = employeeIds.map(() => "?").join(",");
  const sql = `
    SELECT employee_id, latitude, longitude, recorded_at
    FROM employee_locations
    WHERE employee_id IN (${placeholders})
      AND recorded_at BETWEEN ? AND ?
    ORDER BY employee_id ASC, recorded_at ASC
  `;

  const [rows] = await db.query(sql, [...employeeIds, start, end]);
  return rows;
};