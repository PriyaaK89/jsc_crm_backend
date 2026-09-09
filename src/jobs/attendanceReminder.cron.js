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

// Reliable IST date + weekday, independent of server's own timezone/ICU setup.
// Avoids the toLocaleString -> new Date(string) round trip, which can silently
// misparse on some Node builds (especially slim Docker images without full ICU data).
const getISTDateParts = () => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  });

  const parts = formatter.formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;

  const dateStr = `${get("year")}-${get("month")}-${get("day")}`; // YYYY-MM-DD, matches MySQL DATE
  const todayName = get("weekday"); // e.g. "Monday"

  return { dateStr, todayName };
};

cron.schedule(
  "30 9 * * *",
  async () => {
    console.log("======================================");
    console.log("Running attendance reminder cron (9:30 AM IST)...");
    console.log("======================================");

    try {
      const { dateStr, todayName } = getISTDateParts();

      // Debug — remove once you've confirmed this is computing the right date/day
      console.log("DEBUG dateStr:", dateStr, "todayName:", todayName);
      console.log(
        "DEBUG server default TZ:",
        Intl.DateTimeFormat().resolvedOptions().timeZone
      );

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

      if (employees.length > 0) {
        console.log(
          "DEBUG employees:",
          employees.map((e) => ({
            id: e.id,
            name: e.name,
            contact_no: e.contact_no,
            week_off: e.week_off,
          }))
        );
      }

      for (const emp of employees) {
        try {
          // Skip employees whose configured week_off matches today (e.g. "Sunday")
          if (
            emp.week_off &&
            emp.week_off.trim().toLowerCase() === todayName.toLowerCase()
          ) {
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