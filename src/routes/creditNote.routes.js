const express = require("express");
const router = express.Router();
const creditNoteController = require("../controllers/creditNote.controller");
const auth = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");

router.post( "/create-credit-note", auth, upload.fields([
    { name: "bill_t_image", maxCount: 1 }, { name: "dispatch_doc_image", maxCount: 1 }
  ]), creditNoteController.createCreditNote);
router.get("/get-sales-by-customer", auth, creditNoteController.getSalesByCustomer);
router.get( "/get-sales-item/:saleId/items", creditNoteController.getSaleItemsById );
router.get( "/sales-bill-references", creditNoteController.getSalesBillReferences );
router.get( "/get-credit-note-invoice/:id", auth, creditNoteController.getCreditNoteInvoice);

router.get("/sales-ledger-dropdown", auth, creditNoteController.getSalesReturnLedgerDropdown);
router.get("/get-original-sale/:saleId", auth, creditNoteController.getOriginalSale);
router.post( "/send-credit-note-whatsapp/:id", auth, creditNoteController.sendCreditNoteWhatsApp );
// router.get("/get-sales-bill-references", auth, creditNoteController.getSalesBillReferences);
module.exports = router;