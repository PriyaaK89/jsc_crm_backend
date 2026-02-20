const express = require("express");
const router = express.Router();
const salaryController = require("../controllers/EmpSalary.controller");
const auth = require('../middleware/auth.middleware');

router.get(
  "/get-monthly-salary/:employeeId", auth,
  salaryController.calculateMonthlySalary
);
router.post(
  "/lock-monthly-salary/:employeeId",
  auth,
  salaryController.lockMonthlySalary
);

module.exports = router;
