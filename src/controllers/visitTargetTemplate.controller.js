const db = require("../config/db");
const visitTargetModel = require("../models/visitTargetTemplate.model");
const { calculateEndDate } = require("../utils/targetPeriod.helper");
const { getHierarchyIds } = require("../controllers/rollingUser.controller");

/**
 * Create Target Template
 * Body: { template_name, frequency, is_recurring, start_date, end_date,
 *         employee_ids: [], targets: [{ visit_type, target_value }] }
 */
exports.createTemplate = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const {
      template_name,
      frequency,
      is_recurring,
      start_date,
      end_date,
      employee_ids,
      targets,
    } = req.body;

    const assignedBy = req.user.id; // adjust to match your auth middleware

    if (!frequency || !start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: "frequency, start_date and end_date are required",
      });
    }

    if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one employee must be assigned",
      });
    }

    if (!Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one visit-type target must be provided",
      });
    }

    const uniqueEmployeeIds = [...new Set(employee_ids)];

    const conflicts = await visitTargetModel.checkDuplicateTemplate(
      uniqueEmployeeIds,
      start_date,
      end_date
    );

    if (conflicts.length > 0) {
      return res.status(409).json({
        success: false,
        message: "One or more employees already have an active target for this period",
        conflicts,
      });
    }

    await connection.beginTransaction();

    const templateId = await visitTargetModel.createTemplate(connection, {
      assigned_by: assignedBy,
      template_name,
      frequency,
      is_recurring: is_recurring ? 1 : 0,
      start_date,
      end_date,
      status: "ACTIVE",
    });

    await visitTargetModel.assignEmployees(connection, templateId, uniqueEmployeeIds);
    await visitTargetModel.insertTargetDetails(connection, templateId, targets);

    // Create the first period's assignment for every employee right away
    const firstPeriodEnd = calculateEndDate(start_date, frequency);

    for (const employeeId of uniqueEmployeeIds) {
      const assignmentId = await visitTargetModel.createAssignment(connection, {
        template_id: templateId,
        employee_id: employeeId,
        period_start: start_date,
        period_end: firstPeriodEnd,
        status: "ACTIVE",
      });

      await visitTargetModel.createAssignmentDetails(connection, assignmentId, targets);
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Target template created",
      template_id: templateId,
    });
  } catch (error) {
    await connection.rollback();
    console.error("createTemplate error:", error);
    return res.status(500).json({ success: false, message: "Failed to create target template" });
  } finally {
    connection.release();
  }
};

/**
 * Get single template (with employees + targets)
 */
exports.getTemplate = async (req, res) => {
  try {
    const { id } = req.params;

    const template = await visitTargetModel.getTemplateById(id);

    if (!template) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    const [employees, targets] = await Promise.all([
      visitTargetModel.getTemplateEmployees(id),
      visitTargetModel.getTemplateTargets(id),
    ]);

    return res.json({
      success: true,
      data: { ...template, employees, targets },
    });
  } catch (error) {
    console.error("getTemplate error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch template" });
  }
};

/**
 * List templates (paginated, filterable)
 * Query: ?status=&frequency=&search=&page=&limit=
 */
exports.listTemplates = async (req, res) => {
  try {
    const { status, frequency, search, page, limit } = req.query;

    const { rows, total } = await visitTargetModel.getAllTemplates({
      status,
      frequency,
      search,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });

    return res.json({
      success: true,
      data: rows,
      pagination: {
        page: Number(page) || 1,
        limit: Number(limit) || 20,
        total,
      },
    });
  } catch (error) {
    console.error("listTemplates error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch templates" });
  }
};

/**
 * Lightweight template dropdown (id + name only)
 */
exports.templateDropdown = async (req, res) => {
  try {
    const list = await visitTargetModel.getTemplateList();
    return res.json({ success: true, data: list });
  } catch (error) {
    console.error("templateDropdown error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch template list" });
  }
};

/**
 * Update template
 * Body: any of { template_name, frequency, is_recurring, start_date,
 *                end_date, status, employee_ids: [], targets: [] }
 * Only the fields present in the body are updated.
 */
