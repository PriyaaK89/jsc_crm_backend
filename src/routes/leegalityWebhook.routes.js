const express = require("express");
const router = express.Router();
const { leegalityWebhook } = require("../controllers/leegalityWebhook.controller");


router.post("/leegality/webhook", leegalityWebhook);
// router.post("/digio/webhook", digioWebhook);


module.exports = router;