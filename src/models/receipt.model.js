const db = require("../config/db");

exports.createReceipt = async (connection, receiptData) => {
  const { voucher_type_id, voucher_no, receipt_date, account_ledger_id, employee_under_id,
    total_amount, narration, attachment, created_by, } = receiptData;

  const [result] = await connection.query(
    ` INSERT INTO receipts (
            voucher_type_id, voucher_no, receipt_date,
            account_ledger_id, employee_under_id,
            total_amount,
            narration, attachment, created_by
        )
        VALUES ( ?,?,?,?,?,?,?,?,? ) `,
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
    ` INSERT INTO receipt_entries (
            receipt_id,
            ledger_id,
            amount,
            transaction_type,
            transaction_no,
            bank_name,
            entry_type,
            remarks )
        VALUES ( ?,?,?,?,?,?,?,? ) `,
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

exports.insertReceiptBillReference = async (connection, receiptId, receiptEntryId, customerLedgerId, bill,) => {
  await connection.query(
    ` INSERT INTO receipt_bill_references (
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
        VALUES ( ?,?,?,?,?,?,?,?,? ) `,
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

exports.updateSalesBillPendingAmount = async (connection, salesBillReferenceId, receivedAmount,) => {
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

        WHERE id = ? `,
    [receivedAmount, receivedAmount, receivedAmount, salesBillReferenceId],
  );
};

exports.getPendingBills = async (ledgerId) => {
  const [rows] = await db.query(
    ` SELECT
            id, reference_no, reference_type,
            bill_amount, pending_amount,
            due_date

        FROM sales_bill_references

        WHERE ledger_id = ?
        AND pending_amount > 0

        ORDER BY due_date ASC `,
    [ledgerId],
  );

  return rows;
};

exports.getReceiptInvoice = async (receiptId) => {
  // Receipt Master

  const [receiptRows] = await db.query(
    ` SELECT
        r.*,
        accountLedger.ledger_name AS account_ledger_name,
        accountLedger.gst_no AS account_gst_no,
        employee.name AS employee_under_name,
        creator.name AS created_by_name

    FROM receipts r
    LEFT JOIN ledgers accountLedger ON accountLedger.id = r.account_ledger_id
    LEFT JOIN users employee ON employee.id = r.employee_under_id
    LEFT JOIN users creator ON creator.id = r.created_by

    WHERE r.id = ?
    `,
    [receiptId],
  );

  if (!receiptRows.length) {
    return null;
  }

  const receipt = receiptRows[0];

  // Receipt Entries

  const [entries] = await db.query(
    ` SELECT re.*,

        l.ledger_name,
        l.gst_no

    FROM receipt_entries re
    LEFT JOIN ledgers l ON l.id = re.ledger_id
    WHERE re.receipt_id = ?
    ORDER BY re.id ASC `,
    [receiptId],
  );

  // Bill References

  const [billReferences] = await db.query(
    ` SELECT
        rb.*,
        sbr.bill_amount,
        sbr.pending_amount

    FROM receipt_bill_references rb

    LEFT JOIN sales_bill_references sbr
        ON sbr.id = rb.sales_bill_reference_id

    WHERE rb.receipt_id = ?
    ORDER BY rb.id ASC
    `,
    [receiptId],
  );

  return { receipt, entries, billReferences, };
};

const getPendingSalesBills = async (connection, ledgerId) => {
  const [rows] = await connection.query(
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
    ORDER BY
      CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
      due_date ASC,
      id ASC
    FOR UPDATE
    `,
    [ledgerId]
  );

  return rows;
};

const applyAmountToSalesBill = async (connection, salesBillReferenceId, amount) => {
  await connection.query(
    `
    UPDATE sales_bill_references
    SET
      pending_amount = GREATEST(pending_amount - ?, 0),
      status = CASE
        WHEN pending_amount - ? <= 0 THEN 'RECEIVED'
        WHEN pending_amount - ? < bill_amount THEN 'PARTIAL'
        ELSE 'PENDING'
      END
    WHERE id = ?
    `,
    [amount, amount, amount, salesBillReferenceId]
  );
};
exports.allocateReceiptAgainstSelectedBills = async (
  connection,
  {
    receiptId,
    receiptEntryId,
    customerLedgerId,
    billReferences,
  }
) => {
  if (!Array.isArray(billReferences) || billReferences.length === 0) {
    return [];
  }

  const ids = billReferences
    .map((b) => Number(b.sales_bill_reference_id))
    .filter(Boolean);

  if (ids.length === 0) {
    return [];
  }

  const [dbBills] = await connection.query(
    ` SELECT id, reference_no, pending_amount, due_date
    FROM sales_bill_references
    WHERE ledger_id = ? AND id IN (${ids.map(() => "?").join(",")})
    FOR UPDATE `,
    [customerLedgerId, ...ids]
  );

  const billMap = new Map(dbBills.map((b) => [Number(b.id), b]));
  const allocations = [];

  for (const inputBill of billReferences) {
    const billId = Number(inputBill.sales_bill_reference_id);
    const dbBill = billMap.get(billId);

    if (!dbBill) {
      throw new Error(`Sales bill not found: ${billId}`);
    }

    // const requested = Number(inputBill.reference_amount || 0);
    // const pending = Number(dbBill.pending_amount || 0);
    // const applied = Math.min(requested, pending);

    // if (applied <= 0) continue;
    const requested = Number(inputBill.reference_amount || 0);
const pending = Number(dbBill.pending_amount || 0);

if (requested > pending) {
  throw new Error(
    `Allocated amount exceeds pending amount for bill ${dbBill.reference_no}`
  );
}

if (requested <= 0) continue;

    await connection.query(
      `
      INSERT INTO receipt_bill_references (
        receipt_id, receipt_entry_id, customer_ledger_id,
        sales_bill_reference_id, reference_type, reference_no,
        reference_amount, due_date, dr_cr
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        receiptId,
        receiptEntryId,
        customerLedgerId,
        dbBill.id,
        "AGST REF",
        dbBill.reference_no,
        // applied,
        requested,
        dbBill.due_date || null,
        "Cr",
      ]
    );

    await applyAmountToSalesBill(connection, dbBill.id, requested);
    allocations.push({
      bill_id: dbBill.id,
      applied_amount: requested,
    });
  }

  return allocations;
};

// exports.allocateReceiptAgainstBills = async (
//   connection,
//   {
//     receiptId,
//     receiptEntryId,
//     customerLedgerId,
//     receiptAmount,
//   }
// ) => {
//   let remaining = Number(receiptAmount || 0);
//   const allocations = [];

//   if (remaining <= 0) {
//     return { allocations, unallocatedAmount: 0 };
//   }

//   const bills = await getPendingSalesBills(connection, customerLedgerId);

//   for (const bill of bills) {
//     if (remaining <= 0) break;

//     const billPending = Number(bill.pending_amount || 0);
//     if (billPending <= 0) continue;

//     const appliedAmount = Math.min(remaining, billPending);

//     await connection.query(
//       `
//       INSERT INTO receipt_bill_references (
//         receipt_id,
//         receipt_entry_id,
//         customer_ledger_id,
//         sales_bill_reference_id,
//         reference_type,
//         reference_no,
//         reference_amount,
//         due_date,
//         dr_cr
//       )
//       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
//       `,
//       [
//         receiptId,
//         receiptEntryId,
//         customerLedgerId,
//         bill.id,
//         "AGAINST REF",
//         bill.reference_no,
//         appliedAmount,
//         bill.due_date || null,
//         "Cr",
//       ]
//     );

//     await applyAmountToSalesBill(connection, bill.id, appliedAmount);

//     allocations.push({
//       sales_bill_reference_id: bill.id,
//       reference_no: bill.reference_no,
//       applied_amount: appliedAmount,
//     });

//     remaining -= appliedAmount;
//   }

//   return {
//     allocations,
//     unallocatedAmount: remaining,
//   };
// };