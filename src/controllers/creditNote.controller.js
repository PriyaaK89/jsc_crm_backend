const db = require("../config/db");
const creditNoteModel = require("../models/creditNote.model");
const purchaseModel = require("../models/purchaseTxnMaster.model");
const generateVoucherNo = require("../utils/generateVoucherNo");

exports.createCreditNote = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const data = req.body;

    const voucherData = await generateVoucherNo("CREDIT_NOTE");

    const { voucher_no, voucher_type_id, nextSequence } = voucherData;

        /*
=================================
RETURN QTY VALIDATION
=================================
*/

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
          `Return Qty exceeds sold qty for Item ID ${item.stock_item_id}.
            Sold Qty: ${soldQty},
            Already Returned: ${alreadyReturnedQty},
            Available To Return: ${availableToReturn},
            Trying To Return: ${item.return_qty}`,
        );
      }
    }

    const creditNoteId = await creditNoteModel.createCreditNote(connection, {
      ...data,
      voucher_no,
      voucher_type_id,
      created_by: req.user.id,
    });

    for (const item of data.items) {
      await creditNoteModel.insertCreditNoteItem(
        connection,
        item,
        creditNoteId,
      );

      await creditNoteModel.insertCreditNoteStockTransaction(
        connection,
        item,
        creditNoteId,
        data.credit_note_date,
        req.user.id,
      );
    }

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

      created_by: req.user.id,
    });

    /*
        ===========================
        SALES RETURN DR
        ===========================
        */

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
      created_by: req.user.id,
    });

    /*
        ===========================
        GST LEDGERS
        ===========================
        */

    const cgstLedger = await purchaseModel.getLedgerByName(connection, "CGST");
    const sgstLedger = await purchaseModel.getLedgerByName(connection, "SGST");
    const igstLedger = await purchaseModel.getLedgerByName(connection, "IGST");

    /*
        ===========================
        IGST DR
        ===========================
        */

    if (Number(data.igst_total) > 0 && igstLedger) {
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
        created_by: req.user.id,
      });
    }

    /*
        ===========================
        CGST DR
        ===========================
        */

    if (Number(data.cgst_total) > 0 && cgstLedger) {
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
        created_by: req.user.id,
      });
    }

    /*
        ===========================
        SGST DR
        ===========================
        */

    if (Number(data.sgst_total) > 0 && sgstLedger) {
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
        created_by: req.user.id,
      });
    }

    /*
        ===========================
        BILL REFERENCES
        ===========================
        */

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
      ` UPDATE voucher_types
            SET current_sequence = ?
            WHERE id = ? `,
      [nextSequence, voucher_type_id],
    );



    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Credit Note created successfully",
      credit_note_id: creditNoteId,
      voucher_no,
    });
  } catch (error) {
    await connection.rollback();

    console.log("CREDIT NOTE ERROR =>", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    connection.release();
  }
};

exports.getSalesByCustomer = async (req, res) => {
  try {
    const { customer_ledger_id } = req.query;

    if (!customer_ledger_id) {
      return res.status(400).json({
        success: false,
        message: "customer_ledger_id is required",
      });
    }

    const sales = await creditNoteModel.getSalesByCustomer(customer_ledger_id);

    return res.status(200).json({
      success: true,
      data: sales,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getSaleItemsById = async (
  req,
  res
) => {
  try {

    const { saleId } = req.params;

    const data =
      await creditNoteModel.getSaleItemsById(
        db,
        saleId
      );

    res.status(200).json({
      success: true,
      data,
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message,
    });

  }
};
exports.getSalesBillReferences = async (req, res) => {
  try {
    const { sale_id } = req.query;
    console.log("sale_id received:", sale_id);

    if (!sale_id) {
      return res.status(400).json({
        success: false,
        message: "sale_id is required",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
        id,
        reference_no,
        reference_amount,
        pending_amount,
        due_date
      FROM sales_bill_references
      WHERE sale_id = ?
      AND pending_amount > 0
      ORDER BY id DESC
      `,
      [sale_id]
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};