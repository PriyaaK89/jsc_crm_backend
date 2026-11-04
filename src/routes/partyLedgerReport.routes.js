const express = require("express");

const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const auth = require("../middleware/auth.middleware");

const reportController = require("../controllers/partyLedgerReport.controller");
const partyLedgerSummaryController = require("../controllers/partyLedgerSummary.controller")

router.get( "/get-party-ledger-report", auth, checkPermission("VIEW_FINANCIAL_REPORT"), reportController.getPartyLedgerReport );
router.get("/get-party-ledger/summary", auth, checkPermission("VIEW_FINANCIAL_REPORT"), partyLedgerSummaryController.getPartyLedgerSummary);

module.exports = router;