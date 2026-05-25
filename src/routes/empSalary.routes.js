const express = require("express");
const router = express.Router();
const salaryController = require("../controllers/empMonthlySalary.controller");
const auth = require('../middleware/auth.middleware');

router.get(
  "/get-monthly-salary", auth,
  salaryController.getEmployeeMonthlyReport
);

router.get(
  "/salary-months/:employee_id",
  salaryController.getEmployeeSalaryMonths
);

module.exports = router;
