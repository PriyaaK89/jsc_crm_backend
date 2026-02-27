const cron = require('node-cron');
const db = require('../config/db');

cron.schedule('0 2 * * *', async () => {
  try {
    console.log("Running cleanup job...");

    await db.query(`
      DELETE FROM employee_locations
      WHERE recorded_at < NOW() - INTERVAL 30 DAY
    `);

    console.log("Old location data deleted");

  } catch (error) {
    console.error("Cleanup error:", error.message);
  }
});