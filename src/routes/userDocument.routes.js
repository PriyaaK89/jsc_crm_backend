const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload.middleware");
const auth = require("../middleware/auth.middleware");
const { checkPermissionOrSelf } = require("../middleware/permission.middleware");
const uploadController = require("../controllers/userDocument.controller");

//  Upload + Update (same API)
router.post(
  "/upload-document",
  auth,
  upload.single("file"),
  checkPermissionOrSelf(["CREATE_USER", "UPDATE_USER"], "user_id"),
  uploadController.uploadUserDocument
);

//  Get documents
router.get(
  "/get-documents/:user_id",
  auth,
  checkPermissionOrSelf(["VIEW_USER", "CREATE_USER", "UPDATE_USER"], "user_id"),
  uploadController.getUserDocuments
);

module.exports = router;
