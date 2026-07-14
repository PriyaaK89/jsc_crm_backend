const purchaseModel = require("../../models/purchaseTxnMaster.model");
const generateVoucherNo = require("../../utils/generateVoucherNo");
const validateVoucherDate = require("../../utils/validateVoucherDate");

exports.executeApprovedPurchase = async (connection, payload, createdBy) => {
  const data = typeof payload === "string" ? JSON.parse(payload) : payload;
  data.items = typeof data.items === "string" ? JSON.parse(data.items) : data.items || [];
  data.extra_ledgers = typeof data.extra_ledgers === "string" ? JSON.parse(data.extra_ledgers) : data.extra_ledgers || [];

  const bill_t_image = data.bill_t_image || null;
  const dispatch_doc_image = data.dispatch_doc_image || null;

  await validateVoucherDate(connection, "PURCHASE", data.purchase_date);

  const voucherData = await generateVoucherNo("PURCHASE");
  const { voucher_no, voucher_type_id, nextSequence } = voucherData;

  const purchaseId = await purchaseModel.createPurchase(connection, {
    ...data,
    voucher_no,
    bill_t_image,
    dispatch_doc_image,
    created_by: createdBy,
  });

  for (const item of data.items) {
    const purchaseItemId = await purchaseModel.insertPurchaseItem(connection, item, purchaseId);
    if (item.batch_no) {
      await purchaseModel.insertPurchaseBatch(connection, item, purchaseItemId);
    }
    await purchaseModel.insertStockTransaction(connection, item, purchaseId, data.purchase_date, createdBy);
  }

  await purchaseModel.insertLedgerTransaction(connection, {
    transaction_type: "PURCHASE",
    reference_id: purchaseId,
    voucher_no,
    voucher_type_id,
    transaction_date: data.purchase_date,
    ledger_id: data.purchase_ledger_id,
    entry_type: "Dr",
    amount: data.subtotal,
    remarks: "Purchase Account",
    created_by: createdBy,
  });

  const cgstLedger = await purchaseModel.getLedgerByName(connection, "CGST");
  const sgstLedger = await purchaseModel.getLedgerByName(connection, "SGST");
  const igstLedger = await purchaseModel.getLedgerByName(connection, "IGST");

  if (Number(data.igst_total || 0) > 0 && igstLedger) {
    await purchaseModel.insertLedgerTransaction(connection, {
      transaction_type: "PURCHASE", reference_id: purchaseId, voucher_no, voucher_type_id,
      transaction_date: data.purchase_date, ledger_id: igstLedger.id, entry_type: "Dr",
      amount: data.igst_total, remarks: "IGST Input", created_by: createdBy,
    });
  }

  if (Number(data.cgst_total || 0) > 0 && cgstLedger) {
    await purchaseModel.insertLedgerTransaction(connection, {
      transaction_type: "PURCHASE", reference_id: purchaseId, voucher_no, voucher_type_id,
      transaction_date: data.purchase_date, ledger_id: cgstLedger.id, entry_type: "Dr",
      amount: data.cgst_total, remarks: "CGST Input", created_by: createdBy,
    });
  }

  if (Number(data.sgst_total || 0) > 0 && sgstLedger) {
    await purchaseModel.insertLedgerTransaction(connection, {
      transaction_type: "PURCHASE", reference_id: purchaseId, voucher_no, voucher_type_id,
      transaction_date: data.purchase_date, ledger_id: sgstLedger.id, entry_type: "Dr",
      amount: data.sgst_total, remarks: "SGST Input", created_by: createdBy,
    });
  }

  await purchaseModel.insertLedgerTransaction(connection, {
    transaction_type: "PURCHASE",
    reference_id: purchaseId,
    voucher_no,
    voucher_type_id,
    transaction_date: data.purchase_date,
    ledger_id: data.supplier_ledger_id,
    entry_type: "Cr",
    amount: data.total_amount,
    remarks: "Supplier Account",
    created_by: createdBy,
  });

  const supplierLedger = await purchaseModel.getLedgerById(connection, data.supplier_ledger_id);

  if (supplierLedger?.maintain_bill_by_bill) {
    await purchaseModel.insertPurchaseBillReference(connection, {
      purchase_id: purchaseId,
      ledger_id: data.supplier_ledger_id,
      reference_type: data.reference_type || "NEW REF",
      reference_no: data.reference_no || data.supplier_invoice_no || voucher_no,
      bill_amount: data.total_amount,
      pending_amount: data.total_amount,
      due_date: data.due_date || null,
    });
  }

  await connection.query(`UPDATE voucher_types SET current_sequence = ? WHERE id = ?`, [nextSequence, voucher_type_id]);

  return { purchaseId, voucher_no, voucher_type_id };
};