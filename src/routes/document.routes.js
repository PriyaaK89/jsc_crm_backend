const express = require("express");
const router = express.Router();

const upload = require("../middleware/upload.middleware");
const documentController = require("../controllers/document.controller");
const auth = require("../middleware/auth.middleware");

router.post( "/employee-letter", upload.single("file"), auth, documentController.uploadEmployeeLetter );
router.get("/get-employee-documents/:employee_id",auth, documentController.getEmployeeDocumentsByEmployee);

module.exports = router;