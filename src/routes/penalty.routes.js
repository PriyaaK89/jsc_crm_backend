const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const auth = require("../middleware/auth.middleware");
const penaltyController = require("../controllers/penalty.controller");

router.post("/send-penalty-notice", auth, checkPermission("penalty_send"), penaltyController.sendPenaltyNotice);

module.exports = router;