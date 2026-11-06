const express = require("express");
const router = express.Router();
const c = require("../controllers/dashboardAnalytics.controller");
const auth = require("../middleware/auth.middleware");
const { checkPermission } = require("../middleware/permission.middleware");

const canView = [auth, checkPermission("VIEW_DASHBOARD_ANALYTICS")];

router.get("/filters", canView, c.getFilters);
router.get("/orders", canView, c.getOrders);
router.get("/approvals", canView, c.getApprovals);
router.get("/visits", canView, c.getVisits);
router.get("/sales", canView, c.getSales);
router.get("/collections", canView, c.getCollections);
router.get("/business", canView, c.getBusiness);

module.exports = router;
