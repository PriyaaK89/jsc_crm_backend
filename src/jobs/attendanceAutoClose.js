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
      SELECT id, employee_id
      FROM emp_attendance
      WHERE attendance_date = ?
      AND status = 'present'
      AND check_out_time IS NULL
      `,
      [dateStr]
    );

    for (const row of rows) {

      await db.query(
        `
        UPDATE emp_attendance
        SET 
          working_minutes = 0,
          attendance_unit = 'half'
        WHERE id = ?
        `,
        [row.id]
      );

      await generateDailySalaryInternal(row.employee_id, dateStr);
    }

    console.log("Auto close completed");

  } catch (error) {
    console.error("Cron Error:", error);
  }

});