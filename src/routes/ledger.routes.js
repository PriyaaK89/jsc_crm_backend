const express = require("express");
const router = express.Router();
const { createLedgerController , getLedgers, getLedgerByIdController, updateLedgerController, deleteLedgerController} = require("../controllers/ledger.controller");
const auth = require("../middleware/auth.middleware");

router.post( "/create-ledger",auth, createLedgerController);
router.get("/get-ledgers",auth, getLedgers);
router.get("/getLedgerDetailsById/:id",auth, getLedgerByIdController);
router.put("/update_ledger/:id",auth, updateLedgerController);
router.delete("/delete_ledger/:id",auth, deleteLedgerController)

module.exports = router;