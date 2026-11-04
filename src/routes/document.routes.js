const express = require("express");
const router = express.Router();
const { checkPermission, checkPermissionOrSelf } = require("../middleware/permission.middleware");

const upload = require("../middleware/upload.middleware");
const documentController = require("../controllers/document.controller");
const auth = require("../middleware/auth.middleware");

router.post( "/employee-letter", auth, checkPermission("hr_letter_manage"), upload.single("file"), documentController.uploadEmployeeLetter );
router.get("/get-employee-documents/:employee_id", auth, checkPermissionOrSelf(["VIEW_USER", "hr_letter_manage"], "employee_id"), documentController.getEmployeeDocumentsByEmployee);

module.exports = router;