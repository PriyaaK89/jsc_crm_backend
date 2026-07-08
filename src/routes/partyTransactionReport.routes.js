const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const partyTransactionController = require("../controllers/partyTransactionReport.controller");

router.get( "/get-partyTransactionBills", partyTransactionController.getBillsDropdown);
router.get( "/get-party-transaction-report",partyTransactionController.getPartyTransactionReport);
router.delete( "/cancel-party-transaction", auth, partyTransactionController.deleteTransaction);

module.exports = router;