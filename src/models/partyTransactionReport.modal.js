const db = require("../config/db");

exports.getBillDropdown = async (transactionType, ledgerId) => {
  let query = "";
  let params = [ledgerId];

  switch (transactionType) {
    case "PURCHASE":
      query = `
                SELECT
                    id,
                    reference_no,
                    bill_amount,
                    pending_amount,
                    status
                FROM purchase_bill_references
                WHERE ledger_id = ?
                ORDER BY id DESC
            `;
      break;

    case "SALES":
      query = `
                SELECT
                    id,
                    reference_no,
                    bill_amount,
                    pending_amount,
                    status
                FROM sales_bill_references
                WHERE ledger_id = ?
                ORDER BY id DESC
            `;
      break;

    case "PAYMENT":
      query = `
                SELECT
                    id,
                    reference_no,
                    reference_amount AS bill_amount,
                    0 AS pending_amount,
                    reference_type AS status
                FROM payment_bill_references
                WHERE supplier_ledger_id = ?
                ORDER BY id DESC
            `;
      break;

    case "RECEIPT":
      query = `
                SELECT
                    id,
                    reference_no,
                    reference_amount AS bill_amount,
                    0 AS pending_amount,
                    reference_type AS status
                FROM receipt_bill_references
                WHERE customer_ledger_id = ?
                ORDER BY id DESC
            `;
      break;

    case "DEBIT_NOTE":
      query = `
                SELECT
                    id,
                    purchase_bill_reference_id AS linked_bill_id,
                    amount AS bill_amount
                FROM debit_note_bill_references
                WHERE supplier_ledger_id = ?
                ORDER BY id DESC
            `;
      break;

    case "CREDIT_NOTE":
      query = `
                SELECT
                    id,
                    sales_bill_reference_id AS linked_bill_id,
                    amount AS bill_amount
                FROM credit_note_bill_references
                WHERE customer_ledger_id = ?
                ORDER BY id DESC
            `;
      break;

    case "JOURNAL":
      query = `
                SELECT
                    id,
                    reference_no,
                    amount AS bill_amount
                FROM journal_bill_references
                WHERE ledger_id = ?
                ORDER BY id DESC
            `;
      break;

    default:
      return [];
  }

  const [rows] = await db.query(query, params);

  return rows;
};

