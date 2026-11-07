const StockGroup = require("../models/stockGroup.model");
const { getHiddenGroupIdsForRequest } = require("../utils/stockVisibility");

exports.createStockGroup = async (req, res) => {
  try {
    const { name, parent_id, add_quantity, gst_enabled, overdue_limit, hide_from_marketing } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const result = await StockGroup.create({
      name,
      parent_id: parent_id || null,
      add_quantity,
      gst_enabled,
      overdue_limit,
      hide_from_marketing
    });

    res.status(201).json({
      message: "Stock group created successfully",
      data: result
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getStockGroupsDropdown = async (req, res) => {
  try {
    const hiddenGroupIds = await getHiddenGroupIdsForRequest(req);

    const rows = await StockGroup.getAllStockGroups(hiddenGroupIds);

    const data = [
      { id: null, name: "Primary" },
      ...rows
    ];

    res.status(200).json({
      success: true,
      message: "Data Fetched Successfully.",
      data: data
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getStockGroupById = async (req, res) => {
  try {
    const { id } = req.params;
    const hiddenGroupIds = await getHiddenGroupIdsForRequest(req);

    const data = await StockGroup.getStockGroupById(id);

    if (!data || hiddenGroupIds.map(Number).includes(Number(data.id))) {
      return res.status(404).json({ error: "Stock group not found" });
    }

    res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      data
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateStockGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, parent_id, add_quantity, gst_enabled, overdue_limit, hide_from_marketing } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const existing = await StockGroup.getStockGroupById(id);

    if (!existing) {
      return res.status(404).json({ error: "Stock group not found" });
    }

    await StockGroup.updateStockGroup({
      id,
      name,
      parent_id: parent_id || null,
      add_quantity,
      gst_enabled,
      overdue_limit,
      hide_from_marketing
    });

    const updatedData = await StockGroup.getStockGroupById(id);

    return res.status(200).json({
      success: true,
      message: "Stock group updated successfully",
      data: updatedData
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.deleteStockGroup = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await StockGroup.getStockGroupById(id);

    if (!existing) {
      return res.status(404).json({ error: "Stock group not found" });
    }

    await StockGroup.deleteStockGroup(id);

    res.status(200).json({
      success: true,
      message: "Stock group deleted successfully"
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};