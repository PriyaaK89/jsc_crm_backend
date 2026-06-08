const express = require("express");
const router = express.Router();
const debitNoteController = require("../controllers/debitNote.controller");
const auth = require("../middleware/auth.middleware");

router.post( "/create-debit-note", auth , debitNoteController.createDebitNote);
router.get("/get-purchase-by-supplier", auth , debitNoteController.getPurchasesBySupplier);
router.get( "/get-purchase-items/:purchaseId/items", debitNoteController.getPurchaseItemsById );

module.exports = router;