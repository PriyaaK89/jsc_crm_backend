const Permission = require("../models/permission.model");
const { isAuditMode } = require("../middleware/permission.middleware");
const { getScope } = require("./employee-performance/task.controller");

const fail = (status, message) => Object.assign(new Error(message), { status });

// permissions only Admin / Super Admin may grant or revoke (also on the general permission page)
const ADMIN_ONLY_CODES = new Set(["MANAGE_BP_TERRITORIES"]);

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error("PERMISSION ERROR:", err);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
};

const actionOf = (code) => {
  const value = String(code).toUpperCase();
  if (value.startsWith("VIEW_")) return "view";
  if (value.startsWith("CREATE_")) return "create";
  if (value.startsWith("UPDATE_") || value.startsWith("EDIT_")) return "edit";
  if (value.startsWith("DELETE_")) return "delete";
  return "special";
};

const groupByModule = (rows, allowedIds = null) => {
  const groups = new Map();
  rows.forEach((p) => {
    const module = p.module || "Other";
    const key = module.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { module, permissions: [] });
    groups.get(key).permissions.push({
      id: p.id,
      code: p.code,
      name: p.name,
      action: actionOf(p.code),
      ...(allowedIds ? { is_allowed: allowedIds.has(p.id) } : {}),
    });
  });
  return [...groups.values()];
};

const loadTarget = async (userId) => {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw fail(400, "Invalid user id");
  const target = await Permission.getUserAccess(id);
  if (!target) throw fail(404, "User not found");
  return target;
};

const saveChecked = async (req, permissionIds) => {
  const target = await loadTarget(req.params.userId ?? req.body.user_id);
  const actor = req.access;

  if (target.isAdmin) {
    throw fail(400, "Admin and Super Admin already have full access");
  }
  if (target.id === actor.id) {
    throw fail(403, "You cannot change your own permissions");
  }

  const requested = [...new Set(permissionIds.map(Number))];
  if (requested.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw fail(400, "Invalid permission id");
  }

  const all = await Permission.getAllPermissions();
  const byId = new Map(all.map((p) => [p.id, p]));
  if (requested.some((id) => !byId.has(id))) {
    throw fail(400, "Some permissions do not exist");
  }

  // nobody can give away or remove access they do not hold themselves
  if (!actor.isAdmin) {
    const current = await Permission.getAllowedPermissionIds(target.id);
    const was = new Set(current);
    const now = new Set(requested);
    const changed = [...requested.filter((id) => !was.has(id)), ...current.filter((id) => !now.has(id))];
    if (changed.some((id) => ADMIN_ONLY_CODES.has(byId.get(id).code))) {
      throw fail(403, "Only Admin or Super Admin can grant or revoke territory-management permission");
    }
    if (changed.some((id) => !actor.codes.has(byId.get(id).code))) {
      throw fail(403, "You can only assign permissions that you have yourself");
    }
  }

  await Permission.setUserPermissions(target.id, requested);
  return target;
};

// GET /permissions  -> every permission, grouped by module
exports.getCatalog = handle(async (req, res) => {
  const rows = await Permission.getAllPermissions();
  return res.json({ success: true, data: groupByModule(rows) });
});

// GET /permissions/me  -> what the logged-in user can do
exports.getMine = handle(async (req, res) => {
  const access = await Permission.getUserAccess(req.user.id);
  if (!access || !access.isActive) throw fail(403, "Your account is not active");

  const codes = access.isAdmin
    ? (await Permission.getAllPermissions()).map((p) => p.code)
    : [...access.codes];

  // same rule the task APIs use: everyone, or a manager with a team to assign to
  const scope = await getScope(access.id);
  const canAssignTasks =
    !!scope && (scope.hasAllAccess || (scope.canAssign && scope.teamIds.length > 0));

  return res.json({
    success: true,
    data: {
      user_id: access.id,
      role: access.role,
      is_admin: access.isAdmin,
      audit_mode: isAuditMode(),
      can_assign_tasks: canAssignTasks,
      permissions: codes,
    },
  });
});

