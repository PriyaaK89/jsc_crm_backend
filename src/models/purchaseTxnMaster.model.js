const db = require("../config/db");

exports.getPurchaseLedgerDropdown = async () => {

    const [rows] = await db.query(`
        SELECT
            l.id,
            l.ledger_name
        FROM ledgers l
        INNER JOIN account_groups ag
            ON ag.id = l.group_id
        WHERE ag.group_name IN (
            'Purchase account',
            'Direct Expenses'
        )
        ORDER BY l.ledger_name ASC
    `);

    return rows;
};

exports.createPurchase = async ( connection, purchaseData) => {
    const {
        voucher_type_id,
        voucher_no,
        purchase_date,
        supplier_invoice_no,

        supplier_ledger_id,
        purchase_ledger_id,

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

        subtotal,
        igst_total,
        cgst_total,
        sgst_total,
        tax_total,
        total_amount,

        tax_mode,

        narration,
        created_by
    } = purchaseData;

    const [result] = await connection.query(
        `
        INSERT INTO purchases (

            voucher_type_id,
            voucher_no,
            purchase_date,
            supplier_invoice_no,

            supplier_ledger_id,
            purchase_ledger_id,

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
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?
)
        `,
        [
            voucher_type_id,
            voucher_no,
            purchase_date,
            supplier_invoice_no,

            supplier_ledger_id,
            purchase_ledger_id,

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

            subtotal,
            igst_total,
            cgst_total,
            sgst_total,
            tax_total,
            total_amount,

            tax_mode,

            narration,
            created_by
        ]
    );

    return result.insertId;
};

exports.insertPurchaseItem = async (
    connection,
    item,
    purchaseId
) => {

    const [result] = await connection.query(
        `
        INSERT INTO purchase_items (
            purchase_id,
            stock_item_id,
            godown_id,
            batch_no,
            mfg_date,
            expiry_date,

            available_qty,
            billed_qty,

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
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ? )`,
        [
            purchaseId,
            item.stock_item_id,
            item.godown_id,
            item.batch_no,
            item.mfg_date,
            item.expiry_date,
            item.available_qty,
            item.billed_qty,
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
            item.total_amount
        ]
    );

    return result.insertId;
};

exports.insertStockTransaction = async (
    connection,
    item,
    purchaseId,
    purchaseDate,
    createdBy
) => {

    await connection.query(
        `
        INSERT INTO stock_transactions (
 transaction_type, reference_type, reference_id, transaction_date, stock_item_id, godown_id, batch_no, unit_id, qty_in, qty_out, rate, amount, created_by
        )
        VALUES (
            'PURCHASE',
            'PURCHASE',
            ?,
            ?,
            ?,?,?,?,
            ?,0,
            ?,?,
            ?
        )
        `,
        [
            purchaseId,
            purchaseDate,
            item.stock_item_id,
            item.godown_id,
            item.batch_no,
            item.unit_id,
            item.billed_qty,
            item.rate,
            item.total_amount,
            createdBy
        ]
    );
};


exports.insertLedgerTransaction = async (
    connection,
    data
) => {

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
            data.created_by
        ]
    );
};

exports.insertPurchaseBatch =
async (
    connection,
    item,
    purchaseItemId
) => {

    await connection.query(
        `
        INSERT INTO purchase_item_batches (

            purchase_item_id,
            stock_item_id,
            godown_id,
            batch_no,
            qty,
            mfg_date,
            expiry_date,
            remind_expiry,
            remind_date

        )
        VALUES (
            ?,?,?,?,?,?,?,?,?
        )
        `,
        [
            purchaseItemId,
            item.stock_item_id,
            item.godown_id,
            item.batch_no,
            item.billed_qty,
            item.mfg_date || null,
            item.expiry_date || null,
            item.remind_expiry || "No",
            item.remind_date || null
        ]
    );
};

exports.getPurchaseList = async () => {

    const [rows] = await db.query(`
        SELECT

            p.id,
            p.voucher_no,
            p.purchase_date,
            p.total_amount,

            l.ledger_name AS supplier_name

        FROM purchases p

        LEFT JOIN ledgers l
            ON l.id = p.supplier_ledger_id

        ORDER BY p.id DESC
    `);

    return rows;
};

exports.getPurchaseById = async (id) => {

    const [purchaseRows] = await db.query(`
        SELECT *
        FROM purchases
        WHERE id = ?
    `, [id]);

    const [itemRows] = await db.query(`
        SELECT *
        FROM purchase_items
        WHERE purchase_id = ?
    `, [id]);

    return {
        purchase: purchaseRows[0],
        items: itemRows
    };
};

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

exports.getLedgerByName = async ( connection, ledgerName ) => {
    const [rows] = await connection.query(
        `  SELECT id
        FROM ledgers
        WHERE ledger_name = ?
        LIMIT 1
        `,
        [ledgerName]
    );
    return rows[0];
};

exports.insertPurchaseBillReference = async (
    connection,
    data
) => {

    const [result] = await connection.query(
        `
        INSERT INTO purchase_bill_references (
            purchase_id,
            ledger_id,
            reference_type,
            reference_no,
            bill_amount,
            pending_amount,
            due_date

        )
        VALUES (
            ?,?,?,?,?,?,?
        )
        `,
        [
            data.purchase_id,
            data.ledger_id,
            data.reference_type,
            data.reference_no,
            data.bill_amount,
            data.pending_amount,
            data.due_date
        ]
    );

    return result.insertId;
};

exports.getLedgerById = async (connection, ledgerId) => {
  const [rows] = await connection.query(
    `
    SELECT
      id,
      maintain_bill_by_bill
    FROM ledgers
    WHERE id = ?
    `,
    [ledgerId]
  );

  return rows[0];
};

exports.getPurchaseInvoice = async (purchaseId) => {
    const [purchaseRows] = await db.query(
        ` SELECT
            p.*,

            supplier.ledger_name AS supplier_name,
            supplier.gst_no AS supplier_gst,

            purchaseLedger.ledger_name
            AS purchase_ledger_name,

            assignUser.name
            AS assign_employee_name,

            underUser.name
            AS employee_under_name

        FROM purchases p

        LEFT JOIN ledgers supplier
            ON supplier.id = p.supplier_ledger_id

        LEFT JOIN ledgers purchaseLedger
            ON purchaseLedger.id = p.purchase_ledger_id

        LEFT JOIN users assignUser
            ON assignUser.id = p.assign_employee_id

        LEFT JOIN users underUser
            ON underUser.id = p.employee_under_id

        WHERE p.id = ?
        `,
        [purchaseId]
    );

    if (!purchaseRows.length) {
        return null;
    }

    const purchase = purchaseRows[0];

    const [itemRows] = await db.query(
        `
        SELECT

            pi.id,

            pi.stock_item_id,

            pi.batch_no,
            pi.mfg_date,
            pi.expiry_date,

            pi.available_qty,
            pi.billed_qty,

            pi.rate,
            pi.amount,

            pi.igst_percent,
            pi.igst_amount,

            pi.cgst_percent,
            pi.cgst_amount,

            pi.sgst_percent,
            pi.sgst_amount,

            pi.total_amount,

            si.item_name,

            u.symbol

        FROM purchase_items pi

        LEFT JOIN stock_items si
            ON si.id = pi.stock_item_id

        LEFT JOIN units u
            ON u.id = pi.unit_id

        WHERE pi.purchase_id = ?

        ORDER BY pi.id ASC
        `,
        [purchaseId]
    );

    return {
        purchase,
        items: itemRows
    };
};

