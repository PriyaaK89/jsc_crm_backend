const taskModel = require("../../models/employee-performance/task.model");
const { getSubordinateIds } = require("../../models/user.model");
const { uploadFileToMinio, getPresignedUrl } = require("../../utils/fileUpload"); 

const ASSIGN_ALL_PERMISSION_CODE = "TASK_ASSIGN_ANY";
const ASSIGNER_JOB_ROLES = ["ZSM", "RSM", "ASM", "TSM"];
const ADMIN_ROLES = ["admin", "superadmin"];
const PRIORITIES = ["HIGH", "MEDIUM", "LOW"];
const STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"];
const VALID_ACTIONS = ["START_TASK", "UPLOAD_PROOF", "COMMENT", "COMPLETE"];

const normalize = (s) => (s || "").toString().toLowerCase().replace(/[\s_-]/g, "");

// Works out what the logged-in user may do
const getScope = async (userId) => {
  const ctx = await taskModel.getAssignerContext(userId);
  if (!ctx) return null;

  const isAdmin = ADMIN_ROLES.includes(normalize(ctx.role));

  // admin, super admin, or anyone granted the permission -> can assign to anyone
  const hasAllAccess =
    isAdmin || (await taskModel.hasPermission(userId, ASSIGN_ALL_PERMISSION_CODE));

  const isManager = ASSIGNER_JOB_ROLES.includes(
    (ctx.job_role || "").toUpperCase().trim()
  );
  const canAssign = hasAllAccess || isManager;

  // null = unrestricted. Otherwise downline ids, excluding self.
  let teamIds = null;
  if (!hasAllAccess && isManager) {
    const ids = await getSubordinateIds(userId);
    teamIds = ids.filter((id) => id !== userId);
  }

  return { ctx, isAdmin, hasAllAccess, canAssign, teamIds };
};

const parsePaging = (q) => ({
  page: Math.max(1, parseInt(q.page, 10) || 1),
  limit: Math.min(100, Math.max(1, parseInt(q.limit, 10) || 20)),
});

// Shapes a task row (+ proofs) for the Flutter card / CRM table
const formatTasks = async (rows) => {
  const proofs = await taskModel.getProofsByTaskIds(rows.map((r) => r.id));
  const proofMap = {};
  for (const p of proofs) {
    (proofMap[p.task_id] ||= []).push({
      id: p.id,
      file_name: p.file_name,
      mime_type: p.mime_type,
      url: null,
      _path: p.file_path,
      created_at: p.created_at,
    });
  }
  for (const list of Object.values(proofMap)) {
    for (const p of list) {
      p.url = await getPresignedUrl(p._path);
      delete p._path;
    }
  }

  return rows.map((r) => ({
    ...r,
    allowed_actions:
      typeof r.allowed_actions === "string"
        ? JSON.parse(r.allowed_actions)
        : r.allowed_actions,
    proof_required: !!r.proof_required,
    proofs: proofMap[r.id] || [],
  }));
};

// Loads task and checks it belongs to the logged-in assignee
const loadMyTask = async (req, res) => {
  const task = await taskModel.getTaskById(req.params.id);
  if (!task) {
    res.status(404).json({ message: "Task not found" });
    return null;
  }
  if (task.assigned_to !== req.user.id) {
    res.status(403).json({ message: "This task is not assigned to you" });
    return null;
  }
  return task;
};

const actionsOf = (task) =>
  typeof task.allowed_actions === "string"
    ? JSON.parse(task.allowed_actions)
    : task.allowed_actions || [];

// ================= ASSIGNER SIDE =================

// Step 1 of the form: role dropdown
exports.getAssignableRoles = async (req, res) => {
  try {
    const scope = await getScope(req.user.id);
    if (!scope) return res.status(404).json({ message: "User not found" });
    if (!scope.canAssign)
      return res.status(403).json({ message: "You cannot assign tasks" });

    const roles = await taskModel.getAssignableRoles(scope.teamIds, req.user.id);
    return res.json({ roles });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Something went wrong", error: err.message });
  }
};

