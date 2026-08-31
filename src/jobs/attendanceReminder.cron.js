const cron = require("node-cron");
const db = require("../config/db");
const { sendTemplateMessage } = require("../services/whatsapp.service"); // adjust path to your file

const MARKETING_DEPARTMENT_ID = 2;

const formatPhoneForWhatsapp = (contactNo) => {
  if (!contactNo) return null;
  const digits = String(contactNo).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`; // prefix India code if missing
  return digits;
};

cron.schedule(
  "30 9 * * *",
  async () => {
    console.log("======================================");
    console.log("Running attendance reminder cron (9:30 AM IST)...");
    console.log("======================================");

    try {
      const now = new Date(
        new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
      );

      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const todayName = dayNames[now.getDay()];

      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      const dateStr = `${y}-${m}-${d}`;

      // Only active, department_id = 2 employees who have NO attendance row today at all
      const [employees] = await db.query(
        `
        SELECT u.id, u.name, u.contact_no, u.week_off
        FROM users u
        LEFT JOIN emp_attendance ea
          ON ea.employee_id = u.id AND ea.attendance_date = ?
        WHERE u.is_active = 1
          AND u.department_id = ?
          AND ea.id IS NULL
        `,
        [dateStr, MARKETING_DEPARTMENT_ID]
      );

      console.log(`Unmarked active marketing employees: ${employees.length}`);

      for (const emp of employees) {
        try {
          // Skip employees whose configured week_off matches today (e.g. "Sunday")
          if (emp.week_off && emp.week_off.trim().toLowerCase() === todayName.toLowerCase()) {
            console.log(`Skipping ${emp.name} — week off today`);
            continue;
          }

          const phone = formatPhoneForWhatsapp(emp.contact_no);
          if (!phone) {
            console.error(`No contact number for employee ${emp.id} (${emp.name})`);
            continue;
          }

          await sendTemplateMessage(phone, "attendance_reminder", "en_US", [
            {
              type: "body",
              parameters: [{ type: "text", text: emp.name }],
            },
          ]);

          console.log(`Reminder sent to ${emp.name} (${phone})`);
        } catch (empError) {
          console.error(
            `Failed to send reminder to employee ${emp.id}`,
            empError.response?.data || empError.message
          );
        }
      }

      console.log("Attendance reminder cron completed");
    } catch (error) {
      console.error("ATTENDANCE REMINDER CRON FAILED:", error);
    }
  },
  { timezone: "Asia/Kolkata" }
);

module.exports = {};