const express = require("express");
const router = express.Router();
const auth = require("../controllers/auth.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");
// const {isAdmin} = require("../middleware/checkAllowedIp.middleware")
const { isAdmin } = require("../middleware/checkAllowedDevice.middleware");
const upload = require("../middleware/upload.middleware");
router.post(
  "/create-admin",
  authMiddleware,
  allowRoles("SUPER_ADMIN"),
  (req, res, next) => {
    req.body.roleName = "ADMIN";
    next();
  },
  auth.createUserByRole,
);

router.post(
  "/create-user",
  authMiddleware,
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
  "/get-device-requests",
  authMiddleware,
  isAdmin,
  auth.getPendingDeviceRequests,
);
router.post(
  "/approve-device/:deviceRequestId",
  authMiddleware,
  isAdmin,
  auth.approveDeviceRequest,
);
router.post("/login", auth.login);
router.get("/get-users", authMiddleware, auth.getUsersList);
// router.put( "/update-user/:id", authMiddleware, isAdmin, auth.updateUserById);
router.put(
  "/update-user/:id",
  authMiddleware,
  // isAdmin,
  upload.fields([{ name: "profile_image", maxCount: 1 }]), //  ADD THIS
  auth.updateUserById,
);
router.get("/get-employee-details/:id", authMiddleware, auth.getUserById);
router.get("/user-dropdown", authMiddleware, auth.getUserDropdown);

// router.patch( "/update-user-status/:id", authMiddleware, isAdmin, auth.updateUserStatus);
router.patch(
  "/user-status/:action",
  authMiddleware,
  isAdmin,
  auth.updateUserStatusByAction,
);
router.delete("/delete-user/:id", authMiddleware, isAdmin, auth.deleteUserById);
router.get("/get-deleted-users", authMiddleware, isAdmin, auth.getDeletedUsers);

router.post(
  "/set-password/:userId",
  authMiddleware,
  // allowRoles("ADMIN", "SUPER_ADMIN"),
  auth.setUserPassword,
);

router.post( "/update-status", authMiddleware, auth.updateUserStatus);

router.put(
  "/upload-profile-image",
  authMiddleware,
  upload.fields([{ name: "profile_image", maxCount: 1 }]),
  auth.uploadOwnProfileImage
);

router.get(
  "/my-profile",
  authMiddleware,
  auth.getMyProfile
);

router.get("/get-notifications", authMiddleware, auth.getNotifications);
router.get("/get-unreadCount", authMiddleware, auth.getUnreadCount)
router.patch("/mark-notification-as-read/:id", authMiddleware, auth.markAsRead);
router.patch("/mark-allAsRead", authMiddleware, auth.markAllAsRead);
router.delete("/deleteAllNotifications", authMiddleware, auth.clearNotifications);
router.delete("/delete-notification/:id", authMiddleware, auth.deleteNotification);


module.exports = router;
