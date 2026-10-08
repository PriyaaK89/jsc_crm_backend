const router = require("express").Router();
const ctrl = require("../../controllers/employee-performance/performance.controller");
const  authenticate  = require("../../middleware/auth.middleware"); // ← your real auth middleware

router.get("/get-employee-performance-summary", authenticate, ctrl.getMyPerformanceSummary);
router.get("/get-employee-performance", authenticate, ctrl.getMyPerformance);

module.exports = router;
