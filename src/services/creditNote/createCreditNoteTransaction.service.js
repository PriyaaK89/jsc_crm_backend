const creditNoteModel = require("../../models/creditNote.model");
const purchaseModal = require("../../models/purchaseTxnMaster.model");
const generateVoucherNo = require("../../utils/generateVoucherNo");
const validateVoucherDate = require("../../utils/validateVoucherDate");

exports.executeApprovedCreditNote = async (connection, payload, createdBy) => {
  const data = typeof payload === "string" ? JSON.parse(payload) : payload;
  data.items = typeof data.items === "string" ? JSON.parse(data.items) : data.items || [];
  data.bill_references =
    typeof data.bill_references === "string"
      ? JSON.parse(data.bill_references)
      : data.bill_references || [];

  const dispatchDocImage = data.dispatch_doc_image || null;
  const billTImage = data.bill_t_image || null;

  await validateVoucherDate(connection, "CREDIT_NOTE", data.credit_note_date);
  const voucherData = await generateVoucherNo("CREDIT_NOTE");
  const { voucher_no, voucher_type_id, nextSequence } = voucherData;

  /* RETURN QTY VALIDATION — re-checked here (not just at request time),
     because sold/returned qty could have changed while this sat in approval */
  for (const item of data.items) {
    const soldQty = await creditNoteModel.getSoldQtyByInvoice(
      connection,
      data.original_sale_id,
      item.stock_item_id,
      item.godown_id,
      item.batch_no || null,
    );
    const alreadyReturnedQty = await creditNoteModel.getReturnedQtyByInvoice(
      connection,
      data.original_sale_id,
      item.stock_item_id,
      item.godown_id,
      item.batch_no || null,
    );
    const availableToReturn = soldQty - alreadyReturnedQty;

    if (Number(item.return_qty) > Number(availableToReturn)) {
      throw new Error(
        `Return Qty exceeds sold qty for Item ID ${item.stock_item_id}. Available To Return: ${availableToReturn}, Trying To Return: ${item.return_qty}`,
      );
    }
  }

  /* CREATE CREDIT NOTE MASTER */
  const creditNoteId = await creditNoteModel.createCreditNote(connection, {
    ...data,
    voucher_no,
    voucher_type_id,
    bill_t_image: billTImage,
    dispatch_doc_image: dispatchDocImage,
    assign_employee_id: data.assign_employee_id || null,
    employee_under_id: data.employee_under_id || null,
    created_by: createdBy,
  });

  /* ITEMS + STOCK TXNS */
  for (const item of data.items) {
    await creditNoteModel.insertCreditNoteItem(connection, item, creditNoteId);
    await creditNoteModel.insertCreditNoteStockTransaction(
      connection,
      item,
      creditNoteId,
      data.credit_note_date,
      createdBy,
    );
  }

  /* CUSTOMER CR */
  await creditNoteModel.insertLedgerTransaction(connection, {
    transaction_type: "CREDIT_NOTE",
    reference_id: creditNoteId,
    voucher_no,
    voucher_type_id,
    transaction_date: data.credit_note_date,
    ledger_id: data.customer_ledger_id,
    entry_type: "Cr",
    amount: data.total_amount,
    remarks: "Customer Account",
    created_by: createdBy,
  });

  /* SALES RETURN DR */
  await creditNoteModel.insertLedgerTransaction(connection, {
    transaction_type: "CREDIT_NOTE",
    reference_id: creditNoteId,
    voucher_no,
    voucher_type_id,
    transaction_date: data.credit_note_date,
    ledger_id: data.sales_return_ledger_id,
    entry_type: "Dr",
    amount: data.subtotal,
    remarks: "Sales Return",
    created_by: createdBy,
  });

  /* GST REVERSAL LEDGERS */
  const cgstLedger = await purchaseModal.getLedgerByName(connection, "CGST");
  const sgstLedger = await purchaseModal.getLedgerByName(connection, "SGST");
  const igstLedger = await purchaseModal.getLedgerByName(connection, "IGST");

  if (Number(data.igst_total || 0) > 0 && igstLedger) {
    await creditNoteModel.insertLedgerTransaction(connection, {
      transaction_type: "CREDIT_NOTE",
      reference_id: creditNoteId,
      voucher_no,
      voucher_type_id,
      transaction_date: data.credit_note_date,
      ledger_id: igstLedger.id,
      entry_type: "Dr",
      amount: data.igst_total,
      remarks: "IGST Reversal",
      created_by: createdBy,
    });
  }

  if (Number(data.cgst_total || 0) > 0 && cgstLedger) {
    await creditNoteModel.insertLedgerTransaction(connection, {
      transaction_type: "CREDIT_NOTE",
      reference_id: creditNoteId,
      voucher_no,
      voucher_type_id,
      transaction_date: data.credit_note_date,
      ledger_id: cgstLedger.id,
      entry_type: "Dr",
      amount: data.cgst_total,
      remarks: "CGST Reversal",
      created_by: createdBy,
    });
  }

  if (Number(data.sgst_total || 0) > 0 && sgstLedger) {
    await creditNoteModel.insertLedgerTransaction(connection, {
      transaction_type: "CREDIT_NOTE",
      reference_id: creditNoteId,
      voucher_no,
      voucher_type_id,
      transaction_date: data.credit_note_date,
      ledger_id: sgstLedger.id,
      entry_type: "Dr",
      amount: data.sgst_total,
      remarks: "SGST Reversal",
      created_by: createdBy,
    });
  }

  /* BILL REFERENCES */
  if (Array.isArray(data.bill_references)) {
    for (const billRef of data.bill_references) {
      await creditNoteModel.insertCreditNoteBillReference(connection, {
        credit_note_id: creditNoteId,
        customer_ledger_id: data.customer_ledger_id,
        sales_bill_reference_id: billRef.sales_bill_reference_id,
        amount: billRef.amount,
      });

      await creditNoteModel.updateSalesBillReference(
        connection,
        billRef.sales_bill_reference_id,
        billRef.amount,
      );
    }
  }

  await connection.query(
    `UPDATE voucher_types SET current_sequence = ? WHERE id = ?`,
    [nextSequence, voucher_type_id],
  );

  return { creditNoteId, voucher_no, voucher_type_id };
};