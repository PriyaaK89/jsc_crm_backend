const express = require("express");
const router = express.Router();
const salesController = require("../controllers/sales.controller");
const auth = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");

router.get( "/sales-ledger-dropdown", auth, salesController.getSalesLedgerList);

// router.post( "/create-sales-order", auth, salesController.createSales);

router.post(
    "/create-sales-order",
    upload.fields([
      { name: "dispatch_doc_image", maxCount: 1 },
      { name: "bill_t_image", maxCount: 1 }
    ]),
    auth, salesController.createSales
  );

router.get( "/get-sales-invoice/:id", auth, salesController.getSalesInvoice);
router.get("/sales/ledger-overdue-status/:ledgerId", salesController.checkLedgerOverdueStatus);

module.exports = router;