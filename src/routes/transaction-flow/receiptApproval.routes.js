const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth.middleware");
const upload = require("../../middleware/upload.middleware");

const transactionApprovalController = require("../../controllers/transaction-flow/transactionApproval.controller");
const approveReceipt = require("../../controllers/transaction-flow/approveReceipt.controller");
const rejectReceipt = require("../../controllers/transaction-flow/rejectReceiptOrder.controller");
const returnReceipt = require("../../controllers/transaction-flow/returnReceiptOrder.controller");
const resubmitReceipt = require("../../controllers/transaction-flow/resubmitReceiptOrder.controller");

router.post( "/create-receipt-approval-request", auth, upload.single("attachment"),
  transactionApprovalController.createReceiptApprovalRequest, );

router.post( "/approve-receipt-order/:approvalId", auth, approveReceipt.approveReceiptOrder,);
router.post( "/return-receipt-order/:approvalId", auth, upload.fields([{ name: "returnImage", maxCount: 1 }]), returnReceipt.returnReceiptOrder,);
router.post( "/reject-receipt-order/:approvalId", auth, rejectReceipt.rejectReceiptOrder,);
router.post( "/resubmit-receipt-order/:approvalId", auth, resubmitReceipt.resubmitReceiptOrder,);

module.exports = router;