exports.updateTemplate = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id } = req.params;
    const { employee_ids, targets, ...templateFields } = req.body;

    const existing = await visitTargetModel.getTemplateById(id);

    if (!existing) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    // Effective period for any NEW assignments created in this call.
    // Falls back to the template's current dates if not being changed.
    const newStartDate = templateFields.start_date || existing.start_date;
    const newEndDate = templateFields.end_date || existing.end_date;

    // ---- Diff employees ----
    const existingEmployeeRows = await visitTargetModel.getTemplateEmployees(id);
    const existingEmployeeIds = existingEmployeeRows.map((e) => e.id);

    const employeeIdsProvided = Array.isArray(employee_ids);
    const uniqueIncomingEmployeeIds = employeeIdsProvided
      ? [...new Set(employee_ids)]
      : existingEmployeeIds;

    const addedEmployees = employeeIdsProvided
      ? uniqueIncomingEmployeeIds.filter((eid) => !existingEmployeeIds.includes(eid))
      : [];

    const removedEmployees = employeeIdsProvided
      ? existingEmployeeIds.filter((eid) => !uniqueIncomingEmployeeIds.includes(eid))
      : [];

    const keptEmployees = employeeIdsProvided
      ? uniqueIncomingEmployeeIds.filter((eid) => existingEmployeeIds.includes(eid))
      : existingEmployeeIds;

    // ---- Validate: only added employees need a duplicate-assignment check ----
    if (addedEmployees.length > 0) {
      const conflicts = await visitTargetModel.checkDuplicateTemplate(
        addedEmployees,
        newStartDate,
        newEndDate,
        id
      );

      if (conflicts.length > 0) {
        return res.status(409).json({
          success: false,
          message: "One or more employees already have an active target for this period",
          conflicts,
        });
      }
    }

    await connection.beginTransaction();

    // ---- 1. Update template info ----
    if (Object.keys(templateFields).length > 0) {
      await visitTargetModel.updateTemplate(connection, id, templateFields);
    }

    // ---- 2. Update template targets ----
    if (Array.isArray(targets) && targets.length > 0) {
      await visitTargetModel.updateTemplateTargets(connection, id, targets);
    }

    // ---- 3. Update template <-> employee mapping ----
    if (employeeIdsProvided) {
      await visitTargetModel.updateTemplateUsers(connection, id, uniqueIncomingEmployeeIds);
    }

    // Targets to use when creating assignment_details for NEWLY added
    // employees: prefer the payload's targets; otherwise fall back to
    // whatever the template currently has (post-update).
    const effectiveTargets =
      Array.isArray(targets) && targets.length > 0
        ? targets
        : await visitTargetModel.getTemplateTargets(id);

    // ---- 5. Added employees: create a new ACTIVE assignment, or
    // reactivate an existing EXPIRED/COMPLETED row for this exact period
    // (required because uq_assignment_period is unique on
    // template_id+employee_id+period_start+period_end regardless of status) ----
    for (const employeeId of addedEmployees) {
      const existingRow = await visitTargetModel.getAssignmentForPeriod(
        id,
        employeeId,
        newStartDate,
        newEndDate
      );

      if (existingRow) {
        if (existingRow.status === "ACTIVE") {
          // already active for this exact period, nothing to do
          continue;
        }

        // EXPIRED/COMPLETED row exists for this period — reactivate it
        // instead of inserting (avoids uq_assignment_period collision)
        await visitTargetModel.reactivateAssignment(connection, existingRow.id);
        await visitTargetModel.refreshAssignmentDetails(
          connection,
          existingRow.id,
          effectiveTargets
        );
        continue;
      }

      const newAssignmentId = await visitTargetModel.createAssignment(connection, {
        template_id: id,
        employee_id: employeeId,
        period_start: newStartDate,
        period_end: newEndDate,
        status: "ACTIVE",
      });

      await visitTargetModel.createAssignmentDetails(
        connection,
        newAssignmentId,
        effectiveTargets
      );
    }

    // ---- 6. Removed employees: expire their ACTIVE assignment, keep history ----
    if (removedEmployees.length > 0) {
      await visitTargetModel.expireAssignmentsForEmployees(connection, id, removedEmployees);
    }

    // ---- 7. Kept employees: sync assignment_details if targets changed ----
    if (keptEmployees.length > 0 && Array.isArray(targets) && targets.length > 0) {
      await visitTargetModel.syncActiveAssignmentDetailsForEmployees(
        connection,
        id,
        keptEmployees,
        targets
      );
    }

    // ---- 8. Kept employees: sync period dates if template dates changed ----
    if (keptEmployees.length > 0 && (templateFields.start_date || templateFields.end_date)) {
      await visitTargetModel.updateActiveAssignmentsPeriodForEmployees(
        connection,
        id,
        keptEmployees,
        newStartDate,
        newEndDate
      );
    }

    await connection.commit();

    return res.json({
      success: true,
      message: "Template updated",
      summary: {
        added: addedEmployees,
        removed: removedEmployees,
        kept: keptEmployees,
      },
    });
  } catch (error) {
    await connection.rollback();
    console.error("updateTemplate error:", error);
    return res.status(500).json({ success: false, message: "Failed to update template" });
  } finally {
    connection.release();
  }
};

