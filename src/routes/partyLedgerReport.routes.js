const express = require("express");

const router = express.Router();

const reportController =
require("../controllers/partyLedgerReport.controller");

router.get(
    "/get-party-ledger-report",
    reportController.getPartyLedgerReport
);

module.exports = router;