const db = require("../config/db");

exports.getTodayAttendance = async (employeeId) => {
  const [rows] = await db.query(
    `
    SELECT *
    FROM emp_attendance
    WHERE employee_id = ?
      AND attendance_date = CURDATE()
    `,
    [employeeId]
  );
  return rows[0];
};

exports.createAttendance = async (data) => {
  const [result] = await db.query(
    `
    INSERT INTO emp_attendance (
      employee_id,
      attendance_date,
      status,
      work_type,
      field_work_type,
      travel_mode,
      vehicle_type,
      public_transport,
      odometer_reading,
      visit_location,
      check_in_time,
      leave_reason
    ) VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    data
  );
  return result.insertId;
};

exports.updateDayOver = async (data) => {
  return db.query(
    `
    UPDATE emp_attendance
    SET
      status = 'day_over',
      check_out_time = NOW(),
      working_minutes = ?,
      attendance_unit = ?,
      late_login = ?,
      day_over_odometer_reading = ?,
      day_over_location = ?
    WHERE id = ?
    `,
    data
  );
};


exports.saveAttendanceImage = async (data) => {
  return db.query(
    `
    INSERT INTO emp_attendance_images
    (attendance_id, image_type, s3_bucket, s3_key, s3_url, mime_type, file_size_kb)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    data
  );
};

// exports.getDayWiseAttendance = async (employeeId, month, year) => {
//   const [rows] = await db.query(
//     `
//     SELECT
//       ea.attendance_date,
//       ea.status,
//       ea.attendance_unit,
//       ea.working_minutes,
//       TIME(ea.check_in_time) AS check_in_time,
//       TIME(ea.check_out_time) AS check_out_time,
//       u.id AS employee_id,
//       u.name AS employee_name
//     FROM emp_attendance ea
//     JOIN users u ON u.id = ea.employee_id
//     WHERE ea.employee_id = ?
//       AND MONTH(ea.attendance_date) = ?
//       AND YEAR(ea.attendance_date) = ?
//     ORDER BY ea.attendance_date ASC
//     `,
//     [employeeId, month, year]
//   );

//   return rows;
// };

exports.getDayWiseAttendance = async ({
  employeeId,
  startDate,
  endDate,
  limit,
  offset
}) => {
  const [rows] = await db.query(
    `
    SELECT
      ea.attendance_date,
      ea.status,
      ea.attendance_unit,
      ea.working_minutes,
      TIME(ea.check_in_time) AS check_in_time,
      TIME(ea.check_out_time) AS check_out_time,
      u.id AS employee_id,
      u.name AS employee_name
    FROM emp_attendance ea
    JOIN users u ON u.id = ea.employee_id
    WHERE ea.employee_id = ?
      AND ea.attendance_date BETWEEN ? AND ?
    ORDER BY ea.attendance_date DESC
    LIMIT ? OFFSET ?
    `,
    [
      employeeId,
      startDate,
      endDate,
      Number(limit),
      Number(offset)
    ]
  );

  return rows;
};

exports.getDayWiseAttendanceCount = async (
  employeeId,
  startDate,
  endDate
) => {
  const [[row]] = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM emp_attendance
    WHERE employee_id = ?
      AND attendance_date BETWEEN ? AND ?
    `,
    [employeeId, startDate, endDate]
  );

  return row.total;
};

exports.getMonthlyAttendanceSummary = async (
  employeeId,
  month,
  year
) => {
  const [[row]] = await db.query(
    `
    SELECT
      SUM(attendance_unit = 'full') AS full_days,
      SUM(attendance_unit = 'half') AS half_days,
      SUM(attendance_unit = 'absent') AS absent_days,
      SUM(status = 'leave') AS leave_days,
      COUNT(*) AS total_days
    FROM emp_attendance
    WHERE employee_id = ?
      AND MONTH(attendance_date) = ?
      AND YEAR(attendance_date) = ?
    `,
    [employeeId, month, year]
  );

  return row;
};
