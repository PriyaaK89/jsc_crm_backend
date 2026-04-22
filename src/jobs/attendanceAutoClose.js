const cron = require("node-cron");
const db = require("../config/db");
const { generateDailySalaryInternal } = require("../controllers/empAttendance.controller");

cron.schedule("10 0 * * *", async () => {
  console.log("Running attendance auto close cron...");

  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const dateStr = yesterday.toISOString().split("T")[0];

    const [rows] = await db.query(
      `
      SELECT id, employee_id, check_in_time
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

      //  Set proper end time (6:00 PM)
      const checkOut = new Date(checkIn);
      checkOut.setHours(18, 0, 0, 0);

      let workingMinutes = Math.floor(
        (checkOut - checkIn) / (1000 * 60)
      );

      if (workingMinutes < 0) workingMinutes = 0;

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
        [checkOut, workingMinutes, row.id]
      );

      await generateDailySalaryInternal(row.employee_id, dateStr);
    }

    console.log("Auto close completed");
  } catch (error) {
    console.error("Cron Error:", error);
  }
});