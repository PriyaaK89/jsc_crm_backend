const express = require("express");
const router = express.Router();
const { checkAdmin, checkAnyPermission, checkPermission, checkPermissionOrSelf } = require("../middleware/permission.middleware");
const auth = require("../controllers/auth.controller");
const permission = require("../controllers/permission.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");
// const {isAdmin} = require("../middleware/checkAllowedIp.middleware")
const { isAdmin } = require("../middleware/checkAllowedDevice.middleware");
const upload = require("../middleware/upload.middleware");
router.post( "/create-admin", authMiddleware, allowRoles("SUPER_ADMIN"), (req, res, next) => { req.body.roleName = "ADMIN"; next(); }, auth.registerAdmin, );

router.post(
  "/create-user", authMiddleware, checkPermission("CREATE_USER"),
  // isAdmin,
  upload.fields([{ name: "profile_image", maxCount: 1 }]),
  (req, res, next) => {
    req.body.roleName = "USER";
    next();
  },
  auth.createUserByRole,
);

// router.post("/create-user", authMiddleware, isAdmin,
//   (req, res, next) => { req.body.roleName = "USER"; next();}, auth.createUserByRole);
// router.get("/get-ip-requests", authMiddleware, isAdmin, auth.getPendingIpRequests);
// router.post( "/approve-ip/:ipId", authMiddleware, isAdmin, auth.approveIpRequest);

router.get(
  "/get-device-requests", authMiddleware, checkAdmin,
  auth.getPendingDeviceRequests,
);
router.post( "/approve-device/:deviceRequestId", authMiddleware, checkAdmin, auth.approveDeviceRequest,);

router.post("/login", auth.login);
router.get("/get-users", authMiddleware, checkAnyPermission(["VIEW_USER", "VIEW_ATTENDANCE_REPORT", "VIEW_SALARY_REPORT", "VIEW_VISIT_REPORT", "VIEW_EMPLOYEE_REPORT", "CREATE_TARGET", "UPDATE_TARGET", "hr_letter_manage"]), auth.getUsersList);
// router.put( "/update-user/:id", authMiddleware, isAdmin, auth.updateUserById);
router.put(
  "/update-user/:id", authMiddleware, checkPermission("UPDATE_USER"),
  // isAdmin,
  upload.fields([{ name: "profile_image", maxCount: 1 }]), //  ADD THIS
  auth.updateUserById,
);
router.get("/get-employee-details/:id", authMiddleware, checkPermissionOrSelf(["VIEW_USER", "UPDATE_USER", "hr_letter_manage"], "id"), auth.getUserById);
router.get("/user-dropdown", authMiddleware, auth.getUserDropdown);

// router.patch( "/update-user-status/:id", authMiddleware, isAdmin, auth.updateUserStatus);
router.patch(
  "/user-status/:action", authMiddleware, checkPermission("UPDATE_USER"),
  auth.updateUserStatusByAction,
);
router.delete("/delete-user/:id", authMiddleware, checkPermission("DELETE_USER"), auth.deleteUserById);
router.get("/get-deleted-users", authMiddleware, checkPermission("VIEW_USER"), auth.getDeletedUsers);

router.post(
  "/set-password/:userId", authMiddleware, checkPermissionOrSelf(["UPDATE_USER", "CREATE_USER"], "userId"),
  // allowRoles("ADMIN", "SUPER_ADMIN"),
  auth.setUserPassword,
);

router.post( "/update-status", authMiddleware, auth.updateUserStatus);

router.put( "/upload-profile-image", authMiddleware,
  upload.fields([{ name: "profile_image", maxCount: 1 }]), auth.uploadOwnProfileImage );

router.get( "/my-profile", authMiddleware, auth.getMyProfile);

router.get("/get-notifications", authMiddleware, auth.getNotifications);
router.get("/get-unreadCount", authMiddleware, auth.getUnreadCount)
router.patch("/mark-notification-as-read/:id", authMiddleware, auth.markAsRead);
router.patch("/mark-allAsRead", authMiddleware, auth.markAllAsRead);
router.delete("/deleteAllNotifications", authMiddleware, auth.clearNotifications);
router.delete("/delete-notification/:id", authMiddleware, auth.deleteNotification);
router.get('/user-permissions/:userId', authMiddleware, checkPermissionOrSelf(["MANAGE_USER_PERMISSIONS"], "userId"), permission.getLegacy);
router.post('/user-permissions', authMiddleware, checkPermission("MANAGE_USER_PERMISSIONS"), permission.saveLegacy);

module.exports = router;
