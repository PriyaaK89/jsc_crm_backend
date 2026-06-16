const db = require("../config/db");

exports.getJournalLedgerDropdown = async () => {
    const [rows] = await db.query(`
        SELECT
            l.id,
            l.ledger_name,
            l.group_id,
            ag.group_name
        FROM ledgers l
        LEFT JOIN account_groups ag
            ON ag.id = l.group_id
        WHERE l.status = 'ACTIVE'
        ORDER BY l.ledger_name ASC `);

    return rows;
};

exports.createJournal = async ( connection, journalData ) => {
    const { voucher_type_id, voucher_no, journal_date, employee_under_id, total_debit, total_credit, narration, created_by } = journalData;

    const [result] = await connection.query(
        ` INSERT INTO journal_master
        (
            voucher_type_id,
            voucher_no,
            journal_date,
            employee_under_id,
            total_debit,
            total_credit,
            narration,
            created_by
        )
        VALUES
        ( ?,?,?,?,?,?,?,? ) `,
        [
            voucher_type_id,
            voucher_no,
            journal_date,
            employee_under_id,
            total_debit,
            total_credit,
            narration,
            created_by
        ]
    );

    return result.insertId;
};

exports.insertJournalEntry = async ( connection, journalId, entry ) => {
    const [result] = await connection.query(
        ` INSERT INTO journal_entries
        (
            journal_id,
            ledger_id,
            entry_type,
            amount,
            remarks
        )
        VALUES
        (
            ?,?,?,?,?
        )
        `,
        [
            journalId,
            entry.ledger_id,
            entry.entry_type,
            entry.amount,
            entry.remarks || null
        ]
    );

    return result.insertId;
};

exports.insertJournalBillReference = async ( connection, journalEntryId, ledgerId, bill ) => {
    await connection.query(
        ` INSERT INTO journal_bill_references
        (
            journal_entry_id,
            ledger_id,
            reference_type,
            reference_no,
            amount,
            due_date,
            entry_type
        )
        VALUES
        (
            ?,?,?,?,?,?,?
        )
        `,
        [
            journalEntryId,
            ledgerId,
            bill.reference_type,
            bill.reference_no,
            bill.amount,
            bill.due_date || null,
            bill.entry_type
        ]
    );
};

exports.insertLedgerTransaction = async ( connection, data ) => {
    await connection.query(
        ` INSERT INTO ledger_transactions
        (
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
        VALUES
        (
            ?,?,?,?,?,?,?,?,?,?
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

exports.getBillReferences = async (
    ledgerId
) => {

    const [purchaseRefs] = await db.query(
        `
        SELECT
            id,
            reference_no,
            bill_amount,
            pending_amount,
            due_date,
            status,
            'PURCHASE' AS source
        FROM purchase_bill_references
        WHERE ledger_id = ?
        AND pending_amount > 0
        `,
        [ledgerId]
    );

    const [salesRefs] = await db.query(
        `
        SELECT
            id,
            reference_no,
            bill_amount,
            pending_amount,
            due_date,
            status,
            'SALES' AS source
        FROM sales_bill_references
        WHERE ledger_id = ?
        AND pending_amount > 0
        `,
        [ledgerId]
    );

    return [
        ...purchaseRefs,
        ...salesRefs
    ];
};

exports.updatePurchaseBillPendingAmount = async (
    connection,
    referenceNo,
    amount
) => {

    await connection.query(
        `
        UPDATE purchase_bill_references
        SET
            pending_amount =
                pending_amount - ?,

            status =
                CASE
                    WHEN pending_amount - ? <= 0
                        THEN 'PAID'

                    WHEN pending_amount - ? < bill_amount
                        THEN 'PARTIAL'

                    ELSE 'PENDING'
                END
        WHERE reference_no = ?
        `,
        [
            amount,
            amount,
            amount,
            referenceNo
        ]
    );
};

exports.updateSalesBillPendingAmount = async (
    connection,
    referenceNo,
    amount
) => {

    await connection.query(
        `
        UPDATE sales_bill_references
        SET
            pending_amount =
                pending_amount - ?,

            status =
                CASE
                    WHEN pending_amount - ? <= 0
                        THEN 'RECEIVED'

                    WHEN pending_amount - ? < bill_amount
                        THEN 'PARTIAL'

                    ELSE 'PENDING'
                END
        WHERE reference_no = ?
        `,
        [
            amount,
            amount,
            amount,
            referenceNo
        ]
    );
};

exports.getJournalVoucher = async (
    journalId
) => {

    const [journalRows] = await db.query(
        `
        SELECT
            jm.*,
            u.name AS employee_under_name
        FROM journal_master jm
        LEFT JOIN users u
            ON u.id = jm.employee_under_id
        WHERE jm.id = ?
        `,
        [journalId]
    );

    if (!journalRows.length) {
        return null;
    }

    const journal = journalRows[0];

    const [entries] = await db.query(
        `
        SELECT
            je.*,
            l.ledger_name
        FROM journal_entries je
        LEFT JOIN ledgers l
            ON l.id = je.ledger_id
        WHERE je.journal_id = ?
        ORDER BY je.id
        `,
        [journalId]
    );

    const [billReferences] = await db.query(
        `
        SELECT
            jbr.*,
            l.ledger_name
        FROM journal_bill_references jbr
        LEFT JOIN ledgers l
            ON l.id = jbr.ledger_id
        INNER JOIN journal_entries je
            ON je.id = jbr.journal_entry_id
        WHERE je.journal_id = ?
        ORDER BY jbr.id
        `,
        [journalId]
    );

    return {
        journal,
        entries,
        billReferences
    };
};
exports.getJournalInvoice = async (journalId) => {
    const [journalRows] = await db.query(
        ` SELECT
            jm.*,
            assignUser.name AS created_by_name,
            underUser.name AS employee_under_name

        FROM journal_master jm

        LEFT JOIN users assignUser
            ON assignUser.id = jm.created_by

        LEFT JOIN users underUser
            ON underUser.id = jm.employee_under_id

        WHERE jm.id = ?
        `,
        [journalId]
    );

    if (!journalRows.length) {
        return null;
    }

    const journal = journalRows[0];

    const [entries] = await db.query(
        `
        SELECT
            je.*,

            l.ledger_name,
            l.gst_no

        FROM journal_entries je

        LEFT JOIN ledgers l
            ON l.id = je.ledger_id

        WHERE je.journal_id = ?

        ORDER BY je.id ASC
        `,
        [journalId]
    );

    const [billReferences] = await db.query(
        `
        SELECT

            jbr.*,

            l.ledger_name

        FROM journal_bill_references jbr

        LEFT JOIN ledgers l
            ON l.id = jbr.ledger_id

        INNER JOIN journal_entries je
            ON je.id = jbr.journal_entry_id

        WHERE je.journal_id = ?
        ORDER BY jbr.id ASC
        `,
        [journalId]
    );

    return {
        journal,
        entries,
        billReferences
    };
};