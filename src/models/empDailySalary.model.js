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

// Get attendance for specific date

exports.getAttendanceByDate = async (employeeId, date) => {
  const [[row]] = await db.query(
    `
    SELECT 
      attendance_unit, 
      working_minutes,
      odometer_reading,
      day_over_odometer_reading
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

// Get monthly daily salary records
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
