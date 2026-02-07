const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload.middleware");
const auth = require("../middleware/auth.middleware");
const uploadController = require("../controllers/userDocument.controller");

router.post( "/upload-image", auth, upload.single("file"), uploadController.uploadUserDocument);
router.get( "/get-documents/:user_id", auth, uploadController.getUserDocuments);
router.put( "/update-document", auth, uploadController.updateDocument);

module.exports = router;
