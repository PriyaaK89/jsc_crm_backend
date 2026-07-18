const db = require("../../config/db");
const transactionApprovalModel = require("../../models/transaction-flow/transactionApproval.model");

exports.resubmitCreditNoteOrder = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const approvalId = req.params.approvalId;
    const userId = req.user.id;

    const approval = await transactionApprovalModel.getApprovalById(approvalId);
    const employeeName = approval.employee_name || approval.created_by_name || "Employee";
    const employeeId = approval.created_by;

    if (!approval) { throw new Error("Approval request not found") }
    if (approval.status !== "RETURNED") { throw new Error("Only returned requests can be resubmitted") }

    if (approval.returned_to_user_id !== userId) { throw new Error("You are not allowed to resubmit this order") }

    // Mark the "Credit Note Returned" notification as read for this user —
    // otherwise it stays unread forever and reappears (or duplicates on a second return).
    await transactionApprovalModel.completeApprovalNotification(connection, approvalId, userId);

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

    await transactionApprovalModel.createHistory(connection, {
      approval_id: approvalId,
      action: "RESUBMITTED",
      action_by: req.user.id,
      action_level: approval.returned_from_level,
      remarks: "Resubmitted after return",
    });

    await transactionApprovalModel.createNotification(connection, {
      user_id: nextApprover,
      approval_id: approvalId,
      module_type: "CREDIT_NOTE",
      notification_category: "APPROVAL",
      title: "Credit Note Resubmitted",
      message: "Returned Credit Note has been resubmitted for approval.",
      generated_by_id: employeeId,
      generated_by_name: employeeName,
    });

    await transactionApprovalModel.updateStatusNotification(
      connection, approvalId,
      `Credit Note resubmitted and pending at ${approverName}.`,
    );

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