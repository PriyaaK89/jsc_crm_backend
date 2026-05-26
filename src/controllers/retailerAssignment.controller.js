const retailerModel = require("../models/retailerAssignment.model");

/* =====================================================
    GET RETAILERS
===================================================== */

exports.getRetailers = async (req, res) => {

  try {

    const data =
      await retailerModel.getRetailersWithEmployee();

    res.json({
      success: true,
      data
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      success: false,
      error: err.message
    });

  }

};

/* =====================================================
    ASSIGN RETAILER
===================================================== */

exports.assignRetailer = async (req, res) => {

  try {

    const {
      retailer_id,
      employee_id
    } = req.body;

    if (!retailer_id || !employee_id) {

      return res.status(400).json({
        success: false,
        message:
          "retailer_id and employee_id required"
      });

    }

    const result =
      await retailerModel.assignOrUpdateRetailer(
        retailer_id,
        employee_id,
        req.user.id
      );

    res.json({
      success: true,
      message:
        result === "updated"
          ? "Retailer reassigned successfully"
          : "Retailer assigned successfully"
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      success: false,
      error: err.message
    });

  }

};