const Permission = require("../models/permission.model");

// PERMISSION_ENFORCEMENT=audit logs a denial and lets the request through, for a
// short rollout check only. Any other value, or no value, enforces permissions.
const isAuditMode = () => process.env.PERMISSION_ENFORCEMENT === "audit";

const deny = (req, res, next, codes) => {
  if (isAuditMode()) {
    console.warn(
      `[PERMISSION AUDIT] user ${req.user.id} would be denied ${req.method} ${req.originalUrl} (needs ${codes.join(" or ")})`,
    );
    return next();
  }
  return res.status(403).json({
    success: false,
    message: "You do not have permission to perform this action",
  });
};

const loadAccess = async (req, res) => {
  const access = await Permission.getUserAccess(req.user.id);
  if (!access || !access.isActive) {
    res.status(403).json({
      success: false,
      message: "Your account is not active. Please contact admin.",
    });
    return null;
  }
  req.access = access;
  return access;
};

const guard = (codes, isSelf = () => false) => async (req, res, next) => {
  try {
    const access = await loadAccess(req, res);
    if (!access) return undefined;

    if (access.isAdmin || isSelf(req) || codes.some((c) => access.codes.has(c))) {
      return next();
    }
    return deny(req, res, next, codes);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const toList = (codes) => (Array.isArray(codes) ? codes : [codes]);

// needs this permission
const checkPermission = (code) => guard(toList(code));

// needs at least one of these permissions
const checkAnyPermission = (codes) => guard(toList(codes));

// the record belongs to the logged-in user, or the user has the permission.
// `key` is read from the URL params, the query string, then the body.
const checkPermissionOrSelf = (codes, key) =>
  guard(toList(codes), (req) => {
    const value = req.params[key] ?? req.query[key] ?? req.body?.[key];
    return value !== undefined && Number(value) === Number(req.user.id);
  });

// Admin and Super Admin only, using the role stored in the database
const checkAdmin = guard([]);

// Super Admin only, using the role stored in the database
const checkSuperAdmin = async (req, res, next) => {
  try {
    const access = await loadAccess(req, res);
    if (!access) return undefined;
    if (access.role === "SUPER_ADMIN") return next();
    return res.status(403).json({
      success: false,
      message: "Only Super Admin can do this",
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  checkPermission,
  checkAnyPermission,
  checkPermissionOrSelf,
  checkAdmin,
  checkSuperAdmin,
  isAuditMode,
};
