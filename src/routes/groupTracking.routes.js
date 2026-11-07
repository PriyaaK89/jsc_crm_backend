const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const groupTracking = require("../controllers/groupTracking.controller");

// Access control is hierarchy-based and enforced inside the controller
router.get("/group-tracking/filters", auth, groupTracking.getFilters);
router.get("/group-tracking/routes", auth, groupTracking.getGroupRoutes);

module.exports = router;