const db = require("../config/db");
const { getNextPeriod } = require("../utils/targetPeriod.helper");

/**
 * Real visits table (confirmed):
 *   visits(id, user_id, customer_id, visit_type, customer_type, comment,
 *          reminder_date, image_path, created_at, visit_purpose)
 * Notes:
 * - Employee column is `user_id`, not `employee_id`.
 * - There's no dedicated "visit date" column, so the visit's own
 *   `created_at` timestamp is used as the date it happened. Only the
 *   DATE part of created_at is compared against the assignment period.
 */
const ACHIEVED_VISITS_TABLE = "visits";

exports.createTemplate = async (connection, data) => {
  const query = `
        INSERT INTO visit_target_templates
        (
            assigned_by,
            template_name,
            frequency,
            is_recurring,
            start_date,
            end_date,
            status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

  const [result] = await connection.query(query, [
    data.assigned_by,
    data.template_name,
    data.frequency,
    data.is_recurring,
    data.start_date,
    data.end_date,
    data.status || "ACTIVE",
  ]);

  return result.insertId;
};

exports.updateTemplate = async (connection, templateId, data) => {
  const allowed = [
    "template_name",
    "frequency",
    "is_recurring",
    "start_date",
    "end_date",
    "status",
  ];

  const fields = [];
  const params = [];

  allowed.forEach((key) => {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(data[key]);
    }
  });

  if (fields.length === 0) {
    return false;
  }

  params.push(templateId);

  const query = `
    UPDATE visit_target_templates
    SET ${fields.join(", ")}
    WHERE id = ?
  `;

  const [result] = await connection.query(query, params);

  return result.affectedRows > 0;
};

/**
 * Delete Template (soft delete)
 *
 * IMPORTANT: visit_target_assignments references this table via
 * visit_target_assignments_ibfk_1 WITHOUT ON DELETE CASCADE, so a hard
 * DELETE will throw a foreign key error the moment any assignment history
 * exists. Soft-deleting (status = INACTIVE) is the safe, non-destructive
 * option and keeps assignment history intact.
 */
exports.deleteTemplate = async (connection, templateId) => {
  const [result] = await connection.query(
    `UPDATE visit_target_templates SET status = 'INACTIVE' WHERE id = ?`,
    [templateId]
  );

  return result.affectedRows > 0;
};

exports.assignEmployees = async (connection, templateId, employeeIds) => {
  if (!employeeIds || employeeIds.length === 0) {
    return;
  }

  // Remove duplicate employee IDs
  const uniqueEmployeeIds = [...new Set(employeeIds)];

  const values = uniqueEmployeeIds.map((employeeId) => [
    templateId,
    employeeId,
  ]);

  const query = `
    INSERT INTO visit_target_template_users
    (
      template_id,
      employee_id
    )
    VALUES ?
  `;

  await connection.query(query, [values]);
};

/**
 * Update Template Users
 *
 * Diffs the incoming (deduped) employee list against what's currently
 * assigned — only removes/adds the delta instead of wiping and
 * re-inserting everything, so unrelated rows/timestamps are untouched.
 */
exports.updateTemplateUsers = async (connection, templateId, employeeIds) => {
  const uniqueEmployeeIds = [...new Set(employeeIds)];

  const [existingRows] = await connection.query(
    `SELECT employee_id FROM visit_target_template_users WHERE template_id = ?`,
    [templateId]
  );

  const existingIds = existingRows.map((r) => r.employee_id);

  const toRemove = existingIds.filter((id) => !uniqueEmployeeIds.includes(id));
  const toAdd = uniqueEmployeeIds.filter((id) => !existingIds.includes(id));

  if (toRemove.length > 0) {
    await connection.query(
      `DELETE FROM visit_target_template_users
       WHERE template_id = ? AND employee_id IN (${toRemove.map(() => "?").join(",")})`,
      [templateId, ...toRemove]
    );
  }

  if (toAdd.length > 0) {
    const values = toAdd.map((employeeId) => [templateId, employeeId]);

    await connection.query(
      `INSERT INTO visit_target_template_users (template_id, employee_id) VALUES ?`,
      [values]
    );
  }

  return { added: toAdd, removed: toRemove };
};

exports.insertTargetDetails = async (connection, templateId, targets) => {
  if (!targets || targets.length === 0) {
    return;
  }

  const values = targets.map((target) => [
    templateId,
    target.visit_type,
    target.target_value,
  ]);

  const query = `
      INSERT INTO visit_target_template_details
      (
          template_id,
          visit_type,
          target_value
      )
      VALUES ?
  `;

  await connection.query(query, [values]);
};

/**
 * Update Template Targets
 *
 * Upserts incoming visit_type/target_value pairs (relies on the
 * (template_id, visit_type) unique key) and removes visit types that are
 * no longer present in the incoming list.
 */
exports.updateTemplateTargets = async (connection, templateId, targets) => {
  if (!targets || targets.length === 0) {
    return;
  }

  const incomingTypes = targets.map((t) => t.visit_type);

  const [existingRows] = await connection.query(
    `SELECT visit_type FROM visit_target_template_details WHERE template_id = ?`,
    [templateId]
  );

  const toRemove = existingRows
    .map((r) => r.visit_type)
    .filter((type) => !incomingTypes.includes(type));

  if (toRemove.length > 0) {
    await connection.query(
      `DELETE FROM visit_target_template_details
       WHERE template_id = ? AND visit_type IN (${toRemove.map(() => "?").join(",")})`,
      [templateId, ...toRemove]
    );
  }

  const values = targets.map((t) => [templateId, t.visit_type, t.target_value]);

  await connection.query(
    `
      INSERT INTO visit_target_template_details (template_id, visit_type, target_value)
      VALUES ?
      ON DUPLICATE KEY UPDATE target_value = VALUES(target_value)
    `,
    [values]
  );
};

/**
 * Get Template By Id
 */
exports.getTemplateById = async (templateId) => {
  const [rows] = await db.query(
    `
    SELECT

        tt.*,

        u.name AS assigned_by_name

    FROM visit_target_templates tt

    INNER JOIN users u
        ON u.id = tt.assigned_by

    WHERE tt.id = ?
    `,
    [templateId]
  );

  return rows[0];
};

/**
 * Get Active Template By Id (used by the scheduler to decide whether a
 * template is still eligible to roll forward into the next period)
 */
exports.getActiveTemplateById = async (templateId) => {
  const [rows] = await db.query(
    `SELECT * FROM visit_target_templates WHERE id = ? AND status = 'ACTIVE' AND is_recurring = 1`,
    [templateId]
  );

  return rows[0];
};

/**
 * Get All Templates (paginated list w/ filters)
 */
exports.getAllTemplates = async (filters = {}) => {
  const { status, frequency, search, page = 1, limit = 20 } = filters;

  const where = [];
  const params = [];

  if (status) {
    where.push("tt.status = ?");
    params.push(status);
  }

  if (frequency) {
    where.push("tt.frequency = ?");
    params.push(frequency);
  }

  if (search) {
    where.push("tt.template_name LIKE ?");
    params.push(`%${search}%`);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const offset = (page - 1) * limit;

  const [rows] = await db.query(
    `
      SELECT
        tt.*,
        u.name AS assigned_by_name,
        (
          SELECT COUNT(*) FROM visit_target_template_users ttu
          WHERE ttu.template_id = tt.id
        ) AS employee_count
      FROM visit_target_templates tt
      INNER JOIN users u ON u.id = tt.assigned_by
      ${whereClause}
      ORDER BY tt.created_at DESC
      LIMIT ? OFFSET ?
    `,
    [...params, Number(limit), Number(offset)]
  );

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM visit_target_templates tt ${whereClause}`,
    params
  );

  return { rows, total };
};

