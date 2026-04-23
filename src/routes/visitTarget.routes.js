const express = require("express");
const router = express.Router();
const visitTargetController = require("../controllers/visitTarget.controller");
const auth = require("../middleware/auth.middleware");
const { createTarget} = require("../controllers/visitTarget.controller");
const { getMyTargets} = require("../controllers/visitTarget.controller");

router.post("/create-target", auth, createTarget);
router.get("/my-targets", auth, getMyTargets);

module.exports = router;