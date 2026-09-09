const db = require("../config/db");

exports.getPaymentAccountDropdown = async () => {

    const [rows] = await db.query(` SELECT
            l.id,
            l.ledger_name
        FROM ledgers l
        INNER JOIN account_groups ag
            ON ag.id = l.group_id
        WHERE ag.group_name IN (
            'Bank Account',
            'Cash-in-Hand'
        )
        ORDER BY l.ledger_name ASC `);

    return rows;
};

exports.createPayment = async ( connection, paymentData ) => {

    const { voucher_type_id, voucher_no, payment_date, account_ledger_id, employee_under_id, total_amount, narration, attachment, created_by } = paymentData;

    const [result] = await connection.query(
        ` INSERT INTO payments (
            voucher_type_id, voucher_no, payment_date,
            account_ledger_id, employee_under_id,
            total_amount,
            narration, attachment, created_by
        )
        VALUES ( ?,?,?,?,?,?,?,?,? ) `,
        [
            voucher_type_id,
            voucher_no,
            payment_date,
            account_ledger_id,
            employee_under_id,
            total_amount,
            narration,
            attachment,
            created_by
        ]
    );

    return result.insertId;
};

exports.insertPaymentEntry = async ( connection, paymentId, entry ) => {
    const [result] = await connection.query(
        ` INSERT INTO payment_entries (
            payment_id, ledger_id, amount,
            transaction_type, transaction_no, bank_name,
            entry_type, remarks
        )
        VALUES ( ?,?,?,?,?,?,?,? ) `,
        [
            paymentId,
            entry.ledger_id,
            entry.amount,
            entry.transaction_type,
            entry.transaction_no || null,
            entry.bank_name || null,
            "Dr",
            entry.remarks || null
        ]
    );

    return result.insertId;
};


