const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const upload = require("../middleware/upload.middleware"); 
const salaryController = require("../controllers/uploadEmpSalary.controller");
const auth = require('../middleware/auth.middleware');

router.post("/upload-emp-salary", auth, checkPermission("salary_upload"), upload.single("salary_slip"), salaryController.uploadSalarySlip);

module.exports = router;
