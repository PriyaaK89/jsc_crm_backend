const express = require("express");
const router = express.Router();
const journalController = require("../controllers/journal.controller");
const auth = require("../middleware/auth.middleware");

router.post("/create-journal", auth, journalController.createJournal);
router.get( "/ledger-dropdown", auth, journalController.getJournalLedgerDropdown );
router.get( "/get-journal-bill-references/:ledgerId", auth, journalController.getBillReferences );
router.get( "/journal-invoice/print/:id", auth, journalController.getJournalVoucher );
router.get( "/get-journal-invoice/:id", journalController.getJournalInvoice);

module.exports = router;
