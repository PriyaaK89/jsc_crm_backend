const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const salesController = require("../controllers/sales.controller");
const auth = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");

router.get( "/sales-ledger-dropdown", auth, salesController.getSalesLedgerList);

// router.post( "/create-sales-order", auth, salesController.createSales);

router.post(
    "/create-sales-order", auth, checkPermission("CREATE_TRANSACTION"),
    upload.fields([
      { name: "dispatch_doc_image", maxCount: 1 },
      { name: "bill_t_image", maxCount: 1 }
    ]),
    salesController.createSales
  );

router.get( "/get-sales-invoice/:id", auth, salesController.getSalesInvoice);
router.get("/sales/ledger-overdue-status/:ledgerId", auth, salesController.checkLedgerOverdueStatus);
router.get("/sale/my-orders", auth, salesController.getMyOrderHistory);
router.get("/sale/my-orders/:id/items", auth, salesController.getMyOrderItems);

module.exports = router;