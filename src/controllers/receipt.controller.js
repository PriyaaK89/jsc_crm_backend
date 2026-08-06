const db = require("../config/db");
const receiptModel = require("../models/receipt.model");
const { uploadFileToMinio } = require("../utils/fileUpload");
const paymentModal = require("../models/payment.model");
const generateVoucherNo = require("../utils/generateVoucherNo");
const validateVoucherDate = require("../utils/validateVoucherDate");

exports.createReceipt = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const data = {
      ...req.body,
      entries: JSON.parse(req.body.entries || "[]"),
    };

    await validateVoucherDate(connection, "RECEIPT", data.receipt_date);

    const voucherData = await generateVoucherNo("RECEIPT");
    const { voucher_no, voucher_type_id, nextSequence } = voucherData;

    let attachment = null;
    if (req.file) {
      const uploadedFile = await uploadFileToMinio(req.file, "txn_receipt");
      attachment = uploadedFile.object_path;
    }

    const receiptId = await receiptModel.createReceipt(connection, {
      ...data,
      voucher_no,
      voucher_type_id,
      attachment,
      created_by: req.user.id,
    });

    for (const entry of data.entries) {
      const receiptEntryId = await receiptModel.insertReceiptEntry(
        connection,
        receiptId,
        entry
      );

      // 1) Ledger transaction for the receipt entry
      await paymentModal.insertLedgerTransaction(connection, {
        transaction_type: "RECEIPT",
        reference_id: receiptId,
        voucher_no,
        voucher_type_id,
        transaction_date: data.receipt_date,
        ledger_id: entry.ledger_id,
        entry_type: "Cr",
        amount: Number(entry.amount),
        remarks: data.narration,
        created_by: req.user.id,
      });

      const billRefs = Array.isArray(entry.bill_references) ? entry.bill_references : [];

      if (billRefs.length > 0) {
        const agstRefs = billRefs.filter(
          (b) => b.reference_type === "AGST REF" && b.sales_bill_reference_id
        );

        const otherRefs = billRefs.filter(
          (b) => b.reference_type !== "AGST REF"
        );

        // 2) AGST REF: deduct from selected sales bills
        if (agstRefs.length > 0) {
          await receiptModel.allocateReceiptAgainstSelectedBills(connection, {
            receiptId,
            receiptEntryId,
            customerLedgerId: entry.ledger_id,
            billReferences: agstRefs,
          });
        }

        // 3) Non-AGST rows: save only, no deduction from sales pending amount
        for (const bill of otherRefs) {
          await receiptModel.insertReceiptBillReference(
            connection,
            receiptId,
            receiptEntryId,
            entry.ledger_id,
            bill
          );
        }
      }
    }

    await paymentModal.insertLedgerTransaction(connection, {
      transaction_type: "RECEIPT",
      reference_id: receiptId,
      voucher_no,
      voucher_type_id,
      transaction_date: data.receipt_date,
      ledger_id: data.account_ledger_id,
      entry_type: "Dr",
      amount: Number(data.total_amount),
      remarks: data.narration,
      created_by: req.user.id,
    });

    await connection.query(
      `UPDATE voucher_types SET current_sequence = ? WHERE id = ?`,
      [nextSequence, voucher_type_id]
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Receipt created successfully",
      receipt_id: receiptId,
      voucher_no,
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

exports.getReceiptInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const receipt = await receiptModel.getReceiptInvoice(id);

    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: "Receipt not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: receipt,
    });
  } catch (error) {
    console.error("Get Receipt Invoice Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// exports.createReceipt = async (req, res) => {
//   const connection = await db.getConnection();

//   try {
//     await connection.beginTransaction();
//     const { receipt_date } = req.body;
//     await validateVoucherDate( connection, "RECEIPT", receipt_date );

//     const voucherData = await generateVoucherNo("RECEIPT");

//     const { voucher_no, voucher_type_id, nextSequence } = voucherData;

//     let receiptData = {
//       ...req.body,
//       voucher_no,
//       voucher_type_id,
//       entries: JSON.parse(req.body.entries || "[]"),
//     };

//     let attachment = null;

//     if (req.file) {
//       const uploadedFile = await uploadFileToMinio(req.file, "txn_receipt");
//       attachment = uploadedFile.object_path;
//     }

//     receiptData.attachment = attachment;

//     const { entries } = receiptData;
//     const receiptId = await receiptModel.createReceipt(connection, receiptData);

//     for (const entry of entries) {
//       const receiptEntryId = await receiptModel.insertReceiptEntry( connection, receiptId, entry, );

//       /*  Customer Ledger Cr */

//       await paymentModal.insertLedgerTransaction(connection, {
//         transaction_type: "RECEIPT",
//         reference_id: receiptId,
//         voucher_no: receiptData.voucher_no,
//         voucher_type_id: receiptData.voucher_type_id,
//         transaction_date: receiptData.receipt_date,
//         ledger_id: entry.ledger_id,
//         entry_type: "Cr",
//         amount: entry.amount,
//         remarks: receiptData.narration,
//         created_by: receiptData.created_by,
//       });

//       if (entry.bill_references && entry.bill_references.length) {
//         for (const bill of entry.bill_references) {
//           await receiptModel.insertReceiptBillReference(
//             connection,
//             receiptId,
//             receiptEntryId,
//             entry.ledger_id,
//             bill,
//           );

//           if ( bill.reference_type === "AGST REF" && bill.sales_bill_reference_id ) {
//             await receiptModel.updateSalesBillPendingAmount(
//               connection,
//               bill.sales_bill_reference_id,
//               bill.reference_amount,
//             );
//           }
//         }
//       }
//     }

//     await paymentModal.insertLedgerTransaction(connection, {
//       transaction_type: "RECEIPT",
//       reference_id: receiptId,
//       voucher_no: receiptData.voucher_no,
//       voucher_type_id: receiptData.voucher_type_id,
//       transaction_date: receiptData.receipt_date,
//       ledger_id: receiptData.account_ledger_id,
//       entry_type: "Dr",
//       amount: receiptData.total_amount,
//       remarks: receiptData.narration,
//       created_by: receiptData.created_by,
//     });
//     await connection.query(
//   ` UPDATE voucher_types SET current_sequence = ? WHERE id = ? `,
//   [nextSequence, voucher_type_id]
// );
//     await connection.commit();
//     res.status(201).json({
//       success: true,
//       message: "Receipt created successfully",
//     });
//   } 
//   catch (error) {
//   console.log("FULL ERROR =>", error);
//   console.log(error.stack);

//   await connection.rollback();

//   res.status(500).json({
//     success: false,
//     message: error.message,
//   });
// } finally {
//     connection.release();
//   }
// };
