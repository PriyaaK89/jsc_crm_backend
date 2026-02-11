const express = require("express");
const router = express.Router();
const salaryController = require("../controllers/empSalary.controller");
const auth = require('../middleware/auth.middleware');

router.get(
  "/get-monthly-salary/:employeeId", auth,
  salaryController.calculateMonthlySalary
);

module.exports = router;
