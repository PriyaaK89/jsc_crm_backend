const express = require("express");
const router = express.Router();
const dailySalaryController = require("../controllers/empDailySalary.controller");
const auth = require("../middleware/auth.middleware");

router.post(
  "/generate-daily-salary/:employeeId",
  auth,
  dailySalaryController.generateDailySalary
);

module.exports = router;
