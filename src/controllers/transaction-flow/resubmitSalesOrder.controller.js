const db = require("../../config/db");
const transactionApprovalModel = require("../../models/transaction-flow/transactionApproval.model");

exports.resubmitSalesOrder = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const approvalId = req.params.approvalId;
    const userId = req.user.id;

    const approval = await transactionApprovalModel.getApprovalById(approvalId);

    if (!approval) { throw new Error("Approval request not found") }
    if (approval.status !== "RETURNED") { throw new Error("Only returned requests can be resubmitted") }

    // Security check
    if (approval.returned_to_user_id !== userId) { throw new Error("You are not allowed to resubmit this order") }

    let nextApprover = null;
    let nextLevel = null;
    let approverName = "";

    switch (approval.returned_from_level) {
      case "JUNIOR":
        nextApprover = approval.junior_accountant_id;
        nextLevel = "JUNIOR";
        approverName = approval.junior_name;
        break;

      case "DISPATCHER":
        nextApprover = approval.dispatcher_id;
        nextLevel = "DISPATCHER";
        approverName = approval.dispatcher_name;
        break;

      case "SENIOR":
        nextApprover = approval.senior_accountant_id;
        nextLevel = "SENIOR";
        approverName = approval.senior_name;
        break;

      default: throw new Error("Invalid returned_from_level value");
    }
    const updatedPayload = {
  ...approval.payload_json,
  ...req.body,
};

 await connection.query(
  ` UPDATE transaction_approvals
  SET
    payload_json = ?,
    status = 'PENDING',
    approval_level = ?,
    current_approver_id = ?,
    current_status_message = ?,
    returned_to_user_id = NULL,
    returned_from_level = NULL,
    resubmission_count = resubmission_count + 1,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ? `,
  [
    JSON.stringify(updatedPayload),
    nextLevel,
    nextApprover,
    `Pending at ${approverName}`,
    approvalId,
  ],
);

    // await transactionApprovalModel.createHistory(connection, {
    //   approval_id: approvalId,
    //   action: "RESUBMITTED",
    //   action_by: userId,
    //   action_level: nextLevel,
    //   remarks: "Resubmitted after return",
    // });
    await transactionApprovalModel.createHistory(connection, {
  approval_id: approvalId,
  action: "RESUBMITTED",
  action_by: req.user.id,
  action_level: approval.returned_from_level,
  remarks: "Resubmitted after return",
});

    // Approval notification to approver
    await transactionApprovalModel.createNotification(connection, {
      user_id: nextApprover,
      approval_id: approvalId,
      module_type: "SALES",
      notification_category: "APPROVAL",
      title: "Sales Order Resubmitted",
      message: "Returned Sales Order has been resubmitted for approval.",
    });

    // Update employee status notification
    await transactionApprovalModel.updateStatusNotification( connection, approvalId,
      `Sales Order resubmitted and pending at ${approverName}.`,);

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Resubmitted successfully",
    });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    connection.release();
  }
};