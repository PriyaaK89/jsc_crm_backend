const db = require("../config/db");
const receiptModel = require("../models/receipt.model");
const { uploadFileToMinio } = require("../utils/fileUpload");
const paymentModal = require("../models/payment.model");
const generateVoucherNo = require("../utils/generateVoucherNo");

exports.createReceipt = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const voucherData = await generateVoucherNo("RECEIPT");

    const { voucher_no, voucher_type_id, nextSequence } = voucherData;

    let receiptData = {
      ...req.body,
      voucher_no,
      voucher_type_id,
      entries: JSON.parse(req.body.entries || "[]"),
    };

    let attachment = null;

    if (req.file) {
      const uploadedFile = await uploadFileToMinio(req.file, "txn_receipt");

      attachment = uploadedFile.object_path;
    }

    receiptData.attachment = attachment;

    const { entries } = receiptData;

    const receiptId = await receiptModel.createReceipt(connection, receiptData);

    for (const entry of entries) {
      const receiptEntryId = await receiptModel.insertReceiptEntry(
        connection,
        receiptId,
        entry,
      );

      /*  Customer Ledger Cr */

      await paymentModal.insertLedgerTransaction(connection, {
        transaction_type: "RECEIPT",
        reference_id: receiptId,
        voucher_no: receiptData.voucher_no,
        voucher_type_id: receiptData.voucher_type_id,
        transaction_date: receiptData.receipt_date,
        ledger_id: entry.ledger_id,
        entry_type: "Cr",
        amount: entry.amount,
        remarks: receiptData.narration,
        created_by: receiptData.created_by,
      });

      if (entry.bill_references && entry.bill_references.length) {
        for (const bill of entry.bill_references) {
          await receiptModel.insertReceiptBillReference(
            connection,
            receiptId,
            receiptEntryId,
            entry.ledger_id,
            bill,
          );

          if (
            bill.reference_type === "AGST REF" &&
            bill.sales_bill_reference_id
          ) {
            await receiptModel.updateSalesBillPendingAmount(
              connection,
              bill.sales_bill_reference_id,
              bill.reference_amount,
            );
          }
        }
      }
    }

    await paymentModal.insertLedgerTransaction(connection, {
      transaction_type: "RECEIPT",

      reference_id: receiptId,

      voucher_no: receiptData.voucher_no,
      voucher_type_id: receiptData.voucher_type_id,
      transaction_date: receiptData.receipt_date,
      ledger_id: receiptData.account_ledger_id,
      entry_type: "Dr",
      amount: receiptData.total_amount,
      remarks: receiptData.narration,
      created_by: receiptData.created_by,
    });
    await connection.query(
  `
  UPDATE voucher_types
  SET current_sequence = ?
  WHERE id = ?
  `,
  [nextSequence, voucher_type_id]
);
    await connection.commit();
    res.status(201).json({
      success: true,
      message: "Receipt created successfully",
    });
  } 
  catch (error) {
  console.log("FULL ERROR =>", error);
  console.log(error.stack);

  await connection.rollback();

  res.status(500).json({
    success: false,
    message: error.message,
  });
} finally {
    connection.release();
  }
};

exports.getPendingBills = async (req, res) => {
  try {
    const { ledgerId } = req.params;
    const data = await receiptModel.getPendingBills(ledgerId);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
