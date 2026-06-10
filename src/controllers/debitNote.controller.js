const db = require("../config/db");
const debitNoteModel = require("../models/debitNote.model");
const purchaseModel = require("../models/purchaseTxnMaster.model");
const generateVoucherNo = require("../utils/generateVoucherNo");
const creditNoteModal = require("../models/creditNote.model");

exports.createDebitNote = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    const data = req.body;
    const voucherData = await generateVoucherNo("DEBIT_NOTE");

    const { voucher_no, voucher_type_id, nextSequence } = voucherData;

    /*
    =================================
    RETURN QTY VALIDATION
    =================================
    */

    for (const item of data.items) {
      const purchasedQty = await debitNoteModel.getPurchasedQtyByInvoice(
        connection,
        data.original_purchase_id,
        item.stock_item_id,
        item.godown_id,
        item.batch_no || null,
      );

      const alreadyReturnedQty = await debitNoteModel.getReturnedQtyByInvoice(
        connection,
        data.original_purchase_id,
        item.stock_item_id,
        item.godown_id,
        item.batch_no || null,
      );

      const availableToReturn = purchasedQty - alreadyReturnedQty;

      if (Number(item.return_qty) > Number(availableToReturn)) {
        throw new Error(
          `Return Qty exceeds purchased qty for Item ID ${item.stock_item_id}.
Purchased Qty: ${purchasedQty},
Already Returned: ${alreadyReturnedQty},
Available To Return: ${availableToReturn},
Trying To Return: ${item.return_qty}`,
        );
      }

      const currentStock = await creditNoteModal.getAvailableStock(
        connection,
        item.stock_item_id,
        item.godown_id,
        item.batch_no || null,
      );

      if (Number(item.return_qty) > Number(currentStock)) {
        throw new Error(
          `Insufficient stock for Item ID ${item.stock_item_id}.
       Current Stock: ${currentStock}
       Trying To Return: ${item.return_qty}`,
        );
      }
    }

    /*
    =================================
    CREATE DEBIT NOTE
    =================================
    */

    const debitNoteId = await debitNoteModel.createDebitNote(connection, {
      ...data,
      voucher_no,
      voucher_type_id,
      created_by: req.user.id,
    });

    /*
    =================================
    ITEMS + STOCK
    =================================
    */

    for (const item of data.items) {
      await debitNoteModel.insertDebitNoteItem(connection, item, debitNoteId);

      await debitNoteModel.insertDebitNoteStockTransaction(
        connection,
        item,
        debitNoteId,
        data.debit_note_date,
        req.user.id,
      );
    }

    /*
    =================================
    SUPPLIER DR
    =================================
    */

    await debitNoteModel.insertLedgerTransaction(connection, {
      transaction_type: "DEBIT_NOTE",
      reference_id: debitNoteId,
      voucher_no,
      voucher_type_id,
      transaction_date: data.debit_note_date,
      ledger_id: data.supplier_ledger_id,
      entry_type: "Dr",
      amount: data.total_amount,
      remarks: "Supplier Account",
      created_by: req.user.id,
    });

    /*
    =================================
    PURCHASE RETURN CR
    =================================
    */

    await debitNoteModel.insertLedgerTransaction(connection, {
      transaction_type: "DEBIT_NOTE",
      reference_id: debitNoteId,
      voucher_no,
      voucher_type_id,
      transaction_date: data.debit_note_date,
      ledger_id: data.purchase_return_ledger_id,
      entry_type: "Cr",
      amount: data.subtotal,
      remarks: "Purchase Return",
      created_by: req.user.id,
    });

    /*
    =================================
    GST LEDGERS
    =================================
    */

    const cgstLedger = await purchaseModel.getLedgerByName(connection, "CGST");
    const sgstLedger = await purchaseModel.getLedgerByName(connection, "SGST");
    const igstLedger = await purchaseModel.getLedgerByName(connection, "IGST");

    /*
    =================================
    IGST CR
    =================================
    */

    if (Number(data.igst_total) > 0 && igstLedger) {
      await debitNoteModel.insertLedgerTransaction(connection, {
        transaction_type: "DEBIT_NOTE",
        reference_id: debitNoteId,
        voucher_no,
        voucher_type_id,
        transaction_date: data.debit_note_date,
        ledger_id: igstLedger.id,
        entry_type: "Cr",
        amount: data.igst_total,
        remarks: "IGST Reversal",
        created_by: req.user.id,
      });
    }

    /*
    =================================
    CGST CR
    =================================
    */

    if (Number(data.cgst_total) > 0 && cgstLedger) {
      await debitNoteModel.insertLedgerTransaction(connection, {
        transaction_type: "DEBIT_NOTE",
        reference_id: debitNoteId,
        voucher_no,
        voucher_type_id,
        transaction_date: data.debit_note_date,
        ledger_id: cgstLedger.id,
        entry_type: "Cr",
        amount: data.cgst_total,
        remarks: "CGST Reversal",
        created_by: req.user.id,
      });
    }

    /*
    =================================
    SGST CR
    =================================
    */

    if (Number(data.sgst_total) > 0 && sgstLedger) {
      await debitNoteModel.insertLedgerTransaction(connection, {
        transaction_type: "DEBIT_NOTE",
        reference_id: debitNoteId,
        voucher_no,
        voucher_type_id,
        transaction_date: data.debit_note_date,
        ledger_id: sgstLedger.id,
        entry_type: "Cr",
        amount: data.sgst_total,
        remarks: "SGST Reversal",
        created_by: req.user.id,
      });
    }

    /*
    =================================
    BILL REFERENCES
    =================================
    */

      const billRefs = await debitNoteModel.getPurchaseBillReferencesByPurchaseId(
      connection,
      data.original_purchase_id,
    );

    let remainingAmount = Number(data.total_amount);

    for (const bill of billRefs) {
      if (remainingAmount <= 0) break;

      const adjustAmount = Math.min(
        remainingAmount,
        Number(bill.pending_amount),
      );

      await debitNoteModel.insertDebitNoteBillReference(connection, {
        debit_note_id: debitNoteId,
        supplier_ledger_id: data.supplier_ledger_id,
        purchase_bill_reference_id: bill.id,
        amount: adjustAmount,
      });

      await debitNoteModel.updatePurchaseBillReference(
        connection,
        bill.id,
        adjustAmount,
      );

      remainingAmount -= adjustAmount;
    }

    /*
    =================================
    UPDATE VOUCHER SEQUENCE
    =================================
    */

    await connection.query(
      `
      UPDATE voucher_types
      SET current_sequence = ?
      WHERE id = ?
      `,
      [nextSequence, voucher_type_id],
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Debit Note created successfully",
      debit_note_id: debitNoteId,
      voucher_no,
    });
  } catch (error) {
    await connection.rollback();

    console.log("DEBIT NOTE ERROR =>", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    connection.release();
  }
};

exports.getPurchasesBySupplier = async (req, res) => {
  try {
    const { supplier_ledger_id } = req.query;

    if (!supplier_ledger_id) {
      return res.status(400).json({
        success: false,
        message: "supplier_ledger_id is required",
      });
    }

    const purchases =
      await debitNoteModel.getPurchasesBySupplier(supplier_ledger_id);

    return res.status(200).json({
      success: true,
      data: purchases,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getPurchaseItemsById = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { purchaseId } = req.params;

    const data = await debitNoteModel.getPurchaseItemsById(
      connection,
      purchaseId,
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    connection.release();
  }
};
