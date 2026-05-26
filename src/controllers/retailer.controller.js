const retailerModel = require("../models/retailer.model");

exports.createRetailer = async (req, res) => {

  try {

    const {
      name,
      firm_name,
      firm_address,
      contact_number,
      address,
      area,
      district,
      pincode
    } = req.body;

    if (!name || !contact_number) {
      return res.status(400).json({
        success: false,
        message: "Name and contact number required"
      });
    }

    const existing = await retailerModel.checkRetailerExists(contact_number);

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Retailer already exists"
      });
    }

    const data = [
      "retailer",
      name,
      firm_name,
      firm_address,
      contact_number,
      address,
      area,
      district,
      pincode,
      req.user.id
    ];

    const retailerId = await retailerModel.createRetailer(data);

    res.status(201).json({
      success: true,
      message: "Retailer created successfully",
      retailerId
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      error: err.message
    });

  }
};

exports.getRetailers = async (req, res) => {

  try {

    const {
      page = 1,
      limit = 10,
      search = ""
    } = req.query;

    const result = await retailerModel.getRetailers({
      page: Number(page),
      limit: Number(limit),
      search
    });

    res.status(200).json({
      success: true,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      count: result.data.length,
      data: result.data
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      error: err.message
    });

  }
};

exports.getRetailerDetailsById = async (req, res) => {

  try {

    const data = await retailerModel.getRetailerById(req.params.id);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Retailer not found"
      });
    }

    res.json({
      success: true,
      data
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      error: err.message
    });

  }
};

exports.updateRetailer = async (req, res) => {

  try {

    const {
      name,
      firm_name,
      firm_address,
      contact_number,
      address,
      area,
      district,
      pincode
    } = req.body;

    const data = [
      name,
      firm_name,
      firm_address,
      contact_number,
      address,
      area,
      district,
      pincode
    ];

    await retailerModel.updateRetailer(req.params.id, data);

    res.json({
      success: true,
      message: "Retailer updated successfully"
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      error: err.message
    });

  }
};