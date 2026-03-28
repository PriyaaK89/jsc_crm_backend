const express = require("express");
const router = express.Router();
const dailySalaryController = require("../controllers/empDailySalary.controller");
const auth = require("../middleware/auth.middleware");


router.get(
  "/daily-salary-range/:employeeId",
  auth,
  dailySalaryController.getSalaryByDateRange
);
router.get(
  "/my-daily-salary",
  auth,
  dailySalaryController.getMySalaryByDateRange
);

module.exports = router;
