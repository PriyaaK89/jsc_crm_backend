const godownModel = require("../models/godown.model");

const createGodown = async (req, res) => {

    try {

        const result = await godownModel.createGodown(req.body);

        res.status(201).json({
            success: true,
            message: "Godown created successfully",
            id: result.insertId
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const getAllGodowns = async (req, res) => {

  try {


    const page = Number(req.query.page) || 1;

    const limit = Number(req.query.limit) || 10;

    const search = req.query.search || "";


    const result = await godownModel.getAllGodowns({
      page,
      limit,
      search,
    });


    const totalPages = Math.ceil(
      result.total / limit
    );

    res.status(200).json({
      success: true,

      data: result.rows,

      pagination: {
        totalRecords: result.total,
        totalPages,
        currentPage: page,
        limit,
      },
    });

  } catch (error) {

    console.log(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getGodownById = async (req, res) => {

    try {

        const row = await godownModel.getGodownById(req.params.id);

        res.json({
            success: true,
            data: row
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const updateGodown = async (req, res) => {

    try {

        await godownModel.updateGodown(req.params.id, req.body);

        res.json({
            success: true,
            message: "Godown updated successfully"
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const deleteGodown = async (req, res) => {

    try {

        await godownModel.deleteGodown(req.params.id);

        res.json({
            success: true,
            message: "Godown deleted successfully"
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    createGodown,
    getAllGodowns,
    getGodownById,
    updateGodown,
    deleteGodown
};