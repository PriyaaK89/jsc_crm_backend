const db = require("../config/db");

exports.getTodayAttendance = async (employeeId) => {
  const [rows] = await db.query(
    `SELECT * FROM emp_attendance WHERE employee_id = ? AND attendance_date = CURDATE() `,
    [employeeId],
  );
  return rows[0];
};

exports.getMyTodayAttendance = async (employeeId) => {
  const [rows] = await db.query(
    `SELECT
       id,
       status,
       work_type,
       field_work_type,
       visit_location,
       -- Cast to unambiguous ISO 8601 with explicit UTC 'Z' suffix.
       -- This makes JS's new Date(...) parse it correctly and identically
       -- everywhere, instead of relying on the ambiguous "YYYY-MM-DD HH:MM:SS" format.
       DATE_FORMAT(check_in_time, '%Y-%m-%dT%H:%i:%s.000Z')  AS check_in_time,
       DATE_FORMAT(check_out_time, '%Y-%m-%dT%H:%i:%s.000Z') AS check_out_time
     FROM emp_attendance
     WHERE employee_id = ? AND attendance_date = CURDATE()`,
    [employeeId],
  );
  return rows[0];
};

exports.createAttendance = async (data) => {
  const [result] = await db.query(
    ` INSERT INTO emp_attendance (
 employee_id,
 attendance_date,
 status,
 attendance_unit,
 work_type,
 field_work_type,
 travel_mode,
 vehicle_type,
 public_transport,
 odometer_reading,
 visit_location,
 district,
 route,
 check_in_time,
 check_in_latitude,
 check_in_longitude,
 check_in_accuracy,
 check_in_device,
 leave_reason ) VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) `,
    data,
  );
  return result.insertId;
};

exports.updateDayOver = async (data) => {
  return db.query(
    ` UPDATE emp_attendance SET
      status = 'day_over',
      check_out_time = NOW(),
      working_minutes = ?,
      attendance_unit = ?,
      late_login = ?,
      day_over_odometer_reading = ?,
      day_over_location = ?,
       day_over_latitude = ?,
      day_over_longitude = ?,
      day_over_accuracy = ?,
      day_over_device = ?
    WHERE id = ? `, data,
  );
};

// exports.saveAttendanceImage = async (data) => {
//   return db.query(
//     `INSERT INTO emp_attendance_images
//     (attendance_id, image_type, s3_bucket, s3_key, s3_url, mime_type, file_size_kb)
//     VALUES (?, ?, ?, ?, ?, ?, ?)
//     `,
//     data
//   );
// };

exports.saveAttendanceImage = async (data) => {
  const query = ` INSERT INTO emp_attendance_images
    ( attendance_id, image_type, storage_bucket, object_path, file_url, mime_type, file_size_kb )
    VALUES (?, ?, ?, ?, ?, ?, ?) `;

  const [result] = await db.query(query, data);
  return result.insertId;
};

