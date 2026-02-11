const db = require("../config/db");

// exports.getUserSalaryInfo = async (employeeId) => {
//   const [[row]] = await db.query( ` SELECT name, salary, pf, esi FROM users WHERE id = ? `, [employeeId] );
//   return row;
// };

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


exports.getMonthlyAttendanceCounts = async (
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
      SUM(status = 'leave') AS leave_days
    FROM emp_attendance
    WHERE employee_id = ?
      AND MONTH(attendance_date) = ?
      AND YEAR(attendance_date) = ?
    `,
    [employeeId, month, year]
  );

  return row;
};

// exports.saveMonthlySalary = async (data) => {
//   const [result] = await db.query(

//     `
//     INSERT INTO emp_salary (
//   employee_id, month, year,
//   basic_salary, per_day_salary,
//   full_days, half_days, absent_days, leave_days,
//   payable_days, gross_salary,
//   travelling_allowance, city_allowance,
//   daily_allowance, hotel_allowance,
//   total_allowances,
//   pf, esi, total_deductions, net_salary
// )
// VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
// `,
//     data
//   );

//   return result.insertId;
// };

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
    `,
    data
  );

  return result.insertId;
};

