const express = require("express");
const router = express.Router();
const { createDigilockerKYC,getKycStatus } = require("../controllers/digioKyc.controller");

const { digioWebhook } = require("../controllers/digiKYCWebhook.controller");

router.post("/digio-webhook", digioWebhook);
router.post("/digilocker-kyc", createDigilockerKYC);
router.post("/kyc-status/:requestId/response", getKycStatus);

module.exports = router;