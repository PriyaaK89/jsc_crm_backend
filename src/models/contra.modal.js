const db = require("../config/db");

exports.getContraAccountDropdown = async () => {
  const [rows] = await db.query(`
        SELECT
            l.id,
            l.ledger_name
        FROM ledgers l
        INNER JOIN account_groups ag
            ON ag.id = l.group_id
        WHERE ag.group_name IN (
            'Bank Account',
            'Cash-in-Hand'
        )
        ORDER BY l.ledger_name ASC
    `);

  return rows;
};

exports.createContra = async (connection, contraData) => {
  const { voucher_type_id, voucher_no, contra_date, account_ledger_id, employee_under_id, total_amount, narration, created_by, } = contraData;

  const [result] = await connection.query(
    ` INSERT INTO contra_master (

            voucher_type_id,
            voucher_no,
            contra_date,

            account_ledger_id,
            employee_under_id,

            total_amount,
            narration,

            created_by

        )
        VALUES ( ?,?,?,?,?,?,?,? ) `,
    [
      voucher_type_id,
      voucher_no,
      contra_date,
      account_ledger_id,
      employee_under_id,
      total_amount,
      narration,
      created_by,
    ],
  );

  return result.insertId;
};

exports.insertContraEntry = async (connection, contraId, entry) => {
  const [result] = await connection.query(
    `
        INSERT INTO contra_entries (
            contra_id,
            ledger_id,
            amount,
            transaction_type,
            bank_name,
            entry_type,
            remarks

        )
        VALUES (
            ?,?,?,?,?,?,?
        )
        `,
    [
      contraId,
      entry.ledger_id,
      entry.amount,
      entry.transaction_type,
      entry.bank_name || null,
      entry.entry_type,
      entry.remarks || null,
    ],
  );

  return result.insertId;
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
      data.created_by,
    ],
  );
};

exports.getContraVoucher = async (contraId) => {
  const [contraRows] = await db.query(
    `
        SELECT

            c.id,
            c.voucher_type_id,
            c.voucher_no,
            c.contra_date,

            c.account_ledger_id,
            c.employee_under_id,

            c.total_amount,
            c.narration,

            al.ledger_name
                AS account_ledger_name,

            u.name
                AS employee_under_name

        FROM contra_master c

        LEFT JOIN ledgers al
            ON al.id = c.account_ledger_id

        LEFT JOIN users u
            ON u.id = c.employee_under_id

        WHERE c.id = ?
        `,
    [contraId],
  );

  if (!contraRows.length) {
    return null;
  }

  const contra = contraRows[0];

  const [entries] = await db.query(
    `
        SELECT
            ce.id,
            ce.ledger_id,
            l.ledger_name,
            ce.amount,
            ce.transaction_type,
            ce.bank_name,
            ce.entry_type,
            ce.remarks
        FROM contra_entries ce
        LEFT JOIN ledgers l ON l.id = ce.ledger_id
        WHERE ce.contra_id = ?
        ORDER BY ce.id ASC
        `,
    [contraId],
  );

  return {
    contra,
    entries,
  };
};

exports.validateContraLedger = async (connection, ledgerId) => {
  const [rows] = await connection.query(
    `
        SELECT l.id
        FROM ledgers l

        INNER JOIN account_groups ag
            ON ag.id = l.group_id

        WHERE l.id = ?
        AND ag.group_name IN (
            'Bank Account',
            'Cash-in-Hand'
        )
        `,
    [ledgerId],
  );

  return rows.length > 0;
};

exports.getContraInvoice = async (contraId) => {

    const [contraRows] = await db.query(
        ` SELECT
            cm.*,
            accountLedger.ledger_name AS account_ledge_name,
            accountLedger.gst_no AS account_ledger_gst,
            accountDetails.contact AS account_mobile,
            accountDetails.address AS account_address,
            underUser.name AS employee_under_name,
            createdUser.name AS created_by_name

        FROM contra_master cm

        LEFT JOIN ledgers accountLedger ON accountLedger.id = cm.account_ledger_id
        LEFT JOIN ledger_other_details accountDetails ON accountDetails.ledger_id = cm.account_ledger_id
        LEFT JOIN users underUser ON underUser.id = cm.employee_under_id
        LEFT JOIN users createdUser ON createdUser.id = cm.created_by
        WHERE cm.id = ?
        `,
        [contraId]
    );

    if (!contraRows.length) { return null; }

    const contra = contraRows[0];

    const [entries] = await db.query(
        ` SELECT
            ce.id,
            ce.contra_id,

            ce.ledger_id,
            l.ledger_name,
            l.gst_no,

            ce.amount,
            ce.transaction_type,
            ce.bank_name,
            ce.entry_type,
            ce.remarks

        FROM contra_entries ce

        LEFT JOIN ledgers l
            ON l.id = ce.ledger_id

        WHERE ce.contra_id = ?
        ORDER BY ce.id ASC
        `,
        [contraId]
    );

    return {
        contra,
        entries
    };
};