/**
 * Get Template List (lightweight dropdown/select source)
 */
exports.getTemplateList = async () => {
  const [rows] = await db.query(
    `SELECT id, template_name, frequency, status
     FROM visit_target_templates
     WHERE status = 'ACTIVE'
     ORDER BY template_name ASC`
  );

  return rows;
};

/**
 * Check Duplicate Active Template
 *
 * Prevent assigning the same frequency
 * to the same employee for overlapping dates.
 */
// exports.checkDuplicateTemplate = async ( employeeIds, startDate, endDate, excludeTemplateId = null ) => {
//   if (!employeeIds || employeeIds.length === 0) { return []; }

//   let query = ` SELECT
//       ttu.employee_id,
//       tt.id AS template_id

//     FROM visit_target_templates tt

//     INNER JOIN visit_target_template_users ttu
//       ON ttu.template_id = tt.id

//     WHERE
//       ttu.employee_id IN (${employeeIds.map(() => "?").join(",")})
//       AND tt.status = 'ACTIVE'

//       AND (
//         tt.start_date <= ?
//         AND tt.end_date >= ?
//       ) `;

//   const params = [...employeeIds, endDate, startDate];

//   // Ignore current template while editing
//   if (excludeTemplateId) { query += ` AND tt.id <> ?`; params.push(excludeTemplateId); }

