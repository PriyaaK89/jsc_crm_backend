const db = require("../config/db");

exports.getCustomerDropdown = async () => {
  const [rows] = await db.query(` SELECT
          l.id,
          l.ledger_name
      FROM ledgers l
      INNER JOIN account_groups ag
          ON ag.id = l.group_id
      WHERE ag.group_name = 'Sundry Debtors'
      ORDER BY l.ledger_name ASC `);

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
    voucher_type_id, voucher_no, credit_note_date,
    original_sale_id,

    customer_ledger_id, sales_return_ledger_id,
    assign_employee_id, employee_under_id,
    dispatch_doc_no, transport_name, destination,
    bill_t_no, vehicle_no,
    transport_freight,
    local_freight, load_freight, unload_freight, delivery_charge,
    unique_number, transporter,

    eway_number, transporter_gst, delivery_place,
    subtotal,

    igst_total, cgst_total, sgst_total,
    tax_total, total_amount,  bill_t_image,
    dispatch_doc_image,
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
      local_freight, load_freight, unload_freight, delivery_charge,
      unique_number, transporter,
      eway_number, transporter_gst, delivery_place,
      subtotal,
      igst_total, cgst_total, sgst_total,
      tax_total, total_amount,  bill_t_image,
    dispatch_doc_image,
      narration,
      created_by

    )
    VALUES (
      ?,?,?, ?, ?,?, ?,?, ?,?,?, ?,?, ?, ?,?,?, ?, ?,?,?, ?,?, ?, ?, ?, ?,?,?, ?, ?, ?,?
    )  `,
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
      local_freight || 0,
      load_freight || 0,
      unload_freight || 0,
      delivery_charge || 0,
      unique_number || null,
      transporter || null,
      eway_number,
      transporter_gst,
      delivery_place,
      subtotal,

      igst_total,
      cgst_total,
      sgst_total,
      tax_total,
      total_amount,  bill_t_image,
    dispatch_doc_image,
      narration,
      created_by,
    ]
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
    ` INSERT INTO credit_note_items (
      credit_note_id, stock_item_id, godown_id, batch_no,
      available_qty, return_qty,
      rate,
      unit_id, alt_unit_id, alt_unit_qty,
      amount,
      igst_percent, igst_amount,
      cgst_percent, cgst_amount,
      sgst_percent, sgst_amount,
      total_amount

    )
    VALUES (  ?, ?,?,?, ?,?, ?, ?,?,?, ?, ?,?, ?,?, ?,?, ? ) `,
    [
      creditNoteId,

      item.stock_item_id, item.godown_id, item.batch_no,
      item.available_qty, item.return_qty,
      item.rate,

      item.unit_id, item.alt_unit_id, item.alt_unit_qty,

      item.amount,
      item.igst_percent, item.igst_amount,
      item.cgst_percent, item.cgst_amount,
      item.sgst_percent, item.sgst_amount,
      item.total_amount,
    ]
  );

  return result.insertId;
};

exports.insertCreditNoteStockTransaction = async ( connection, item, creditNoteId, creditNoteDate, createdBy ) => {
  await connection.query(
    ` INSERT INTO stock_transactions (
      transaction_type, reference_type, reference_id, transaction_date,
      stock_item_id, godown_id, batch_no, unit_id, qty_in, qty_out,
      rate, amount, created_by
    )
    VALUES ( 'SALES_RETURN', 'CREDIT_NOTE', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?  ) `,
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
    ]
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
    ]
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
    ]
  );

  return result.insertId;
};

exports.updateSalesBillReference = async ( connection, salesBillReferenceId, amount ) => {
  const [rows] = await connection.query(
    ` SELECT pending_amount FROM sales_bill_references WHERE id = ? `,
    [salesBillReferenceId]
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
    ` UPDATE sales_bill_references SET pending_amount = ?, status = ? WHERE id = ? `,
    [Math.max(newPending, 0), status, salesBillReferenceId]
  );
};

exports.getAvailableStock = async ( connection, stockItemId, godownId, batchNo = null ) => {
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

  if (batchNo) { sql += ` AND batch_no = ? `;
    params.push(batchNo);
  }
  const [rows] = await connection.query(sql, params);
  return rows[0]?.available_stock || 0;
};

exports.getSoldQtyByInvoice = async ( connection, saleId, stockItemId, godownId, batchNo = null ) => {
  let sql = `
    SELECT
      COALESCE(SUM(si.billed_qty),0) AS sold_qty
    FROM sales_items si
    WHERE si.sale_id = ?
      AND si.stock_item_id = ?
      AND si.godown_id = ?
  `;

  const params = [saleId, stockItemId, godownId];
  if (batchNo && batchNo !== "NOT_APPLICABLE") { sql += ` AND si.batch_no = ? `; params.push(batchNo); }
  const [rows] = await connection.query(sql, params);
  return Number(rows[0]?.sold_qty || 0);
};
exports.getReturnedQtyByInvoice = async ( connection, saleId, stockItemId, godownId, batchNo = null ) => {
  let sql = ` SELECT
            COALESCE(SUM(cni.return_qty),0)
            AS returned_qty
        FROM credit_note_items cni
        INNER JOIN credit_notes cn
            ON cn.id = cni.credit_note_id
        WHERE cn.original_sale_id = ?
        AND cni.stock_item_id = ?
        AND cni.godown_id = ?
        AND cn.status = 'ACTIVE' `;

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
    ` SELECT
      s.id,
      s.voucher_no,
      s.sales_date,
      s.total_amount
    FROM sales s
    WHERE s.customer_ledger_id = ? AND s.status = 'ACTIVE'
    ORDER BY s.sales_date DESC `, [customerLedgerId]
  );
  return rows;
};

exports.getSaleItemsById = async (connection, saleId) => {
  const [rows] = await connection.query(
    ` SELECT si.*,

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
    LEFT JOIN stock_items st ON st.id = si.stock_item_id
    LEFT JOIN units u ON st.unit_id = u.id
    LEFT JOIN units au ON st.alternative_unit_id = au.id
    WHERE si.sale_id = ?
    `,
    [saleId]
  );

  return rows;
};

exports.getSalesBillReferences = async (customerLedgerId, saleId) => {
  const [rows] = await db.query(
    ` SELECT id, reference_no, bill_amount, pending_amount, status, due_date
        FROM sales_bill_references
        WHERE ledger_id = ?
        AND sale_id = ?
        ORDER BY id DESC `, [customerLedgerId, saleId]
  );

  return rows;
};

exports.getCreditNoteInvoice = async (creditNoteId) => {
    const [creditNoteRows] = await db.query(
        ` SELECT cn.*,
            customer.ledger_name AS customer_name,
            customer.gst_no AS customer_gst,

            customerDetails.contact AS customer_mobile,
            customerDetails.address AS customer_address,
            customerDetails.firm_name,
            customerDetails.customer_name,

            salesReturnLedger.ledger_name AS sales_return_ledger_name,

            assignUser.name AS assign_employee_name,
            underUser.name AS employee_under_name,

            s.voucher_no AS original_invoice_no,
            s.sales_date AS original_invoice_date

        FROM credit_notes cn
        LEFT JOIN ledgers customer ON customer.id = cn.customer_ledger_id
        LEFT JOIN ledger_other_details customerDetails ON customerDetails.ledger_id = cn.customer_ledger_id
        LEFT JOIN ledgers salesReturnLedger ON salesReturnLedger.id = cn.sales_return_ledger_id
        LEFT JOIN users assignUser ON assignUser.id = cn.assign_employee_id
        LEFT JOIN users underUser ON underUser.id = cn.employee_under_id
        LEFT JOIN sales s ON s.id = cn.original_sale_id

        WHERE cn.id = ?
        `,
        [creditNoteId]
    );

    if (!creditNoteRows.length) { return null; }
    const creditNote = creditNoteRows[0];
    const [itemRows] = await db.query(
        ` SELECT
            cni.id, cni.stock_item_id, cni.batch_no, cni.return_qty,
            cni.rate, cni.amount,
            cni.igst_percent, cni.igst_amount,
            cni.cgst_percent, cni.cgst_amount,
            cni.sgst_percent, cni.sgst_amount, cni.total_amount,
            gst.hsn_sac AS hsn_code,

            si.item_name,
            si.alternative_unit_value, si.base_unit_value, si.bulk_unit_value, salesItem.calculated_alt_unit,

            u.symbol AS unit_name

        FROM credit_note_items cni
        LEFT JOIN stock_items si ON si.id = cni.stock_item_id
        LEFT JOIN units u ON u.id = cni.unit_id
        LEFT JOIN stock_item_gst_details gst ON gst.stock_item_id = si.id
          LEFT JOIN sales_items salesItem
      ON salesItem.sale_id = ?
      AND salesItem.stock_item_id = cni.stock_item_id
        WHERE cni.credit_note_id = ?
        ORDER BY cni.id ASC
        `,
        [creditNote.original_sale_id,creditNoteId]
    );

    const [billReferences] = await db.query(
        ` SELECT
        cnbr.*, sbr.reference_no
        FROM credit_note_bill_references cnbr
        LEFT JOIN sales_bill_references sbr
            ON sbr.id = cnbr.sales_bill_reference_id
        WHERE cnbr.credit_note_id = ? `,
        [creditNoteId]
    );

    return { creditNote, items: itemRows, billReferences };
};

exports.getSaleById = async (saleId) => {
  const [rows] = await db.query(
    `SELECT id, voucher_no, sales_date, customer_ledger_id, total_amount
     FROM sales WHERE id = ?`,
    [saleId],
  );
  return rows[0] || null;
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
