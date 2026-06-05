const express = require("express");
const router = express.Router();
const salesController = require("../controllers/sales.controller");
const auth = require("../middleware/auth.middleware");

router.get( "/sales-ledger-dropdown", auth, salesController.getSalesLedgerList);

router.post( "/create-sales-order", auth, salesController.createSales);

module.exports = router;