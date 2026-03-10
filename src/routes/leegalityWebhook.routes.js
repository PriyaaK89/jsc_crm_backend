const express = require("express");
const router = express.Router();
const { leegalityWebhook } = require("../controllers/leegalityWebhook.controller");

router.post("/leegality/webhook", leegalityWebhook);

module.exports = router;