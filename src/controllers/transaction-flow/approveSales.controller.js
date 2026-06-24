const db = require("../../config/db");
const transactionApprovalModel = require("../../models/transaction-flow/transactionApproval.model");
const { validateApprover } = require("./validation");
const salesApprovalService = require("../../services/sales/createSalesTransaction.service");
const { uploadFileToMinio } = require("../../utils/fileUpload");

exports.approveSalesOrder = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const approvalId = req.params.approvalId;
    const remarks = req.body.remarks || "";
    const userId = req.user.id;

    const approval = await transactionApprovalModel.getApprovalById(approvalId);

    if (!approval) {
      throw new Error("Approval request not found");
    }
    // const newPayload = req.body.payload_json || approval.payload_json;
    // const oldPayload = approval.payload_json;

//     const newPayload =
//   req.body.payload_json
//     ? JSON.parse(JSON.stringify(req.body.payload_json))
//     : JSON.parse(JSON.stringify(approval.payload_json));

// const oldPayload =
//   JSON.parse(JSON.stringify(approval.payload_json));

const newPayload = req.body.payload_json
  ? (typeof req.body.payload_json === "string"
      ? JSON.parse(req.body.payload_json)          // multipart → string → parse
      : JSON.parse(JSON.stringify(req.body.payload_json))) // json body → object → clone
  : JSON.parse(JSON.stringify(approval.payload_json));

const oldPayload = JSON.parse(JSON.stringify(approval.payload_json));

    validateApprover(approval, userId);

    // await transactionApprovalModel.markApprovalNotificationCompleted( connection, approvalId, userId );
    await transactionApprovalModel.completeApprovalNotification( connection, approvalId, userId );

    let nextApprover = null;
    let nextLevel = null;
    let employeeMessage = "";
    let approverMessage = "";

    if (req.files?.dispatch_doc_image?.[0]) {
      const uploaded = await uploadFileToMinio(
        req.files.dispatch_doc_image[0],
        "txn_sales",
      );
      newPayload.dispatch_doc_image = uploaded.object_path;
    }

    if (req.files?.bill_t_image?.[0]) {
      const uploaded = await uploadFileToMinio(
        req.files.bill_t_image[0],
        "txn_sales",
      );
      newPayload.bill_t_image = uploaded.object_path;
    }

    const isModified =
      JSON.stringify(oldPayload) !== JSON.stringify(newPayload);

    if (isModified) {
      await transactionApprovalModel.createPayloadHistory(connection, {
        approval_id: approvalId,
        modified_by: userId,
        modified_level: approval.approval_level,
        old_payload: oldPayload,
        new_payload: newPayload,
      });
    }
    const modificationData = {
      payload_json: newPayload,
      is_bill_modified: isModified ? 1 : approval.is_bill_modified,
      modified_by: isModified ? userId : approval.modified_by,
      modified_at: isModified ? new Date() : approval.modified_at,
    };

    await transactionApprovalModel.createHistory(connection, {
      approval_id: approvalId,
      action: "APPROVED",
      action_by: userId,
      action_level: approval.approval_level,
      remarks,
    });

    /* JUNIOR -> DISPATCHER */
    if (approval.approval_level === "JUNIOR") {
      nextApprover = approval.dispatcher_id;
      nextLevel = "DISPATCHER";

      // employeeMessage = "Sales Order approved by Junior Accountant. Pending at Dispatcher.";
      employeeMessage = `Sales Order approved by ${approval.junior_name}. Pending at ${approval.dispatcher_name}.`;
      approverMessage = "Sales Order approved by Junior Accountant. Pending for your approval.";

      await transactionApprovalModel.updateApproval(connection, approvalId, {
        ...modificationData,
        current_approver_id: nextApprover,
        approval_level: nextLevel,
        status: "PENDING",
        remarks,
        current_status_message: "Pending at Dispatcher",
      });
      await transactionApprovalModel.updateStatusNotification(
  connection,
  approvalId,
  employeeMessage
);
    } else if (approval.approval_level === "DISPATCHER") {
      /* DISPATCHER -> SENIOR */
      nextApprover = approval.senior_accountant_id;
      nextLevel = "SENIOR";

      // employeeMessage = "Sales Order approved by Dispatcher. Pending at Senior Accountant.";
      employeeMessage = `Sales Order approved by ${approval.dispatcher_name}. Pending at ${approval.senior_name}.`;
      approverMessage = "Sales Order approved by Dispatcher. Pending for your approval.";
      await transactionApprovalModel.updateApproval(connection, approvalId, {
        ...modificationData,
        current_approver_id: nextApprover,
        approval_level: nextLevel,
        status: "PENDING",
        remarks,
        current_status_message: "Pending at Senior Accountant",
      });
      await transactionApprovalModel.updateStatusNotification( connection, approvalId, employeeMessage );
    } else if (approval.approval_level === "SENIOR") {
      const result = await salesApprovalService.executeApprovedSales(
        connection,
        newPayload,
        approval.created_by,
      );

      await transactionApprovalModel.updateApproval(connection, approval.id, {
        ...modificationData,
        status: "APPROVED",
        current_approver_id: null,
        approval_level: "SENIOR",
        remarks,
        current_status_message: `Approved. Sales Voucher ${result.voucher_no} generated`,
        approved_at: new Date(),
        final_transaction_id: result.saleId,
      });
      employeeMessage = `Sales Order approved by ${approval.senior_name}. Sales Voucher ${result.voucher_no} generated successfully.`;
      await transactionApprovalModel.updateStatusNotification( connection, approvalId, employeeMessage );
      // employeeMessage = `Sales Order approved successfully. Sales ID: ${result.saleId}`;
    }

    /* NEXT APPROVER NOTIFICATION  */
    if (nextApprover) {
      await transactionApprovalModel.createNotification(connection, {
        user_id: nextApprover,
        approval_id: approvalId,
        module_type: "SALES",
        notification_category: "APPROVAL",
        title: "Sales Approval Pending",
        message: approverMessage,
      });
    }

    /* EMPLOYEE STATUS NOTIFICATION  */
    await transactionApprovalModel.createNotification(connection, {
      user_id: approval.created_by,
      approval_id: approvalId,
      module_type: "SALES",
      notification_category: "STATUS",
      title: "Sales Order Status",
      message: employeeMessage,
    });

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Approved successfully",
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
