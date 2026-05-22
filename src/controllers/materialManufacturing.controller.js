const manufacturingModel = require("../models/materialManufacturing.model");

const {
  createManufacturingSchema,
  getAvailableStock, 
} = require("../utils/manufacturingValidator");

const getStockItemsDropdown = async (req, res) => {
  try {
    const data = await manufacturingModel.getStockItemsDropdown();

    return res.status(200).json({
      success: true,
      message: "Stock items fetched successfully",
      data,
    });
  } catch (error) {
    console.error("getStockItemsDropdown Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getStockItemBatches = async (req, res) => {
  try {
    const { item_id, godown_id } = req.query;

    if (!item_id) {
      return res.status(400).json({
        success: false,
        message: "item_id is required",
      });
    }

    if (!godown_id) {
      return res.status(400).json({
        success: false,
        message: "godown_id is required",
      });
    }

    const data = await manufacturingModel.getStockItemBatches(
      item_id,
      godown_id,
    );

    return res.status(200).json({
      success: true,
      message: "Batch list fetched successfully",
      data,
    });
  } catch (error) {
    console.error("getStockItemBatches Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const createManufacturing = async (req, res) => {
  try {
    const { error, value } = createManufacturingSchema.validate(req.body, {
      abortEarly: false,
      allowUnknown: false,
    });

    if (error) {
      const errors = error.details.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));

      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors,
      });
    }

    const result = await manufacturingModel.createManufacturing(value);

    return res.status(201).json({
      success: true,
      message: "Manufacturing entry created successfully",
      data: result,
    });
  } catch (error) {
    console.error("createManufacturing Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getAvailableStockQty = async (req, res) => {
  try {
    const { item_id, godown_id, batch_no } = req.query;

    if (!item_id) {
      return res.status(400).json({
        success: false,
        message: "item_id is required",
      });
    }

    if (!godown_id) {
      return res.status(400).json({
        success: false,
        message: "godown_id is required",
      });
    }

    const data = await manufacturingModel.getAvailableStock(
      item_id,
      godown_id,
      batch_no,
    );

    return res.status(200).json({
      success: true,
      message: "Available stock fetched successfully",
      data,
    });
  } catch (error) {
    console.error("getAvailableStock Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getManufacturingReport = async (req, res) => {
  try {
    const {
      filter_type,
      item_id,
      godown_id,
      search = "",
      page = 1,
      limit = 10,
    } = req.query;

    if (!filter_type) {
      return res.status(400).json({
        success: false,
        message: "filter_type is required",
      });
    }

    if (filter_type === "ITEM_WISE" && !item_id) {
      return res.status(400).json({
        success: false,
        message: "item_id is required",
      });
    }

    if (filter_type === "GODOWN_WISE" && !godown_id) {
      return res.status(400).json({
        success: false,
        message: "godown_id is required",
      });
    }

    const result = await manufacturingModel.getManufacturingReport({
      filter_type,
      item_id,
      godown_id,
      search,
      page: Number(page),
      limit: Number(limit),
    });

    return res.status(200).json({
      success: true,
      message: "Manufacturing report fetched successfully",
      ...result,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

module.exports = {
  getStockItemsDropdown,
  getStockItemBatches,
  createManufacturing,
  getAvailableStockQty, getManufacturingReport
};
