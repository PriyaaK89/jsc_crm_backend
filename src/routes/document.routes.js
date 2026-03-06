const express = require("express");
const router = express.Router();

const upload = require("../middleware/upload.middleware");
const documentController = require("../controllers/document.controller");

router.post(
  "/employee-letter",
  upload.single("file"),
  documentController.uploadEmployeeLetter
);

module.exports = router;