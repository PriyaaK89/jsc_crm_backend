const express = require("express");
const router = express.Router();
const dailyReportController = require("../controllers/dailyReport.controller");
const auth = require("../middleware/auth.middleware");
const { submitDailyTargetReportonDayOver } = require("../controllers/dailyReport.controller");

router.post("/submit-daily-targetReport", auth, submitDailyTargetReportonDayOver);
router.get("/get-target-vs-achievement", auth, dailyReportController.getTargetVsAchievement);

module.exports = router;