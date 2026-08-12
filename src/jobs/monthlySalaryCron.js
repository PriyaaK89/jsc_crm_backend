const cron = require("node-cron");
const db = require("../config/db");


cron.schedule("59 23 28-31 * *", async () => {

  /* =====================================================
     CHECK LAST DAY OF MONTH
  ===================================================== */

  const tomorrow = new Date();

  tomorrow.setDate(tomorrow.getDate() + 1);

  // If tomorrow is not 1st date,
  // then today is NOT last day
  if (tomorrow.getDate() !== 1) {
    return;
  }

  console.log("=================================");
  console.log("Running monthly salary cron...");
  console.log("=================================");

  try {

    const now = new Date();

    // Current month/year
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    /* =====================================================
       GET ACTIVE EMPLOYEES
    ===================================================== */

    const [employees] = await db.query(`
      SELECT
        id,
        pf,
        esi
      FROM users
      WHERE is_active = 1
    `);

    console.log(
      `Employees found: ${employees.length}`
    );

    /* =====================================================
       LOOP EMPLOYEES
    ===================================================== */

    for (const emp of employees) {

      try {

        console.log(
          `Generating monthly salary for employee ${emp.id}`
        );

        /* =====================================================
           CHECK LOCK
        ===================================================== */

        const [[lockedRow]] = await db.query(
          `
          SELECT salary_locked
          FROM emp_salary_monthly
          WHERE employee_id = ?
            AND month = ?
            AND year = ?
          `,
          [ emp.id, month, year, ]
        );

        if ( lockedRow && lockedRow.salary_locked === 1 ) {

          console.log(
            `Salary locked for employee ${emp.id}`
          );

          continue;
        }

        /* =====================================================
           DAILY SALARY AGGREGATION
        ===================================================== */

        const [[summary]] = await db.query(
          `
          SELECT

            COUNT(
              CASE
                WHEN attendance_type = 'full'
                THEN 1
              END
            ) AS total_present,

            COUNT(
              CASE
                WHEN attendance_type = 'half'
                THEN 1
              END
            ) AS total_half_day,

            COUNT(
              CASE
                WHEN attendance_type = 'absent'
                THEN 1
              END
            ) AS total_absent,

            COUNT(
              CASE
                WHEN attendance_type = 'week_off'
                THEN 1
              END
            ) AS total_week_off,

            COUNT(
              CASE
                WHEN attendance_type = 'leave'
                THEN 1
              END
            ) AS total_leave,

            COALESCE(
              SUM(total_reading),
              0
            ) AS total_reading,

            COALESCE(
              SUM(basic_salary),
              0
            ) AS total_basic_salary,

            COALESCE(
              SUM(travelling_allowance),
              0
            ) AS total_travelling_allowance,

            COALESCE(
              SUM(daily_allowance),
              0
            ) AS total_daily_allowance,

            COALESCE(
              SUM(hotel_expense),
              0
            ) AS total_hotel_expense,

            COALESCE(
              SUM(other_expense),
              0
            ) AS total_other_expense,

            COALESCE(
              SUM(bus_train_toll_expense),
              0
            ) AS total_bus_train_toll_expense,

            COALESCE(
              SUM(gross_salary),
              0
            ) AS gross_salary

          FROM emp_salary_daily

          WHERE employee_id = ?
            AND MONTH(salary_date) = ?
            AND YEAR(salary_date) = ?
          `,
          [
            emp.id,
            month,
            year,
          ]
        );

        /* =====================================================
           CALCULATIONS
        ===================================================== */

        const grossSalary = Number(summary.gross_salary) || 0;
        const pfDeduction = Number(emp.pf) || 0;
        const esiDeduction = Number(emp.esi) || 0;

        const netSalary = grossSalary - pfDeduction - esiDeduction;

        /* =====================================================
           SAVE MONTHLY SALARY
        ===================================================== */

        await db.query(
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
            ?,?,?,?,?,?,?,?,?,?,
            ?,?,?,?,?,?,?,?,?,NOW()
          )

          ON DUPLICATE KEY UPDATE
            total_present = VALUES(total_present),
            total_half_day = VALUES(total_half_day),
            total_absent = VALUES(total_absent),
            total_week_off = VALUES(total_week_off),
            total_leave = VALUES(total_leave),
            total_reading = VALUES(total_reading),
            total_basic_salary = VALUES(total_basic_salary),
            total_travelling_allowance = VALUES(total_travelling_allowance),
            total_daily_allowance = VALUES(total_daily_allowance),
            total_hotel_expense = VALUES(total_hotel_expense),
            total_other_expense = VALUES(total_other_expense),
            total_bus_train_toll_expense = VALUES(total_bus_train_toll_expense),
            gross_salary = VALUES(gross_salary),
            pf_deduction = VALUES(pf_deduction),
            esi_deduction = VALUES(esi_deduction),
            net_salary = VALUES(net_salary)
          `,
          [

            emp.id,

            month,
            year,

            summary.total_present || 0,
            summary.total_half_day || 0,
            summary.total_absent || 0,
            summary.total_week_off || 0,
            summary.total_leave || 0,

            summary.total_reading || 0,

            summary.total_basic_salary || 0,

            summary.total_travelling_allowance || 0,
            summary.total_daily_allowance || 0,

            summary.total_hotel_expense || 0,
            summary.total_other_expense || 0,
            summary.total_bus_train_toll_expense || 0,

            grossSalary,

            pfDeduction,
            esiDeduction,

            netSalary,
          ]
        );

        console.log(
          `Monthly salary generated for employee ${emp.id}`
        );

      } catch (empError) {

        console.error(
          `Monthly salary failed for employee ${emp.id}`,
          empError
        );

      }
    }

    console.log("=================================");
    console.log("Monthly salary cron completed");
    console.log("=================================");

  } catch (error) {

    console.error(
      "Monthly salary cron failed",
      error
    );

  }

});