//   const [rows] = await db.query(query, params);
//   return rows;
// };

exports.checkDuplicateTemplate = async (
  employeeIds,
  startDate,
  endDate,
  excludeTemplateId = null
) => {
  if (!employeeIds || employeeIds.length === 0) {
    return [];
  }

  let query = `
    SELECT
      vta.employee_id,
      vta.template_id

    FROM visit_target_assignments vta

    INNER JOIN visit_target_templates tt
      ON tt.id = vta.template_id

    WHERE
      vta.employee_id IN (${employeeIds.map(() => "?").join(",")})

      -- Only ACTIVE assignments should block a new assignment
      AND vta.status = 'ACTIVE'

      -- Ignore deleted/inactive templates
      AND tt.status = 'ACTIVE'

      -- Check overlapping period
      AND (
        vta.period_start <= ?
        AND vta.period_end >= ?
      )
  `;

  const params = [...employeeIds, endDate, startDate];

  // Ignore current template while editing
  if (excludeTemplateId) {
    query += ` AND vta.template_id <> ?`;
    params.push(excludeTemplateId);
  }

  const [rows] = await db.query(query, params);

  return rows;
};
/**
 * Get Employees of Template
 */
exports.getTemplateEmployees = async (templateId) => {
  const [rows] = await db.query(
    ` SELECT u.id, u.name
        FROM visit_target_template_users tu
        INNER JOIN users u ON u.id = tu.employee_id
        WHERE tu.template_id=? `,
    [templateId]
  );

  return rows;
};

/**
 * Get Target Details
 */
exports.getTemplateTargets = async (templateId) => {
  const [rows] = await db.query(
    ` SELECT visit_type, target_value
        FROM visit_target_template_details
        WHERE template_id=? `,
    [templateId]
  );

  return rows;
};

exports.createAssignment = async (connection, data) => {
  const query = `
        INSERT INTO visit_target_assignments
        (
            template_id,
            employee_id,
            period_start,
            period_end,
            status
        )
        VALUES (?, ?, ?, ?, ?)
    `;

  const [result] = await connection.query(query, [
    data.template_id,
    data.employee_id,
    data.period_start,
    data.period_end,
    data.status || "ACTIVE",
  ]);

  return result.insertId;
};

exports.createAssignmentDetails = async (connection, assignmentId, targets) => {
  if (!targets || targets.length === 0) {
    return;
  }

  const values = targets.map((target) => [
    assignmentId,
    target.visit_type,
    target.target_value,
  ]);

  const query = `
      INSERT INTO visit_target_assignment_details
      (
          assignment_id,
          visit_type,
          target_value
      )
      VALUES ?
  `;

  await connection.query(query, [values]);
};

// exports.checkExistingAssignment = async ( templateId, employeeId, startDate, endDate ) => {
//   const [rows] = await db.query(
//     ` SELECT id FROM visit_target_assignments WHERE template_id=? AND employee_id=? AND period_start=? AND period_end=? LIMIT 1 `,
//     [templateId, employeeId, startDate, endDate]
//   );
//   return rows.length > 0;
// };

exports.checkExistingAssignment = async (
  templateId,
  employeeId,
  startDate,
  endDate
) => {
  const [rows] = await db.query(
    ` SELECT id
        FROM visit_target_assignments
        WHERE template_id=?
        AND employee_id=?
        AND period_start=?
        AND period_end=?
        AND status='ACTIVE'
        LIMIT 1 `,

    [templateId, employeeId, startDate, endDate]
  );

  return rows.length > 0;
};

exports.getAssignmentById = async (id) => {
  const [rows] = await db.query(
    ` SELECT * FROM visit_target_assignments  WHERE id=? `,
    [id]
  );

  return rows[0];
};

exports.getEmployeeActiveAssignment = async (employeeId) => {
  const [rows] = await db.query(
    ` SELECT *
        FROM visit_target_assignments
        WHERE employee_id=?
        AND status='ACTIVE'

        AND CURDATE()
        BETWEEN period_start
        AND period_end

        LIMIT 1
        `,

    [employeeId]
  );

  return rows[0];
};

