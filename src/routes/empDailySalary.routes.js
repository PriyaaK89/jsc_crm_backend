const express = require("express");
const router = express.Router();
const { checkPermissionOrSelf } = require("../middleware/permission.middleware");
const dailySalaryController = require("../controllers/empDailySalary.controller");
const auth = require("../middleware/auth.middleware");


router.get( "/daily-salary-range/:employeeId", auth, checkPermissionOrSelf(["VIEW_SALARY_REPORT"], "employeeId"), dailySalaryController.getSalaryByDateRange);
router.get( "/my-daily-salary", auth, dailySalaryController.getMySalaryByDateRange);

module.exports = router;
