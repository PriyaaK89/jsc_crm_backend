const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const auth = require("../middleware/auth.middleware");
// own / team ledger, else the normal VIEW_FINANCIAL_REPORT check (Dealer List -> Party History / Bill)
const { allowOwnLedgerOr } = require("../middleware/ledgerAccess.middleware");
const partyTransactionController = require("../controllers/partyTransactionReport.controller");

router.get( "/get-partyTransactionBills", auth, checkPermission("VIEW_FINANCIAL_REPORT"), partyTransactionController.getBillsDropdown);
router.get( "/get-party-transaction-report", auth, allowOwnLedgerOr("VIEW_FINANCIAL_REPORT"), partyTransactionController.getPartyTransactionReport);
router.delete( "/cancel-party-transaction", auth, checkPermission("DELETE_TRANSACTION"), partyTransactionController.deleteTransaction);

module.exports = router;