exports.getAssignmentTargets = async (assignmentId) => {
  const [rows] = await db.query(
    ` SELECT visit_type, target_value FROM visit_target_assignment_details WHERE assignment_id=? `,
    [assignmentId]
  );

  return rows;
};

exports.getAssignmentsToGenerate = async () => {
  const [rows] = await db.query(
    ` SELECT * FROM visit_target_templates
        WHERE status='ACTIVE'
        AND is_recurring=1 `
  );
  return rows;
};

exports.updateAssignmentStatus = async (
  connection,
  assignmentId,
  status,
  completedAt = null
) => {
  await connection.query(
    ` UPDATE visit_target_assignments
    SET status = ?, completed_at = ?
    WHERE id = ? `,
    [status, completedAt, assignmentId]
  );
};

/**
 * Mark Assignment Completed
 * Only flips ACTIVE -> COMPLETED (won't touch an already-EXPIRED row).
 */
exports.markAssignmentCompleted = async (connection, assignmentId) => {
  const [result] = await connection.query(
    `UPDATE visit_target_assignments
     SET status = 'COMPLETED', completed_at = NOW()
     WHERE id = ? AND status = 'ACTIVE'`,
    [assignmentId]
  );

  return result.affectedRows > 0;
};

/**
 * Expire Assignment
 * Only flips ACTIVE -> EXPIRED.
 */
exports.expireAssignment = async (connection, assignmentId) => {
  const [result] = await connection.query(
    `UPDATE visit_target_assignments
     SET status = 'EXPIRED'
     WHERE id = ? AND status = 'ACTIVE'`,
    [assignmentId]
  );

  return result.affectedRows > 0;
};

/**
 * Get assignments whose period has ended but are still marked ACTIVE
 * (i.e. haven't been rolled over/expired yet). Used by the scheduler.
 */
exports.getAssignmentsPastPeriodEnd = async () => {
  const [rows] = await db.query(
    `SELECT * FROM visit_target_assignments
     WHERE status = 'ACTIVE' AND period_end < CURDATE()`
  );

  return rows;
};

/**
 * Create Next Assignment
 *
 * Rolls a just-finished assignment forward into the next period for a
 * recurring template. Targets are copied from the TEMPLATE (source of
 * truth), not the previous assignment, so any template target edits are
 * picked up automatically. Returns null (no-op) if the template's
 * end_date has been reached or the assignment already exists.
 */
exports.createNextAssignment = async (connection, previousAssignment, template) => {
  const nextPeriod = getNextPeriod(previousAssignment.period_end, template.frequency);

  // For recurring templates, end_date is a rolling boundary — extend it
  // to cover the new period instead of using it to cap recurrence.
  // Non-recurring templates keep the old hard-stop behavior.
  if (!template.is_recurring && nextPeriod.start_date > template.end_date) {
    return null;
  }

  const alreadyExists = await exports.checkExistingAssignment(
    template.id,
    previousAssignment.employee_id,
    nextPeriod.start_date,
    nextPeriod.end_date
  );

  if (alreadyExists) {
    return null;
  }

  const newAssignmentId = await exports.createAssignment(connection, {
    template_id: template.id,
    employee_id: previousAssignment.employee_id,
    period_start: nextPeriod.start_date,
    period_end: nextPeriod.end_date,
    status: "ACTIVE",
  });

  const templateTargets = await exports.getTemplateTargets(template.id);
  await exports.createAssignmentDetails(connection, newAssignmentId, templateTargets);

  // Keep the template's end_date in sync with the latest period it has
  // rolled into, so getTemplateById/listTemplates reflect current state.
  if (template.is_recurring && nextPeriod.end_date > template.end_date) {
    await connection.query(
      `UPDATE visit_target_templates SET end_date = ? WHERE id = ?`,
      [nextPeriod.end_date, template.id]
    );
  }

  return newAssignmentId;
};

/**
 * Get Assignment Progress (target vs. achieved, by visit_type)
 *
 * Depends on ACHIEVED_VISITS_TABLE — see the assumption note at the top
 * of this file.
 */
