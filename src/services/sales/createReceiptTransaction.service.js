const receiptModel = require("../../models/receipt.model");
const paymentModal = require("../../models/payment.model");
const generateVoucherNo = require("../../utils/generateVoucherNo");
const validateVoucherDate = require("../../utils/validateVoucherDate");

exports.executeApprovedReceipt = async (connection, payload, createdBy) => {
  await validateVoucherDate(connection, "RECEIPT", payload.receipt_date);

  const voucherData = await generateVoucherNo("RECEIPT");
  const { voucher_no, voucher_type_id, nextSequence } = voucherData;

  const receiptData = {
    ...payload,
    voucher_no,
    voucher_type_id,
    created_by: createdBy,
  };

  const receiptId = await receiptModel.createReceipt(connection, receiptData);

  const entries = payload.entries || [];

  for (const entry of entries) {
    const receiptEntryId = await receiptModel.insertReceiptEntry(
      connection,
      receiptId,
      entry,
    );

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
      created_by: createdBy,
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

        if (bill.reference_type === "AGST REF" && bill.sales_bill_reference_id) {
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
    created_by: createdBy,
  });

  await connection.query(
    `UPDATE voucher_types SET current_sequence = ? WHERE id = ?`,
    [nextSequence, voucher_type_id],
  );

  return { receiptId, voucher_no };
};