const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth.middleware");
const generateOfferLetterController = require("../../controllers/documents/generateOfferLetter.controller")

router.get( "/next-offer-reference", generateOfferLetterController.getNextDocumentReference);

module.exports = router;