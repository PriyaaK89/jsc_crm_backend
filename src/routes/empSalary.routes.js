const express = require("express");
const router = express.Router();
const { checkPermissionOrSelf } = require("../middleware/permission.middleware");
const salaryController = require("../controllers/empMonthlySalary.controller");
const auth = require('../middleware/auth.middleware');

router.get(
  "/get-monthly-salary", auth, checkPermissionOrSelf(["VIEW_SALARY_REPORT"], "employee_id"), 
  salaryController.getEmployeeMonthlyReport
);

router.get(
  "/salary-months/:employee_id", auth, checkPermissionOrSelf(["VIEW_SALARY_REPORT"], "employee_id"),
  salaryController.getEmployeeSalaryMonths
);

module.exports = router;
