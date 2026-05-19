const cron = require("node-cron");
const db = require("../config/db");

const {
  generateDailySalaryInternal,
} = require("../controllers/empAttendance.controller");

cron.schedule("10 0 * * *", async () => {

  console.log("Running attendance auto close cron...");

  try {

    const yesterday = new Date();

    yesterday.setDate(yesterday.getDate() - 1);

    const dateStr = yesterday.toISOString().split("T")[0];

    const day = yesterday.getDay();

    // Sunday = 0
    const isSunday = day === 0;

    /* =====================================================
       STEP 1 -> AUTO CLOSE OPEN ATTENDANCE
    ===================================================== */

    const [rows] = await db.query(
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

    for (const row of rows) {

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

      // Generate salary row
      await generateDailySalaryInternal(
        row.employee_id,
        dateStr
      );
    }

    console.log("Auto close completed");


    /* =====================================================
       STEP 2 -> CREATE ABSENT / WEEK OFF
    ===================================================== */

    // All active employees
    const [employees] = await db.query(
      `
      SELECT id
      FROM users
      WHERE is_active = 1
      `
    );

    for (const emp of employees) {

      // Check attendance exists already
      const [existing] = await db.query(
        `
        SELECT id
        FROM emp_attendance
        WHERE employee_id = ?
          AND attendance_date = ?
        `,
        [
          emp.id,
          dateStr,
        ]
      );

      // Skip existing
      if (existing.length > 0) {
        continue;
      }

      /* =====================================================
         WEEK OFF
      ===================================================== */

      if (isSunday) {

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

        // Generate salary row
        await generateDailySalaryInternal(
          emp.id,
          dateStr
        );

      } else {

        /* =====================================================
           ABSENT
        ===================================================== */

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

        // Generate salary row
        await generateDailySalaryInternal(
          emp.id,
          dateStr
        );
      }
    }

    console.log("Absent/WeekOff generation completed");

  } catch (error) {

    console.error("Cron Error:", error);

  }

});