// GET /permissions/users/:userId  -> the catalog with this user's selections
exports.getForUser = handle(async (req, res) => {
  const target = await loadTarget(req.params.userId);
  const [rows, allowed] = await Promise.all([
    Permission.getAllPermissions(),
    Permission.getAllowedPermissionIds(target.id),
  ]);

  return res.json({
    success: true,
    data: {
      user_id: target.id,
      role: target.role,
      is_admin: target.isAdmin,
      permission_ids: allowed,
      modules: groupByModule(rows, new Set(allowed)),
    },
  });
});

// PUT /permissions/users/:userId   body: { permission_ids: [] }
exports.saveForUser = handle(async (req, res) => {
  const ids = req.body.permission_ids;
  if (!Array.isArray(ids)) throw fail(400, "permission_ids must be a list");

  await saveChecked(req, ids);
  return res.json({ success: true, message: "Permissions saved successfully" });
});

// POST /auth/user-permissions  (existing API, same request and response)
// body: { user_id, permissions: [{ permission_id, is_allowed }] }
exports.saveLegacy = handle(async (req, res) => {
  const { user_id: userId, permissions } = req.body;
  if (!Array.isArray(permissions)) throw fail(400, "permissions must be a list");

  const target = await loadTarget(userId);
  const allowed = new Set(await Permission.getAllowedPermissionIds(target.id));
  permissions.forEach((p) => {
    if (Number(p.is_allowed) === 1) allowed.add(Number(p.permission_id));
    else allowed.delete(Number(p.permission_id));
  });

  await saveChecked(req, [...allowed]);
  return res.status(200).json({ message: "Permissions updated successfully" });
});

// GET /permissions/super-admin/users
//   ?search=&role=&status=&department_id=&access=&permission_code=&page=&limit=
exports.listUsers = handle(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
  const { summary, users } = await Permission.listUsersWithPermissions({
    search: String(req.query.search || "").trim().slice(0, 100),
    role: req.query.role || "",
    status: req.query.status || "",
    departmentId: Number(req.query.department_id) || null,
    access: req.query.access || "",
    permissionCode: req.query.permission_code || "",
    page,
    limit,
  });

  const allCount = (await Permission.getAllPermissions()).length;
  const total = Number(summary.total) || 0;
  const fullAccess = Number(summary.full_access) || 0;

  return res.json({
    success: true,
    data: {
      summary: {
        total_users: total,
        full_access: fullAccess,
        with_permissions: Number(summary.with_permissions) || 0,
        total_permissions: allCount,
      },
      users: users.map((u) => {
        const isAdmin = Permission.ADMIN_ROLES.includes(u.role);
        return {
          ...u,
          is_active: Number(u.is_active) !== 0,
          is_admin: isAdmin,
          granted_count: isAdmin ? allCount : u.permissions.length,
        };
      }),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// GET /permissions/super-admin/users/:userId
exports.getUserDetails = handle(async (req, res) => {
  const target = await loadTarget(req.params.userId);
  const [user, rows, allowed] = await Promise.all([
    Permission.getUserSummary(target.id),
    Permission.getAllPermissions(),
    Permission.getAllowedPermissionIds(target.id),
  ]);

  return res.json({
    success: true,
    data: {
      user,
      is_admin: target.isAdmin,
      permission_ids: target.isAdmin ? rows.map((p) => p.id) : allowed,
      modules: groupByModule(
        rows,
        target.isAdmin ? new Set(rows.map((p) => p.id)) : new Set(allowed),
      ),
    },
  });
});

// GET /auth/user-permissions/:userId  (existing API, same response)
exports.getLegacy = handle(async (req, res) => {
  const target = await loadTarget(req.params.userId);
  const [rows, allowed] = await Promise.all([
    Permission.getAllPermissions(),
    Permission.getAllowedPermissionIds(target.id),
  ]);
  const ids = new Set(allowed);
  return res.status(200).json(
    rows.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      module: p.module,
      is_allowed: ids.has(p.id) ? 1 : 0,
    })),
  );
});