/**
 * Delete (soft-deactivate) template
 *
 * Deactivating a template also expires any ACTIVE assignments still
 * tied to it, so:
 *   - Employees aren't stuck "blocked" by checkDuplicateTemplate against
 *     a dead template's assignment.
 *   - Progress dashboards stop showing a "live" target for a template
 *     that no longer exists in active form.
 * COMPLETED/EXPIRED assignment history is left untouched either way.
 */
exports.deleteTemplate = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id } = req.params;

    const existing = await visitTargetModel.getTemplateById(id);

    if (!existing) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    await connection.beginTransaction();

    await visitTargetModel.deleteTemplate(connection, id);
    await visitTargetModel.expireAllActiveAssignmentsForTemplate(connection, id);

    await connection.commit();

    return res.json({ success: true, message: "Template deactivated" });
  } catch (error) {
    await connection.rollback();
    console.error("deleteTemplate error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete template" });
  } finally {
    connection.release();
  }
};

/**
 * Get a single assignment (raw row)
 */
exports.getAssignment = async (req, res) => {
  try {
    const { id } = req.params;
    const assignment = await visitTargetModel.getAssignmentById(id);

    if (!assignment) {
      return res.status(404).json({ success: false, message: "Assignment not found" });
    }

    const targets = await visitTargetModel.getAssignmentTargets(id);
    return res.json({ success: true, data: { ...assignment, targets } });
  } catch (error) {
    console.error("getAssignment error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch assignment" });
  }
};

/**
 * Get progress (target vs achieved) for one assignment
 */
exports.getAssignmentProgress = async (req, res) => {
  try {
    const { id } = req.params;
    const progress = await visitTargetModel.getAssignmentProgress(id);

    if (!progress) { return res.status(404).json({ success: false, message: "Assignment not found" }); }

    return res.json({ success: true, data: progress });
  } catch (error) {
    console.error("getAssignmentProgress error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch assignment progress" });
  }
};

/**
 * Get progress for one employee's current active assignment
 */
exports.getEmployeeProgress = async (req, res) => {
  try {
    const { employeeId } = req.params;

    const data = await visitTargetModel.getEmployeeProgress(employeeId);

    if (!data) {
      return res.json({
        success: true,
        data: null,
        message: "No active target for this employee",
      });
    }

    return res.json({ success: true, data });
  } catch (error) {
    console.error("getEmployeeProgress error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch employee progress" });
  }
};

/**
 * Admin dashboard progress view — across employees/templates
 * Query: ?template_id=&period_start=&period_end=
 */
exports.getAdminProgress = async (req, res) => {
  try {
    const { template_id, period_start, period_end } = req.query;

    const data = await visitTargetModel.getAdminProgress({
      templateId: template_id,
      periodStart: period_start,
      periodEnd: period_end,
    });

    return res.json({ success: true, data });
  } catch (error) {
    console.error("getAdminProgress error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch admin progress" });
  }
};

/**
 * Manually mark an assignment as completed (e.g. admin override once
 * an employee hits all their targets early)
 */
exports.completeAssignment = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { id } = req.params;
    await connection.beginTransaction();
    const updated = await visitTargetModel.markAssignmentCompleted(connection, id);

    if (!updated) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Active assignment not found, or it's already completed/expired",
      });
    }

    await connection.commit();
    return res.json({ success: true, message: "Assignment marked completed" });
  } catch (error) {
    await connection.rollback();
    console.error("completeAssignment error:", error);
    return res.status(500).json({ success: false, message: "Failed to complete assignment" });
  } finally {
    connection.release();
  }
};