exports.insertBillReference = async (connection, paymentId, paymentEntryId, supplierLedgerId, bill) => {
  await connection.query(
    ` INSERT INTO payment_bill_references (
      payment_id,
      payment_entry_id,
      supplier_ledger_id,
      purchase_bill_reference_id,
      reference_type,
      reference_no,
      reference_amount,
      due_date,
      dr_cr
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      paymentId,
      paymentEntryId,
      supplierLedgerId,
      bill.purchase_bill_reference_id || null,
      bill.reference_type,
      bill.reference_no || null,
      bill.reference_amount,
      bill.due_date || null,
      bill.dr_cr || "Dr",
    ]
  );
};

exports.insertLedgerTransaction = async ( connection, data ) => {

    await connection.query(
        ` INSERT INTO ledger_transactions (
            transaction_type, reference_id,
            voucher_no, voucher_type_id, transaction_date,
            ledger_id, entry_type, amount,
            remarks, created_by
        )
        VALUES ( ?,?,?,?,?,?,?,?,?,? ) `,
        [
            data.transaction_type,
            data.reference_id,
            data.voucher_no,
            data.voucher_type_id,
            data.transaction_date,

            data.ledger_id,
            data.entry_type,
            data.amount,

            data.remarks,
            data.created_by
        ]
    );
};



exports.getBillReferences = async (ledgerId) => {
    const [rows] = await db.query(
        ` SELECT
            pbr.id, pbr.reference_no, pbr.reference_type,
            pbr.bill_amount, pbr.pending_amount,
            pbr.due_date, pbr.status,
            p.purchase_date

        FROM purchase_bill_references pbr

        INNER JOIN purchases p ON p.id = pbr.purchase_id

        WHERE pbr.ledger_id = ?
        AND pbr.pending_amount > 0

        ORDER BY p.purchase_date ASC
        `,
        [ledgerId]
    );

    return rows;
};

// exports.updatePurchaseBillPendingAmount = async ( connection, referenceNo, paidAmount ) => {
//     await connection.query(
//         ` UPDATE purchase_bill_references SET pending_amount = pending_amount - ?,
//             status =
//                 CASE
//                     WHEN pending_amount - ? <= 0
//                     THEN 'PAID'
//                     WHEN pending_amount - ? < bill_amount
//                     THEN 'PARTIAL'
//                     ELSE 'PENDING'
//                 END
//         WHERE reference_no = ? `,
//         [ paidAmount, paidAmount, paidAmount, referenceNo ]
//     );
// };

exports.updatePurchaseBillPendingAmountById = async (connection, purchaseBillReferenceId, paidAmount) => {
  await connection.query(
    `
    UPDATE purchase_bill_references
    SET
      pending_amount = GREATEST(pending_amount - ?, 0),
      status = CASE
        WHEN pending_amount - ? <= 0 THEN 'PAID'
        WHEN pending_amount - ? < bill_amount THEN 'PARTIAL'
        ELSE 'PENDING'
      END
    WHERE id = ?
    `,
    [paidAmount, paidAmount, paidAmount, purchaseBillReferenceId]
  );
};

exports.getPaymentVoucher = async ( paymentId ) => {

    const [paymentRows] = await db.query(
        `  SELECT
            p.id, p.voucher_type_id, p.voucher_no, p.payment_date,
            p.account_ledger_id, p.employee_under_id,
            p.total_amount, p.narration, p.attachment,
            accountLedger.ledger_name AS account_ledger_name,
            u.name AS employee_under_name

        FROM payments p
        LEFT JOIN ledgers accountLedger ON accountLedger.id = p.account_ledger_id
        LEFT JOIN users u ON u.id = p.employee_under_id
        WHERE p.id = ? `,
        [paymentId]
    );

    if (!paymentRows.length) {
        return null;
    }

    const payment = paymentRows[0];

    const [entries] = await db.query(
        ` SELECT
            pe.id, pe.ledger_id,
            l.ledger_name,
            pe.amount, pe.transaction_type, pe.transaction_no, pe.bank_name,
            pe.entry_type, pe.remarks

        FROM payment_entries pe
        LEFT JOIN ledgers l ON l.id = pe.ledger_id

        WHERE pe.payment_id = ?
        ORDER BY pe.id ASC
        `, [paymentId]
    );

    const [billReferences] = await db.query(
        `  SELECT
            pbr.id,
            pbr.payment_entry_id,
            pbr.supplier_ledger_id,
            pbr.purchase_bill_reference_id,
            supplier.ledger_name AS supplier_name,
            pbr.reference_type,
            pbr.reference_no,
            pbr.reference_amount,
            pbr.due_date,
            pbr.dr_cr

        FROM payment_bill_references pbr

        LEFT JOIN ledgers supplier ON supplier.id = pbr.supplier_ledger_id
        WHERE pbr.payment_id = ?
        ORDER BY pbr.id ASC `,
        [paymentId]
    );

    return { payment, entries, billReferences };
};

const getPendingPurchaseBills = async (connection, ledgerId) => {
  const [rows] = await connection.query(
    `
    SELECT id, reference_no, reference_type, bill_amount, pending_amount, due_date
    FROM purchase_bill_references
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

exports.allocatePaymentAgainstSelectedBills = async (
  connection,
  {
    paymentId,
    paymentEntryId,
    supplierLedgerId,
    billReferences,
  }
) => {
  if (!Array.isArray(billReferences) || billReferences.length === 0) {
    return [];
  }

  const ids = billReferences
    .map((b) => Number(b.purchase_bill_reference_id))
    .filter(Boolean);

  if (ids.length === 0) {
    return [];
  }

  const [dbBills] = await connection.query(
    `
    SELECT id, reference_no, pending_amount, due_date
    FROM purchase_bill_references
    WHERE ledger_id = ?
      AND id IN (${ids.map(() => "?").join(",")})
    FOR UPDATE
    `,
    [supplierLedgerId, ...ids]
  );

  const billMap = new Map(dbBills.map((b) => [Number(b.id), b]));
  const allocations = [];

  for (const inputBill of billReferences) {
    const billId = Number(inputBill.purchase_bill_reference_id);
    const dbBill = billMap.get(billId);

    if (!dbBill) {
      throw new Error(`Purchase bill not found: ${billId}`);
    }

    const requested = Number(inputBill.reference_amount || 0);
    const pending = Number(dbBill.pending_amount || 0);

    if (requested > pending) {
      throw new Error(
        `Allocated amount exceeds pending amount for bill ${dbBill.reference_no}`
      );
    }

    if (requested <= 0) continue;

    await connection.query(
      ` INSERT INTO payment_bill_references (
        payment_id,
        payment_entry_id,
        supplier_ledger_id,
        purchase_bill_reference_id,
        reference_type,
        reference_no,
        reference_amount,
        due_date,
        dr_cr
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) `,
      [
        paymentId,
        paymentEntryId,
        supplierLedgerId,
        dbBill.id,
        "AGST REF",
        dbBill.reference_no,
        requested,
        dbBill.due_date || null,
        "Dr",
      ]
    );

    await connection.query(
      ` UPDATE purchase_bill_references
      SET
        pending_amount = GREATEST(pending_amount - ?, 0),
        status = CASE
          WHEN pending_amount - ? <= 0 THEN 'PAID'
          WHEN pending_amount - ? < bill_amount THEN 'PARTIAL'
          ELSE 'PENDING'
        END
      WHERE id = ? `,
      [requested, requested, requested, dbBill.id]
    );

    allocations.push({
      bill_id: dbBill.id,
      applied_amount: requested,
    });
  }

  return allocations;
};