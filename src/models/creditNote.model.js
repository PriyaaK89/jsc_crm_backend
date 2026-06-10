const db = require("../config/db");

exports.getCustomerDropdown = async () => {
  const [rows] = await db.query(`
      SELECT
          l.id,
          l.ledger_name
      FROM ledgers l
      INNER JOIN account_groups ag
          ON ag.id = l.group_id
      WHERE ag.group_name = 'Sundry Debtors'
      ORDER BY l.ledger_name ASC
  `);

  return rows;
};

exports.getSalesReturnLedgerDropdown = async () => {
  const [rows] = await db.query(`
      SELECT
          l.id,
          l.ledger_name
      FROM ledgers l
      INNER JOIN account_groups ag
          ON ag.id = l.group_id
      WHERE ag.group_name = 'Sales Account'
      ORDER BY l.ledger_name ASC
  `);

  return rows;
};

exports.createCreditNote = async (connection, creditNoteData) => {
  const {
    voucher_type_id,
    voucher_no,
    credit_note_date,

    original_sale_id,

    customer_ledger_id,
    sales_return_ledger_id,

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
  } = creditNoteData;

  const [result] = await connection.query(
    `
    INSERT INTO credit_notes (
      voucher_type_id,
      voucher_no,
      credit_note_date,
      original_sale_id,
      customer_ledger_id,
      sales_return_ledger_id,
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
      credit_note_date,
      original_sale_id,
      customer_ledger_id,
      sales_return_ledger_id,
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

/*
|--------------------------------------------------------------------------
| Credit Note Item
|--------------------------------------------------------------------------
*/

exports.insertCreditNoteItem = async (connection, item, creditNoteId) => {
  const [result] = await connection.query(
    `
    INSERT INTO credit_note_items (

      credit_note_id,

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
      creditNoteId,

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

exports.insertCreditNoteStockTransaction = async (
  connection,
  item,
  creditNoteId,
  creditNoteDate,
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
      'SALES_RETURN',
      'CREDIT_NOTE',
      ?,

      ?, ?,?,
      ?, ?,

      ?,
      0,
 ?, ?, ?  ) `,
    [
      creditNoteId,
      creditNoteDate,

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

exports.insertCreditNoteBillReference = async (connection, data) => {
  const [result] = await connection.query(
    ` INSERT INTO credit_note_bill_references (
      credit_note_id,
      customer_ledger_id,
      sales_bill_reference_id,
      amount
    )
    VALUES (
      ?,?,?,?
    )
    `,
    [
      data.credit_note_id,
      data.customer_ledger_id,
      data.sales_bill_reference_id,
      data.amount,
    ],
  );

  return result.insertId;
};

exports.updateSalesBillReference = async (
  connection,
  salesBillReferenceId,
  amount,
) => {
  const [rows] = await connection.query(
    ` SELECT
      pending_amount
    FROM sales_bill_references
    WHERE id = ? `,
    [salesBillReferenceId],
  );

  if (!rows.length) {
    throw new Error("Sales bill reference not found");
  }

  const currentPending = Number(rows[0].pending_amount);
  const newPending = currentPending - Number(amount);

  let status = "PARTIAL";

  if (newPending <= 0) {
    status = "RECEIVED";
  }

  await connection.query(
    ` UPDATE sales_bill_references SET
      pending_amount = ?,
      status = ?
    WHERE id = ? `,
    [Math.max(newPending, 0), status, salesBillReferenceId],
  );
};

exports.getAvailableStock = async (
  connection,
  stockItemId,
  godownId,
  batchNo = null,
) => {
  let sql = `
      SELECT
      COALESCE(SUM(qty_in),0)
      -
      COALESCE(SUM(qty_out),0)
      AS available_stock
      FROM stock_transactions
      WHERE stock_item_id = ?
      AND godown_id = ?
  `;

  const params = [stockItemId, godownId];

  if (batchNo) {
    sql += `
      AND batch_no = ?
    `;

    params.push(batchNo);
  }

  const [rows] = await connection.query(sql, params);

  return rows[0]?.available_stock || 0;
};

// exports.getSoldQtyByInvoice = async (
//   connection,
//   saleId,
//   stockItemId,
//   godownId,
//   batchNo = null,
// ) => {
//   let sql = `
//         SELECT
//             COALESCE(SUM(si.billed_qty), 0) AS sold_qty
//         FROM sales_items si
//         INNER JOIN sales s
//             ON s.id = si.sale_id
//         WHERE s.id = ?
//         AND si.stock_item_id = ?
//         AND si.godown_id = ?
//     `;

//   const params = [saleId, stockItemId, godownId];

//   // if (batchNo) {
//   //   sql += ` AND si.batch_no = ?`;
//   //   params.push(batchNo);
//   // }

//   // if (batchNo) {
//   //   sql += ` AND ( ? = 'NOT_APPLICABLE' OR .batch_no = ? ) `;

//   //   params.push(batchNo, batchNo);
//   // }
//   if (batchNo && batchNo !== "NOT_APPLICABLE") {
//   sql += ` AND si.batch_no = ? `;
//   params.push(batchNo);
// }

//   const [rows] = await connection.query(sql, params);

//   return Number(rows[0]?.sold_qty || 0);
// };


exports.getSoldQtyByInvoice = async (
  connection,
  saleId,
  stockItemId,
  godownId,
  batchNo = null
) => {
  let sql = `
    SELECT
      COALESCE(SUM(si.billed_qty),0) AS sold_qty
    FROM sales_items si
    WHERE si.sale_id = ?
      AND si.stock_item_id = ?
      AND si.godown_id = ?
  `;

  const params = [
    saleId,
    stockItemId,
    godownId
  ];

  if (batchNo && batchNo !== "NOT_APPLICABLE") {
    sql += ` AND si.batch_no = ? `;
    params.push(batchNo);
  }

  const [rows] = await connection.query(sql, params);

  return Number(rows[0]?.sold_qty || 0);
};
exports.getReturnedQtyByInvoice = async (
  connection,
  saleId,
  stockItemId,
  godownId,
  batchNo = null,
) => {
  let sql = `
        SELECT
            COALESCE(SUM(cni.return_qty),0)
            AS returned_qty
        FROM credit_note_items cni
        INNER JOIN credit_notes cn
            ON cn.id = cni.credit_note_id
        WHERE cn.original_sale_id = ?
        AND cni.stock_item_id = ?
        AND cni.godown_id = ?
        AND cn.status = 'ACTIVE'
    `;

  const params = [saleId, stockItemId, godownId];

  if (batchNo) {
    sql += ` AND cni.batch_no = ?`;
    params.push(batchNo);
  }

  const [rows] = await connection.query(sql, params);

  return Number(rows[0]?.returned_qty || 0);
};

exports.getSalesByCustomer = async (customerLedgerId) => {
  const [rows] = await db.query(
    `
    SELECT
      s.id,
      s.voucher_no,
      s.sales_date,
      s.total_amount
    FROM sales s
    WHERE s.customer_ledger_id = ?
      AND s.status = 'ACTIVE'
    ORDER BY s.sales_date DESC
    `,
    [customerLedgerId],
  );
  return rows;
};

exports.getSaleItemsById = async (connection, saleId) => {
  const [rows] = await connection.query(
    `
    SELECT
      si.*,

      st.item_name AS stock_item_name,

      st.alternative_unit_value,
      st.base_unit_value,

      u.symbol AS base_unit_name,
      au.symbol AS alternative_unit_name,

      (
        si.billed_qty -
        COALESCE(
          (
            SELECT SUM(cni.return_qty)
            FROM credit_note_items cni
            INNER JOIN credit_notes cn
              ON cn.id = cni.credit_note_id
            WHERE
              cn.original_sale_id = si.sale_id
            AND cni.stock_item_id = si.stock_item_id
            AND cni.godown_id = si.godown_id
            AND (cni.batch_no <=> si.batch_no)
            AND cn.status = 'ACTIVE'
          ),
          0
        )
      ) AS available_to_return

    FROM sales_items si

    LEFT JOIN stock_items st
      ON st.id = si.stock_item_id

    LEFT JOIN units u
      ON st.unit_id = u.id

    LEFT JOIN units au
      ON st.alternative_unit_id = au.id

    WHERE si.sale_id = ?
    `,
    [saleId],
  );

  return rows;
};

exports.getSalesBillReferences = async (
    customerLedgerId,
    saleId
) => {

    const [rows] = await db.query(
        `
        SELECT
            id,
            reference_no,
            bill_amount,
            pending_amount,
            status,
            due_date
        FROM sales_bill_references
        WHERE ledger_id = ?
        AND sale_id = ?
        ORDER BY id DESC
        `,
        [
            customerLedgerId,
            saleId
        ]
    );

    return rows;
};

// exports.getSaleItemsById = async (
//   connection,
//   saleId
// ) => {

//   const [rows] = await connection.query(
//     ` SELECT
//       si.*,
//       st.item_name AS stock_item_name,
//       (
//         si.billed_qty -
//         COALESCE(
//           (
//             SELECT SUM(cni.return_qty)
//             FROM credit_note_items cni
//             INNER JOIN credit_notes cn
//               ON cn.id = cni.credit_note_id
//             WHERE
//               cn.original_sale_id = si.sale_id
//             AND cni.stock_item_id = si.stock_item_id
//             AND cni.godown_id = si.godown_id
//             AND (
//                  cni.batch_no <=> si.batch_no
//                 )
//             AND cn.status = 'ACTIVE'
//           ),
//           0
//         )
//       ) AS available_to_return

//     FROM sales_items si

//     LEFT JOIN stock_items st
//       ON st.id = si.stock_item_id

//     WHERE si.sale_id = ?
//     `,
//     [saleId]
//   );

//   return rows;
// };
