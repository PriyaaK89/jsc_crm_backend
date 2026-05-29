const cron = require("node-cron");
const db = require("../config/db");

const {
  generateDailySalaryInternal,
} = require("../controllers/empAttendance.controller");

/* =====================================================
   ATTENDANCE AUTO CLOSE + ABSENT/WEEK OFF
===================================================== */

cron.schedule("10 0 * * *", async () => {

  console.log("======================================");
  console.log("Running attendance auto close cron...");
  console.log("======================================");

  try {

    /* =====================================================
       YESTERDAY DATE (IST SAFE)
    ===================================================== */

    const yesterday = new Date();

    yesterday.setDate(yesterday.getDate() - 1);

    // Prevent UTC issue
    const localDate = new Date(
      yesterday.getTime() - yesterday.getTimezoneOffset() * 60000
    );

    const dateStr = localDate.toISOString().split("T")[0];

    const day = yesterday.getDay();

    // Sunday = 0
    const isSunday = day === 0;

    console.log("Date:", dateStr);
    console.log("Is Sunday:", isSunday);

    /* =====================================================
       STEP 1 -> AUTO CLOSE OPEN ATTENDANCE
    ===================================================== */

    const [openAttendanceRows] = await db.query(
      `
      SELECT 
        id,
        employee_id,
        check_in_time
      FROM emp_attendance
      WHERE attendance_date = ?
        AND status = 'present'
        AND check_out_time IS NULL
        AND check_in_time IS NOT NULL
      `,
      [dateStr]
    );

    console.log(
      `Open attendance found: ${openAttendanceRows.length}`
    );

    for (const row of openAttendanceRows) {

      try {

        console.log(
          `Auto closing attendance for employee ${row.employee_id}`
        );

        const checkIn = new Date(row.check_in_time);

        // Auto checkout at 6 PM
        const checkOut = new Date(checkIn);

        checkOut.setHours(18, 0, 0, 0);

        let workingMinutes = Math.floor(
          (checkOut - checkIn) / (1000 * 60)
        );

        if (workingMinutes < 0) {
          workingMinutes = 0;
        }

        await db.query(
          `
          UPDATE emp_attendance
          SET
            status = 'day_over',
            check_out_time = ?,
            working_minutes = ?,
            attendance_unit = 'half'
          WHERE id = ?
          `,
          [
            checkOut,
            workingMinutes,
            row.id,
          ]
        );

        // Salary generation
        try {

          await generateDailySalaryInternal(
            row.employee_id,
            dateStr
          );

        } catch (salaryError) {

          console.error(
            `Salary generation failed for employee ${row.employee_id}`,
            salaryError
          );

        }

        console.log(
          `Attendance auto closed for employee ${row.employee_id}`
        );

      } catch (rowError) {

        console.error(
          `Failed to auto close employee ${row.employee_id}`,
          rowError
        );

      }
    }

    console.log("Step 1 completed");

    /* =====================================================
       STEP 2 -> CREATE ABSENT / WEEK OFF
    ===================================================== */

    // IMPORTANT:
    // Filter ONLY employee users
    const [employees] = await db.query(
      `
      SELECT id
      FROM users
      WHERE is_active = 1
      `
    );

    console.log(`Employees found: ${employees.length}`);

    for (const emp of employees) {

      try {

        console.log(`Processing employee ${emp.id}`);

        /* =====================================================
           CHECK EXISTING ATTENDANCE
        ===================================================== */

        const [existing] = await db.query(
          `
          SELECT id, status
          FROM emp_attendance
          WHERE employee_id = ?
            AND attendance_date = ?
          `,
          [
            emp.id,
            dateStr,
          ]
        );

        // Skip if already exists
        if (existing.length > 0) {

          console.log(
            `Attendance already exists for employee ${emp.id}`
          );

          continue;
        }

        /* =====================================================
           WEEK OFF
        ===================================================== */

        if (isSunday) {

          console.log(
            `Creating week off for employee ${emp.id}`
          );

          await db.query(
            `
            INSERT INTO emp_attendance (
              employee_id,
              attendance_date,
              status,
              attendance_unit,
              created_at,
              updated_at
            )
            VALUES (
              ?,
              ?,
              'week_off',
              'week_off',
              NOW(),
              NOW()
            )
            `,
            [
              emp.id,
              dateStr,
            ]
          );

        } else {

          /* =====================================================
             ABSENT
          ===================================================== */

          console.log(
            `Creating absent for employee ${emp.id}`
          );

          await db.query(
            `
            INSERT INTO emp_attendance (
              employee_id,
              attendance_date,
              status,
              attendance_unit,
              created_at,
              updated_at
            )
            VALUES (
              ?,
              ?,
              'absent',
              'absent',
              NOW(),
              NOW()
            )
            `,
            [
              emp.id,
              dateStr,
            ]
          );
        }

        /* =====================================================
           GENERATE SALARY
        ===================================================== */

        try {

          await generateDailySalaryInternal(
            emp.id,
            dateStr
          );

        } catch (salaryError) {

          console.error(
            `Salary generation failed for employee ${emp.id}`,
            salaryError
          );

        }

        console.log(
          `Completed employee ${emp.id}`
        );

      } catch (employeeError) {

        console.error(
          `Failed employee ${emp.id}`,
          employeeError
        );

      }
    }

    console.log("======================================");
    console.log("Attendance cron completed");
    console.log("======================================");

  } catch (error) {

    console.error("CRON FAILED:", error);

  }

});