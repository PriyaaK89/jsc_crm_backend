const db = require("../config/db");
const visitTargetModel = require("../models/visitTargetTemplate.model");
const { calculateEndDate } = require("../utils/targetPeriod.helper");

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

    if (Array.isArray(employee_ids) && employee_ids.length > 0) {
      const uniqueEmployeeIds = [...new Set(employee_ids)];

      const startDate = templateFields.start_date || existing.start_date;
      const endDate = templateFields.end_date || existing.end_date;

      const conflicts = await visitTargetModel.checkDuplicateTemplate(
        uniqueEmployeeIds,
        startDate,
        endDate,
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

    if (Object.keys(templateFields).length > 0) {
      await visitTargetModel.updateTemplate(connection, id, templateFields);
    }

    if (Array.isArray(employee_ids) && employee_ids.length > 0) {
      await visitTargetModel.updateTemplateUsers(connection, id, [...new Set(employee_ids)]);
    }

    if (Array.isArray(targets) && targets.length > 0) {
      await visitTargetModel.updateTemplateTargets(connection, id, targets);
    }

    await connection.commit();

    return res.json({ success: true, message: "Template updated" });
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

    if (!progress) { return res.status(404).json({ success: false, message: "Assignment not found" });}

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