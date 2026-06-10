const db = require("../config/db");
const contraModel = require("../models/contra.modal");
const generateVoucherNo = require("../utils/generateVoucherNo");

exports.getContraAccountDropdown = async (req, res) => {
  try {
    const data = await contraModel.getContraAccountDropdown();

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.createContra = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const data = req.body;

    const voucherData = await generateVoucherNo("CONTRA");

    const { voucher_no, voucher_type_id, nextSequence } = voucherData;

    if (!data.entries || !data.entries.length) {
      throw new Error("At least one contra entry is required");
    }

    let totalAmount = 0;

    for (const entry of data.entries) {
      totalAmount += Number(entry.amount || 0);
    }

    const contraId = await contraModel.createContra(connection, {
      voucher_type_id,
      voucher_no,
      contra_date: data.contra_date,
      account_ledger_id: data.account_ledger_id,
      employee_under_id: data.employee_under_id || null,
      total_amount: totalAmount,
      narration: data.narration || null,
      created_by: req.user.id,
    });

    // -----------------------------
    // DR ENTRIES
    // -----------------------------

    for (const entry of data.entries) {
      const isValid = await contraModel.validateContraLedger(
        connection,
        entry.ledger_id,
      );

      if (!isValid) {
        throw new Error(
          `Invalid contra ledger selected. Ledger ID ${entry.ledger_id}`,
        );
      }

      await contraModel.insertContraEntry(connection, contraId, {
        ...entry,
        entry_type: "Dr",
      });

      await contraModel.insertLedgerTransaction(connection, {
        transaction_type: "CONTRA",
        reference_id: contraId,
        voucher_no,
        voucher_type_id,
        transaction_date: data.contra_date,

        ledger_id: entry.ledger_id,
        entry_type: "Dr",

        amount: Number(entry.amount),

        remarks: "Contra Debit Entry",
        created_by: req.user.id,
      });
    }

    // -----------------------------
    // CR ENTRY
    // -----------------------------

    await contraModel.insertLedgerTransaction(connection, {
      transaction_type: "CONTRA",
      reference_id: contraId,
      voucher_no,
      voucher_type_id,
      transaction_date: data.contra_date,

      ledger_id: data.account_ledger_id,
      entry_type: "Cr",

      amount: totalAmount,

      remarks: "Contra Credit Entry",
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

    return res.status(201).json({
      success: true,
      message: "Contra voucher created successfully",
      contra_id: contraId,
      voucher_no,
    });
  } catch (error) {
    await connection.rollback();

    console.log("CONTRA ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    connection.release();
  }
};

exports.getContraVoucher = async (req, res) => {
  try {
    const { id } = req.params;

    const data = await contraModel.getContraVoucher(id);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Contra voucher not found",
      });
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
