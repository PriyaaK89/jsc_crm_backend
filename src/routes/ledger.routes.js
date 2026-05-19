const express = require("express");
const router = express.Router();
const { createLedgerController , getLedgers, getLedgerByIdController, updateLedgerController, deleteLedgerController} = require("../controllers/ledger.controller");

router.post( "/create-ledger", createLedgerController);
router.get("/get-ledgers", getLedgers);
router.get("/getLedgerDetailsById/:id", getLedgerByIdController);
router.put("/update_ledger/:id", updateLedgerController);
router.delete("/delete_ledger/:id", deleteLedgerController)

module.exports = router;