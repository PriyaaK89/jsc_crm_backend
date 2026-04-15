const express = require("express");
const router = express.Router();
const companyController = require("../controllers/company.controller");
const upload = require("../middleware/upload.middleware");
const auth = require('../middleware/auth.middleware');

// multiple file fields
const uploadFields = upload.fields([
  { name: "company_logo", maxCount: 1 },
  { name: "signature", maxCount: 1 },
]);

router.post("/create-company", uploadFields, auth, companyController.createCompany);
router.get("/get-companies", auth, companyController.getCompanies);
router.get("/get-company/:id", auth, companyController.getCompanyById);
router.put("/update-company/:id", uploadFields, auth, companyController.updateCompany);
router.delete("/delete-company/:id", auth, companyController.deleteCompany);

module.exports = router;