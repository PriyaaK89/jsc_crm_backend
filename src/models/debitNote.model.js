const db = require("../config/db");

exports.getSupplierDropdown = async () => {
  const [rows] = await db.query(`
      SELECT
          l.id,
          l.ledger_name
      FROM ledgers l
      INNER JOIN account_groups ag
          ON ag.id = l.group_id
      WHERE ag.group_name = 'Sundry Creditors'
      ORDER BY l.ledger_name ASC
  `);

  return rows;
};

exports.getPurchaseReturnLedgerDropdown = async () => {
  const [rows] = await db.query(`
      SELECT
          l.id,
          l.ledger_name
      FROM ledgers l
      INNER JOIN account_groups ag
          ON ag.id = l.group_id
      WHERE ag.group_name = 'Purchase Account'
      ORDER BY l.ledger_name ASC
  `);

  return rows;
};

exports.createDebitNote = async (connection, debitNoteData) => {
  const {
    voucher_type_id,
    voucher_no,
    debit_note_date,
    original_purchase_id,
    supplier_ledger_id,
    purchase_return_ledger_id,
    assign_employee_id,
    employee_under_id,

    dispatch_doc_no,
    transport_name,
    destination,
    bill_t_no,
    vehicle_no,
    transport_freight,

    eway_number,
    transporter_gst,
    delivery_place,

    subtotal,

    igst_total,
    cgst_total,
    sgst_total,

    tax_total,
    total_amount,

    narration,

    created_by,
  } = debitNoteData;

  const [result] = await connection.query(
    `
    INSERT INTO debit_notes (

      voucher_type_id,
      voucher_no,
      debit_note_date,

      original_purchase_id,

      supplier_ledger_id,
      purchase_return_ledger_id,

      assign_employee_id,
      employee_under_id,

      dispatch_doc_no,
      transport_name,
      destination,

      bill_t_no,
      vehicle_no,

      transport_freight,

      eway_number,
      transporter_gst,
      delivery_place,

      subtotal,

      igst_total,
      cgst_total,
      sgst_total,

      tax_total,
      total_amount,

      narration,

      created_by

    )
    VALUES (
      ?,?,?,
      ?,
      ?,?,
      ?,?,
      ?,?,?,
      ?,?,
      ?,
      ?,?,?,
      ?,
      ?,?,?,
      ?,?,
      ?,
      ?
    )
    `,
    [
      voucher_type_id,
      voucher_no,
      debit_note_date,

      original_purchase_id,

      supplier_ledger_id,
      purchase_return_ledger_id,

      assign_employee_id,
      employee_under_id,

      dispatch_doc_no,
      transport_name,
      destination,

      bill_t_no,
      vehicle_no,

      transport_freight,

      eway_number,
      transporter_gst,
      delivery_place,

      subtotal,

      igst_total,
      cgst_total,
      sgst_total,

      tax_total,
      total_amount,

      narration,

      created_by,
    ],
  );

  return result.insertId;
};

exports.insertDebitNoteItem = async (connection, item, debitNoteId) => {
  const [result] = await connection.query(
    `
    INSERT INTO debit_note_items (

      debit_note_id,

      stock_item_id,
      godown_id,
      batch_no,

      available_qty,
      return_qty,

      rate,

      unit_id,
      alt_unit_id,
      alt_unit_qty,

      amount,

      igst_percent,
      igst_amount,

      cgst_percent,
      cgst_amount,

      sgst_percent,
      sgst_amount,

      total_amount

    )
    VALUES (
      ?,
      ?,?,?,
      ?,?,
      ?,
      ?,?,?,
      ?,
      ?,?,
      ?,?,
      ?,?,
      ?
    )
    `,
    [
      debitNoteId,
      item.stock_item_id,
      item.godown_id,
      item.batch_no,
      item.available_qty,
      item.return_qty,
      item.rate,
      item.unit_id,
      item.alt_unit_id,
      item.alt_unit_qty,

      item.amount,

      item.igst_percent,
      item.igst_amount,

      item.cgst_percent,
      item.cgst_amount,

      item.sgst_percent,
      item.sgst_amount,

      item.total_amount,
    ],
  );

  return result.insertId;
};

exports.insertDebitNoteStockTransaction = async (
  connection,
  item,
  debitNoteId,
  debitNoteDate,
  createdBy,
) => {
  await connection.query(
    `
    INSERT INTO stock_transactions (

      transaction_type,
      reference_type,
      reference_id,
      transaction_date,

      stock_item_id,
      godown_id,
      batch_no,

      unit_id,

      qty_in,
      qty_out,

      rate,
      amount,

      created_by

    )
    VALUES (

      'PURCHASE_RETURN',
      'DEBIT_NOTE',

      ?,

      ?,

      ?,
      ?,
      ?,

      ?,

      0,
      ?,

      ?,
      ?,

      ?
    )
    `,
    [
      debitNoteId,
      debitNoteDate,

      item.stock_item_id,
      item.godown_id,
      item.batch_no,

      item.unit_id,

      item.return_qty,

      item.rate,
      item.total_amount,

      createdBy,
    ],
  );
};

exports.insertLedgerTransaction = async (connection, data) => {
  await connection.query(
    `
    INSERT INTO ledger_transactions (

      transaction_type,
      reference_id,
      voucher_no,
      voucher_type_id,
      transaction_date,
      ledger_id,
      entry_type,
      amount,
      remarks,
      created_by

    )
    VALUES (
      ?,?,?,?,?,?,
      ?,?,?,?
    )
    `,
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
      data.created_by,
    ],
  );
};

