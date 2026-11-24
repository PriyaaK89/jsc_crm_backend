const express = require("express");

const router = express.Router();
const auth = require("../middleware/auth.middleware");
// own / team ledger, else the normal VIEW_FINANCIAL_REPORT check (field employees opening their dealers)
const { allowOwnLedgerOr } = require("../middleware/ledgerAccess.middleware");

const reportController = require("../controllers/partyLedgerReport.controller");
const partyLedgerSummaryController = require("../controllers/partyLedgerSummary.controller")
const dealerListController = require("../controllers/dealerList.controller");

router.get( "/get-party-ledger-report", auth, allowOwnLedgerOr("VIEW_FINANCIAL_REPORT"), reportController.getPartyLedgerReport );
router.get("/get-party-ledger/summary", auth, allowOwnLedgerOr("VIEW_FINANCIAL_REPORT"), partyLedgerSummaryController.getPartyLedgerSummary);

// Dealer List (APK): the server decides the scope (all dealers / own + team), see the controller.
// Kept in this router so app.js does not change (this router is already mounted at the root).
router.get("/dealer-list", auth, dealerListController.getDealerList);

module.exports = router;