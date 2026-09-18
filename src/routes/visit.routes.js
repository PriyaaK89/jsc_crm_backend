const express = require("express");
const router = express.Router();
const {
  createVisit, getVisits, getMyVisits, getTodayVisit, getTodayVisitCount,
  getVisitReport, getHierarchyVisits, getUsersBySelectedLevel,
  getUserVisitDetails, getMyVisitSummary, getMyVisitDetailsById
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
router.get("/get-emp-visit",auth, getVisits);
router.get("/my-visits", auth, getMyVisits);
router.get("/my-today-visit", auth, getTodayVisit);
router.get("/get-my-todayVisitCount", auth, getTodayVisitCount);
router.get( "/get-visit-report-summary", auth, getVisitReport );
router.get("/hierarchy-visits", auth, getHierarchyVisits );
router.get( "/users-by-level", auth, getUsersBySelectedLevel);
router.get( "/get-hierarchy-visits/:userId", auth, getUserVisitDetails);

router.get("/my-visit-summary", auth, getMyVisitSummary);
router.get("/my-visits/:id", auth, getMyVisitDetailsById);

module.exports = router;