exports.getAssignmentProgress = async (assignmentId) => {
  const assignment = await exports.getAssignmentById(assignmentId);

  if (!assignment) {
    return null;
  }

  const [targetRows] = await db.query(
    `SELECT visit_type, target_value
     FROM visit_target_assignment_details
     WHERE assignment_id = ?`,
    [assignmentId]
  );

  const [achievedRows] = await db.query(
    `
      SELECT visit_type, COUNT(*) AS achieved
      FROM ${ACHIEVED_VISITS_TABLE}
      WHERE user_id = ?
        AND DATE(created_at) BETWEEN ? AND ?
      GROUP BY visit_type
    `,
    [assignment.employee_id, assignment.period_start, assignment.period_end]
  );

  const achievedMap = {};
  achievedRows.forEach((r) => {
    achievedMap[r.visit_type] = r.achieved;
  });

  return {
    assignment,
    breakdown: targetRows.map((t) => ({
      visit_type: t.visit_type,
      target_value: t.target_value,
      achieved: achievedMap[t.visit_type] || 0,
    })),
  };
};

/**
 * Get Employee Progress — current active assignment + its progress
 */
exports.getEmployeeProgress = async (employeeId) => {
  const assignment = await exports.getEmployeeActiveAssignment(employeeId);

  if (!assignment) {
    return null;
  }

  return exports.getAssignmentProgress(assignment.id);
};

/**
 * Get Admin Progress — progress across many employees/assignments at once
 * (dashboard view). Optionally filter by template or period.
 */
exports.getAdminProgress = async (filters = {}) => {
  const { templateId, periodStart, periodEnd } = filters;

  const where = ["a.status = 'ACTIVE'"];
  const params = [];

  if (templateId) {
    where.push("a.template_id = ?");
    params.push(templateId);
  }

  if (periodStart && periodEnd) {
    where.push("a.period_start >= ? AND a.period_end <= ?");
    params.push(periodStart, periodEnd);
  }

  const [assignments] = await db.query(
    `
      SELECT a.*, u.name AS employee_name
      FROM visit_target_assignments a
      INNER JOIN users u ON u.id = a.employee_id
      WHERE ${where.join(" AND ")}
      ORDER BY a.employee_id
    `,
    params
  );

  // Note: N+1 by design for readability/correctness at typical dashboard
  // scale (tens of active assignments). If this ever needs to run over
  // hundreds of rows, batch the achieved-visits query with a single
  // GROUP BY employee_id + visit_type instead of per-assignment calls.
  const result = [];

  for (const assignment of assignments) {
    const progress = await exports.getAssignmentProgress(assignment.id);

    if (progress) {
      // getAssignmentProgress() re-fetches the assignment internally via
      // getAssignmentById(), which doesn't join `users` — so employee_name
      // from the query above would otherwise be lost. Re-attach it here.
      progress.assignment.employee_name = assignment.employee_name;
      result.push(progress);
    }
  }

  return result;
};

exports.getAssignmentHistory = async (filters = {}) => {
  const { employeeId, templateId, status, page = 1, limit = 20 } = filters;
 
  const where = ["a.status IN ('COMPLETED','EXPIRED')"];
  const params = [];
 
  if (employeeId) {
    where.push("a.employee_id = ?");
    params.push(employeeId);
  }
 
  if (templateId) {
    where.push("a.template_id = ?");
    params.push(templateId);
  }
 
  if (status) {
    where.push("a.status = ?");
    params.push(status);
  }
 
  const whereClause = where.join(" AND ");
  const offset = (page - 1) * limit;
 
  const [rows] = await db.query(
    `
      SELECT a.*, u.name AS employee_name, tt.template_name
      FROM visit_target_assignments a
      INNER JOIN users u ON u.id = a.employee_id
      INNER JOIN visit_target_templates tt ON tt.id = a.template_id
      WHERE ${whereClause}
      ORDER BY a.period_end DESC
      LIMIT ? OFFSET ?
    `,
    [...params, Number(limit), Number(offset)]
  );
 
  const [[{ total }]] = await db.query(
    `
      SELECT COUNT(*) AS total
      FROM visit_target_assignments a
      WHERE ${whereClause}
    `,
    params
  );
 
  const rowsWithProgress = [];
 
  for (const row of rows) {
    const progress = await exports.getAssignmentProgress(row.id);
 
    if (progress) {
      progress.assignment.employee_name = row.employee_name;
      progress.assignment.template_name = row.template_name;
      rowsWithProgress.push(progress);
    }
  }
 
  return { rows: rowsWithProgress, total };
};

