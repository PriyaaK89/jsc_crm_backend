const express = require("express");
const router = express.Router();
const { checkPermission, checkPermissionOrSelf } = require("../middleware/permission.middleware");
const {
  createVisit, getVisits, getMyVisits, getTodayVisit, getTodayVisitCount,
  getVisitReport, getHierarchyVisits, getUsersBySelectedLevel,
  getUserVisitDetails, getMyVisitSummary, getMyVisitDetailsById, getFollowUpVisits
} = require("../controllers/visit.controller");
const upload = require("../middleware/upload.middleware");
const auth = require("../middleware/auth.middleware");

// router.post("/upload-visit",auth,upload.single("image"), createVisit);
router.post(
  "/upload-visit",
  auth,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "shop_image", maxCount: 1 },
    { name: "document_image", maxCount: 1 }
  ]),
  createVisit
);
router.get("/get-emp-visit", auth, checkPermission("VIEW_VISIT_REPORT"), getVisits);
router.get("/my-visits", auth, getMyVisits);
router.get("/my-today-visit", auth, getTodayVisit);
router.get("/get-my-todayVisitCount", auth, getTodayVisitCount);
router.get( "/get-visit-report-summary", auth, checkPermission("VIEW_VISIT_REPORT"), getVisitReport );
router.get("/hierarchy-visits", auth, checkPermission("VIEW_VISIT_REPORT"), getHierarchyVisits );
router.get( "/users-by-level", auth, getUsersBySelectedLevel);
router.get( "/get-hierarchy-visits/:userId", auth, checkPermissionOrSelf(["VIEW_VISIT_REPORT"], "userId"), getUserVisitDetails);

router.get("/my-visit-summary", auth, getMyVisitSummary);
router.get("/my-visits/:id", auth, getMyVisitDetailsById);
router.get("/follow-up-visits", auth, getFollowUpVisits);

module.exports = router;