const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const receiptController = require("../controllers/receipt.controller");
const upload = require("../middleware/upload.middleware");
const auth = require("../middleware/auth.middleware");

router.post( "/createReceipt", auth, checkPermission("CREATE_TRANSACTION"),  upload.single("attachment"), receiptController.createReceipt );
router.get( "/getPendingBills/:ledgerId",auth, receiptController.getPendingBills);
router.get( "/get-receipt-invoice/:id",auth, receiptController.getReceiptInvoice);
// routes/receipt.routes.js
router.post("/:id/send-receipt-whatsapp",auth, receiptController.sendReceiptWhatsapp);

module.exports = router;