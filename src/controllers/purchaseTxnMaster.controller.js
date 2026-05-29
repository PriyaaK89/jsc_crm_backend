const db = require("../config/db");
const purchaseModel = require("../models/purchaseTxnMaster.model");
const generateVoucherNo = require("../utils/generateVoucherNo");

exports.getPurchaseLedgerDropdown = async (req, res) => {
  try {
    const data = await purchaseModel.getPurchaseLedgerDropdown();

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

exports.getSupplierDropdown = async (req, res) => {
  try {
    const data = await purchaseModel.getSupplierDropdown();
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

exports.createPurchase = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const data = req.body;

    const voucherData = await generateVoucherNo("PURCHASE");

    const { voucher_no, voucher_type_id, nextSequence } = voucherData;

    const purchaseId = await purchaseModel.createPurchase(connection, {
      ...data,
      voucher_no,
      created_by: req.user.id,
    });

    // INSERT ITEMS

    for (const item of data.items) {
      // PURCHASE ITEMS
      const purchaseItemId = await purchaseModel.insertPurchaseItem(
        connection,
        item,
        purchaseId,
      );

      if (item.batch_no) {
        await purchaseModel.insertPurchaseBatch(
          connection,
          item,
          purchaseItemId,
        );
      }

      // STOCK TRANSACTION

      await purchaseModel.insertStockTransaction(
        connection,
        item,
        purchaseId,
        data.purchase_date,
        req.user.id,
      );
    }

    // PURCHASE ACCOUNT DR

    await purchaseModel.insertLedgerTransaction(connection, {
      transaction_type: "PURCHASE",
      reference_id: purchaseId,
      voucher_no,
      voucher_type_id: voucher_type_id,
      transaction_date: data.purchase_date,
      ledger_id: data.purchase_ledger_id,
      entry_type: "Dr",
      amount: data.subtotal,
      remarks: "Purchase Account",
      created_by: req.user.id,
    });

    // IGST DR
    const cgstLedger = await purchaseModel.getLedgerByName(
      connection,
      "CGST",
    );

    const sgstLedger = await purchaseModel.getLedgerByName(
      connection,
      "SGST",
    );

    const igstLedger = await purchaseModel.getLedgerByName(
      connection,
      "IGST",
    );

    if (data.igst_total > 0) {
      await purchaseModel.insertLedgerTransaction(connection, {
        transaction_type: "PURCHASE",
        reference_id: purchaseId,
        voucher_no,
        voucher_type_id: voucher_type_id,
        transaction_date: data.purchase_date,
        ledger_id: igstLedger.id,
        entry_type: "Dr",
        amount: data.igst_total,
        remarks: "IGST Input",
        created_by: req.user.id,
      });
    }

    // CGST DR

    if (data.cgst_total > 0) {
      await purchaseModel.insertLedgerTransaction(connection, {
        transaction_type: "PURCHASE",
        reference_id: purchaseId,
        voucher_no,
        voucher_type_id: voucher_type_id,
        transaction_date: data.purchase_date,
        ledger_id: cgstLedger.id,
        entry_type: "Dr",
        amount: data.cgst_total,
        remarks: "CGST Input",
        created_by: req.user.id,
      });
    }

    // SGST DR

    if (data.sgst_total > 0) {
      await purchaseModel.insertLedgerTransaction(connection, {
        transaction_type: "PURCHASE",
        reference_id: purchaseId,
        voucher_no,
        voucher_type_id: voucher_type_id,
        transaction_date: data.purchase_date,
        ledger_id: sgstLedger.id,
        entry_type: "Dr",
        amount: data.sgst_total,
        remarks: "SGST Input",
        created_by: req.user.id,
      });
    }

    await purchaseModel.insertLedgerTransaction(connection, {
      transaction_type: "PURCHASE",
      reference_id: purchaseId,
      voucher_no,
      voucher_type_id: voucher_type_id,
      transaction_date: data.purchase_date,
      ledger_id: data.supplier_ledger_id,
      entry_type: "Cr",
      amount: data.total_amount,
      remarks: "Supplier Account",
      created_by: req.user.id,
    });

    await connection.query(
      `
  UPDATE voucher_types
  SET current_sequence = ?
  WHERE id = ?
  `,
      [nextSequence, voucher_type_id],
    );
    await connection.commit();

    res.status(201).json({
      success: true,
      message: "Purchase created successfully",
      purchase_id: purchaseId,
      voucher_no,
    });
  } catch (error) {
    await connection.rollback();
    console.log(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    connection.release();
  }
};

exports.getPurchaseList = async (req, res) => {
  try {
    const data = await purchaseModel.getPurchaseList();

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

exports.getPurchaseById = async (req, res) => {
  try {
    const data = await purchaseModel.getPurchaseById(req.params.id);
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
