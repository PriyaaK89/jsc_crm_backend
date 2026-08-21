const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth.middleware");
const controller = require("../../controllers/transaction-flow/transactionApproval.controller");
const upload = require("../../middleware/upload.middleware");
const salesApprove = require("../../controllers/transaction-flow/approveSales.controller");
const rejectSales = require("../../controllers/transaction-flow/rejectSalesOrder.controller");
const returnSales = require("../../controllers/transaction-flow/returnSalesOrder.controller");
const resubmitSales = require("../../controllers/transaction-flow/resubmitSalesOrder.controller");
const purchaseApprove = require("../../controllers/transaction-flow/approvePurchaseOrder.controller");
const purchaseReject = require("../../controllers/transaction-flow/rejectPurchaseOrder.controller");
const purchaseReturn = require("../../controllers/transaction-flow/returnPurchaseOrder.controller");
const purchaseResubmit = require("../../controllers/transaction-flow/resubmitPurchaseOrder.controller");
const creditNoteApprove = require("../../controllers/transaction-flow/approveCreditNote.controller");
const creditNoteReject = require("../../controllers/transaction-flow/rejectCreditNoteOrder.controller");
const creditNoteReturn = require("../../controllers/transaction-flow/returnCreditNoteOrder.controller");
const creditNoteResubmit = require("../../controllers/transaction-flow/resubmitCreditNoteOrder.controller");

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

router.post( "/:approvalId/send-whatsapp-confirmation",
  auth,
  salesApprove.sendSalesOrderWhatsapp
);

router.post( "/create-purchase-approval-request", auth, upload.fields([{ name: "orderBillImage", maxCount: 1 }]), controller.createPurchaseApprovalRequest);

router.post( "/approve-purchase-order/:approvalId", auth,
  upload.fields([ { name: "dispatch_doc_image", maxCount: 1 }, { name: "bill_t_image", maxCount: 1 }, ]), 
  purchaseApprove.approvePurchaseOrder );

router.post( "/return-purchase-order/:approvalId", auth, upload.fields([ { name: "returnImage", maxCount: 1 } ]), purchaseReturn.returnPurchaseOrder );
router.post( "/reject-purchase-order/:approvalId", auth, purchaseReject.rejectPurchaseOrder );
router.post( "/resubmit-purchase-order/:approvalId", auth, purchaseResubmit.resubmitPurchaseOrder );

router.post( "/create-credit-note-approval-request", auth,
  upload.fields([ { name: "bill_t_image", maxCount: 1 }, { name: "dispatch_doc_image", maxCount: 1 }, ]),
  controller.createCreditNoteApprovalRequest
);

router.post( "/approve-credit-note-order/:approvalId", auth,
  upload.fields([ { name: "dispatch_doc_image", maxCount: 1 }, { name: "bill_t_image", maxCount: 1 },]),
  creditNoteApprove.approveCreditNoteOrder
);
router.post( "/return-credit-note-order/:approvalId", auth,
  upload.fields([{ name: "returnImage", maxCount: 1 }]), creditNoteReturn.returnCreditNoteOrder
);
router.post("/reject-credit-note-order/:approvalId", auth, creditNoteReject.rejectCreditNoteOrder);
router.post("/resubmit-credit-note-order/:approvalId", auth, creditNoteResubmit.resubmitCreditNoteOrder);

module.exports = router;