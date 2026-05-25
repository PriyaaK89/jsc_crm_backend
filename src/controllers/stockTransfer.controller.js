const StockTransferModel = require("../models/stockTransfer.model");
const db = require("../config/db");
const MaterialMfgModal = require("../models/materialManufacturing.model")


const createStockTransfer = async (req, res) => {
  try {
    const data = req.body;

    if (!data.transfer_date) {
      return res.status(400).json({
        success: false,
        message: "Transfer date is required",
      });
    }

    if (
      !data.source_items ||
      !Array.isArray(data.source_items) ||
      data.source_items.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "At least one source item is required",
      });
    }

    // ==========================================
    // DESTINATION ITEMS VALIDATION
    // ==========================================

    if (
      !data.destination_items ||
      !Array.isArray(data.destination_items) ||
      data.destination_items.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "At least one destination item is required",
      });
    }

    // ==========================================
    // VALIDATE SOURCE ITEMS
    // ==========================================

    for (const item of data.source_items) {
      // ITEM VALIDATION

      if (!item.item_id) {
        return res.status(400).json({
          success: false,
          message: "Source item_id is required",
        });
      }

      // GODOWN VALIDATION

      if (!item.godown_id) {
        return res.status(400).json({
          success: false,
          message: "Source godown_id is required",
        });
      }

      // QTY VALIDATION

      if (!item.qty || Number(item.qty) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Source qty must be greater than 0",
        });
      }

      // UNIT VALIDATION

      if (!item.unit_id) {
        return res.status(400).json({
          success: false,
          message: "Source unit_id is required",
        });
      }

      // ==========================================
      // CHECK AVAILABLE STOCK
      // ==========================================

      const availableStock = await MaterialMfgModal.getAvailableStock(
        item.item_id,
        item.godown_id,
        item.batch_no || null
      );

      if (Number(item.qty) > Number(availableStock)) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for item_id ${item.item_id}. Available stock is ${availableStock}`,
        });
      }
    }

    // ==========================================
    // VALIDATE DESTINATION ITEMS
    // ==========================================

    for (const item of data.destination_items) {
      // ITEM VALIDATION

      if (!item.item_id) {
        return res.status(400).json({
          success: false,
          message: "Destination item_id is required",
        });
      }

      // GODOWN VALIDATION

      if (!item.godown_id) {
        return res.status(400).json({
          success: false,
          message: "Destination godown_id is required",
        });
      }

      // QTY VALIDATION

      if (!item.qty || Number(item.qty) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Destination qty must be greater than 0",
        });
      }

      // UNIT VALIDATION

      if (!item.unit_id) {
        return res.status(400).json({
          success: false,
          message: "Destination unit_id is required",
        });
      }
    }

    // ==========================================
    // VALIDATE ADDITIONAL COSTS
    // ==========================================

    if (data.additional_costs?.length) {
      for (const cost of data.additional_costs) {
        if (!cost.ledger_id) {
          return res.status(400).json({
            success: false,
            message: "ledger_id is required in additional_costs",
          });
        }

        if (Number(cost.amount) < 0) {
          return res.status(400).json({
            success: false,
            message: "Additional cost amount cannot be negative",
          });
        }
      }
    }

    // ==========================================
    // VALIDATE TRANSPORTATION
    // ==========================================

    if (data.transportation) {
      const transport = data.transportation;

      const transportFreight =
        Number(transport.transport_freight || 0);

      const localFreight =
        Number(transport.local_freight || 0);

      const loadUnloadFreight =
        Number(transport.load_unload_freight || 0);

      if (
        transportFreight < 0 ||
        localFreight < 0 ||
        loadUnloadFreight < 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Transportation amounts cannot be negative",
        });
      }
    }

    // ==========================================
    // CREATE STOCK TRANSFER
    // ==========================================

    const result = await StockTransferModel.createStockTransfer(data);

    return res.status(201).json({
      success: true,
      message: "Stock transfer created successfully",
      transferId: result.transferId,
    });

  } catch (error) {

    console.error("CREATE STOCK TRANSFER ERROR :", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


const getStockTransferReport = async ( req, res ) => {
  try {
    let {
      item_id,
      from_date,
      to_date,
      search = "",
      page = 1,
      limit = 10,
    } = req.query;

    page = Number(page) || 1;
    limit = Number(limit) || 10;

    if (page < 1) {
      page = 1;
    }

    if (limit < 1) {
      limit = 10;
    }

    const result =
      await StockTransferModel.getStockTransferReport({ item_id, from_date, to_date, search, page, limit, });

    return res.status(200).json({
      success: true,
      message: "Stock transfer report fetched successfully",
      data: result.data,
      pagination: result.pagination,
    });

  } catch (error) {
    console.log(
      "getStockTransferReport Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

module.exports = {
  createStockTransfer, getStockTransferReport
};