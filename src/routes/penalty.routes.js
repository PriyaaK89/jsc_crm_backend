const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const penaltyController = require("../controllers/penalty.controller");

router.post("/send-penalty-notice", auth, penaltyController.sendPenaltyNotice);

module.exports = router;