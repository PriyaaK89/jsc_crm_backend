const express = require("express");
const router = express.Router();

const upload = require("../middleware/upload.middleware");
const imageController = require("../controllers/upload.controller");

router.post(
  "/imageUpload",
  upload.single("file"),
  imageController.imageUpload
);

module.exports = router;