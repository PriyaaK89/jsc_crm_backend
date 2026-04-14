const express = require("express");
const router = express.Router();
const companyController = require("../controllers/company.controller");
const upload = require("../middleware/upload.middleware");

// multiple file fields
const uploadFields = upload.fields([
  { name: "company_logo", maxCount: 1 },
  { name: "signature", maxCount: 1 },
]);

router.post("/company/create-company", uploadFields, companyController.createCompany);

module.exports = router;