const db = require("../config/db");

exports.getLedgerDetails = async (
    ledgerId
) => {
    const [rows] = await db.query(
        `
        SELECT
            id,
            ledger_name,
            opening_balance,
            balance_type,
            mailing_name,
            location,
            state,
            country,
            gst_no,
            pan_no,
            credit_limit
        FROM ledgers
        WHERE id = ?
        `,
        [ledgerId]
    );

    return rows[0];
};

exports.getOpeningBalance = async ( ledgerId, fromDate ) => {
    const [ledgerRows] = await db.query(
        `
        SELECT
            opening_balance,
            balance_type
        FROM ledgers
        WHERE id = ?
        `,
        [ledgerId]
    );
    let openingBalance = 0;
    if (ledgerRows.length > 0) {
        const ledger = ledgerRows[0];
        openingBalance = Number(ledger.opening_balance || 0);

        // IF DR => NEGATIVE
        // IF CR => POSITIVE

        if (
            ledger.balance_type === "Dr"
        ) {
            openingBalance = -openingBalance;
        }
    }

    const [txnRows] = await db.query(
        `
        SELECT

            entry_type,
            amount

        FROM ledger_transactions

        WHERE ledger_id = ?
        AND transaction_date < ?
        AND is_cancelled = 0

        ORDER BY transaction_date ASC, id ASC
        `,
        [ledgerId, fromDate]
    );

    for (const row of txnRows) {

        const amount = Number(row.amount);

        // FOR SUPPLIER ACCOUNT:
        // DR => REDUCE
        // CR => INCREASE

        if (row.entry_type === "Dr") {
            openingBalance -= amount;
        } else {
            openingBalance += amount;
        }
    }

    return openingBalance;
};


exports.getPartyLedgerReport = async ({
    ledger_id,
    from_date,
    to_date,
    search = "",
    page = 1,
    limit = 20
}) => {

    const offset = (page - 1) * limit;

    // SEARCH FILTER

    let searchCondition = "";
    let searchParams = [];

    if (search) {

        searchCondition = `
            AND (
                lt.transaction_type LIKE ?
                OR lt.voucher_no LIKE ?
                OR lt.remarks LIKE ?
            )
        `;

        searchParams = [
            `%${search}%`,
            `%${search}%`,
            `%${search}%`
        ];
    }

    // TOTAL COUNT

    const [countRows] = await db.query(
        `
        SELECT COUNT(*) AS total

        FROM ledger_transactions lt

        WHERE lt.ledger_id = ?
        AND lt.transaction_date
            BETWEEN ? AND ?
        AND lt.is_cancelled = 0

        ${searchCondition}
        `,
        [
            ledger_id,
            from_date,
            to_date,
            ...searchParams
        ]
    );

    const totalRecords =
        countRows[0].total;

    // GET ALL ROWS TILL PAGE END
    // IMPORTANT FOR RUNNING BALANCE

    const fetchLimit = page * limit;

 const [rows] = await db.query(
    `
    SELECT

        lt.id,
        lt.transaction_date,
        lt.transaction_type,
        lt.voucher_no,
        lt.entry_type,
        lt.amount,
        lt.remarks,
        lt.reference_id,

        l.ledger_name,

        p.purchase_ledger_id,

        pl.ledger_name
        AS purchase_ledger_name

    FROM ledger_transactions lt

    LEFT JOIN ledgers l
        ON l.id = lt.ledger_id

    LEFT JOIN purchases p
        ON p.id = lt.reference_id
        AND lt.transaction_type = 'PURCHASE'

    LEFT JOIN ledgers pl
        ON pl.id = p.purchase_ledger_id

    WHERE lt.ledger_id = ?
    AND lt.transaction_date
        BETWEEN ? AND ?
    AND lt.is_cancelled = 0

    ${searchCondition}

    ORDER BY
        lt.transaction_date ASC,
        lt.id ASC

    LIMIT ?
    `,
    [
        ledger_id,
        from_date,
        to_date,
        ...searchParams,
        fetchLimit
    ]
);
    return {
        rows,
        totalRecords,
        offset,
        limit
    };
};