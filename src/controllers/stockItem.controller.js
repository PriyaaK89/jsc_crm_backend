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

    alternative_unit_id,
    alternative_unit_value,
    base_unit_value,

    bulk_unit_id,
    bulk_unit_value,
    bulk_base_value,

      is_returnable,
   returnable_percentage,

    maintain_in_batches,
    track_mfg_date,
    use_expiry_dates,
    set_standard_rates,
    enable_cost_tracking,
    gst_applicable,
    set_gst_details,
    type_of_supply,
    rate_of_duty,
    description,
    created_by,
    gst_details,
    opening_stock, 

   
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

        if (is_returnable == 1) {

   if (
      returnable_percentage == null ||
      returnable_percentage === ""
   ) {
      return res.status(400).json({
         success: false,
         message: "Returnable percentage is required"
      });
   }

   if (
      Number(returnable_percentage) < 0 ||
      Number(returnable_percentage) > 100
   ) {
      return res.status(400).json({
         success: false,
         message: "Returnable percentage must be between 0 and 100"
      });
   }
}



        // CREATE STOCK ITEM

const [stockItemResult] = await connection.query(
    `
    INSERT INTO stock_items (

        item_name,
        stock_group_id,
        stock_category_id,
        unit_id,

        alternative_unit_id,
        alternative_unit_value,
        base_unit_value,

        bulk_unit_id,
        bulk_unit_value,
        bulk_base_value,

           is_returnable,
   returnable_percentage,

        maintain_in_batches,
        track_mfg_date,
        use_expiry_dates,
        set_standard_rates,
        enable_cost_tracking,

        gst_applicable,
        set_gst_details,

        type_of_supply,
        rate_of_duty,

        description,
        created_by

    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [

        item_name,
        stock_group_id,
        stock_category_id || null,
        unit_id,

        alternative_unit_id || null,
        alternative_unit_value || null,
        base_unit_value || null,

        bulk_unit_id || null,
        bulk_unit_value || null,
        bulk_base_value || null,

        is_returnable || 0,
returnable_percentage || null,

        maintain_in_batches || 0,

        maintain_in_batches == 1
            ? track_mfg_date || 0
            : 0,

        maintain_in_batches == 1
            ? use_expiry_dates || 0
            : 0,

        set_standard_rates || 0,
        enable_cost_tracking || 0,

        gst_applicable || 0,
        set_gst_details || 0,

        type_of_supply || "Goods",

        rate_of_duty || 0,

        description || null,

        created_by || null
    ]
);


        const stock_item_id = stockItemResult.insertId;

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
                    state_tax
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    // gst_details.cess || 0
                ]
            );
        }

        if (opening_stock) {

    const calculatedAmount =
        Number(opening_stock.quantity || 0)
        *
        Number(opening_stock.rate || 0);

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
            supercash_price,
            per_unit_id,
            amount

        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            stock_item_id,
            opening_stock.godown_id,
            opening_stock.batch_no || null,
            maintain_in_batches == 1 &&
            track_mfg_date == 1 ? opening_stock.mfg_date || null : null,
            maintain_in_batches == 1 &&
            use_expiry_dates == 1 ? opening_stock.expiry_date || null : null,
            opening_stock.quantity || 0,
            opening_stock.rate || 0,
            opening_stock.supercash_price || 0,
            opening_stock.per_unit_id || null,
            calculatedAmount
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


exports.getStockItems = async (req, res) => {
    try {
        const {
            search = "",
            page = 1,
            limit = 10
        } = req.query;

        const result =
            await stockItemModel.getStockItems( search, page, limit );
        return res.status(200).json({
            success: true,
            totalRecords: result.totalRecords,
            totalPages: result.totalPages,
            currentPage: result.currentPage,
            limit: Number(limit),
            data: result.rows
        });
    } catch (error) {
        console.log( "GET STOCK ITEMS ERROR:", error );
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};


exports.getStockItemById = async (req, res) => {
    try {
        const { id } = req.params;
        const stockItem = await stockItemModel.getStockItemById(id);
        if (!stockItem) {
            return res.status(404).json({
                success: false,
                message: "Stock item not found"
            });
        }
        const gstDetails = await stockItemModel.getGSTDetails(id);
        const openingStock = await stockItemModel.getOpeningStock(id);
        return res.status(200).json({
            success: true,
            data: {
                ...stockItem,
                gst_details: gstDetails || null,
                opening_stock: openingStock || null
            }
        });

    } catch (error) {
        console.log("GET STOCK ITEM DETAILS ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};


exports.updateStockItem = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const { id } = req.params;
        const {
            item_name,
            stock_group_id,
            stock_category_id,
            unit_id,

            alternative_unit_id,
            alternative_unit_value,
            base_unit_value,

            bulk_unit_id,
            bulk_unit_value,
            bulk_base_value,

              is_returnable,
   returnable_percentage,

            maintain_in_batches,
            track_mfg_date,
            use_expiry_dates,
            set_standard_rates,
            enable_cost_tracking,

            gst_applicable,
            set_gst_details,

            type_of_supply,
            rate_of_duty,

            description,
            updated_by,

            gst_details,
            opening_stock

        } = req.body;



        // UPDATE STOCK ITEM

        await connection.query(
            `
            UPDATE stock_items
            SET

                item_name = ?,
                stock_group_id = ?,
                stock_category_id = ?,
                unit_id = ?,

                alternative_unit_id = ?,
                alternative_unit_value = ?,
                base_unit_value = ?,

                bulk_unit_id = ?,
                bulk_unit_value = ?,
                bulk_base_value = ?,

                  is_returnable = ?,
   returnable_percentage = ?,



                maintain_in_batches = ?,
                track_mfg_date = ?,
                use_expiry_dates = ?,
                set_standard_rates = ?,
                enable_cost_tracking = ?,

                gst_applicable = ?,
                set_gst_details = ?,

                type_of_supply = ?,
                rate_of_duty = ?,

                description = ?,
                updated_by = ?

            WHERE id = ?
            `,
            [

                item_name,
                stock_group_id,
                stock_category_id || null,
                unit_id,

                alternative_unit_id || null,
                alternative_unit_value || null,
                base_unit_value || null,

                bulk_unit_id || null,
                bulk_unit_value || null,
                bulk_base_value || null,
                
        is_returnable || 0,
returnable_percentage || null,


                maintain_in_batches || 0,
                track_mfg_date || 0,
                use_expiry_dates || 0,
                set_standard_rates || 0,
                enable_cost_tracking || 0,

                gst_applicable || 0,
                set_gst_details || 0,

                type_of_supply || "Goods",
                rate_of_duty || 0,

                description || null,
                updated_by || null,

                id
            ]
        );

        // DELETE OLD GST DETAILS

        await connection.query(`
            DELETE FROM stock_item_gst_details
            WHERE stock_item_id = ?
        `, [id]);



        // INSERT NEW GST DETAILS

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
                    state_tax

                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [

                    id,

                    gst_details.gst_description || null,
                    gst_details.hsn_sac || null,
                    gst_details.is_non_gst_goods || 0,
                    gst_details.calculation_type || "On Value",
                    gst_details.taxability || null,
                    gst_details.integrated_tax || 0,
                    gst_details.central_tax || 0,
                    gst_details.state_tax || 0,
                    // gst_details.cess || 0
                ]
            );
        }



        // DELETE OLD OPENING STOCK

        await connection.query(`
            DELETE FROM stock_item_opening_stock
            WHERE stock_item_id = ?
        `, [id]);



        // INSERT NEW OPENING STOCK

        if (opening_stock) {

            const calculatedAmount =
                Number(opening_stock.quantity || 0)
                *
                Number(opening_stock.rate || 0);

            await connection.query(
                `
                INSERT INTO stock_item_opening_stock (

                    stock_item_id,
                    godown_id,
                    batch_no,
                    mfg_date,
                    expiry_date,
                    quantity,
                    rate, supercash_price,
                    per_unit_id,
                    amount

                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [

                    id,

                    opening_stock.godown_id,

                    opening_stock.batch_no || null,

                    maintain_in_batches == 1 &&
                    track_mfg_date == 1
                        ? opening_stock.mfg_date || null
                        : null,

                    maintain_in_batches == 1 &&
                    use_expiry_dates == 1 ? opening_stock.expiry_date || null : null,
                    opening_stock.quantity || 0,
                    opening_stock.rate || 0,
                    opening_stock.supercash_price || 0,
                    opening_stock.per_unit_id || null,
                    calculatedAmount
                ]
            );
        }



        await connection.commit();

        return res.status(200).json({
            success: true,
            message: "Stock item updated successfully"
        });

    } catch (error) {

        await connection.rollback();

        console.log("UPDATE STOCK ITEM ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });

    } finally {

        connection.release();
    }
};


exports.deleteStockItem = async (req, res) => {

    try {

        const { id } = req.params;

        const result =
            await stockItemModel.deleteStockItem(id);

        if (result.affectedRows === 0) {

            return res.status(404).json({
                success: false,
                message: "Stock item not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Stock item deleted successfully"
        });

    } catch (error) {

        console.log("DELETE STOCK ITEM ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};