exports.getAssignmentHistory = async (req, res) => {
  try {
    const { employee_id, template_id, status, page, limit } = req.query;

    const { rows, total } = await visitTargetModel.getAssignmentHistory({
      employeeId: employee_id,
      templateId: template_id,
      status,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });

    return res.json({
      success: true,
      data: rows,
      pagination: {
        page: Number(page) || 1,
        limit: Number(limit) || 20,
        total,
      },
    });
  } catch (error) {
    console.error("getAssignmentHistory error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch assignment history" });
  }
};
/**
 * Manually expire an assignment (admin override — normally the
 * scheduler handles this automatically once period_end passes)
 */
exports.expireAssignment = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { id } = req.params;
    await connection.beginTransaction();
    const updated = await visitTargetModel.expireAssignment(connection, id);

    if (!updated) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Active assignment not found, or it's already completed/expired",
      });
    }

    await connection.commit();

    return res.json({ success: true, message: "Assignment marked expired" });
  } catch (error) {
    await connection.rollback();
    console.error("expireAssignment error:", error);
    return res.status(500).json({ success: false, message: "Failed to expire assignment" });
  } finally {
    connection.release();
  }
};

exports.reactivateTemplate = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id } = req.params;
    const { start_date, end_date } = req.body;

    const existing = await visitTargetModel.getTemplateById(id);

    if (!existing) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    if (existing.status === "ACTIVE") {
      return res.status(400).json({ success: false, message: "Template is already active" });
    }

    const todayStr = new Date().toISOString().slice(0, 10);

    let periodStart;
    let periodEnd;

    if (start_date && end_date) {
      periodStart = start_date;
      periodEnd = end_date;
    } else if (String(existing.end_date).slice(0, 10) >= todayStr) {
      // Original window hasn't passed yet — safe to reuse as-is.
      periodStart = existing.start_date;
      periodEnd = existing.end_date;
    } else {
      return res.status(400).json({
        success: false,
        message:
          "This template's original period has already passed. Provide start_date and end_date to reactivate it with a new period.",
      });
    }

    const mappedEmployees = await visitTargetModel.getTemplateEmployees(id);
    const employeeIds = mappedEmployees.map((e) => e.id);

    if (employeeIds.length > 0) {
      const conflicts = await visitTargetModel.checkDuplicateTemplate(
        employeeIds,
        periodStart,
        periodEnd,
        id
      );

      if (conflicts.length > 0) {
        return res.status(409).json({
          success: false,
          message:
            "One or more employees already have an active target for this period. Remove them from this template first, or choose a different period.",
          conflicts,
        });
      }
    }

    await connection.beginTransaction();

    const reactivated = await visitTargetModel.reactivateTemplate(
      connection,
      id,
      periodStart,
      periodEnd
    );

    if (!reactivated) {
      // Covers a race where the template's status changed between the
      // check above and this update.
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "Template could not be reactivated — its status may have changed. Please retry.",
      });
    }

    const templateTargets = await visitTargetModel.getTemplateTargets(id);

    for (const employeeId of employeeIds) {
      const existingAssignment = await visitTargetModel.getAssignmentForPeriod(
        id,
        employeeId,
        periodStart,
        periodEnd
      );

      if (existingAssignment) {
        // Row already exists for this period (likely EXPIRED/COMPLETED
        // from before deactivation) — flip it back to ACTIVE and refresh
        // its targets from the template instead of creating a duplicate.
        if (existingAssignment.status !== "ACTIVE") {
          await visitTargetModel.reactivateAssignment(connection, existingAssignment.id);
          await visitTargetModel.refreshAssignmentDetails(
            connection,
            existingAssignment.id,
            templateTargets
          );
        }
        continue;
      }

      const newAssignmentId = await visitTargetModel.createAssignment(connection, {
        template_id: id,
        employee_id: employeeId,
        period_start: periodStart,
        period_end: periodEnd,
        status: "ACTIVE",
      });

      await visitTargetModel.createAssignmentDetails(connection, newAssignmentId, templateTargets);
    }

    await connection.commit();

    return res.json({
      success: true,
      message: "Template reactivated",
      period: { start_date: periodStart, end_date: periodEnd },
      employees_assigned: employeeIds,
    });
  } catch (error) {
    await connection.rollback();
    console.error("reactivateTemplate error:", error);
    return res.status(500).json({ success: false, message: "Failed to reactivate template" });
  } finally {
    connection.release();
  }
};

