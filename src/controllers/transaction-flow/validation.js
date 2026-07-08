const db = require("../../config/db");
const transactionApprovalModel = require("../../models/transaction-flow/transactionApproval.model");
const transactionApprovalConfigModel = require("../../models/transaction-flow/transactionApprovalConfig.model");
const { uploadFileToMinio } = require("../../utils/fileUpload");

function validateApprover(approval, userId) {
    if (approval.current_approver_id !== userId) {
        throw new Error("You are not authorized");
    }

    if (approval.status !== "PENDING") {
        throw new Error("Approval already processed");
    }
}

module.exports = {
    validateApprover
};