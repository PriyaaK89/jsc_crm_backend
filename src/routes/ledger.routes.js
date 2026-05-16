const express = require("express");
const router = express.Router();
const { createLedgerController , getLedgers} = require("../controllers/ledger.controller");

router.post( "/create-ledger", createLedgerController);
router.get("/get-ledgers", getLedgers)

module.exports = router;