const express = require("express");
const router = express.Router();
const { verifyGST } = require("../controllers/gst.controller");

router.post("/verify-gst", verifyGST);

module.exports = router;