/**
 * ============================================================
 * ADD THESE FUNCTIONS TO visitTarget.model.js
 * (paste anywhere after the existing exports — order doesn't matter)
 * ============================================================
 */

/**
 * Get ALL active assignments for a template, scoped to a specific
 * set of employee_ids. Used to expire / sync only the relevant rows
 * during an update, instead of touching every ACTIVE row blindly.
 */
exports.getActiveAssignmentsForEmployees = async (templateId, employeeIds) => {
  if (!employeeIds || employeeIds.length === 0) {
    return [];
  }

  const [rows] = await db.query(
    `
      SELECT *
      FROM visit_target_assignments
      WHERE template_id = ?
        AND status = 'ACTIVE'
        AND employee_id IN (${employeeIds.map(() => "?").join(",")})
    `,
    [templateId, ...employeeIds]
  );

  return rows;
};



/**
 * Expire ACTIVE assignments for a specific set of employees under a
 * specific template. Used when employees are removed from a template
 * during an edit — history (COMPLETED/EXPIRED rows) is left untouched,
 * only the currently ACTIVE row (if any) flips to EXPIRED.
 */
exports.expireAssignmentsForEmployees = async (connection, templateId, employeeIds) => {
  if (!employeeIds || employeeIds.length === 0) {
    return 0;
  }

  const [result] = await connection.query(
    `
      UPDATE visit_target_assignments
      SET status = 'EXPIRED'
      WHERE template_id = ?
        AND status = 'ACTIVE'
        AND employee_id IN (${employeeIds.map(() => "?").join(",")})
    `,
    [templateId, ...employeeIds]
  );

  return result.affectedRows;
};

/**
 * Expire every ACTIVE assignment tied to a template. Used by
 * deleteTemplate() — once a template is soft-deactivated, none of its
 * assignments should remain ACTIVE (otherwise checkDuplicateTemplate
 * would keep blocking those employees from getting a new assignment
 * elsewhere, and dashboards would keep showing a "live" target for a
 * dead template).
 */
exports.expireAllActiveAssignmentsForTemplate = async (connection, templateId) => {
  const [result] = await connection.query(
    `
      UPDATE visit_target_assignments
      SET status = 'EXPIRED'
      WHERE template_id = ?
        AND status = 'ACTIVE'
    `,
    [templateId]
  );

  return result.affectedRows;
};
exports.reactivateTemplate = async (connection, templateId, periodStart, periodEnd) => {
  const [result] = await connection.query(
    `
      UPDATE visit_target_templates
      SET status = 'ACTIVE', start_date = ?, end_date = ?
      WHERE id = ? AND status = 'INACTIVE'
    `,
    [periodStart, periodEnd, templateId]
  );
 
  return result.affectedRows > 0;
};
/**
 * Update period_start / period_end on the ACTIVE assignments of a
 * specific set of employees under a template. Used when the template's
 * start_date/end_date change during an edit, so existing (kept)
 * employees' current assignment window moves with it.
 *
 * Does NOT touch COMPLETED/EXPIRED rows (status = 'ACTIVE' guard).
 */
exports.updateActiveAssignmentsPeriodForEmployees = async (
  connection,
  templateId,
  employeeIds,
  periodStart,
  periodEnd
) => {
  if (!employeeIds || employeeIds.length === 0) {
    return 0;
  }

  const [result] = await connection.query(
    `
      UPDATE visit_target_assignments
      SET period_start = ?, period_end = ?
      WHERE template_id = ?
        AND status = 'ACTIVE'
        AND employee_id IN (${employeeIds.map(() => "?").join(",")})
    `,
    [periodStart, periodEnd, templateId, ...employeeIds]
  );

  return result.affectedRows;
};

/**
 * Synchronize visit_target_assignment_details for the ACTIVE assignments
 * of a specific set of employees to match a new target list (normally
 * the just-updated template targets). Upserts on (assignment_id,
 * visit_type) and removes visit_types no longer present.
 *
 * ASSUMPTION: visit_target_assignment_details has a UNIQUE KEY on
 * (assignment_id, visit_type) — mirroring visit_target_template_details.
 * If that unique key doesn't exist yet, add it:
 *   ALTER TABLE visit_target_assignment_details
 *     ADD UNIQUE KEY uniq_assignment_visit_type (assignment_id, visit_type);
 */
