const cron = require('node-cron');
const db = require('../config/db');

cron.schedule('0 2 * * *', async () => {
  try {
    console.log("Running cleanup job...");

    await db.query(`
      DELETE FROM employee_locations
      WHERE recorded_at < NOW() - INTERVAL 40 DAY
    `);

    console.log("Old location data deleted");

  } catch (error) {
    console.error("Cleanup error:", error.message);
  }
});

cron.schedule("0 0 * * *", async () => {
  try {
    await db.query(
      `DELETE FROM notifications WHERE created_at < NOW() - INTERVAL 30 DAY`
    );
    console.log("Old notifications deleted");
  } catch (err) {
    console.error(err);
  }
});