const express = require("express");
const router = express.Router();
const purchaseController = require("../controllers/purchaseTxnMaster.controller");
const auth = require("../middleware/auth.middleware");

router.get( "/purchase-ledger-dropdown", auth, purchaseController.getPurchaseLedgerDropdown);
router.get( "/supplier-dropdown", auth, purchaseController.getSupplierDropdown);
router.post( "/create-purchase-order", auth, purchaseController.createPurchase);

router.get( "/get-purchaseOrders-list", auth, purchaseController.getPurchaseList);
router.get( "/getPurchaseOrderDetails/:id", auth, purchaseController.getPurchaseById);


module.exports = router;