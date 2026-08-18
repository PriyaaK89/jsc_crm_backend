const { runDailyReminders } = require("../services/reminderService");

exports.runRemindersNow = async (req, res) => {
  try {
    console.log("Manual trigger: running WhatsApp reminders...");
    const results = await runDailyReminders();

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return res.status(200).json({
      success: true,
      message: `Processed ${results.length} reminder(s). Sent: ${sent}, Failed: ${failed}.`,
      results,
    });
  } catch (err) {
    console.error("Manual reminder run failed:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to run reminders.",
      error: err.message,
    });
  }
};