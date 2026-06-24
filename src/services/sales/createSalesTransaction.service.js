const salesModel = require("../../models/sales.model");
const purchaseModal = require("../../models/purchaseTxnMaster.model");
const generateVoucherNo = require("../../utils/generateVoucherNo");

exports.executeApprovedSales = async (connection, payload, createdBy) => {

  const data = typeof payload === "string" ? JSON.parse(payload) : payload;
  data.items = typeof data.items === "string" ? JSON.parse(data.items) : data.items || [];
  data.extra_ledgers = typeof data.extra_ledgers === "string" ? JSON.parse(data.extra_ledgers) : data.extra_ledgers || [];
  const dispatchDocImage = data.dispatch_doc_image || null;
  const billTImage = data.bill_t_image || null;

  /* VOUCHER */
  const voucherData = await generateVoucherNo("SALES");
  const { voucher_no, voucher_type_id, nextSequence } = voucherData;

  /* STOCK VALIDATION */

  for (const item of data.items) {
     console.log("APPROVAL ITEM =>", {
    stock_item_id: item.stock_item_id,
    godown_id: item.godown_id,
    batch_no: item.batch_no,
    billed_qty: item.billed_qty,
  });

    const availableStock = await salesModel.getAvailableStock(
      connection,
      item.stock_item_id,
      item.godown_id,
      item.batch_no || null,
    );

      console.log("AVAILABLE STOCK =>", availableStock);

    if (Number(availableStock) < Number(item.billed_qty)) {
      throw new Error( `Insufficient stock for Item ID ${item.stock_item_id}. Available: ${availableStock} Required: ${item.billed_qty}`, );
    }
  }

  /* CREATE SALES MASTER */

  const saleId = await salesModel.createSales(connection, {
    ...data,
    dispatch_doc_image: dispatchDocImage,
    bill_t_image: billTImage,
    voucher_no,
    created_by: createdBy,
  });

  /* SALES ITEMS */

  for (const item of data.items) {
    const salesItemId = await salesModel.insertSalesItem( connection, item, saleId, );

    if (item.batch_no) { await salesModel.insertSalesBatch(connection, item, salesItemId);}

    await salesModel.insertSalesStockTransaction(connection,item,saleId,data.sales_date,createdBy, );}

  /* EXTRA LEDGERS */

  if (data.extra_ledgers?.length) {
    for (const ledger of data.extra_ledgers) {
      await salesModel.insertExtraLedger(connection, {
        sale_id: saleId,
        ledger_id: ledger.ledger_id,
        amount: ledger.amount,
        operation: ledger.operation,
        comments: ledger.comments,
      });

      await salesModel.insertLedgerTransaction(connection, {
        transaction_type: "SALES",
        reference_id: saleId,
        voucher_no,
        voucher_type_id,
        transaction_date: data.sales_date,
        ledger_id: ledger.ledger_id,
        entry_type: ledger.operation === "PLUS" ? "Cr" : "Dr",
        amount: ledger.amount,
        remarks: ledger.comments,
        created_by: createdBy,
      });
    }
  }

  /* CUSTOMER DR */
  await salesModel.insertLedgerTransaction(connection, {
    transaction_type: "SALES",
    reference_id: saleId,
    voucher_no,
    voucher_type_id,
    transaction_date: data.sales_date,
    ledger_id: data.customer_ledger_id,
    entry_type: "Dr",
    amount: data.total_amount,
    remarks: "Customer Account",
    created_by: createdBy,
  });

  /* SALES ACCOUNT CR */
  await salesModel.insertLedgerTransaction(connection, {
    transaction_type: "SALES",
    reference_id: saleId,
    voucher_no,
    voucher_type_id,
    transaction_date: data.sales_date,
    ledger_id: data.sales_ledger_id,
    entry_type: "Cr",
    amount: data.subtotal,
    remarks: "Sales Account",
    created_by: createdBy,
  });

  /* GST LEDGERS */

  const cgstLedger = await purchaseModal.getLedgerByName(connection, "CGST");
  const sgstLedger = await purchaseModal.getLedgerByName(connection, "SGST");
  const igstLedger = await purchaseModal.getLedgerByName(connection, "IGST");

  /* IGST */

  if (Number(data.igst_total || 0) > 0 && igstLedger) {
    await salesModel.insertLedgerTransaction(connection, {
      transaction_type: "SALES",
      reference_id: saleId,
      voucher_no,
      voucher_type_id,
      transaction_date: data.sales_date,
      ledger_id: igstLedger.id,
      entry_type: "Cr",
      amount: data.igst_total,
      remarks: "IGST Output",
      created_by: createdBy,
    });
  }

  /* CGST */

  if (Number(data.cgst_total || 0) > 0 && cgstLedger) {
    await salesModel.insertLedgerTransaction(connection, {
      transaction_type: "SALES",
      reference_id: saleId,
      voucher_no,
      voucher_type_id,
      transaction_date: data.sales_date,
      ledger_id: cgstLedger.id,
      entry_type: "Cr",
      amount: data.cgst_total,
      remarks: "CGST Output",
      created_by: createdBy,
    });
  }

  /* SGST */
  if (Number(data.sgst_total || 0) > 0 && sgstLedger) {
    await salesModel.insertLedgerTransaction(connection, {
      transaction_type: "SALES",
      reference_id: saleId,
      voucher_no,
      voucher_type_id,
      transaction_date: data.sales_date,
      ledger_id: sgstLedger.id,
      entry_type: "Cr",
      amount: data.sgst_total,
      remarks: "SGST Output",
      created_by: createdBy,
    });
  }

  /* BILL REFERENCE */
  const customerLedger = await purchaseModal.getLedgerById( connection, data.customer_ledger_id, );

  if (customerLedger && customerLedger.maintain_bill_by_bill) {
    await salesModel.insertSalesBillReference(connection, {
      sale_id: saleId,
      ledger_id: data.customer_ledger_id,
      reference_type: data.reference_type || "NEW REF",
      reference_no: data.reference_no || voucher_no,
      reference_amount: data.total_amount,
      bill_amount: data.total_amount,
      pending_amount: data.total_amount,
      due_date: data.due_date || null,
    });
  }

  /* UPDATE VOUCHER SEQUENCE */
  await connection.query(` UPDATE voucher_types SET current_sequence = ? WHERE id = ? `, [nextSequence, voucher_type_id], );
  return { saleId, voucher_no, voucher_type_id, };
};