const cron = require("node-cron");
const { runDailyReminders } = require("../services/reminderService");

/**
 * Daily WhatsApp payment reminder job:
 * 1. Scans all pending sales_bill_references.
 * 2. Sends discount-tier reminders before the due date (Track A),
 *    then due-today / grace-period / post-grace reminders (Track B).
 * 3. Each bill is logged in whatsapp_reminder_logs so re-running the
 *    job the same day never double-sends.
 *
 * Runs daily at 10:00 AM server time (business hours, not midnight —
 * adjust the cron expression if needed).
 */
cron.schedule("0 10 * * *", async () => {
  console.log("======================================");
  console.log("Running WhatsApp payment reminder cron...");
  console.log("======================================");

  try {
    const results = await runDailyReminders();

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(`Reminders processed: ${results.length} (sent: ${sent}, failed: ${failed})`);
  } catch (error) {
    console.error("Reminder cron failed:", error);
  }

  console.log("======================================");
  console.log("WhatsApp reminder cron completed");
  console.log("======================================");
});

// Exported so it can also be triggered manually (e.g. an admin
// "run reminders now" button, or a one-off test script).
module.exports = { runDailyReminders };