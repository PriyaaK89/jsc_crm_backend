const express = require("express");
const router = express.Router();
const esignController = require("../controllers/esign.controller");

// router.post(
//   "/send-offer-esign",
//   esignController.sendOfferLetterForESign
// );
router.post("/documents/send-esign", esignController?.sendForESign);
module.exports = router;