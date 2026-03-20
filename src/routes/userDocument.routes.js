const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload.middleware");
const auth = require("../middleware/auth.middleware");
const uploadController = require("../controllers/userDocument.controller");

//  Upload + Update (same API)
router.post(
  "/upload-document",
  auth,
  upload.single("file"),
  uploadController.uploadUserDocument
);

//  Get documents
router.get(
  "/get-documents/:user_id",
  auth,
  uploadController.getUserDocuments
);

module.exports = router;
