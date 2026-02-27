const db = require('../config/db');

exports.saveLocation = async (data) => {
  const sql = `
    INSERT INTO employee_locations
    (employee_id, attendance_id, latitude, longitude, accuracy, speed)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  const [result] = await db.query(sql, [
    data.employee_id,
    data.attendance_id,
    data.latitude,
    data.longitude,
    data.accuracy,
    data.speed
  ]);

  return result;
};

exports.getLocationsByDate = async (employeeId, start, end) => {
  const sql = `
    SELECT latitude, longitude, recorded_at
    FROM employee_locations
    WHERE employee_id = ?
    AND recorded_at BETWEEN ? AND ?
    ORDER BY recorded_at ASC
  `;

  const [rows] = await db.query(sql, [employeeId, start, end]);

  return rows;
};