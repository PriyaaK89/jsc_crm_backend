const express = require("express");
const router = express.Router();
const { checkAnyPermission, checkPermission } = require("../middleware/permission.middleware");
const companyController = require("../controllers/company.controller");
const upload = require("../middleware/upload.middleware");
const auth = require('../middleware/auth.middleware');

// multiple file fields
const uploadFields = upload.fields([
  { name: "company_logo", maxCount: 1 },
  { name: "signature", maxCount: 1 },
]);

router.post("/create-company", auth, checkPermission("CREATE_COMPANY"), uploadFields, companyController.createCompany);
router.get("/get-companies", auth, companyController.getCompanies);
router.get("/get-company/:id", auth, checkAnyPermission(["VIEW_COMPANY", "UPDATE_COMPANY"]), companyController.getCompanyById);
router.put("/update-company/:id", auth, checkPermission("UPDATE_COMPANY"), uploadFields, companyController.updateCompany);
router.delete("/delete-company/:id", auth, checkPermission("DELETE_COMPANY"), companyController.deleteCompany);

module.exports = router;