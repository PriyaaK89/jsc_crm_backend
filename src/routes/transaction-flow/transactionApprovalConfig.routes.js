const express = require("express");
const router = express.Router();
const { checkPermission, checkPermissionOrSelf } = require("../../middleware/permission.middleware");
const controller = require("../../controllers/transaction-flow/transactionApprovalConfig.controller");
const auth = require("../../middleware/auth.middleware");

router.post( "/create-transaction-approval-config", auth, checkPermission("transaction_approval_config"), controller.createApprovalConfig );
router.get( "/get-transaction-approval-config", auth, checkPermission("transaction_approval_config"), controller.getAllApprovalConfigs );
router.get( "/get-approvalConfig-employee/:employee_id", auth, checkPermissionOrSelf(["transaction_approval_config"], "employee_id"), controller.getApprovalConfigByEmployee );
router.put( "/update-transaction-approval/:id", auth, checkPermission("transaction_approval_config"), controller.updateApprovalConfig );

module.exports = router;