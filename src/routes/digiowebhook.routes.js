const express = require("express");
const router = express.Router();
const {digioWebhook} = require("../controllers/digioWebhook.controller")


router.post(
  "/digio/webhook",
  express.raw({ type: "application/json" }),
  digioWebhook
);

module.exports = router;