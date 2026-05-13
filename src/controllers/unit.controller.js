const unitModel = require("../models/unit.model");

// CREATE UNIT
const createUnit = async (req, res) => {

    try {

        const {
            type,
            symbol,
            first_unit_id,
            conversion_value,
            second_unit_id
        } = req.body;

        if (!type) {
            return res.status(400).json({
                success: false,
                message: "Type is required"
            });
        }

        if (type === "SIMPLE") {

            if (!symbol) {
                return res.status(400).json({
                    success: false,
                    message: "Symbol is required"
                });
            }
        }

        if (type === "COMPOUND") {

            if (
                !first_unit_id ||
                !conversion_value ||
                !second_unit_id
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Compound unit fields are required"
                });
            }
        }

        await unitModel.createUnit(req.body);

        return res.status(201).json({
            success: true,
            message: "Unit created successfully"
        });

    } catch (error) {

        console.log(error);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// GET ALL UNITS
const getAllUnits = async (req, res) => {

    try {

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const search = req.query.search || "";

        const result = await unitModel.getAllUnits(
            search,
            page,
            limit
        );

        return res.status(200).json({
            success: true,
            data: result.data,
            pagination: {
                total: result.total,
                currentPage: page,
                totalPages: Math.ceil(result.total / limit),
                limit
            }
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const getSimpleUnits = async (req, res) => {

    try {

        const data = await unitModel.getSimpleUnits();

        return res.status(200).json({
            success: true,
            data
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// GET UNIT BY ID
const getUnitById = async (req, res) => {

    try {

        const { id } = req.params;

        const unit = await unitModel.getUnitById(id);

        if (!unit) {
            return res.status(404).json({
                success: false,
                message: "Unit not found"
            });
        }

        return res.status(200).json({
            success: true,
            data: unit
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// UPDATE UNIT
const updateUnit = async (req, res) => {
    try {
        const { id } = req.params;
        const existingUnit = await unitModel.getUnitById(id);
        if (!existingUnit) {
            return res.status(404).json({
                success: false,
                message: "Unit not found"
            });
        }
        await unitModel.updateUnit(id, req.body);
        return res.status(200).json({
            success: true,
            message: "Unit updated successfully"
        });

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// DELETE UNIT
const deleteUnit = async (req, res) => {

    try {

        const { id } = req.params;

        const existingUnit = await unitModel.getUnitById(id);

        if (!existingUnit) {
            return res.status(404).json({
                success: false,
                message: "Unit not found"
            });
        }

        await unitModel.deleteUnit(id);

        return res.status(200).json({
            success: true,
            message: "Unit deleted successfully"
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// GET ALL UQC
const getAllUQC = async (req, res) => {

    try {

        const data = await unitModel.getAllUQC();

        return res.status(200).json({
            success: true,
            data
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    createUnit,
    getAllUnits,
    getUnitById,
    updateUnit,
    deleteUnit,
    getAllUQC, getSimpleUnits
};