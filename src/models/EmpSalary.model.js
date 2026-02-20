const db = require("../config/db");

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
      daily_allowance_without_doc,
      hotel_allowance
    FROM users
    WHERE id = ?
    `,
    [employeeId]
  );
  return row;
};

exports.getMonthlySalarySummary = async (employeeId, month, year) => {
  const [[row]] = await db.query(
    `
    SELECT
      COUNT(CASE WHEN attendance_type = 'full' THEN 1 END) as full_days,
      COUNT(CASE WHEN attendance_type = 'half' THEN 1 END) as half_days,
      COUNT(CASE WHEN attendance_type = 'absent' THEN 1 END) as absent_days,
      COUNT(CASE WHEN attendance_type = 'leave' THEN 1 END) as leave_days,

      SUM(basic_salary) as total_basic,
      SUM(travelling_allowance) as total_travel,
      SUM(city_allowance) as total_city,
      SUM(daily_allowance) as total_daily,
      SUM(hotel_allowance) as total_hotel,
      SUM(gross_salary) as total_gross

    FROM emp_salary_daily
    WHERE employee_id = ?
    AND MONTH(salary_date) = ?
    AND YEAR(salary_date) = ?
    `,
    [employeeId, month, year]
  );

  return row;
};


exports.saveMonthlySalary = async (data) => {
  const [result] = await db.query(
    `
    INSERT INTO emp_salary (
      employee_id, month, year,
      basic_salary, per_day_salary,
      full_days, half_days, absent_days, leave_days,
      payable_days, gross_salary,
      travelling_allowance, city_allowance,
      daily_allowance, hotel_allowance,
      total_allowances,
      pf, esi, total_deductions, net_salary
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    
    ON DUPLICATE KEY UPDATE
      basic_salary = VALUES(basic_salary),
      per_day_salary = VALUES(per_day_salary),
      full_days = VALUES(full_days),
      half_days = VALUES(half_days),
      absent_days = VALUES(absent_days),
      leave_days = VALUES(leave_days),
      payable_days = VALUES(payable_days),
      gross_salary = VALUES(gross_salary),
      travelling_allowance = VALUES(travelling_allowance),
      city_allowance = VALUES(city_allowance),
      daily_allowance = VALUES(daily_allowance),
      hotel_allowance = VALUES(hotel_allowance),
      total_allowances = VALUES(total_allowances),
      pf = VALUES(pf),
      esi = VALUES(esi),
      total_deductions = VALUES(total_deductions),
      net_salary = VALUES(net_salary)
    `,
    data
  );

  return result;
};


