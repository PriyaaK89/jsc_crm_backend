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
    voucher_type_id, voucher_no, sales_date, reference_no,
    customer_ledger_id, sales_ledger_id,
    assign_employee_id, employee_under_id,
    is_consignee,

    dealer_name, proprietor_name, consignee_contact_no, consignee_address, consignee_gstn_no,

    dispatch_doc_no, transport_name, destination, bill_t_no, vehicle_no,
    
    transport_freight, local_freight, load_freight, unload_freight,
    eway_number, transporter_gst, delivery_place,
    is_supercash_sale,
    subtotal, igst_total, cgst_total, sgst_total, tax_total, total_amount,
    tax_mode,
    dispatch_doc_image, bill_t_image,
    narration, created_by,
  } = salesData;
    const sanitized_assign_employee_id = assign_employee_id || null;
  const sanitized_employee_under_id  = employee_under_id  || null;

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

            dispatch_doc_image,
            bill_t_image,

            narration,
            created_by

        )
        VALUES (
            ?,?,?,?,
            ?,?, ?,?,?,
            ?,?,?,?,?,
            ?,?,?,?,?,
            ?,?,?,?,
            ?,?,?,?,
            ?,?,?,?,?,?,
            ?,?,?,?,? ) `,
    [
      voucher_type_id, voucher_no, sales_date, reference_no,
      customer_ledger_id, sales_ledger_id,
      // assign_employee_id, employee_under_id,
       sanitized_assign_employee_id,  // ← use sanitized
      sanitized_employee_under_id, 
      is_consignee,
      dealer_name, proprietor_name, consignee_contact_no, consignee_address, consignee_gstn_no,
      dispatch_doc_no, transport_name, destination,

      bill_t_no, vehicle_no,
      transport_freight, local_freight, load_freight, unload_freight,
      eway_number, transporter_gst, delivery_place,
      is_supercash_sale,
      subtotal, igst_total, cgst_total, sgst_total, tax_total, total_amount,
      tax_mode, dispatch_doc_image, bill_t_image,
      narration, created_by,
    ],
  );

  return result.insertId;
};

exports.insertSalesItem = async (connection, item, saleId) => {
  const [result] = await connection.query(
    `
        INSERT INTO sales_items (

            sale_id, stock_item_id, godown_id, batch_no,
            available_qty, billed_qty,
            rate, supercash_rate,
            unit_id, alt_unit_id, alt_unit_qty,
            bulk_unit_id, bulk_unit_value, calculated_alt_unit,

            amount,
            igst_percent, igst_amount,
            cgst_percent, cgst_amount,
            sgst_percent, sgst_amount,
            total_amount

        )
        VALUES (
            ?,?,?,?, ?,?, ?,?, ?,?,?, ?, ?,?, ?,?, ?,?, ?,?,?,?
        ) `,
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
      item.bulk_unit_id,
      item.bulk_unit_value,
      item.calculated_alt_unit,

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

exports.insertSalesStockTransaction = async ( connection, item, saleId, salesDate, createdBy, ) => {
  await connection.query(
    ` INSERT INTO stock_transactions ( transaction_type, reference_type, reference_id, transaction_date, stock_item_id, godown_id, batch_no, unit_id, qty_in, qty_out, rate, amount, created_by )
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
    ` INSERT INTO ledger_transactions (
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
        VALUES ( ?,?,?,?,?,?, ?,?,?,? ) `,
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
exports.insertSalesBillReference = async ( connection, data) => {

  const [result] = await connection.query(
    ` INSERT INTO sales_bill_references (
      sale_id, ledger_id, reference_type, reference_no,
      reference_amount, bill_amount, pending_amount,  status, due_date )
    VALUES ( ?,?,?,?,?,?,?,?,? ) `,
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

exports.getAvailableStock = async ( connection, stockItemId, godownId, batchNo = null ) => {

    let sql = ` SELECT COALESCE(SUM(qty_in),0) - COALESCE(SUM(qty_out),0)
        AS available_stock
        FROM stock_transactions
        WHERE stock_item_id = ?
        AND godown_id = ? `;

    const params = [ stockItemId, godownId ];

    if (batchNo) {
        sql += `  AND batch_no = ? `;
        params.push(batchNo);
    }

    const [rows] =
    await connection.query(sql, params);
    return rows[0]?.available_stock || 0;
};

exports.insertExtraLedger = async ( connection, data) => {
  await connection.query(
    ` INSERT INTO sales_extra_ledgers ( sale_id, ledger_id, amount, operation, comments )
    VALUES ( ?,?,?,?,? ) `,
    [
      data.sale_id,
      data.ledger_id,
      data.amount,
      data.operation,
      data.comments
    ]
  );
};
exports.getSalesInvoice = async (saleId) => {
  // Sales Header
  const [salesRows] = await db.query(
    ` SELECT
        s.*,
        customer.ledger_name AS customer_name,
        customer.gst_no AS customer_gst,
        customerDetails.contact AS customer_mobile,
        customerDetails.address AS customer_address,
        customerDetails.firm_name,
        customerDetails.customer_name,

        salesLedger.ledger_name AS sales_ledger_name,

        assignUser.name AS assign_employee_name,
        underUser.name AS employee_under_name

    FROM sales s
    LEFT JOIN ledgers customer ON customer.id = s.customer_ledger_id
    LEFT JOIN ledger_other_details customerDetails ON customerDetails.ledger_id = s.customer_ledger_id
    LEFT JOIN ledgers salesLedger ON salesLedger.id = s.sales_ledger_id
    LEFT JOIN users assignUser ON assignUser.id = s.assign_employee_id
    LEFT JOIN users underUser ON underUser.id = s.employee_under_id

    WHERE s.id = ?
    `,
    [saleId]
  );

  if (!salesRows.length) {
    return null;
  }

  const sale = salesRows[0];

  // Sales Items
  const [itemRows] = await db.query(
    ` SELECT
        si.id,
        si.stock_item_id,
        si.batch_no,

        gst.hsn_sac AS hsn_code,

        si.available_qty,
        si.billed_qty,

        si.rate,
        si.supercash_rate,
        si.amount,

        si.igst_percent,
        si.igst_amount,

        si.cgst_percent,
        si.cgst_amount,

        si.sgst_percent,
        si.sgst_amount,

        si.total_amount,

        stock.item_name,

        stock.alternative_unit_value,
        stock.base_unit_value,
        stock.bulk_unit_value,
        stock.bulk_base_value,

        u.symbol AS unit_name,
        au.symbol AS alternative_unit_name,
        bu.symbol AS bulk_unit_name

    FROM sales_items si
    LEFT JOIN stock_items stock ON stock.id = si.stock_item_id
    LEFT JOIN units u ON u.id = si.unit_id
    LEFT JOIN units au ON au.id = stock.alternative_unit_id
    LEFT JOIN units bu ON bu.id = stock.bulk_unit_id
    LEFT JOIN stock_item_gst_details gst ON gst.stock_item_id = stock.id

    WHERE si.sale_id = ?

    ORDER BY si.id ASC
    `,
    [saleId]
  );

  // Calculate Alternative Unit and Bulk Unit
  const items = itemRows.map((item) => {
    const billedQty = Number(item.billed_qty) || 0;
    const baseUnitValue = Number(item.base_unit_value) || 0;
    const bulkBaseValue = Number(item.bulk_base_value) || 0;

    let calculated_alt_unit = null;
    let calculated_bulk_unit = null;

    /*
      Example:
      Base unit = KG
      Alternative unit = PKT
      Bulk unit = BAG

      1 PKT = 4 KG
      1 BAG = 48 KG

      Packets inside 1 BAG:
      48 / 4 = 12 PKT
    */
    if (
      baseUnitValue > 0 &&
      bulkBaseValue > 0 &&
      item.alternative_unit_name
    ) {
      const altQty = bulkBaseValue / baseUnitValue;

      calculated_alt_unit = `${Number(
        altQty.toFixed(2)
      )} ${item.alternative_unit_name}`;
    }

    /*
      Calculate number of bulk units according to ordered quantity.

      Example:
      Ordered quantity = 288 KG
      1 BAG = 48 KG

      288 / 48 = 6 BAG
    */
    if (
      billedQty > 0 &&
      bulkBaseValue > 0 &&
      item.bulk_unit_name
    ) {
      const bulkQty = billedQty / bulkBaseValue;

      calculated_bulk_unit = `${Number(
        bulkQty.toFixed(2)
      )} ${item.bulk_unit_name}`;
    }

    return {
      ...item,
      calculated_alt_unit,
      calculated_bulk_unit,
    };
  });

  // Extra Ledgers
  const [extraLedgers] = await db.query(
    ` SELECT sel.*, l.ledger_name FROM sales_extra_ledgers sel
    LEFT JOIN ledgers l ON l.id = sel.ledger_id
    WHERE sel.sale_id = ? `,
    [saleId]
  );

  // Bill References
  const [billReferences] = await db.query( ` SELECT * FROM sales_bill_references WHERE sale_id = ? `, [saleId] );

  return { sale, items, extraLedgers, billReferences, };
};

const addDays = (dateStr, days) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};

const getOutstandingAmount = async (connection, ledgerId) => {
  const [rows] = await connection.query(
    `
    SELECT COALESCE(SUM(pending_amount), 0) AS total_outstanding
    FROM sales_bill_references
    WHERE ledger_id = ?
      AND pending_amount > 0
      AND status IN ('PENDING', 'PARTIAL')
    `,
    [ledgerId]
  );

  return Number(rows[0]?.total_outstanding || 0);
};

const formatDate = (dateVal) => {
  if (!dateVal) return "";
  const d = new Date(dateVal);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
};

const getOverdueBills = async (connection, ledgerId, referenceDate) => {
  const [rows] = await connection.query(
    `
    SELECT
      sbr.id,
      sbr.reference_no,
      sbr.due_date,
      sbr.bill_amount,
      sbr.pending_amount,
      s.sales_date AS bill_date,
      DATEDIFF(?, sbr.due_date) AS duration_days
    FROM sales_bill_references sbr
    LEFT JOIN sales s ON s.id = sbr.sale_id
    WHERE sbr.ledger_id = ?
      AND sbr.pending_amount > 0
      AND sbr.due_date IS NOT NULL
      AND sbr.due_date < ?
      AND sbr.status IN ('PENDING', 'PARTIAL')
    ORDER BY sbr.due_date ASC
    `,
    [referenceDate, ledgerId, referenceDate]
  );

  return rows;
};

exports.enforceSalesRules = async (
  connection,
  customerLedger,
  salesAmount,
  salesDate
) => {
  const ledgerId = customerLedger.id;
  const creditLimit = Number(customerLedger.credit_limit || 0);
  const openingBalance = Number(customerLedger.opening_balance || 0);
  const balanceType = customerLedger.balance_type;

  let effectiveLimit = 0;
  let limitSource = null;

  if (creditLimit > 0) {
    effectiveLimit = creditLimit;
    limitSource = "CREDIT_LIMIT";
  } else if (balanceType === "Cr" && openingBalance > 0) {
    effectiveLimit = openingBalance;
    limitSource = "OPENING_CR_BALANCE";
  } else {
    const err = new Error(
      `Sale blocked. No credit limit is set for this ledger and it has no credit (Cr) opening balance.`
    );
    err.code = "NO_CREDIT_FACILITY";
    throw err;
  }

  const outstanding = await getOutstandingAmount(connection, ledgerId);
  console.log("DEBUG ledgerId:", ledgerId, "outstanding:", outstanding, "effectiveLimit:", effectiveLimit, "source:", limitSource);
  const projectedOutstanding = outstanding + Number(salesAmount || 0);
  console.log("DEBUG projectedOutstanding:", projectedOutstanding);

  if (projectedOutstanding > effectiveLimit) {
    const err = new Error(
      `Credit limit exceeded. Limit: ${effectiveLimit} (${limitSource}), current outstanding: ${outstanding}, new sale: ${salesAmount}`
    );
    err.code = "CREDIT_LIMIT_EXCEEDED";
    err.creditLimitInfo = {
      credit_limit: effectiveLimit,
      limit_source: limitSource,
      current_outstanding: outstanding,
      new_sale_amount: Number(salesAmount || 0),
      projected_outstanding: projectedOutstanding,
    };
    throw err;
  }

  const overdueBills = await getOverdueBills(connection, ledgerId, salesDate);

  if (overdueBills.length > 0) {
    const formattedBills = overdueBills.map((b) => ({
      voucher_no: b.reference_no,
      bill_date: formatDate(b.bill_date),
      bill_amount: Number(b.bill_amount),
      pending_amount: Number(b.pending_amount),
      due_date: formatDate(b.due_date),
      duration_days: Number(b.duration_days),
    }));

    const message = formattedBills
      .map(
        (b) =>
          `Voucher - ${b.voucher_no},Bill Date - ${b.bill_date},Bill Amt - ${b.bill_amount.toFixed(2)},Duration - ${b.duration_days} days`
      )
      .join("\n");

    const err = new Error(message);
    err.code = "OVERDUE_BILLS";
    err.overdueBills = formattedBills;
    throw err;
  }
};

exports.checkOverdueBills = async (connection, ledgerId, referenceDate) => {
  const overdueBills = await getOverdueBills(connection, ledgerId, referenceDate);

  if (overdueBills.length === 0) {
    return [];
  }

  return overdueBills.map((b) => ({
    voucher_no: b.reference_no,
    bill_date: formatDate(b.bill_date),
    bill_amount: Number(b.bill_amount),
    pending_amount: Number(b.pending_amount),
    due_date: formatDate(b.due_date),
    duration_days: Number(b.duration_days),
  }));
};

exports.getInterestConfigBySlab = async (connection, ledgerId, slabType) => {
  const [rows] = await connection.query(
    ` SELECT * FROM ledger_interest_config
    WHERE ledger_id = ?
      AND slab_type = ?
    ORDER BY slab_no ASC LIMIT 1 `,
    [ledgerId, slabType]
  );

  return rows[0] || null;
};

exports.getActiveBillsForReminders = async () => {
  const [rows] = await db.query(`
    SELECT
      sbr.id AS bill_reference_id,
      sbr.sale_id, sbr.ledger_id, sbr.reference_no,
      sbr.pending_amount, sbr.bill_amount, sbr.due_date,
      s.sales_date,
      l.ledger_name, l.default_credit_period,
      lod.customer_name, lod.contact,
      lic.grace_period
    FROM sales_bill_references sbr
    INNER JOIN sales s ON s.id = sbr.sale_id
    INNER JOIN ledgers l ON l.id = sbr.ledger_id
    LEFT JOIN ledger_other_details lod ON lod.ledger_id = sbr.ledger_id
    LEFT JOIN (
      SELECT ledger_id, grace_period
      FROM ledger_interest_config
      WHERE slab_type = 'debit' AND slab_no = 1
    ) lic ON lic.ledger_id = sbr.ledger_id
    WHERE sbr.pending_amount > 0
      AND sbr.status IN ('PENDING','PARTIAL')
  `);
  return rows;
};

exports.hasReminderBeenSentToday = async (billReferenceId, templateName, sentDate) => {
  const [rows] = await db.query(
    `SELECT id FROM whatsapp_reminder_logs
     WHERE sales_bill_reference_id = ? AND template_name = ? AND sent_date = ?`,
    [billReferenceId, templateName, sentDate]
  );
  return rows.length > 0;
};

exports.logReminderSent = async (data) => {
  await db.query(
    `INSERT INTO whatsapp_reminder_logs
      (sales_bill_reference_id, template_name, sent_date, discount_percent, status, response_payload)
     VALUES (?,?,?,?,?,?)`,
    [
      data.bill_reference_id, data.template_name, data.sent_date,
      data.discount_percent || null, data.status || "SENT", data.response_payload || null,
    ]
  );
};

// exports.getSalesInvoice = async (saleId) => {
//   const [salesRows] = await db.query(
//       ` SELECT
//           s.*,
//           customer.ledger_name AS customer_name,
//           customer.gst_no AS customer_gst,
//           customerDetails.contact AS customer_mobile,
//           customerDetails.address AS customer_address,
//           customerDetails.firm_name,
//           customerDetails.customer_name,

//           salesLedger.ledger_name AS sales_ledger_name,

//           assignUser.name AS assign_employee_name,
//           underUser.name AS employee_under_name

//       FROM sales s
//       LEFT JOIN ledgers customer ON customer.id = s.customer_ledger_id
//       LEFT JOIN ledger_other_details customerDetails ON customerDetails.ledger_id = s.customer_ledger_id
//       LEFT JOIN ledgers salesLedger ON salesLedger.id = s.sales_ledger_id
//       LEFT JOIN users assignUser ON assignUser.id = s.assign_employee_id
//       LEFT JOIN users underUser ON underUser.id = s.employee_under_id

//       WHERE s.id = ?
//       `,
//       [saleId]
//   );

//   if (!salesRows.length) {
//       return null;
//   }

//   const sale = salesRows[0];

//   // Sales Items

// const [itemRows] = await db.query(
//   `
//   SELECT
//       si.id,
//       si.stock_item_id,

//       si.batch_no,

//       gst.hsn_sac AS hsn_code,

//       si.available_qty,
//       si.billed_qty,

//       si.rate,
//       si.supercash_rate,

//       si.amount,

//       si.igst_percent,
//       si.igst_amount,

//       si.cgst_percent,
//       si.cgst_amount,

//       si.sgst_percent,
//       si.sgst_amount,

//       si.total_amount,
//       si.calculated_alt_unit,

//       stock.alternative_unit_value,
//       stock.base_unit_value,
//       stock.bulk_unit_value,

//       stock.item_name,
//       u.symbol AS unit_name

//   FROM sales_items si

//   LEFT JOIN stock_items stock
//       ON stock.id = si.stock_item_id

//   LEFT JOIN units u
//       ON u.id = si.unit_id

//   LEFT JOIN stock_item_gst_details gst
//       ON gst.stock_item_id = stock.id

//   WHERE si.sale_id = ?

//   ORDER BY si.id ASC
//   `,
//   [saleId]
// );

//   // Extra Ledgers

//   const [extraLedgers] = await db.query(
//       `
//       SELECT

//           sel.*,
//           l.ledger_name

//       FROM sales_extra_ledgers sel

//       LEFT JOIN ledgers l
//           ON l.id = sel.ledger_id

//       WHERE sel.sale_id = ?
//       `,
//       [saleId]
//   );

//   // Bill References

//   const [billReferences] = await db.query(
//       `
//       SELECT *

//       FROM sales_bill_references

//       WHERE sale_id = ?
//       `,
//       [saleId]
//   );

//   return {
//       sale,
//       items: itemRows,
//       extraLedgers,
//       billReferences
//   };
// };