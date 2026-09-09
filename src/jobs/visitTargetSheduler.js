const cron = require("node-cron"); // npm install node-cron
const db = require("../config/db");
const visitTargetModel = require("../models/visitTargetTemplate.model");

/**
 * Daily rollover job:
 * 1. Find ACTIVE assignments whose period_end has already passed
 *    (i.e. nobody manually completed them, and they just ran out the clock).
 * 2. Expire each one.
 * 3. If its template is still ACTIVE + is_recurring, create the next
 *    period's assignment for that employee (targets copied fresh from
 *    the template). If the template's end_date has been reached,
 *    createNextAssignment() is a no-op and recurrence stops naturally.
 *
 * Each assignment is processed in its own transaction so one failure
 * doesn't roll back the whole batch.
 */
async function processExpiredAssignments() {
  const expiredCandidates = await visitTargetModel.getAssignmentsPastPeriodEnd();

  for (const assignment of expiredCandidates) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      await visitTargetModel.expireAssignment(connection, assignment.id);

      const template = await visitTargetModel.getActiveTemplateById(assignment.template_id);

      if (template) {
        const newAssignmentId = await visitTargetModel.createNextAssignment(
          connection,
          assignment,
          template
        );

        if (newAssignmentId) {
          console.log(
            `Rolled assignment ${assignment.id} -> new assignment ${newAssignmentId} ` +
            `(employee ${assignment.employee_id}, template ${template.id})`
          );
        } else {
          console.log(
            `Assignment ${assignment.id} expired; template ${template.id} ` +
            `has no further period to roll into (end_date reached or already exists).`
          );
        }
      } else {
        console.log(
          `Assignment ${assignment.id} expired; template ${assignment.template_id} ` +
          `is no longer ACTIVE/recurring, so it will not roll forward.`
        );
      }

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      console.error(`Failed to roll over assignment ${assignment.id}:`, err);
    } finally {
      connection.release();
    }
  }
}

// Runs once daily at 00:15 server time — adjust the cron expression to
// match when you want the rollover to happen (e.g. right after midnight).
cron.schedule("15 0 * * *", () => {
  processExpiredAssignments().catch((err) => {
    console.error("visitTarget scheduler run failed:", err);
  });
});

// Exported so it can also be triggered manually (e.g. an admin
// "run rollover now" button, or a one-off script) and for testing.
module.exports = { processExpiredAssignments };