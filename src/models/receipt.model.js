const db = require("../config/db");

exports.createReceipt = async (connection, receiptData) => {
  const {
    voucher_type_id,
    voucher_no,
    receipt_date,
    account_ledger_id,
    employee_under_id,
    total_amount,
    narration,
    attachment,
    created_by,
  } = receiptData;

  const [result] = await connection.query(
    ` INSERT INTO receipts (

            voucher_type_id,
            voucher_no,
            receipt_date,

            account_ledger_id,
            employee_under_id,

            total_amount,

            narration,
            attachment,
            created_by
        )
        VALUES (
            ?,?,?,?,?,?,?,?,?
        )
        `,
    [
      voucher_type_id,
      voucher_no,
      receipt_date,
      account_ledger_id,
      employee_under_id,
      total_amount,
      narration,
      attachment,
      created_by,
    ],
  );

  return result.insertId;
};

exports.insertReceiptEntry = async (connection, receiptId, entry) => {
  const [result] = await connection.query(
    `
        INSERT INTO receipt_entries (

            receipt_id,
            ledger_id,
            amount,

            transaction_type,
            transaction_no,
            bank_name,

            entry_type,
            remarks

        )
        VALUES (
            ?,?,?,?,?,?,?,?
        )
        `,
    [
      receiptId,
      entry.ledger_id,
      entry.amount,

      entry.transaction_type,
      entry.transaction_no || null,
      entry.bank_name || null,

      "Cr",
      entry.remarks || null,
    ],
  );

  return result.insertId;
};

exports.insertReceiptBillReference = async (
  connection,
  receiptId,
  receiptEntryId,
  customerLedgerId,
  bill,
) => {
  await connection.query(
    `
        INSERT INTO receipt_bill_references (

            receipt_id,
            receipt_entry_id,
            customer_ledger_id,
            sales_bill_reference_id,

            reference_type,
            reference_no,
            reference_amount,

            due_date,
            dr_cr

        )
        VALUES (
            ?,?,?,?,?,?,?,?,?
        )
        `,
    [
      receiptId,
      receiptEntryId,
      customerLedgerId,
      bill.sales_bill_reference_id || null,

      bill.reference_type,
      bill.reference_no || null,
      bill.reference_amount,

      bill.due_date || null,
      bill.dr_cr || "Cr",
    ],
  );
};

exports.updateSalesBillPendingAmount = async (
  connection,
  salesBillReferenceId,
  receivedAmount,
) => {
  await connection.query(
    ` UPDATE sales_bill_references
        SET
            pending_amount = pending_amount - ?,

            status =
                CASE
                    WHEN pending_amount - ? <= 0
                    THEN 'RECEIVED'
                    WHEN pending_amount - ? < bill_amount
                    THEN 'PARTIAL'
                    ELSE 'PENDING'
                END

        WHERE id = ?
        `,
    [receivedAmount, receivedAmount, receivedAmount, salesBillReferenceId],
  );
};

exports.getPendingBills = async (ledgerId) => {
  const [rows] = await db.query(
    `
        SELECT

            id,
            reference_no,
            reference_type,

            bill_amount,
            pending_amount,

            due_date

        FROM sales_bill_references

        WHERE ledger_id = ?
        AND pending_amount > 0

        ORDER BY due_date ASC
        `,
    [ledgerId],
  );

  return rows;
};
