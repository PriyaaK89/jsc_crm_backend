const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth.middleware");
const generateOfferLetterController = require("../../controllers/documents/generateOfferLetter.controller")

router.get( "/offer-letter/next-offer-reference", generateOfferLetterController.getNextOfferReference);

module.exports = router;