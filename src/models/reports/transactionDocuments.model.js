const db = require("../../config/db");
const { getPresignedUrl } = require("../../utils/fileUpload"); 

const TRANSACTION_CONFIG = {
  Sales: {
    table: "sales", dateColumn: "sales_date", voucherColumn: "voucher_no",
    billTColumn: "bill_t_image", dispatchColumn: "dispatch_doc_image",
    attachmentColumn: null, approvalType: "SALES",
  },
  Purchase: {
    table: "purchases", dateColumn: "purchase_date", voucherColumn: "voucher_no",
    billTColumn: "bill_t_image", dispatchColumn: "dispatch_doc_image",
    attachmentColumn: null, approvalType: "PURCHASE",
  },
  "Credit Note": {
    table: "credit_notes", dateColumn: "credit_note_date", voucherColumn: "voucher_no",
    billTColumn: "bill_t_image", dispatchColumn: "dispatch_doc_image",
    attachmentColumn: null, approvalType: "CREDITNOTE",
  },
  "Debit Note": {
    table: "debit_notes", dateColumn: "debit_note_date", voucherColumn: "voucher_no",
    billTColumn: "bill_t_image", dispatchColumn: "dispatch_doc_image",
    attachmentColumn: null, approvalType: "DEBITNOTE",
  },
  Receipt: {
    table: "receipts", dateColumn: "receipt_date", voucherColumn: "voucher_no",
    billTColumn: null, dispatchColumn: null,
    attachmentColumn: "attachment", approvalType: "RECEIPT",
  },
  Payment: {
    table: "payments", dateColumn: "payment_date", voucherColumn: "voucher_no",
    billTColumn: null, dispatchColumn: null,
    attachmentColumn: "attachment", approvalType: "PAYMENT",
  },
};

exports.getAvailableTransactionTypes = () => Object.keys(TRANSACTION_CONFIG);

const toPresignedUrl = async (objectPath) => {
  if (!objectPath) return null;
  try {
    return await getPresignedUrl(objectPath);
  } catch (err) {
    console.error(`Failed to presign ${objectPath}:`, err.message);
    return null;
  }
};

exports.getTransactionDocuments = async (
  transactionType,
  fromDate,
  toDate,
  page = 1,
  limit = 10,
  search = "",
) => {
  const config = TRANSACTION_CONFIG[transactionType];
  if (!config) {
    throw new Error(`Invalid transaction type: ${transactionType}`);
  }

  const {
    table, dateColumn, voucherColumn,
    billTColumn, dispatchColumn, attachmentColumn,
    approvalType,
  } = config;

  const billTSelect = billTColumn ? `t.${billTColumn}` : "NULL";
  const dispatchSelect = dispatchColumn ? `t.${dispatchColumn}` : "NULL";
  const attachmentSelect = attachmentColumn ? `t.${attachmentColumn}` : "NULL";

  // Shared WHERE clause + params for both the count query and the page query
  const whereClauses = [`t.${dateColumn} BETWEEN ? AND ?`];
  const whereParams = [fromDate, toDate];

  if (search && search.trim()) {
    whereClauses.push(`t.${voucherColumn} LIKE ?`);
    whereParams.push(`%${search.trim()}%`);
  }

  const whereSql = whereClauses.join(" AND ");

  // 1) total count (for pagination) — no LIMIT/OFFSET here
  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM ${table} t WHERE ${whereSql}`,
    whereParams,
  );
  const total = countRows[0]?.total || 0;

  const safeLimit = Math.max(1, Number(limit) || 10);
  const safePage = Math.max(1, Number(page) || 1);
  const offset = (safePage - 1) * safeLimit;

  // 2) actual page of rows
  const [rows] = await db.query(
    `
    SELECT
      t.id                AS transaction_id,
      t.${voucherColumn}  AS transaction_no,
      t.${dateColumn}     AS transaction_date,
      ${billTSelect}      AS bill_t_doc,
      ${dispatchSelect}   AS dispatch_doc,
      ${attachmentSelect} AS direct_attachment,
      ta.payload_json     AS approval_payload_json
    FROM ${table} t
    LEFT JOIN transaction_approvals ta
      ON ta.final_transaction_id = t.id
      AND ta.transaction_type = ?
    WHERE ${whereSql}
    ORDER BY t.${dateColumn} DESC
    LIMIT ? OFFSET ?
    `,
    [approvalType, ...whereParams, safeLimit, offset],
  );

  const resolvedRows = rows.map((row) => {
    let othersPath = row.direct_attachment || null;
    let billTPath = row.bill_t_doc;
    let dispatchPath = row.dispatch_doc;

    if (row.approval_payload_json) {
      try {
        const outer = JSON.parse(row.approval_payload_json);
        othersPath = outer.orderBillImageUrl || outer.orderBillImage || othersPath;
        if (!billTPath && outer.billTImageUrl) billTPath = outer.billTImageUrl;
        if (!dispatchPath && outer.dispatchDocImageUrl) dispatchPath = outer.dispatchDocImageUrl;
      } catch (err) {
        // malformed payload_json — keep direct-table values
      }
    }

    return {
      transaction_no: row.transaction_no,
      transaction_date: row.transaction_date,
      bill_t_path: billTPath,
      dispatch_path: dispatchPath,
      others_path: othersPath,
    };
  });

  const entries = await Promise.all(
    resolvedRows.map(async (row) => {
      const [bill_t_doc, dispatch_doc, others] = await Promise.all([
        toPresignedUrl(row.bill_t_path),
        toPresignedUrl(row.dispatch_path),
        toPresignedUrl(row.others_path),
      ]);

      return {
        transaction_no: row.transaction_no,
        transaction_date: row.transaction_date,
        bill_t_doc,
        dispatch_doc,
        others,
      };
    }),
  );

  return {
    entries,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      total_pages: Math.ceil(total / safeLimit) || 0,
    },
  };
};