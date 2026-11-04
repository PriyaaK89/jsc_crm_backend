const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const auth = require("../middleware/auth.middleware");
const partyTransactionController = require("../controllers/partyTransactionReport.controller");

router.get( "/get-partyTransactionBills", auth, checkPermission("VIEW_FINANCIAL_REPORT"), partyTransactionController.getBillsDropdown);
router.get( "/get-party-transaction-report", auth, checkPermission("VIEW_FINANCIAL_REPORT"), partyTransactionController.getPartyTransactionReport);
router.delete( "/cancel-party-transaction", auth, checkPermission("DELETE_TRANSACTION"), partyTransactionController.deleteTransaction);

module.exports = router;