const db = require("../../config/db");
const transactionApprovalModel = require("../../models/transaction-flow/transactionApproval.model");
const { validateApprover } = require("./validation");
const creditNoteApprovalService = require("../../services/creditNote/createCreditNoteTransaction.service");
const { uploadFileToMinio } = require("../../utils/fileUpload");

exports.approveCreditNoteOrder = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const approvalId = req.params.approvalId;
    const remarks = req.body.remarks || "";
    const userId = req.user.id;

    const approval = await transactionApprovalModel.getApprovalById(approvalId);
    if (!approval) throw new Error("Approval request not found");

    const newPayload = req.body.payload_json
      ? (typeof req.body.payload_json === "string"
          ? JSON.parse(req.body.payload_json)
          : JSON.parse(JSON.stringify(req.body.payload_json)))
      : JSON.parse(JSON.stringify(approval.payload_json));

    const oldPayload = JSON.parse(JSON.stringify(approval.payload_json));

    validateApprover(approval, userId);
    await transactionApprovalModel.completeApprovalNotification(connection, approvalId, userId);

    let nextApprover = null;
    let nextLevel = null;
    let employeeMessage = "";
    let approverMessage = "";

    if (req.files?.dispatch_doc_image?.[0]) {
      const uploaded = await uploadFileToMinio(req.files.dispatch_doc_image[0], "txn_creditNote");
      newPayload.dispatch_doc_image = uploaded.object_path;
    }
    if (req.files?.bill_t_image?.[0]) {
      const uploaded = await uploadFileToMinio(req.files.bill_t_image[0], "txn_creditNote");
      newPayload.bill_t_image = uploaded.object_path;
    }

    const isModified = JSON.stringify(oldPayload) !== JSON.stringify(newPayload);
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
    const employeeName = approval.employee_name || approval.created_by_name || "Employee";

    await transactionApprovalModel.createHistory(connection, {
      approval_id: approvalId,
      action: "APPROVED",
      action_by: userId,
      action_level: approval.approval_level,
      remarks,
    });

    if (approval.approval_level === "JUNIOR") {
      if (approval.dispatcher_id) {
        /* JUNIOR -> DISPATCHER (4-step flow) */
        nextApprover = approval.dispatcher_id;
        nextLevel = "DISPATCHER";
        employeeMessage = `Credit Note approved by ${approval.junior_name} (Junior Accountant). Pending at ${approval.dispatcher_name} (Dispatcher).`;
        approverMessage = `Credit Note approved by Junior Accountant (${approval.junior_name}), requested by ${employeeName}. Pending for your approval.`;

        await transactionApprovalModel.updateApproval(connection, approvalId, {
          ...modificationData,
          current_approver_id: nextApprover,
          approval_level: nextLevel,
          status: "PENDING",
          remarks,
          current_status_message: "Pending at Dispatcher",
        });
      } else {
        /* JUNIOR -> SENIOR directly (3-step flow, dispatcher skipped) */
        nextApprover = approval.senior_accountant_id;
        nextLevel = "SENIOR";
        employeeMessage = `Credit Note approved by ${approval.junior_name} (Junior Accountant). Pending at ${approval.senior_name}.`;
        approverMessage = `Credit Note approved by Junior Accountant (${approval.junior_name}), requested by ${employeeName}. Pending for your approval.`;

        await transactionApprovalModel.updateApproval(connection, approvalId, {
          ...modificationData,
          current_approver_id: nextApprover,
          approval_level: nextLevel,
          status: "PENDING",
          remarks,
          current_status_message: "Pending at Senior Accountant",
        });
      }
      await transactionApprovalModel.updateStatusNotification(connection, approvalId, employeeMessage);
    } else if (approval.approval_level === "DISPATCHER") {
      nextApprover = approval.senior_accountant_id;
      nextLevel = "SENIOR";
      employeeMessage = `Credit Note approved by ${approval.dispatcher_name} (Dispatcher). Pending at ${approval.senior_name}.`;
      approverMessage = `Credit Note approved by Dispatcher (${approval.dispatcher_name}), requested by ${employeeName}. Pending for your approval.`;

      await transactionApprovalModel.updateApproval(connection, approvalId, {
        ...modificationData,
        current_approver_id: nextApprover,
        approval_level: nextLevel,
        status: "PENDING",
        remarks,
        current_status_message: "Pending at Senior Accountant",
      });
      await transactionApprovalModel.updateStatusNotification(connection, approvalId, employeeMessage);
    } else if (approval.approval_level === "SENIOR") {
      const result = await creditNoteApprovalService.executeApprovedCreditNote(
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
        current_status_message: `Approved. Credit Note Voucher ${result.voucher_no} generated`,
        approved_at: new Date(),
        final_transaction_id: result.creditNoteId,
      });

      employeeMessage = `Credit Note approved by ${approval.senior_name} (Senior Accountant). Credit Note Voucher ${result.voucher_no} generated successfully.`;
      await transactionApprovalModel.updateStatusNotification(connection, approvalId, employeeMessage);
    }

    if (nextApprover) {
      await transactionApprovalModel.createNotification(connection, {
        user_id: nextApprover,
        approval_id: approvalId,
        module_type: "CREDIT_NOTE",
        notification_category: "APPROVAL",
        title: "Credit Note Approval Pending",
        message: approverMessage,
        generated_by_id: approval.created_by,
        generated_by_name: employeeName,
      });
    }

    await transactionApprovalModel.createNotification(connection, {
      user_id: approval.created_by,
      approval_id: approvalId,
      module_type: "CREDIT_NOTE",
      notification_category: "STATUS",
      title: "Credit Note Status",
      message: employeeMessage,
      generated_by_id: approval.created_by,
      generated_by_name: employeeName,
    });

    await connection.commit();

    return res.status(200).json({ success: true, message: "Approved successfully" });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};