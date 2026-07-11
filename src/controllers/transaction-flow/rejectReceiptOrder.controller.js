const db = require("../../config/db");
const transactionApprovalModel = require("../../models/transaction-flow/transactionApproval.model");
const { validateApprover } = require("./validation");

exports.rejectReceiptOrder = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const approvalId = req.params.approvalId;
    const reason = req.body.reason?.trim();
    const userId = req.user.id;

    if (!reason) {
      throw new Error("Rejection reason required");
    }

    const approval = await transactionApprovalModel.getApprovalById(approvalId);

    if (!approval) {
      throw new Error("Approval not found");
    }

    validateApprover(approval, userId);

    await transactionApprovalModel.completeApprovalNotification(connection, approvalId, userId);

    let rejectedByName = "";

    switch (approval.approval_level) {
      case "JUNIOR":
        rejectedByName = approval.junior_name;
        break;
      case "SENIOR":
        rejectedByName = approval.senior_name;
        break;
      default:
        rejectedByName = "Unknown User";
    }

    const rejectionMessage = `Receipt request rejected by ${rejectedByName}. Reason: ${reason}`;

    await transactionApprovalModel.createHistory(connection, {
      approval_id: approvalId,
      action: "REJECTED",
      action_by: userId,
      action_level: approval.approval_level,
      remarks: reason,
    });

    await transactionApprovalModel.updateApproval(connection, approvalId, {
      payload_json: approval.payload_json,
      current_approver_id: null,
      approval_level: approval.approval_level,
      status: "REJECTED",
      remarks: reason,
      current_status_message: `Rejected by ${rejectedByName}`,
      rejected_at: new Date(),
    });

    await transactionApprovalModel.updateStatusNotification(connection, approvalId, rejectionMessage);

    if (approval.senior_accountant_id && approval.senior_accountant_id !== userId) {
      await transactionApprovalModel.createNotification(connection, {
        user_id: approval.senior_accountant_id,
        approval_id: approvalId,
        module_type: "RECEIPT",
        notification_category: "STATUS",
        title: "Receipt Request Rejected",
        message: rejectionMessage,
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Rejected successfully",
    });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};