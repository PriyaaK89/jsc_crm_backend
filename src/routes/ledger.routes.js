const express = require("express");
const router = express.Router();
const { checkAnyPermission, checkPermission } = require("../middleware/permission.middleware");
const { createLedgerController , getLedgers, getLedgerByIdController, updateLedgerController, deleteLedgerController, getLedgerDropdown, reassignLedgerEmployee, getMyAssignedLedgers, sendLedgerCreatedWhatsapp} = require("../controllers/ledger.controller");
const auth = require("../middleware/auth.middleware");

router.post( "/create-ledger", auth, checkPermission("CREATE_LEDGER"), createLedgerController);
router.get("/get-ledgers", auth, checkAnyPermission(["VIEW_LEDGER", "VIEW_TRANSACTION", "CREATE_TRANSACTION", "VIEW_FINANCIAL_REPORT", "VIEW_DISTRIBUTOR"]), getLedgers);
router.get("/getLedgerDetailsById/:id", auth,  getLedgerByIdController);
router.put("/update_ledger/:id", auth, checkPermission("UPDATE_LEDGER"), updateLedgerController);
router.delete("/delete_ledger/:id", auth, checkPermission("DELETE_LEDGER"), deleteLedgerController);
router.get( "/ledger-dropdown",auth, getLedgerDropdown );
router.put("/reassign-ledger", auth, checkPermission("UPDATE_LEDGER"), reassignLedgerEmployee);
router.get("/get-my-assigned-ledgers", auth, getMyAssignedLedgers);
router.post( "/:ledgerId/send-whatsapp", auth, checkAnyPermission(["CREATE_LEDGER", "UPDATE_LEDGER"]), sendLedgerCreatedWhatsapp);

module.exports = router;