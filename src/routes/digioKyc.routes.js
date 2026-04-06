const express = require("express");
const router = express.Router();
const { createDigilockerKYC,getKycStatus } = require("../controllers/digioKyc.controller");

const { digioWebhook } = require("../controllers/digiKYCWebhook.controller");

router.post("/digio-webhook", digioWebhook);
router.post("/digilocker-kyc", createDigilockerKYC);
router.get("/kyc-status/:requestId", getKycStatus);

module.exports = router;