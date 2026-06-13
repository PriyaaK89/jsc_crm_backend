const express = require("express");
const router = express.Router();
const creditNoteController = require("../controllers/creditNote.controller");
const auth = require("../middleware/auth.middleware");

router.post( "/create-credit-note", auth, creditNoteController.createCreditNote);
router.get("/get-sales-by-customer", auth, creditNoteController.getSalesByCustomer);
router.get( "/get-sales-item/:saleId/items", creditNoteController.getSaleItemsById );
router.get(
    "/sales-bill-references",
    creditNoteController.getSalesBillReferences
);
router.get(
    "/get-credit-note-invoice/:id", auth, creditNoteController.getCreditNoteInvoice
);
module.exports = router;