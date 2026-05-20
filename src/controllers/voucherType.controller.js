const connection = require("../config/db");
const { createVoucherTypeModel, getAllVoucherTypesModel, getVoucherTypeByIdModel, updateVoucherTypeModel, deleteVoucherTypeModel } = require("../models/voucherType.model");

// CREATE
const createVoucherType = async (req, res) => {

  try {

    const {
      voucher_name,
      voucher_type,
      numbering_method,
      use_advance_numbering,
      decimal_digit,
      starting_number,
      prefix,
      suffix,
      use_effective_date,
      voucher_start_date,
      voucher_end_date,
      allow_narration
    } = req.body;

    // REQUIRED VALIDATION
    if (
      !voucher_name ||
      !voucher_type ||
      !voucher_start_date ||
      !voucher_end_date
    ) {
      return res.status(400).json({
        success: false,
        message: "Required fields missing"
      });
    }

    // ADVANCE NUMBERING VALIDATION
    if (
      numbering_method === "AUTOMATIC" &&
      Number(use_advance_numbering) === 1
    ) {

      if (
        !decimal_digit ||
        !starting_number
      ) {
        return res.status(400).json({
          success: false,
          message: "Advance numbering fields are required"
        });
      }
    }

    // IF MANUAL THEN RESET VALUES
    let finalDecimalDigit = null;
    let finalStartingNumber = null;
    let finalPrefix = null;
    let finalSuffix = null;
    let finalAdvanceNumbering = 0;

    if (
      numbering_method === "AUTOMATIC" &&
      Number(use_advance_numbering) === 1
    ) {

      finalAdvanceNumbering = 1;
      finalDecimalDigit = decimal_digit;
      finalStartingNumber = starting_number;
      finalPrefix = prefix || null;
      finalSuffix = suffix || null;
    }

    const result = await createVoucherTypeModel(connection, {
      voucher_name,
      voucher_type,
      numbering_method,
      use_advance_numbering: finalAdvanceNumbering,
      decimal_digit: finalDecimalDigit,
      starting_number: finalStartingNumber,
      prefix: finalPrefix,
      suffix: finalSuffix,
      use_effective_date,
      voucher_start_date,
      voucher_end_date,
      allow_narration
    });

    return res.status(201).json({
      success: true,
      message: "Voucher type created successfully",
      voucher_type_id: result.insertId
    });

  } catch (error) {

    console.log("CREATE VOUCHER TYPE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};



const getAllVoucherTypes = async (req, res) => {

  try {

    // QUERY PARAMS
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search || "";

    const data = await getAllVoucherTypesModel(
      connection,
      page,
      limit,
      search
    );

    return res.status(200).json({
      success: true,

      current_page: page,

      per_page: limit,

      total_records: data.total,

      total_pages: Math.ceil(data.total / limit),

      data: data.rows
    });

  } catch (error) {

    console.log("GET ALL VOUCHER TYPES ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};



// GET BY ID
const getVoucherTypeById = async (req, res) => {

  try {

    const { id } = req.params;

    const data = await getVoucherTypeByIdModel(connection, id);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Voucher type not found"
      });
    }

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {

    console.log("GET VOUCHER TYPE BY ID ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};



// UPDATE
const updateVoucherType = async (req, res) => {

  try {

    const { id } = req.params;

    const existingVoucher = await getVoucherTypeByIdModel(connection, id);

    if (!existingVoucher) {
      return res.status(404).json({
        success: false,
        message: "Voucher type not found"
      });
    }

    const {
      voucher_name,
      voucher_type,
      numbering_method,
      use_advance_numbering,
      decimal_digit,
      starting_number,
      prefix,
      suffix,
      use_effective_date,
      voucher_start_date,
      voucher_end_date,
      allow_narration
    } = req.body;

    let finalDecimalDigit = null;
    let finalStartingNumber = null;
    let finalPrefix = null;
    let finalSuffix = null;
    let finalAdvanceNumbering = 0;

    if (
      numbering_method === "AUTOMATIC" &&
      Number(use_advance_numbering) === 1
    ) {

      if (
        !decimal_digit ||
        !starting_number
      ) {
        return res.status(400).json({
          success: false,
          message: "Advance numbering fields are required"
        });
      }

      finalAdvanceNumbering = 1;
      finalDecimalDigit = decimal_digit;
      finalStartingNumber = starting_number;
      finalPrefix = prefix || null;
      finalSuffix = suffix || null;
    }

    await updateVoucherTypeModel(connection, id, {
      voucher_name,
      voucher_type,
      numbering_method,
      use_advance_numbering: finalAdvanceNumbering,
      decimal_digit: finalDecimalDigit,
      starting_number: finalStartingNumber,
      prefix: finalPrefix,
      suffix: finalSuffix,
      use_effective_date,
      voucher_start_date,
      voucher_end_date,
      allow_narration
    });

    return res.status(200).json({
      success: true,
      message: "Voucher type updated successfully"
    });

  } catch (error) {

    console.log("UPDATE VOUCHER TYPE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};



// DELETE
const deleteVoucherType = async (req, res) => {

  try {

    const { id } = req.params;

    const existingVoucher = await getVoucherTypeByIdModel(connection, id);

    if (!existingVoucher) {
      return res.status(404).json({
        success: false,
        message: "Voucher type not found"
      });
    }

    await deleteVoucherTypeModel(connection, id);

    return res.status(200).json({
      success: true,
      message: "Voucher type deleted successfully"
    });

  } catch (error) {

    console.log("DELETE VOUCHER TYPE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

const getVoucherTypeDropdown = async (req, res) => {

  try {

    const query = `
      SELECT DISTINCT voucher_type
      FROM voucher_types
      ORDER BY voucher_type ASC
    `;

    const [result] = await connection.query(query);

    return res.status(200).json({
      success: true,
      data: result,
    });

  } catch (error) {

    console.log(error, "ERROR");

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });

  }

};

const getVoucherByType = async (req, res) => {

  try {

    const { voucher_type } = req.query;

    const query = `
      SELECT *
      FROM voucher_types
      WHERE voucher_type = ?
      ORDER BY id DESC
    `;

    const [result] = await connection.query(
      query,
      [voucher_type]
    );

    return res.status(200).json({
      success: true,
      data: result,
    });

  } catch (error) {

    console.log(error, "ERROR");

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });

  }

};
const activateVoucher = async (req, res) => {

  try {

    const { id } = req.params;

    // FIND CURRENT VOUCHER
    const findQuery = `
      SELECT *
      FROM voucher_types
      WHERE id = ?
    `;

    const [voucherResult] = await connection.query(
      findQuery,
      [id]
    );

    if (voucherResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Voucher not found",
      });
    }

    const voucher = voucherResult[0];

    // INACTIVE SAME TYPE
    const inactiveQuery = `
      UPDATE voucher_types
      SET status = 'INACTIVE'
      WHERE voucher_type = ?
    `;

    await connection.query(
      inactiveQuery,
      [voucher.voucher_type]
    );

    // ACTIVATE CURRENT
    const activateQuery = `
      UPDATE voucher_types
      SET status = 'ACTIVE'
      WHERE id = ?
    `;

    await connection.query(
      activateQuery,
      [id]
    );

    return res.status(200).json({
      success: true,
      message: "Voucher activated successfully",
    });

  } catch (error) {

    console.log(error, "ERROR");

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });

  }

};

module.exports = {
  createVoucherType,
  getAllVoucherTypes,
  getVoucherTypeById,
  updateVoucherType,
  deleteVoucherType, getVoucherTypeDropdown, getVoucherByType, activateVoucher
};