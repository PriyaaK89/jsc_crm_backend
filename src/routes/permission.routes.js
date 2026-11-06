const express = require("express");
const router = express.Router();
const c = require("../controllers/permission.controller");
const auth = require("../middleware/auth.middleware");
const {
  checkPermission,
  checkPermissionOrSelf,
  checkSuperAdmin,
} = require("../middleware/permission.middleware");
const { MANAGE_USER_PERMISSIONS } = require("../utils/permissionCodes");

router.get("/me", auth, c.getMine);
router.get("/", auth, checkPermission(MANAGE_USER_PERMISSIONS), c.getCatalog);
router.get(
  "/users/:userId",
  auth,
  checkPermissionOrSelf(MANAGE_USER_PERMISSIONS, "userId"),
  c.getForUser,
);
router.put(
  "/users/:userId",
  auth,
  checkPermission(MANAGE_USER_PERMISSIONS),
  c.saveForUser,
);

// Super Admin permission management page
router.get("/super-admin/users", auth, checkSuperAdmin, c.listUsers);
router.get("/super-admin/users/:userId", auth, checkSuperAdmin, c.getUserDetails);
router.put("/super-admin/users/:userId", auth, checkSuperAdmin, c.saveForUser);

module.exports = router;
