const db = require("../config/db");
const stockItemModel = require("../models/stockItem.model");

// CREATE STOCK ITEM COMPLETE
exports.createStockItem = async (req, res) => {
    const connection = await db.getConnection();
    try {

        await connection.beginTransaction();

        const {
            item_name,
            stock_group_id,
            stock_category_id,
            unit_id,
            gst_applicable,
            set_gst_details,
            type_of_supply,
            rate_of_duty,
            description,
            created_by,

            gst_details,

            opening_stock
        } = req.body;

        if (!item_name) {
            return res.status(400).json({
                success: false,
                message: "Item name is required"
            });
        }

        if (!stock_group_id) {
            return res.status(400).json({
                success: false,
                message: "Stock group is required"
            });
        }

        if (!unit_id) {
            return res.status(400).json({
                success: false,
                message: "Unit is required"
            });
        }



        // CREATE STOCK ITEM

        const [stockItemResult] = await connection.query(
            `
            INSERT INTO stock_items (
                item_name,
                stock_group_id,
                stock_category_id,
                unit_id,
                gst_applicable,
                set_gst_details,
                type_of_supply,
                rate_of_duty,
                description,
                created_by
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                item_name,
                stock_group_id,
                stock_category_id || null,
                unit_id,
                gst_applicable || 0,
                set_gst_details || 0,
                type_of_supply || "Goods",
                rate_of_duty || 0,
                description || null,
                created_by || null
            ]
        );



        const stock_item_id = stockItemResult.insertId;



        // CREATE GST DETAILS

        if (set_gst_details && gst_details) {

            await connection.query(
                `
                INSERT INTO stock_item_gst_details (
                    stock_item_id,
                    description,
                    hsn_sac,
                    is_non_gst_goods,
                    calculation_type,
                    taxability,
                    integrated_tax,
                    central_tax,
                    state_tax,
                    cess
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    stock_item_id,
                    gst_details.gst_description || null,
                    gst_details.hsn_sac || null,
                    gst_details.is_non_gst_goods || 0,
                    gst_details.calculation_type || "On Value",
                    gst_details.taxability || null,
                    gst_details.integrated_tax || 0,
                    gst_details.central_tax || 0,
                    gst_details.state_tax || 0,
                    gst_details.cess || 0
                ]
            );
        }



        // CREATE OPENING STOCK

        if (opening_stock) {

            await connection.query(
                `
                INSERT INTO stock_item_opening_stock (
                    stock_item_id,
                    godown_id,
                    batch_no,
                    mfg_date,
                    expiry_date,
                    quantity,
                    rate,
                    per_unit_id,
                    amount
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    stock_item_id,
                    opening_stock.godown_id,
                    opening_stock.batch_no || null,
                    opening_stock.mfg_date || null,
                    opening_stock.expiry_date || null,
                    opening_stock.quantity || 0,
                    opening_stock.rate || 0,
                    opening_stock.per_unit_id || null,
                    opening_stock.amount || 0
                ]
            );
        }



        await connection.commit();



        return res.status(201).json({
            success: true,
            message: "Stock item created successfully",
            stock_item_id
        });

    } catch (error) {

        await connection.rollback();

        console.log("CREATE STOCK ITEM ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });

    } finally {

        connection.release();
    }
};