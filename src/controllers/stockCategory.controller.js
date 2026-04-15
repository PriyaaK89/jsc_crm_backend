const StockCategory = require("../models/stockCategory.model");

exports.createStockCategory = async (req, res) => {
  try {
    const { name, stock_group_id } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Category name is required" });
    }

    const result = await StockCategory.createStockCategory({
      name,
      stock_group_id: stock_group_id || null
    });

    res.status(201).json({
      success: true,
      message: "Stock category created successfully",
      data: result
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAllStockCategories = async (req, res) => {
  try {
    const data = await StockCategory.getAllStockCategories();

    res.status(200).json({
      success: true,
      message: "Categories fetched successfully",
      data
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getStockCategoryById = async (req, res) => {
  try {
    const { id } = req.params;

    const data = await StockCategory.getStockCategoryById(id);

    if (!data) {
      return res.status(404).json({ error: "Category not found" });
    }

    res.status(200).json({
      success: true,
      message: "Category fetched successfully",
      data
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateStockCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, stock_group_id } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const existing = await StockCategory.getStockCategoryById(id);

    if (!existing) {
      return res.status(404).json({ error: "Category not found" });
    }

    await StockCategory.updateStockCategory({
      id,
      name,
      stock_group_id: stock_group_id || null
    });

    res.status(200).json({
      success: true,
      message: "Category updated successfully"
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteStockCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await StockCategory.deleteStockCategory(id);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Category not found" });
    }

    res.status(200).json({
      success: true,
      message: "Category deleted successfully"
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};