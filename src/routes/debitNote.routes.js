const express = require("express");
const router = express.Router();
const debitNoteController = require("../controllers/debitNote.controller");
const auth = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");

router.post( "/create-debit-note", auth , upload.fields([
    { name: "bill_t_image", maxCount: 1 },
    { name: "dispatch_doc_image", maxCount: 1 }
  ]), debitNoteController.createDebitNote);
router.get("/get-purchase-by-supplier", auth , debitNoteController.getPurchasesBySupplier);
router.get( "/get-purchase-items/:purchaseId/items", auth, debitNoteController.getPurchaseItemsById );
router.get( "/get-debitNote-invoice/:id", auth, debitNoteController.getDebitNoteInvoice);

module.exports = router;