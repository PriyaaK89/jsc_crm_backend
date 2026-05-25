const db = require("../config/db");

/* =====================================================
   GET MONTHLY SUMMARY FROM DAILY TABLE
===================================================== */

exports.getMonthlySalarySummary = async (
  employeeId,
  month,
  year
) => {

  const [[row]] = await db.query(
    `
    SELECT

      COUNT(
        CASE WHEN attendance_type = 'full'
        THEN 1 END
      ) AS total_present,

      COUNT(
        CASE WHEN attendance_type = 'half'
        THEN 1 END
      ) AS total_half_day,

      COUNT(
        CASE WHEN attendance_type = 'absent'
        THEN 1 END
      ) AS total_absent,

      COUNT(
        CASE WHEN attendance_type = 'week_off'
        THEN 1 END
      ) AS total_week_off,

      COUNT(
        CASE WHEN attendance_type = 'leave'
        THEN 1 END
      ) AS total_leave,

      SUM(total_reading)
        AS total_reading,

      SUM(basic_salary)
        AS total_basic_salary,

      SUM(travelling_allowance)
        AS total_travelling_allowance,

      SUM(daily_allowance)
        AS total_daily_allowance,

      SUM(hotel_expense)
        AS total_hotel_expense,

      SUM(other_expense)
        AS total_other_expense,

      SUM(bus_train_toll_expense)
        AS total_bus_train_toll_expense,

      SUM(gross_salary)
        AS gross_salary

    FROM emp_salary_daily

    WHERE employee_id = ?
      AND MONTH(salary_date) = ?
      AND YEAR(salary_date) = ?
    `,
    [employeeId, month, year]
  );

  return row;
};

/* =====================================================
   SAVE MONTHLY SALARY
===================================================== */

exports.saveMonthlySalary = async (data) => {

  const [result] = await db.query(
    `
    INSERT INTO emp_salary_monthly (

      employee_id,

      month,
      year,

      total_present,
      total_half_day,
      total_absent,
      total_week_off,
      total_leave,

      total_reading,

      total_basic_salary,

      total_travelling_allowance,
      total_daily_allowance,

      total_hotel_expense,
      total_other_expense,
      total_bus_train_toll_expense,

      gross_salary,

      pf_deduction,
      esi_deduction,

      net_salary,

      generated_at

    )
    VALUES (
      ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW()
    )

    ON DUPLICATE KEY UPDATE

      total_present = VALUES(total_present),
      total_half_day = VALUES(total_half_day),
      total_absent = VALUES(total_absent),
      total_week_off = VALUES(total_week_off),
      total_leave = VALUES(total_leave),

      total_reading = VALUES(total_reading),

      total_basic_salary =
        VALUES(total_basic_salary),

      total_travelling_allowance =
        VALUES(total_travelling_allowance),

      total_daily_allowance =
        VALUES(total_daily_allowance),

      total_hotel_expense =
        VALUES(total_hotel_expense),

      total_other_expense =
        VALUES(total_other_expense),

      total_bus_train_toll_expense =
        VALUES(total_bus_train_toll_expense),

      gross_salary = VALUES(gross_salary),

      pf_deduction = VALUES(pf_deduction),
      esi_deduction = VALUES(esi_deduction),

      net_salary = VALUES(net_salary)
    `,
    data
  );

  return result;
};