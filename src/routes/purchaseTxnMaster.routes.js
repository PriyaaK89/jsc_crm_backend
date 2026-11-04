const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const purchaseController = require("../controllers/purchaseTxnMaster.controller");
const auth = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");

router.get( "/purchase-ledger-dropdown", auth, purchaseController.getPurchaseLedgerDropdown);
router.get( "/supplier-dropdown", auth, purchaseController.getSupplierDropdown);
router.post( "/create-purchase-order", auth, checkPermission("CREATE_TRANSACTION"), upload.fields([
    { name: "bill_t_image", maxCount: 1 },
    { name: "dispatch_doc_image", maxCount: 1 }
  ]), purchaseController.createPurchase);

router.get( "/get-purchaseOrders-list", auth, checkPermission("VIEW_TRANSACTION"), purchaseController.getPurchaseList);
router.get( "/getPurchaseOrderDetails/:id", auth, checkPermission("VIEW_TRANSACTION"), purchaseController.getPurchaseById);
router.get( "/purchase-invoice/print/:id", auth,  purchaseController.getPurchaseInvoice );

module.exports = router;