exports.getPartyTransactionReport = async ({
  transaction_type,
  employee_id,
  ledger_id,
  voucher_no,
  bill_id,
  from_date,
  to_date,
  page = 1,
  limit = 20,
}) => {
  const offset = (page - 1) * limit;
  let where = `  WHERE lt.is_cancelled = 0 `;
  const params = [];

  if (transaction_type) { where += ` AND lt.transaction_type = ? `;
    params.push(transaction_type);
  }

  if (ledger_id) { where += `  AND lt.ledger_id = ? `;
    params.push(ledger_id);
  }

  if (voucher_no) { where += `  AND lt.voucher_no  LIKE ?  `;
    params.push(`%${voucher_no}%`);
  }

  if (from_date && to_date) { where += `  AND lt.transaction_date  BETWEEN ? AND ? `;
    params.push(from_date, to_date);
  }

  if (employee_id) {
    where += `
            AND (
                p.employee_under_id = ?
                OR s.employee_under_id = ?
                OR dn.employee_under_id = ?
                OR cn.employee_under_id = ?
                OR pay.employee_under_id = ?
                OR rec.employee_under_id = ?
                OR jm.employee_under_id = ?
                OR cm.employee_under_id = ?
            )
        `;

    params.push(
      employee_id,
      employee_id,
      employee_id,
      employee_id,
      employee_id,
      employee_id,
      employee_id,
      employee_id,
    );
  }

  if (bill_id) { where += `  AND (  pbr.id = ?  OR sbr.id = ? ) `;
    params.push(bill_id, bill_id);
  }

  const [countRows] = await db.query(
    `
            SELECT
                COUNT(DISTINCT lt.id) total

            FROM ledger_transactions lt

            LEFT JOIN purchases p
                ON lt.reference_id = p.id
                AND lt.transaction_type='PURCHASE'

            LEFT JOIN sales s
                ON lt.reference_id = s.id
                AND lt.transaction_type='SALES'

            LEFT JOIN purchase_bill_references pbr
                ON pbr.purchase_id = p.id

            LEFT JOIN sales_bill_references sbr
                ON sbr.sale_id = s.id

            LEFT JOIN debit_notes dn
                ON lt.reference_id = dn.id
                AND lt.transaction_type='DEBIT_NOTE'

            LEFT JOIN credit_notes cn
                ON lt.reference_id = cn.id
                AND lt.transaction_type='CREDIT_NOTE'

            LEFT JOIN payments pay
                ON lt.reference_id = pay.id
                AND lt.transaction_type='PAYMENT'

            LEFT JOIN receipts rec
                ON lt.reference_id = rec.id
                AND lt.transaction_type='RECEIPT'

            LEFT JOIN journal_master jm
                ON lt.reference_id = jm.id
                AND lt.transaction_type='JOURNAL'

            LEFT JOIN contra_master cm
                ON lt.reference_id = cm.id
                AND lt.transaction_type='CONTRA'

            ${where}
            `,
    params,
  );

  const [totalAmountRows] = await db.query(
    `
    SELECT
        SUM(x.bill_amount) AS grandTotal
    FROM (
        SELECT
            lt.id,
           
            lt.amount AS bill_amount

        FROM ledger_transactions lt

        LEFT JOIN purchases p
            ON lt.reference_id = p.id
            AND lt.transaction_type = 'PURCHASE'

        LEFT JOIN sales s
            ON lt.reference_id = s.id
            AND lt.transaction_type = 'SALES'

        LEFT JOIN purchase_bill_references pbr
            ON pbr.purchase_id = p.id

        LEFT JOIN sales_bill_references sbr
            ON sbr.sale_id = s.id

        LEFT JOIN debit_notes dn
            ON lt.reference_id = dn.id
            AND lt.transaction_type = 'DEBIT_NOTE'

        LEFT JOIN credit_notes cn
            ON lt.reference_id = cn.id
            AND lt.transaction_type = 'CREDIT_NOTE'

        LEFT JOIN payments pay
            ON lt.reference_id = pay.id
            AND lt.transaction_type = 'PAYMENT'

        LEFT JOIN receipts rec
            ON lt.reference_id = rec.id
            AND lt.transaction_type = 'RECEIPT'

        LEFT JOIN journal_master jm
            ON lt.reference_id = jm.id
            AND lt.transaction_type = 'JOURNAL'

        LEFT JOIN contra_master cm
            ON lt.reference_id = cm.id
            AND lt.transaction_type = 'CONTRA'

        ${where}

        GROUP BY lt.id
    ) x
    `,
    params,
  );
  const grandTotal = Number(totalAmountRows[0]?.grandTotal || 0);
  const totalRecords = countRows[0].total;

  const [rows] = await db.query(
    ` SELECT
                lt.id, lt.reference_id,
                lt.transaction_date AS bill_date,
                l.ledger_name,
                u.name AS employee_name,
                lt.transaction_type,
                lt.voucher_no,
                lt.amount AS bill_amount,
                lt.entry_type,

GROUP_CONCAT(
    DISTINCT COALESCE(
        pbr.reference_type,
        sbr.reference_type
    )
) AS reference_type,

SUM(
    COALESCE(
        pbr.pending_amount,
        sbr.pending_amount,
        0
    )
) AS bill_due_amount,

GROUP_CONCAT(
    DISTINCT COALESCE(
        pbr.reference_no,
        sbr.reference_no
    )
) AS reference_no,

CASE
    WHEN SUM(
        COALESCE(
            pbr.pending_amount,
            sbr.pending_amount,
            0
        )
    ) = 0
    THEN 'Yes'
    ELSE 'No'
END AS bill_used,

    CASE

    WHEN lt.transaction_type = 'PURCHASE'
    THEN purchaseLedger.ledger_name

    WHEN lt.transaction_type = 'SALES'
    THEN salesLedger.ledger_name

    WHEN lt.transaction_type = 'CREDIT_NOTE'
    THEN creditReturnLedger.ledger_name

    WHEN lt.transaction_type = 'DEBIT_NOTE'
    THEN debitReturnLedger.ledger_name

    ELSE NULL

END AS sub_ledger,
                (
                    SELECT GROUP_CONCAT(reference_no)
                    FROM purchase_bill_references
                    WHERE purchase_id = p.id
                )
                    AS purchase_bill,

                (
                    SELECT GROUP_CONCAT(reference_no)
                    FROM sales_bill_references
                    WHERE sale_id = s.id
                )
                    AS sales_bill

            FROM ledger_transactions lt

            LEFT JOIN ledgers l
                ON l.id =
                lt.ledger_id

                    


            LEFT JOIN users u
                ON u.id =
                l.employee_under

            LEFT JOIN purchases p
                ON p.id =
                lt.reference_id
                AND lt.transaction_type='PURCHASE'

            LEFT JOIN sales s
                ON s.id =
                lt.reference_id
                AND lt.transaction_type='SALES'

            LEFT JOIN purchase_bill_references pbr
                ON pbr.purchase_id = p.id


            LEFT JOIN sales_bill_references sbr
                ON sbr.sale_id = s.id

            LEFT JOIN debit_notes dn
                ON dn.id =
                lt.reference_id
                AND lt.transaction_type='DEBIT_NOTE'

            LEFT JOIN credit_notes cn
                ON cn.id =
                lt.reference_id
                AND lt.transaction_type='CREDIT_NOTE'

            LEFT JOIN payments pay
                ON pay.id =
                lt.reference_id
                AND lt.transaction_type='PAYMENT'

            LEFT JOIN receipts rec
                ON rec.id =
                lt.reference_id
                AND lt.transaction_type='RECEIPT'

            LEFT JOIN journal_master jm
                ON jm.id =
                lt.reference_id
                AND lt.transaction_type='JOURNAL'

            LEFT JOIN contra_master cm
                ON cm.id =
                lt.reference_id
                AND lt.transaction_type='CONTRA'
    
                LEFT JOIN ledgers purchaseLedger
    ON purchaseLedger.id = p.purchase_ledger_id

LEFT JOIN ledgers salesLedger
    ON salesLedger.id = s.sales_ledger_id

LEFT JOIN ledgers creditReturnLedger
    ON creditReturnLedger.id = cn.sales_return_ledger_id

LEFT JOIN ledgers debitReturnLedger
    ON debitReturnLedger.id = dn.purchase_return_ledger_id



            ${where}

            GROUP BY lt.id

            ORDER BY
                lt.transaction_date DESC,
                lt.id DESC

            LIMIT ?
            OFFSET ?
            `,
    [...params, Number(limit), Number(offset)],
  );

  return {
    rows,
    totalRecords,
    grandTotal,
    currentPage: Number(page),
    totalPages: Math.ceil(totalRecords / limit),
  };
};

exports.deleteTransaction = async ( connection, transactionType, referenceId, userId) => {

  const [rows] = await connection.query(
    `
    SELECT id
    FROM ledger_transactions
    WHERE transaction_type = ?
      AND reference_id = ?
      AND is_cancelled = 0
    LIMIT 1
    `,
    [transactionType, referenceId]
  );

  if (!rows.length) {
    throw new Error("Transaction not found or already cancelled");
  }

  await connection.query(
    `
    UPDATE ledger_transactions
    SET
      is_cancelled = 1,
      cancelled_at = NOW(),
      cancelled_by = ?
    WHERE
      transaction_type = ?
      AND reference_id = ?
    `,
    [userId, transactionType, referenceId]
  );

  return true;
};