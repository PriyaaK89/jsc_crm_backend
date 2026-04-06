const express = require("express");
const router = express.Router();
const { verifyPAN } = require("../controllers/panVerification.controller");
const auth = require('../middleware/auth.middleware');

router.post("/verify-pan", auth, verifyPAN);

module.exports = router;