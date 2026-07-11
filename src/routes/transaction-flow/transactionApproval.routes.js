const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth.middleware");
const controller = require("../../controllers/transaction-flow/transactionApproval.controller");
const upload = require("../../middleware/upload.middleware");
const salesApprove = require("../../controllers/transaction-flow/approveSales.controller");
const rejectSales = require("../../controllers/transaction-flow/rejectSalesOrder.controller");
const returnSales = require("../../controllers/transaction-flow/returnSalesOrder.controller");
const resubmitSales = require("../../controllers/transaction-flow/resubmitSalesOrder.controller");

router.post( "/create-sales-approval-request", auth,   
    upload.fields([ { name: "orderBillImage", maxCount: 1 } ]), 
    controller.createSalesApprovalRequest );
router.get( "/pending-approvals", auth, controller.getPendingApprovals );
router.get( "/get-notifications", auth, controller.getNotifications );
router.get( "/get-notification-counts", auth, controller.getNotificationCounts );
router.put("/mark-notifications-read", auth, controller.markNotificationsRead);
router.get( "/get-order-approval/:approvalId", auth, controller.getApprovalById );
router.get( "/approval-history/:approvalId", controller.getPayloadHistory );
// router.post( "/approve-sale-order", auth, salesApprove.approveSalesOrder);
router.post(
  "/approve-sale-order/:approvalId", auth,  upload.fields([
    { name: "dispatch_doc_image", maxCount: 1 },
    { name: "bill_t_image", maxCount: 1 }
  ]),  salesApprove.approveSalesOrder
);

router.post( "/return-sale-order/:approvalId", auth, upload.fields([ { name: "returnImage", maxCount: 1 } ]), returnSales.returnSalesOrder );
router.post( "/reject-sale-order/:approvalId", auth, rejectSales.rejectSalesOrder );
router.post( "/resubmit-sale-order/:approvalId", auth, resubmitSales.resubmitSalesOrder );
router.get( "/next-order-number", auth, controller.getNextOrderNumber );

module.exports = router;