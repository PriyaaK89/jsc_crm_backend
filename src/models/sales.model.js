const db = require("../config/db");

exports.getSalesLedgerDropdown = async () => {
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

exports.createSales = async (connection, salesData) => {
  const {
    voucher_type_id,
    voucher_no,
    sales_date,
    reference_no,

    customer_ledger_id,
    sales_ledger_id,

    assign_employee_id,
    employee_under_id,

    is_consignee,

    dealer_name,
    proprietor_name,
    consignee_contact_no,
    consignee_address,
    consignee_gstn_no,

    dispatch_doc_no,
    transport_name,
    destination,

    bill_t_no,
    vehicle_no,

    transport_freight,
    local_freight,
    load_freight,
    unload_freight,

    eway_number,
    transporter_gst,
    delivery_place,

    is_supercash_sale,

    subtotal,
    igst_total,
    cgst_total,
    sgst_total,
    tax_total,
    total_amount,

    tax_mode,

    narration,
    created_by,
  } = salesData;

  const [result] = await connection.query(
    `
        INSERT INTO sales (

            voucher_type_id,
            voucher_no,
            sales_date,
            reference_no,

            customer_ledger_id,
            sales_ledger_id,

            assign_employee_id,
            employee_under_id,

            is_consignee,

            dealer_name,
            proprietor_name,
            consignee_contact_no,
            consignee_address,
            consignee_gstn_no,

            dispatch_doc_no,
            transport_name,
            destination,

            bill_t_no,
            vehicle_no,

            transport_freight,
            local_freight,
            load_freight,
            unload_freight,

            eway_number,
            transporter_gst,
            delivery_place,

            is_supercash_sale,

            subtotal,
            igst_total,
            cgst_total,
            sgst_total,
            tax_total,
            total_amount,
            tax_mode,

            narration,
            created_by

        )
        VALUES (
            ?,?,?,?,
            ?,?,
            ?,?,
            ?,
            ?,?,?,?,?,
            ?,?,?,
            ?,?,
            ?,?,?,?,
            ?,?,?,
            ?,
            ?,?,?,?,?,?,
            ?,?,?
        )
        `,
    [
      voucher_type_id,
      voucher_no,
      sales_date,
      reference_no,

      customer_ledger_id,
      sales_ledger_id,

      assign_employee_id,
      employee_under_id,

      is_consignee,

      dealer_name,
      proprietor_name,
      consignee_contact_no,
      consignee_address,
      consignee_gstn_no,

      dispatch_doc_no,
      transport_name,
      destination,

      bill_t_no,
      vehicle_no,

      transport_freight,
      local_freight,
      load_freight,
      unload_freight,

      eway_number,
      transporter_gst,
      delivery_place,

      is_supercash_sale,

      subtotal,
      igst_total,
      cgst_total,
      sgst_total,
      tax_total,
      total_amount,

      tax_mode,

      narration,
      created_by,
    ],
  );

  return result.insertId;
};

exports.insertSalesItem = async (connection, item, saleId) => {
  const [result] = await connection.query(
    `
        INSERT INTO sales_items (

            sale_id,
            stock_item_id,
            godown_id,
            batch_no,

            available_qty,
            billed_qty,

            rate,
            supercash_rate,

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
            ?,?,?,?,
            ?,?,
            ?,?,
            ?,?,?,
            ?,
            ?,?,
            ?,?,
            ?,?,
            ?
        )
        `,
    [
      saleId,
      item.stock_item_id,
      item.godown_id,
      item.batch_no,

      item.available_qty,
      item.billed_qty,

      item.rate,
      item.supercash_rate || 0,

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

exports.insertSalesStockTransaction = async (
  connection,
  item,
  saleId,
  salesDate,
  createdBy,
) => {
  await connection.query(
    `
        INSERT INTO stock_transactions ( transaction_type, reference_type, reference_id, transaction_date, stock_item_id, godown_id, batch_no, unit_id, qty_in, qty_out, rate, amount, created_by
        )
        VALUES (
            'SALE',
            'SALES', ?, ?,
            ?,?, ?, ?, 0, ?, ?, ?, ?
        )
        `,
    [
      saleId,
      salesDate,
      item.stock_item_id,
      item.godown_id,
      item.batch_no,
      item.unit_id,
      item.billed_qty,
      item.rate,
      item.total_amount,
      createdBy,
    ],
  );
};

exports.insertSalesBatch = async (connection, item, salesItemId) => {
  await connection.query(
    ` INSERT INTO sales_item_batches ( sales_item_id, stock_item_id, godown_id, batch_no, qty )
        VALUES ( ?,?,?,?,? ) `,
    [ salesItemId, item.stock_item_id, item.godown_id, item.batch_no, item.billed_qty, ],
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
exports.insertSalesBillReference = async (
  connection,
  data
) => {

  const [result] = await connection.query(
    `
    INSERT INTO sales_bill_references (

      sale_id,
      ledger_id,
      reference_type,
      reference_no,
      reference_amount,
      bill_amount,
      pending_amount,
       status,
      due_date

    )
    VALUES (
      ?,?,?,?,?,?,?,?,?
    )
    `,
    [
      data.sale_id,
      data.ledger_id,
      data.reference_type,
      data.reference_no,
      data.reference_amount,
      data.bill_amount,
      data.pending_amount,
      "PENDING",
      data.due_date
    ]);
  return result.insertId;
};

exports.getAvailableStock = async (
    connection,
    stockItemId,
    godownId,
    batchNo = null
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

    const params = [
        stockItemId,
        godownId
    ];

    if (batchNo) {
        sql += `
            AND batch_no = ?
        `;
        params.push(batchNo);
    }

    const [rows] =
    await connection.query(sql, params);
    return rows[0]?.available_stock || 0;
};