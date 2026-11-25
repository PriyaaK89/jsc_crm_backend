const express = require("express");

const router = express.Router();
const auth = require("../middleware/auth.middleware");
// own / team ledger, else the normal VIEW_FINANCIAL_REPORT check (field employees opening their dealers)
const { allowOwnLedgerOr } = require("../middleware/ledgerAccess.middleware");

const reportController = require("../controllers/partyLedgerReport.controller");
const partyLedgerSummaryController = require("../controllers/partyLedgerSummary.controller")
const dealerListController = require("../controllers/dealerList.controller");
const dealerReminderController = require("../controllers/dealerReminder.controller");

router.get( "/get-party-ledger-report", auth, allowOwnLedgerOr("VIEW_FINANCIAL_REPORT"), reportController.getPartyLedgerReport );
router.get("/get-party-ledger/summary", auth, allowOwnLedgerOr("VIEW_FINANCIAL_REPORT"), partyLedgerSummaryController.getPartyLedgerSummary);

// Dealer List (APK): the server decides the scope (all dealers / own + team), see the controller.
// Kept in this router so app.js does not change (this router is already mounted at the root).
router.get("/dealer-list", auth, dealerListController.getDealerList);

// Dealer List three-dot menu
// History: visits made to this dealer (own / team dealer, any dealer for VIEW_ALL_DISTRIBUTORS, admin)
router.get("/dealer-list/:ledger_id/visits", auth, allowOwnLedgerOr([]), dealerListController.getDealerVisits);
// Add Reminder / History -> Reminders (same dealer check; ledger_id from body / query)
router.post("/dealer-reminders", auth, allowOwnLedgerOr([]), dealerReminderController.createReminder);
router.get("/dealer-reminders", auth, allowOwnLedgerOr([]), dealerReminderController.listReminders);
// only the creator (or Admin / Super Admin) can change a reminder, checked in the controller
router.patch("/dealer-reminders/:id/status", auth, dealerReminderController.updateStatus);

module.exports = router;