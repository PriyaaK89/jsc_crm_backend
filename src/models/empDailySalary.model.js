const db = require("../config/db");

// Get employee salary details
exports.getUserSalaryInfo = async (employeeId) => {
  const [[row]] = await db.query(
    `
    SELECT 
      name,
      salary,
      pf,
      esi,
      travelling_allowance_per_km,
      avg_travel_km_per_day,
      city_allowance_per_km,
      daily_allowance_with_doc,
      hotel_allowance
    FROM users
    WHERE id = ?
    `,
    [employeeId]
  );

  return row;
};

exports.getAttendanceByDate = async (employeeId, date) => {
  const [[row]] = await db.query(
    `
    SELECT
      id,
      status,
      attendance_unit,
      working_minutes,
      odometer_reading,
      day_over_odometer_reading,
      check_out_time
    FROM emp_attendance
    WHERE employee_id = ?
    AND attendance_date = ?
    `,
    [employeeId, date]
  );

  return row;
};

// Insert or update daily salary
exports.saveDailySalary = async (data) => {
  const [result] = await db.query(
    `
    INSERT INTO emp_salary_daily (
      employee_id,
      salary_date,
      attendance_type,
      working_hours,
      per_day_salary,
      basic_salary,
      travelling_allowance,
      daily_allowance,
      gross_salary,
      net_salary
    )
    VALUES (?,?,?,?,?,?,?,?,?,?)
    
    ON DUPLICATE KEY UPDATE
      attendance_type = VALUES(attendance_type),
      working_hours = VALUES(working_hours),
      per_day_salary = VALUES(per_day_salary),
      basic_salary = VALUES(basic_salary),
      travelling_allowance = VALUES(travelling_allowance),
      daily_allowance = VALUES(daily_allowance),
      gross_salary = VALUES(gross_salary),
      net_salary = VALUES(net_salary)
    `,
    data
  );

  return result;
};

// Get attendance for specific date

// exports.getAttendanceByDate = async (employeeId, date) => {
//   const [[row]] = await db.query(
//     `SELECT 
//       attendance_unit, 
//       working_minutes,
//       odometer_reading,
//       day_over_odometer_reading
//     FROM emp_attendance
//     WHERE employee_id = ?
//     AND attendance_date = ?
//     `,
//     [employeeId, date]
//   );
//   return row;
// };

// Get monthly daily salary records not used anywhere
exports.getMonthlyDailySalary = async (employeeId, month, year) => {
  const [rows] = await db.query(
    `
    SELECT *
    FROM emp_salary_daily
    WHERE employee_id = ?
    AND MONTH(salary_date) = ?
    AND YEAR(salary_date) = ?
    ORDER BY salary_date ASC
    `,
    [employeeId, month, year]
  );

  return rows;
};

// Get monthly totals
exports.getMonthlyTotals = async (employeeId, month, year) => {
  const [[row]] = await db.query(
    `
    SELECT
      SUM(basic_salary) as total_basic,
      SUM(travelling_allowance) as total_ta,
      SUM(city_allowance) as total_ca,
      SUM(daily_allowance) as total_da,
      SUM(hotel_allowance) as total_hotel,
      SUM(other_expense) as total_other,
      SUM(gross_salary) as total_gross,
      SUM(net_salary) as total_net
    FROM emp_salary_daily
    WHERE employee_id = ?
    AND MONTH(salary_date) = ?
    AND YEAR(salary_date) = ?
    `,
    [employeeId, month, year]
  );

  return row;
};

// exports.getSalaryByDateRange = async (employeeId, startDate, endDate) => {
//   const [rows] = await db.query(
//     `
//     SELECT * FROM emp_salary_daily WHERE employee_id = ? AND salary_date BETWEEN ? AND ? ORDER BY salary_date ASC
//     `,
//     [employeeId, startDate, endDate]
//   );
//   return rows;
// };

exports.getSalaryByDateRange = async (
  employeeId,
  startDate,
  endDate,
  limit,
  offset
) => {
  // Get paginated data
  const [rows] = await db.query(
    `
    SELECT *
    FROM emp_salary_daily
    WHERE employee_id = ?
    AND salary_date BETWEEN ? AND ?
    ORDER BY salary_date ASC
    LIMIT ? OFFSET ?
    `,
    [employeeId, startDate, endDate, limit, offset]
  );

  // Get total count (important for frontend pagination)
  const [countResult] = await db.query(
    `
    SELECT COUNT(*) as total
    FROM emp_salary_daily
    WHERE employee_id = ?
    AND salary_date BETWEEN ? AND ?
    `,
    [employeeId, startDate, endDate]
  );

  return {
    rows,
    total: countResult[0].total,
  };
};

exports.getMySalaryByDateRange = async (
  employeeId,
  startDate,
  endDate,
  limit,
  offset
) => {
  let query = `
    SELECT *
    FROM emp_salary_daily
    WHERE employee_id = ?
  `;

  let countQuery = `
    SELECT COUNT(*) as total
    FROM emp_salary_daily
    WHERE employee_id = ?
  `;

  const params = [employeeId];
  const countParams = [employeeId];

  //  Apply filters only if provided
  if (startDate && endDate) {
    query += ` AND salary_date BETWEEN ? AND ?`;
    countQuery += ` AND salary_date BETWEEN ? AND ?`;
    params.push(startDate, endDate);
    countParams.push(startDate, endDate);
  } else if (startDate) {
    query += ` AND salary_date >= ?`;
    countQuery += ` AND salary_date >= ?`;
    params.push(startDate);
    countParams.push(startDate);
  } else if (endDate) {
    query += ` AND salary_date <= ?`;
    countQuery += ` AND salary_date <= ?`;
    params.push(endDate);
    countParams.push(endDate);
  }

  query += ` ORDER BY salary_date ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const [rows] = await db.query(query, params);
  const [countResult] = await db.query(countQuery, countParams);

  return {
    rows,
    total: countResult[0].total,
  };
};