exports.getDayWiseAttendance = async ({ employeeId, search, startDate, endDate, limit, offset, }) => {
  let query = ` SELECT
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

exports.getDayWiseAttendanceCount = async ({ employeeId, search, startDate, endDate, }) => {
  let query = ` SELECT COUNT(*) AS total
    FROM emp_attendance ea JOIN users u ON u.id = ea.employee_id WHERE 1=1 `;

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

exports.getMonthlyAttendanceSummary = async (employeeId, month, year) => {
  const [[row]] = await db.query(
    ` SELECT

      -- Leave Days
      SUM(
        CASE 
          WHEN status = 'leave' THEN 1
          ELSE 0
        END
      ) AS leave_days,


      -- Full Days
      SUM(
        CASE 
          WHEN attendance_unit = 'full' THEN 1
          ELSE 0
        END
      ) AS full_days,

      -- Half Days
      SUM(
        CASE 
          WHEN attendance_unit = 'half' THEN 1
          ELSE 0
        END
      ) AS half_days,

      -- Absent Days
      SUM(
        CASE 
          WHEN attendance_unit = 'absent'
               OR status = 'present' -- login but no checkout
          THEN 1
          ELSE 0
        END
      ) AS absent_days,

      COUNT(*) AS total_days

    FROM emp_attendance
    WHERE employee_id = ?
      AND MONTH(attendance_date) = ?
      AND YEAR(attendance_date) = ?
    `,
    [employeeId, month, year],
  );

  return {
     present_days: row.present_days || 0,
    leave_days: row.leave_days || 0,
    full_days: row.full_days || 0,
    half_days: row.half_days || 0,
    absent_days: row.absent_days || 0,
    total_days: row.total_days || 0,
  };
};
exports.getAttendanceImagesByDate = async (employeeId, date) => {
  const [rows] = await db.query(
    ` SELECT
      ea.id AS attendance_id,
      ea.attendance_date,
      eai.image_type,
      eai.storage_bucket,
      eai.object_path,
      eai.file_url,
      eai.mime_type,
      eai.file_size_kb
    FROM emp_attendance ea
    LEFT JOIN emp_attendance_images eai
      ON ea.id = eai.attendance_id
    WHERE ea.employee_id = ?
      AND ea.attendance_date = ?
    `, [employeeId, date], );

  return rows;
};

exports.getMyTeamAttendance = async ({ hierarchyIds, date, level, user_id }) => {
  // Guard: "IN ()" with an empty list is a SQL syntax error
  if (!hierarchyIds || hierarchyIds.length === 0) return [];

  // Default to today's date in IST if no date is sent
  const targetDate =
    date || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  let query = `
    SELECT
      ea.id,
      COALESCE(ea.attendance_date, ?) AS attendance_date,
      CASE WHEN ea.id IS NULL THEN 'absent' ELSE ea.status END AS status,
      CASE WHEN ea.id IS NULL THEN 'absent' ELSE ea.attendance_unit END AS attendance_unit,
      COALESCE(ea.working_minutes, 0) AS working_minutes,

      TIME(ea.check_in_time)  AS check_in_time,
      TIME(ea.check_out_time) AS check_out_time,

      ea.odometer_reading,
      ea.day_over_odometer_reading,
      ea.visit_location,

      ea.travel_mode,
      ea.work_type,
      ea.field_work_type,
      ea.vehicle_type,
      ea.leave_reason,

      u.id AS employee_id,
      u.name AS employee_name,
      u.contact_no,

      jr.level,
      jr.name AS role_name

    FROM users u
    JOIN job_roles jr ON jr.id = u.job_role_id
    LEFT JOIN emp_attendance ea
      ON ea.employee_id = u.id
      AND ea.attendance_date = ?

    WHERE u.id IN (${hierarchyIds.map(() => "?").join(",")})
      AND u.is_active = 1`;

  const params = [targetDate, targetDate, ...hierarchyIds];

  if (level) {
    query += ` AND jr.level = ?`;
    params.push(level);
  }

  if (user_id) {
    query += ` AND u.id = ?`;
    params.push(user_id);
  }

  query += ` ORDER BY u.name`;

  const [rows] = await db.query(query, params);
  return rows;
};

// exports.getMyTeamAttendance = async ({ hierarchyIds, date, level, user_id, }) => {
//   let query = ` SELECT
//       ea.id,
//       ea.attendance_date,
//       ea.status,
//       ea.attendance_unit,
//       ea.working_minutes,

//       TIME(ea.check_in_time) AS check_in_time,
//       TIME(ea.check_out_time) AS check_out_time,

//       ea.odometer_reading,
//       ea.day_over_odometer_reading,
//       ea.visit_location,

//       ea.travel_mode,
//       ea.work_type,
//       ea.field_work_type,
//       ea.vehicle_type,
//       ea.leave_reason,

//       u.id AS employee_id,
//       u.name AS employee_name,
//       u.contact_no,

//       jr.level,
//       jr.name AS role_name

//     FROM emp_attendance ea

//     JOIN users u ON u.id = ea.employee_id
//     JOIN job_roles jr ON jr.id = u.job_role_id

//     WHERE ea.employee_id IN (${hierarchyIds.map(() => "?").join(",")})`;

//   const params = [...hierarchyIds];

//   if (date) {
//     query += ` AND ea.attendance_date = ?`;
//     params.push(date);
//   }

//   if (level) {
//     query += ` AND jr.level = ?`;
//     params.push(level);
//   }

//   if (user_id) {
//     query += ` AND ea.employee_id = ?`;
//     params.push(user_id);
//   }

//   query += ` ORDER BY u.name`;

//   const [rows] = await db.query(query, params);

//   return rows;
// };

exports.getDailyAttendanceSummary = async (date) => {
  const [rows] = await db.query(
    ` SELECT 
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

SUM(
  CASE 
    WHEN ea.status = 'day_over'
         AND working_minutes IS NOT NULL
         AND working_minutes > 0
         AND working_minutes < 360
    THEN 1
    ELSE 0
  END
) AS half_days,
      

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
      AND ea.attendance_date = ? `,
    [date],
  );

  return rows[0];
};

exports.getMonthlyAttendanceSummary = async (employeeId, month, year) => {
  const [[row]] = await db.query(
    ` SELECT
      SUM(CASE WHEN status = 'leave' THEN 1 ELSE 0 END) AS leave_days,
      SUM(CASE WHEN attendance_unit = 'full' THEN 1 ELSE 0 END) AS full_days,
      SUM(CASE WHEN attendance_unit = 'half' THEN 1 ELSE 0 END) AS half_days,
      SUM(CASE WHEN attendance_unit = 'holiday' THEN 1 ELSE 0 END) AS holiday_days,
      SUM(CASE WHEN status IN ('present', 'day_over') THEN 1 ELSE 0 END) AS present_days,
      SUM(CASE WHEN attendance_unit = 'absent' THEN 1 ELSE 0 END) AS absent_days,
      COUNT(*) AS total_days,

      SUM(CASE WHEN work_type = 'field' THEN 1 ELSE 0 END) AS field_days,
      SUM(CASE WHEN work_type = 'field' AND field_work_type = 'tour' THEN 1 ELSE 0 END) AS tour_days,
      SUM(CASE WHEN work_type = 'office' THEN 1 ELSE 0 END) AS office_days,
      SUM(CASE WHEN work_type = 'wfh' THEN 1 ELSE 0 END) AS wfh_days,

      SUM(
        CASE WHEN travel_mode = 'private'
             AND day_over_odometer_reading IS NOT NULL
             AND odometer_reading IS NOT NULL
        THEN (day_over_odometer_reading - odometer_reading) ELSE 0 END
      ) AS total_km,
      SUM(
        CASE WHEN travel_mode = 'private'
             AND day_over_odometer_reading IS NOT NULL
             AND odometer_reading IS NOT NULL
        THEN 1 ELSE 0 END
      ) AS travel_tracked_days,

      -- FIXED: convert to IST before averaging the login-time clock value
      SEC_TO_TIME(
        AVG(
          CASE WHEN check_in_time IS NOT NULL
            THEN TIME_TO_SEC(TIME(CONVERT_TZ(check_in_time, '+00:00', '+05:30')))
          END
        )
      ) AS avg_login_time,

      -- unaffected by timezone — this is a pure duration (minutes worked),
      -- not a clock time, so no IST conversion is needed here
      AVG(CASE WHEN working_minutes IS NOT NULL AND working_minutes > 0 THEN working_minutes END) AS avg_working_minutes

    FROM emp_attendance
    WHERE employee_id = ? AND MONTH(attendance_date) = ? AND YEAR(attendance_date) = ?
    `,
    [employeeId, month, year],
  );

  return {
    leave_days: row.leave_days || 0,
    full_days: row.full_days || 0,
    half_days: row.half_days || 0,
    holiday_days: row.holiday_days || 0,
    present_days: row.present_days || 0,
    absent_days: row.absent_days || 0,
    total_days: row.total_days || 0,
    field_days: row.field_days || 0,
    tour_days: row.tour_days || 0,
    office_days: row.office_days || 0,
    wfh_days: row.wfh_days || 0,
    total_km: row.total_km || 0,
    travel_tracked_days: row.travel_tracked_days || 0,
    avg_login_time: row.avg_login_time,       // "HH:MM:SS" string, already IST — safe, it's a TIME type not a timestamp
    avg_working_minutes: row.avg_working_minutes || 0,
  };
};

// exports.getTodayAttendance = async (employeeId) => {
//   const [rows] = await db.query(
//     `SELECT id, status, work_type, field_work_type, visit_location,
//             check_in_time, check_out_time
//      FROM emp_attendance
//      WHERE employee_id = ? AND attendance_date = CURDATE()`,
//     [employeeId],
//   );
//   return rows[0];
// };