// Step 2 of the form: employees of the chosen role (within my team)
exports.getAssignableUsers = async (req, res) => {
  try {
    const jobRoleId = Number(req.query.job_role_id);
    if (!jobRoleId)
      return res.status(400).json({ message: "job_role_id is required" });

    const scope = await getScope(req.user.id);
    if (!scope) return res.status(404).json({ message: "User not found" });
    if (!scope.canAssign)
      return res.status(403).json({ message: "You cannot assign tasks" });

    const users = await taskModel.getAssignableUsers(jobRoleId, scope.teamIds, req.user.id);

    return res.json({ users });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Something went wrong", error: err.message });
  }
};

exports.createTask = async (req, res) => {
  try {
    const {
      title, description, priority = "MEDIUM", assigned_to,
      deadline, allowed_actions, proof_required = false,
    } = req.body;

    // --- validation ---
    if (!title || !title.trim())
      return res.status(400).json({ message: "Title is required" });
    if (title.length > 255)
      return res.status(400).json({ message: "Title is too long (max 255)" });

    const prio = String(priority).toUpperCase();
    if (!PRIORITIES.includes(prio))
      return res.status(400).json({ message: "Invalid priority" });

    const assignedTo = Number(assigned_to);
    if (!assignedTo)
      return res.status(400).json({ message: "assigned_to is required" });

    const deadlineDate = new Date(deadline);
    if (!deadline || isNaN(deadlineDate.getTime()))
      return res.status(400).json({ message: "Valid deadline is required" });
    if (deadlineDate <= new Date())
      return res.status(400).json({ message: "Deadline must be in the future" });

    if (
      !Array.isArray(allowed_actions) ||
      allowed_actions.length === 0 ||
      !allowed_actions.every((a) => VALID_ACTIONS.includes(a))
    ) {
      return res.status(400).json({
        message: `allowed_actions must be a non-empty array of: ${VALID_ACTIONS.join(", ")}`,
      });
    }
    const wantsProof = proof_required === true || proof_required === "true" || proof_required === 1;
    if (wantsProof && !allowed_actions.includes("UPLOAD_PROOF")) {
      return res.status(400).json({
        message: "proof_required needs the UPLOAD_PROOF action enabled",
      });
    }

    // --- permission ---
    const scope = await getScope(req.user.id);
    
    if (!scope) return res.status(404).json({ message: "User not found" });
    if (!scope.canAssign)
      return res.status(403).json({ message: "You are not allowed to assign tasks" });
    if (assignedTo === req.user.id)
      return res.status(400).json({ message: "You cannot assign a task to yourself" });

    // const target = await taskModel.findAssignableUser(assignedTo, scope.teamIds);
    const target = await taskModel.findAssignableUser(assignedTo, scope.teamIds, req.user.id);
    if (!target)
      return res.status(403).json({ message: "This employee is not in your team" });

    const id = await taskModel.createTask({
      title: title.trim(),
      description: description ? String(description).trim() : null,
      priority: prio,
      assigned_by: req.user.id,
      assigned_to: assignedTo,
      deadline: deadlineDate,
      allowed_actions: [...new Set(allowed_actions)],
      proof_required: wantsProof,
    });

    // TODO: send FCM push notification to assignedTo here

    const [task] = await formatTasks([await taskModel.getTaskById(id)]);
    return res.status(201).json({ message: "Task assigned successfully", task });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Something went wrong", error: err.message });
  }
};

// Tasks I created (CRM tracking screen)
exports.getAssignedByMe = async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    if (status && !STATUSES.includes(status))
      return res.status(400).json({ message: "Invalid status" });

    const { page, limit } = parsePaging(req.query);
    const { rows, total } = await taskModel.getTasksByColumn("assigned_by", req.user.id, {
      status, page, limit,
    });
    return res.json({ tasks: await formatTasks(rows), total, page, limit });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Something went wrong", error: err.message });
  }
};

