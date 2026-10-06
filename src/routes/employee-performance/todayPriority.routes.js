const router = require("express").Router();
const ctrl = require("../../controllers/employee-performance/todayPriority.controller");
const  auth  = require("../../middleware/auth.middleware"); // ← use your real auth middleware

router.get("/get-today-priority", auth, ctrl.getTodayPriorities);
router.get("/pending-orders", auth, ctrl.getPendingOrders);
router.get("/returned-orders", auth, ctrl.getReturnedOrders);
router.patch("/follow-ups/:visitId/done", auth, ctrl.markFollowUpDone);

module.exports = router;