const express = require("express");
const router = express.Router();
const controller = require("../../controllers/transaction-flow/transactionApprovalConfig.controller");
const auth = require("../../middleware/auth.middleware");

router.post( "/create-transaction-approval-config", auth, controller.createApprovalConfig );
router.get( "/get-transaction-approval-config", auth, controller.getAllApprovalConfigs );
router.get( "/get-approvalConfig-employee/:employee_id", auth, controller.getApprovalConfigByEmployee );
router.put( "/update-transaction-approval/:id", auth, controller.updateApprovalConfig );

module.exports = router;