/**
 * Permanently delete a template — irreversible, wipes all assignment
 * history tied to it. Requires ?confirm=true to avoid accidental calls.
 * Recommend the frontend only exposes this after the template is
 * already INACTIVE (deactivated), to avoid nuking a live template's
 * history out from under active employees.
 */
exports.hardDeleteTemplate = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id } = req.params;
    const { confirm } = req.query;

    if (confirm !== "true") {
      return res.status(400).json({
        success: false,
        message: "Permanent delete requires ?confirm=true",
      });
    }

    const existing = await visitTargetModel.getTemplateById(id);

    if (!existing) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    await connection.beginTransaction();

    const deleted = await visitTargetModel.hardDeleteTemplate(connection, id);

    if (!deleted) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    await connection.commit();

    return res.json({ success: true, message: "Template permanently deleted" });
  } catch (error) {
    await connection.rollback();
    console.error("hardDeleteTemplate error:", error);
    return res.status(500).json({ success: false, message: "Failed to permanently delete template" });
  } finally {
    connection.release();
  }
};

exports.holdTemplate = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id } = req.params;

    const existing = await visitTargetModel.getTemplateById(id);

    if (!existing) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    if (existing.status === "HOLD") {
      return res.status(400).json({ success: false, message: "Template is already on hold" });
    }

    if (existing.status !== "ACTIVE") {
      return res.status(400).json({
        success: false,
        message: `Only an ACTIVE template can be put on hold (current status: ${existing.status})`,
      });
    }

    await connection.beginTransaction();

    const held = await visitTargetModel.holdTemplate(connection, id);

    if (!held) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "Template could not be held — its status may have changed. Please retry.",
      });
    }

    await connection.commit();

    return res.json({ success: true, message: "Template put on hold" });
  } catch (error) {
    await connection.rollback();
    console.error("holdTemplate error:", error);
    return res.status(500).json({ success: false, message: "Failed to hold template" });
  } finally {
    connection.release();
  }
};

exports.unholdTemplate = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id } = req.params;

    const existing = await visitTargetModel.getTemplateById(id);

    if (!existing) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    if (existing.status !== "HOLD") {
      return res.status(400).json({
        success: false,
        message: `Only a HELD template can be unheld (current status: ${existing.status})`,
      });
    }

    await connection.beginTransaction();

    const unheld = await visitTargetModel.unholdTemplate(connection, id);

    if (!unheld) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "Template could not be unheld — its status may have changed. Please retry.",
      });
    }

    await connection.commit();

    return res.json({ success: true, message: "Template resumed from hold" });
  } catch (error) {
    await connection.rollback();
    console.error("unholdTemplate error:", error);
    return res.status(500).json({ success: false, message: "Failed to unhold template" });
  } finally {
    connection.release();
  }
};

exports.getTeamProgress = async (req, res) => {
  try {
    const loggedInUser = req.user;
    const { level, user_id, template_id } = req.query;

    const hierarchyIds = await getHierarchyIds(loggedInUser.id);

    const rows = await visitTargetModel.getTeamProgress({
      employeeIds: hierarchyIds,
      level: level ? Number(level) : undefined,
      employeeId: user_id ? Number(user_id) : undefined,
      templateId: template_id,
    });

    // flatten (assignment + breakdown[]) rows into one entry per employee
    const userMap = new Map();

    rows.forEach((r) => {
      const a = r.assignment;
      if (!userMap.has(a.employee_id)) {
        userMap.set(a.employee_id, {
          id: a.employee_id,
          name: a.employee_name,
          contact_no: a.contact_no,
          role_name: a.role_name,
          level: a.level,
          total_target: 0,
          total_achieved: 0,
          targets: [],
        });
      }

      const entry = userMap.get(a.employee_id);

      r.breakdown.forEach((b) => {
        entry.targets.push({
          assignment_id: a.id,
          visit_type: b.visit_type,
          target_value: b.target_value,
          achieved: b.achieved,
          period_start: a.period_start,
          period_end: a.period_end,
        });
        entry.total_target += Number(b.target_value) || 0;
        entry.total_achieved += Number(b.achieved) || 0;
      });
    });

    return res.status(200).json({ success: true, data: Array.from(userMap.values()) });
  } catch (error) {
    console.error("getTeamProgress error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch team progress" });
  }
};