exports.insertDebitNoteBillReference = async (connection, data) => {
  const [result] = await connection.query(
    `
    INSERT INTO debit_note_bill_references (

      debit_note_id,
      supplier_ledger_id,
      purchase_bill_reference_id,
      amount

    )
    VALUES (
      ?,?,?,?
    )
    `,
    [
      data.debit_note_id,
      data.supplier_ledger_id,
      data.purchase_bill_reference_id,
      data.amount,
    ],
  );

  return result.insertId;
};

exports.updatePurchaseBillReference = async (
  connection,
  purchaseBillReferenceId,
  amount,
) => {
  const [rows] = await connection.query(
    ` SELECT
      pending_amount
    FROM purchase_bill_references
    WHERE id = ?  `,
    [purchaseBillReferenceId],
  );

  if (!rows.length) {
    throw new Error("Purchase bill reference not found");
  }

  const currentPending = Number(rows[0].pending_amount);
  const newPending = currentPending - Number(amount);

  let status = "PARTIAL";

  if (newPending <= 0) {
    status = "PAID";
  }

  await connection.query(
    ` UPDATE purchase_bill_references
    SET
      pending_amount = ?,
      status = ?
    WHERE id = ? `,
    [Math.max(newPending, 0), status, purchaseBillReferenceId],
  );
};

exports.getPurchasesBySupplier = async (supplierLedgerId) => {
  const [rows] = await db.query(
    ` SELECT
      p.id,
      p.voucher_no,
      p.purchase_date,
      p.total_amount
    FROM purchases p
    WHERE p.supplier_ledger_id = ?
      AND p.status = 'ACTIVE'
    ORDER BY p.purchase_date DESC `,
    [supplierLedgerId],
  );

  return rows;
};

exports.getPurchasedQtyByInvoice = async (
  connection,
  purchaseId,
  stockItemId,
  godownId,
  batchNo
) => {

  const [rows] = await connection.query(
    `
    SELECT
      COALESCE(SUM(pib.qty),0) AS purchased_qty
    FROM purchase_item_batches pib
    INNER JOIN purchase_items pi
      ON pi.id = pib.purchase_item_id
    WHERE pi.purchase_id = ?
      AND pib.stock_item_id = ?
      AND pib.godown_id = ?
      AND (
        ? = 'NOT_APPLICABLE'
        OR pib.batch_no = ?
      )
    `,
    [
      purchaseId,
      stockItemId,
      godownId,
      batchNo,
      batchNo
    ]
  );

  return Number(rows[0].purchased_qty || 0);
};

// exports.getPurchasedQtyByInvoice = async (
//   connection,
//   purchaseId,
//   stockItemId,
//   godownId,
//   batchNo
// ) => {

//   const [rows] = await connection.query(
//     `
//     SELECT
//       COALESCE(SUM(pib.qty),0) AS purchased_qty
//     FROM purchase_item_batches pib
//     INNER JOIN purchase_items pi
//       ON pi.id = pib.purchase_item_id
//     WHERE pi.purchase_id = ?
//       AND pib.stock_item_id = ?
//       AND pib.godown_id = ?
//       AND (
//       ? IN ('NOT_APPLICABLE')
//       OR pib.batch_no = ?
//     )
//     `,
//     [
//       purchaseId,
//       stockItemId,
//       godownId,
//       batchNo
//     ]
//   );

//   return Number(rows[0].purchased_qty || 0);
// };

exports.getReturnedQtyByInvoice = async (
  connection,
  purchaseId,
  stockItemId,
  godownId,
  batchNo = null,
) => {
  let sql = `
      SELECT
          COALESCE(SUM(dni.return_qty),0)
          AS returned_qty
      FROM debit_note_items dni
      INNER JOIN debit_notes dn
          ON dn.id = dni.debit_note_id
      WHERE dn.original_purchase_id = ?
      AND dni.stock_item_id = ?
      AND dni.godown_id = ?
      AND dn.status = 'ACTIVE'
  `;

  const params = [purchaseId, stockItemId, godownId];

  if (batchNo) {
    sql += ` AND dni.batch_no = ?`;
    params.push(batchNo);
  }

  const [rows] = await connection.query(sql, params);

  return Number(rows[0]?.returned_qty || 0);
};

exports.getPurchaseItemsById = async (
  connection,
  purchaseId
) => {

  const [rows] = await connection.query(
    `
    SELECT

      pi.*,

      st.item_name AS stock_item_name,

      st.alternative_unit_value,
      st.base_unit_value,

      u.symbol AS base_unit_name,
      au.symbol AS alternative_unit_name,

      (
        pi.available_qty -
        COALESCE(
          (
            SELECT SUM(dni.return_qty)
            FROM debit_note_items dni
            INNER JOIN debit_notes dn
              ON dn.id = dni.debit_note_id
            WHERE
              dn.original_purchase_id = pi.purchase_id
              AND dni.stock_item_id = pi.stock_item_id
              AND dni.godown_id = pi.godown_id
              AND (dni.batch_no <=> pi.batch_no)
              AND dn.status = 'ACTIVE'
          ),
          0
        )
      ) AS available_to_return

    FROM purchase_items pi

    LEFT JOIN stock_items st
      ON st.id = pi.stock_item_id

    LEFT JOIN units u
      ON st.unit_id = u.id

    LEFT JOIN units au
      ON st.alternative_unit_id = au.id

    WHERE pi.purchase_id = ?
    `,
    [purchaseId]
  );

  return rows;
};

exports.getPurchaseBillReferencesByPurchaseId = async (
  connection,
  purchaseId
) => {
  const [rows] = await connection.query(
    `
    SELECT
      id,
      reference_no,
      bill_amount,
      pending_amount
    FROM purchase_bill_references
    WHERE purchase_id = ?
      AND pending_amount > 0
    ORDER BY id ASC
    `,
    [purchaseId]
  );

  return rows;
};