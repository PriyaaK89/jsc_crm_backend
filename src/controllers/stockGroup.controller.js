const StockGroup = require("../models/stockGroup.model");

exports.createStockGroup = async (req, res) => {
  try {
    const {
      name,
      parent_id,
      add_quantity,
      gst_enabled,
      overdue_limit
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const result = await StockGroup.create({
      name,
      parent_id: parent_id || null,
      add_quantity,
      gst_enabled,
      overdue_limit
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
    //  Call model
    const rows = await StockGroup.getAllStockGroups();

    //  Add Primary at top
    const data = [
      { id: null, name: "Primary" },
      ...rows
    ];

    res.status(200).json({
        success: true,
        message: "Data Fetched Successfully.",
        data: data });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getStockGroupById = async (req, res) => {
  try {
    const { id } = req.params;

    const data = await StockGroup.getStockGroupById(id);

    if (!data) {
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
    const { name, parent_id, add_quantity, gst_enabled, overdue_limit } = req.body;

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
      overdue_limit
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

    //  Step 1: Check if exists
    const existing = await StockGroup.getStockGroupById(id);

    if (!existing) {
      return res.status(404).json({ error: "Stock group not found" });
    }

    //  Step 2: Delete
    await StockGroup.deleteStockGroup(id);

    res.status(200).json({
      success: true,
      message: "Stock group deleted successfully"
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};