exports.syncActiveAssignmentDetailsForEmployees = async (
  connection,
  templateId,
  employeeIds,
  targets
) => {
  if (!employeeIds || employeeIds.length === 0 || !targets || targets.length === 0) {
    return;
  }

  const [assignments] = await connection.query(
    `
      SELECT id
      FROM visit_target_assignments
      WHERE template_id = ?
        AND status = 'ACTIVE'
        AND employee_id IN (${employeeIds.map(() => "?").join(",")})
    `,
    [templateId, ...employeeIds]
  );

  if (assignments.length === 0) {
    return;
  }

  const incomingTypes = targets.map((t) => t.visit_type);

  for (const assignment of assignments) {
    const [existingDetailRows] = await connection.query(
      `SELECT visit_type FROM visit_target_assignment_details WHERE assignment_id = ?`,
      [assignment.id]
    );

    const toRemove = existingDetailRows
      .map((r) => r.visit_type)
      .filter((vt) => !incomingTypes.includes(vt));

    if (toRemove.length > 0) {
      await connection.query(
        `
          DELETE FROM visit_target_assignment_details
          WHERE assignment_id = ? AND visit_type IN (${toRemove.map(() => "?").join(",")})
        `,
        [assignment.id, ...toRemove]
      );
    }

    const values = targets.map((t) => [assignment.id, t.visit_type, t.target_value]);

    await connection.query(
      `
        INSERT INTO visit_target_assignment_details (assignment_id, visit_type, target_value)
        VALUES ?
        ON DUPLICATE KEY UPDATE target_value = VALUES(target_value)
      `,
      [values]
    );
  }
};

exports.getAssignmentForPeriod = async (templateId, employeeId, periodStart, periodEnd) => {
  const [rows] = await db.query(
    `SELECT * FROM visit_target_assignments
     WHERE template_id=? AND employee_id=? AND period_start=? AND period_end=?
     LIMIT 1`,
    [templateId, employeeId, periodStart, periodEnd]
  );
  return rows[0];
};

exports.reactivateAssignment = async (connection, assignmentId) => {
  const [result] = await connection.query(
    `UPDATE visit_target_assignments SET status='ACTIVE', completed_at=NULL WHERE id=?`,
    [assignmentId]
  );
  return result.affectedRows > 0;
};

exports.refreshAssignmentDetails = async (connection, assignmentId, targets) => {
  await connection.query(`DELETE FROM visit_target_assignment_details WHERE assignment_id=?`, [assignmentId]);
  await exports.createAssignmentDetails(connection, assignmentId, targets);
};

/**
 * Permanently delete a template and all its dependent rows.
 * IRREVERSIBLE — unlike deleteTemplate() (soft/INACTIVE), this removes
 * history entirely. Deletes children first since there's no
 * ON DELETE CASCADE on visit_target_assignments -> visit_target_templates.
 */
exports.hardDeleteTemplate = async (connection, templateId) => {
  // 1. assignment_details for every assignment under this template
  await connection.query(
    `
      DELETE ad FROM visit_target_assignment_details ad
      INNER JOIN visit_target_assignments a ON a.id = ad.assignment_id
      WHERE a.template_id = ?
    `,
    [templateId]
  );

  // 2. assignments themselves
  await connection.query(
    `DELETE FROM visit_target_assignments WHERE template_id = ?`,
    [templateId]
  );

  // 3. template-level targets
  await connection.query(
    `DELETE FROM visit_target_template_details WHERE template_id = ?`,
    [templateId]
  );

  // 4. template <-> employee mapping
  await connection.query(
    `DELETE FROM visit_target_template_users WHERE template_id = ?`,
    [templateId]
  );

  // 5. the template row itself
  const [result] = await connection.query(
    `DELETE FROM visit_target_templates WHERE id = ?`,
    [templateId]
  );

  return result.affectedRows > 0;
};

 exports.holdTemplate = async (connection, templateId) => {
  const [result] = await connection.query(
    `UPDATE visit_target_templates SET status = 'HOLD' WHERE id = ? AND status = 'ACTIVE'`,
    [templateId]
  );

  return result.affectedRows > 0;
};

exports.unholdTemplate = async (connection, templateId) => {
  const [result] = await connection.query(
    `UPDATE visit_target_templates SET status = 'ACTIVE' WHERE id = ? AND status = 'HOLD'`,
    [templateId]
  );

  return result.affectedRows > 0;
};