const express = require("express");
const router = express.Router();
const esignController = require("../controllers/esign.controller");
const auth = require('../middleware/auth.middleware');

// router.post(
//   "/send-offer-esign",
//   esignController.sendOfferLetterForESign
// );
router.post("/documents/send-esign", auth , esignController?.sendForESign);
router.get("/document-status/:documentId", auth , esignController?.checkLeegalityStatus)
module.exports = router;