// ================= ASSIGNEE SIDE (Flutter) =================

exports.getMyTasks = async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    if (status && !STATUSES.includes(status))
      return res.status(400).json({ message: "Invalid status" });

    const { page, limit } = parsePaging(req.query);
    const { rows, total } = await taskModel.getTasksByColumn("assigned_to", req.user.id, {
      status, page, limit,
    });
    return res.json({ tasks: await formatTasks(rows), total, page, limit });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Something went wrong", error: err.message });
  }
};

exports.getTask = async (req, res) => {
  try {
    const task = await taskModel.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });

    // visible to assignee, assigner, or admin
    if (task.assigned_to !== req.user.id && task.assigned_by !== req.user.id) {
      const scope = await getScope(req.user.id);
      if (!scope?.isAdmin)
        return res.status(403).json({ message: "Access denied" });
    }
    const [formatted] = await formatTasks([task]);
    return res.json({ task: formatted });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Something went wrong", error: err.message });
  }
};

exports.startTask = async (req, res) => {
  try {
    const task = await loadMyTask(req, res);
    if (!task) return;

    if (!actionsOf(task).includes("START_TASK"))
      return res.status(403).json({ message: "Start is not enabled for this task" });

    const ok = await taskModel.startTask(task.id, req.user.id);
    if (!ok)
      return res.status(409).json({ message: "Task cannot be started (already started or completed)" });

    const [updated] = await formatTasks([await taskModel.getTaskById(task.id)]);
    return res.json({ message: "Task started", task: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Something went wrong", error: err.message });
  }
};

exports.uploadProof = async (req, res) => {
  try {
    const task = await loadMyTask(req, res);
    if (!task) return;

    if (!actionsOf(task).includes("UPLOAD_PROOF"))
      return res.status(403).json({ message: "Proof upload is not enabled for this task" });
    if (task.status === "COMPLETED")
      return res.status(409).json({ message: "Task is already completed" });
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ message: "Please attach at least one file" });

    const rows = [];
    for (const file of req.files) {
      const objectPath = await uploadFileToMinio(file, "task_proof");
      rows.push([task.id, objectPath, file.originalname, file.mimetype, req.user.id]);
    }
    await taskModel.addProofs(rows);

    const [updated] = await formatTasks([await taskModel.getTaskById(task.id)]);
    return res.status(201).json({ message: "Proof uploaded", task: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Something went wrong", error: err.message });
  }
};

exports.addComment = async (req, res) => {
  try {
    const task = await loadMyTask(req, res);
    if (!task) return;

    if (!actionsOf(task).includes("COMMENT"))
      return res.status(403).json({ message: "Comment is not enabled for this task" });

    const comment = (req.body.comment || "").trim();
    if (!comment) return res.status(400).json({ message: "Comment is required" });

    const ok = await taskModel.updateComment(task.id, req.user.id, comment);
    if (!ok) return res.status(409).json({ message: "Task is already completed" });

    const [updated] = await formatTasks([await taskModel.getTaskById(task.id)]);
    return res.json({ message: "Comment saved", task: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Something went wrong", error: err.message });
  }
};

exports.completeTask = async (req, res) => {
  try {
    const task = await loadMyTask(req, res);
    if (!task) return;

    if (!actionsOf(task).includes("COMPLETE"))
      return res.status(403).json({ message: "Complete is not enabled for this task" });

    if (task.proof_required && (await taskModel.countProofs(task.id)) === 0)
      return res.status(400).json({ message: "Please upload proof before completing" });

    const comment = req.body.comment ? String(req.body.comment).trim() : null;
    const ok = await taskModel.completeTask(task.id, req.user.id, comment);
    if (!ok) return res.status(409).json({ message: "Task is already completed" });

    const [updated] = await formatTasks([await taskModel.getTaskById(task.id)]);
    return res.json({ message: "Task completed", task: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Something went wrong", error: err.message });
  }
};