const express = require("express");
const router = express.Router();
const { checkPermission } = require("../../middleware/permission.middleware");
const auth = require("../../middleware/auth.middleware");
const generateOfferLetterController = require("../../controllers/documents/generateOfferLetter.controller")

router.get( "/next-offer-reference", auth, checkPermission("hr_letter_manage"), generateOfferLetterController.getNextDocumentReference);

module.exports = router;