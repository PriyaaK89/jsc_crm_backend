const express = require("express");
const router = express.Router();
const dailySalaryController = require("../controllers/empDailySalary.controller");
const auth = require("../middleware/auth.middleware");

router.post(
  "/generate-daily-salary/:employeeId",
  auth,
  dailySalaryController.generateDailySalary
);

router.get(
  "/daily-salary-range/:employeeId",
  auth,
  dailySalaryController.getSalaryByDateRange
);

module.exports = router;
