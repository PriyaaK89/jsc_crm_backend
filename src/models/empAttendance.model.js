const db = require("../config/db");

exports.getTodayAttendance = async (employeeId) => {
  const [rows] = await db.query(
    `SELECT * FROM emp_attendance WHERE employee_id = ? AND attendance_date = CURDATE() `,
    [employeeId]
  );
  return rows[0];
};

exports.createAttendance = async (data) => {
  const [result] = await db.query(
    `
    INSERT INTO emp_attendance (
      employee_id, attendance_date, status, work_type, field_work_type, travel_mode, vehicle_type, public_transport, odometer_reading, visit_location, check_in_time, leave_reason
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

exports.getDayWiseAttendance = async ({
  employeeId,
  search,
  startDate,
  endDate,
  limit,
  offset,
}) => {
  let query = `
    SELECT
      ea.attendance_date,
      ea.status,
      ea.attendance_unit,
      ea.working_minutes,
      TIME(ea.check_in_time) AS check_in_time,
      TIME(ea.check_out_time) AS check_out_time,
      ea.odometer_reading,
      ea.day_over_odometer_reading,
      ea.visit_location,
      ea.travel_mode, ea.work_type, ea.field_work_type, ea.vehicle_type, ea.leave_reason,
      u.id AS employee_id,
      u.name AS employee_name
    FROM emp_attendance ea
    JOIN users u ON u.id = ea.employee_id
    WHERE 1=1
  `;

  const params = [];

  //  Filter by employee_id
  if (employeeId) {
    query += ` AND ea.employee_id = ?`;
    params.push(employeeId);
  }

  //  Search by employee name
  if (search) {
    query += ` AND u.name LIKE ?`;
    params.push(`%${search}%`);
  }

  //  Date filter
  if (startDate && endDate) {
    query += ` AND ea.attendance_date BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }

  //  Sorting + Pagination
  query += ` ORDER BY ea.attendance_date DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  const [rows] = await db.query(query, params);
  return rows;
};

exports.getDayWiseAttendanceCount = async ({
  employeeId,
  search,
  startDate,
  endDate,
}) => {
  let query = `
    SELECT COUNT(*) AS total
    FROM emp_attendance ea
    JOIN users u ON u.id = ea.employee_id
    WHERE 1=1
  `;

  const params = [];

  if (employeeId) {
    query += ` AND ea.employee_id = ?`;
    params.push(employeeId);
  }

  if (search) {
    query += ` AND u.name LIKE ?`;
    params.push(`%${search}%`);
  }

  if (startDate && endDate) {
    query += ` AND ea.attendance_date BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }

  const [[row]] = await db.query(query, params);
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

      -- Leave Days
      SUM(
        CASE 
          WHEN status = 'leave' THEN 1
          ELSE 0
        END
      ) AS leave_days,

      -- Absent (login but no checkout OR no working minutes)
      SUM(
        CASE 
          WHEN status IN ('present','day_over')
               AND (check_out_time IS NULL 
                    OR working_minutes IS NULL)
          THEN 1
          ELSE 0
        END
      ) AS absent_days,

      -- Full Days
      SUM(
        CASE 
          WHEN status IN ('present','day_over')
               AND working_minutes >= 360
          THEN 1
          ELSE 0
        END
      ) AS full_days,

      -- Half Days
      SUM(
        CASE 
          WHEN status IN ('present','day_over')
               AND working_minutes > 0
               AND working_minutes < 360
          THEN 1
          ELSE 0
        END
      ) AS half_days,

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

exports.getAttendanceImagesByDate = async (employeeId, date) => {
  const [rows] = await db.query(
    `
    SELECT 
      ea.id AS attendance_id,
      ea.attendance_date,
      eai.image_type,
      eai.s3_url
    FROM emp_attendance ea
    LEFT JOIN emp_attendance_images eai 
      ON ea.id = eai.attendance_id
    WHERE ea.employee_id = ?
      AND ea.attendance_date = ?
    `,
    [employeeId, date]
  );

  return rows;
};

exports.getDailyAttendanceSummary = async (date) => {
  const [rows] = await db.query(
    `
    SELECT 
      COUNT(DISTINCT u.id) AS total_employees,

      -- Active / Inactive
      SUM(CASE WHEN u.is_active = 1 THEN 1 ELSE 0 END) AS active_employees,
      SUM(CASE WHEN u.is_active = 0 THEN 1 ELSE 0 END) AS inactive_employees,

      -- Checked-in (login done but not day_over yet)
      SUM(
        CASE 
          WHEN ea.status = 'present' AND u.is_active = 1
          THEN 1 ELSE 0 
        END
      ) AS checked_in,

      -- Completed day (checkout done)
      SUM(
        CASE 
          WHEN ea.status = 'day_over' AND u.is_active = 1
          THEN 1 ELSE 0 
        END
      ) AS completed_day,

      -- Half day
      SUM(
        CASE 
          WHEN ea.attendance_unit = 'half' AND u.is_active = 1
          THEN 1 ELSE 0 
        END
      ) AS half_day,

      -- Leave
      SUM(
        CASE 
          WHEN ea.status = 'leave' AND u.is_active = 1
          THEN 1 ELSE 0 
        END
      ) AS leave_count,

      -- Absent (ONLY active employees with no record OR marked absent)
      SUM(
        CASE 
          WHEN u.is_active = 1 AND (
            ea.id IS NULL 
            OR ea.attendance_unit = 'absent'
          )
          THEN 1 ELSE 0 
        END
      ) AS absent_count

    FROM users u
    LEFT JOIN emp_attendance ea 
      ON u.id = ea.employee_id
      AND ea.attendance_date = ?
    `,
    [date]
  );

  return rows[0];
};