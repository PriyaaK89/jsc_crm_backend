const express = require("express");
const router = express.Router();
const purchaseController = require("../controllers/purchaseTxnMaster.controller");
const auth = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");

router.get( "/purchase-ledger-dropdown", auth, purchaseController.getPurchaseLedgerDropdown);
router.get( "/supplier-dropdown", auth, purchaseController.getSupplierDropdown);
router.post( "/create-purchase-order", auth,  upload.fields([
    { name: "bill_t_image", maxCount: 1 },
    { name: "dispatch_doc_image", maxCount: 1 }
  ]), purchaseController.createPurchase);

router.get( "/get-purchaseOrders-list", auth, purchaseController.getPurchaseList);
router.get( "/getPurchaseOrderDetails/:id", auth, purchaseController.getPurchaseById);
router.get( "/purchase-invoice/print/:id",  purchaseController.getPurchaseInvoice );

module.exports = router;