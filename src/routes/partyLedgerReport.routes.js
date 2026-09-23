const express = require("express");

const router = express.Router();

const reportController = require("../controllers/partyLedgerReport.controller");
const partyLedgerSummaryController = require("../controllers/partyLedgerSummary.controller")

router.get( "/get-party-ledger-report", reportController.getPartyLedgerReport );
router.get("/get-party-ledger/summary", partyLedgerSummaryController.getPartyLedgerSummary);

module.exports = router;