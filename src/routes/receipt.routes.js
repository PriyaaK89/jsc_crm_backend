const express = require("express");
const router = express.Router();
const receiptController = require("../controllers/receipt.controller");
const upload = require("../middleware/upload.middleware");


router.post( "/createReceipt",  upload.single("attachment"), receiptController.createReceipt );
router.get( "/getPendingBills/:ledgerId", receiptController.getPendingBills);
router.get( "/get-receipt-invoice/:id", receiptController.getReceiptInvoice);

module.exports = router;