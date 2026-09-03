const db = require("../config/db");

const createStockItem = async (data) => {

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
        created_by

    } = data;

    const [result] = await db.query(
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
            track_mfg_date || 0,
            use_expiry_dates || 0,
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

    return result.insertId;
};

// CREATE GST DETAILS
const createGSTDetails = async (stock_item_id, data) => {
    const {
        gst_description,
        hsn_sac,
        is_non_gst_goods,
        calculation_type,
        taxability,
        integrated_tax,
        central_tax,
        state_tax,
       
    } = data;

    const [result] = await db.query(
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ? )
        `,
        [
            stock_item_id,
            gst_description,
            hsn_sac,
            is_non_gst_goods,
            calculation_type,
            taxability,
            integrated_tax,
            central_tax,
            state_tax,
        ]
    );

    return result.insertId;
};




// CREATE OPENING STOCK
const createOpeningStock = async (stock_item_id, data) => {

    const { godown_id, batch_no, mfg_date, expiry_date, quantity, rate,   supercash_price,per_unit_id, amount } = data;

    const [result] = await db.query(
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
            godown_id,
            batch_no,
            mfg_date,
            expiry_date,
            quantity,
            rate,
             supercash_price || 0,
            per_unit_id,
            amount
        ]
    );
    return result.insertId;
};


const getStockItems = async (
    search = "",
    page = 1,
    limit = 10
) => {

    const offset = (page - 1) * limit;

    const [countRows] = await db.query(
        `
        SELECT COUNT(*) AS total
        FROM stock_items
        WHERE item_name LIKE ?
        `,
        [`%${search}%`]
    );

    const totalRecords = countRows[0].total;

    const [rows] = await db.query(
        `

        SELECT

            si.id,
            si.item_name,

            si.type_of_supply,
            si.rate_of_duty,

            si.gst_applicable,
            si.set_gst_details,

            si.maintain_in_batches,
            si.track_mfg_date,
            si.use_expiry_dates,

            si.set_standard_rates,
            si.enable_cost_tracking,

            si.is_returnable,
            si.returnable_percentage,

            si.description,
            si.created_at,

            sg.name AS stock_group_name,

            sc.name AS stock_category_name,

            u.symbol AS base_unit_name,

            au.symbol AS alternative_unit_name,
            si.alternative_unit_value,
            si.base_unit_value,

            bu.symbol AS bulk_unit_name,
            si.bulk_unit_value,
            si.bulk_base_value,

            os.quantity,
            os.rate,
            os.supercash_price,
            os.amount,

            gu.symbol AS opening_stock_unit,

            g.godown_name

        FROM stock_items si

        LEFT JOIN stock_groups sg
            ON si.stock_group_id = sg.id

        LEFT JOIN stock_categories sc
            ON si.stock_category_id = sc.id

        LEFT JOIN units u
            ON si.unit_id = u.id

        LEFT JOIN units au
            ON si.alternative_unit_id = au.id

        LEFT JOIN units bu
            ON si.bulk_unit_id = bu.id

        LEFT JOIN stock_item_opening_stock os
            ON si.id = os.stock_item_id

        LEFT JOIN units gu
            ON os.per_unit_id = gu.id

        LEFT JOIN godowns g
            ON os.godown_id = g.id

        WHERE si.item_name LIKE ?

        ORDER BY si.id DESC

        LIMIT ?
        OFFSET ?

        `,
        [
            `%${search}%`,
            Number(limit),
            Number(offset)
        ]
    );



    return {
        rows,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        currentPage: Number(page)
    };
};

const getStockItemById = async (id) => {
    const [rows] = await db.query(`
        SELECT
            si.*,
            sg.name AS stock_group_name,
            sc.name AS stock_category_name,
            u.symbol AS base_unit_name,
            au.symbol AS alternative_unit_name,
            bu.symbol AS bulk_unit_name,

            si.alternative_unit_value,
            si.base_unit_value,
        
            si.bulk_unit_value,
            si.bulk_base_value
        FROM stock_items si

        LEFT JOIN stock_groups sg ON si.stock_group_id = sg.id

        LEFT JOIN stock_categories sc ON si.stock_category_id = sc.id

        LEFT JOIN units u ON si.unit_id = u.id

        LEFT JOIN units au ON si.alternative_unit_id = au.id

        LEFT JOIN units bu
            ON si.bulk_unit_id = bu.id

        WHERE si.id = ?
    `, [id]);

    const item = rows[0];

    if (!item) return null;
    
    let calculated_alt_unit = null;
    
    if (
        Number(item.base_unit_value) > 0 &&
        Number(item.bulk_base_value) > 0
    ) {
        const altQty = Number(
            (
                Number(item.bulk_base_value) /
                Number(item.base_unit_value)
            ).toFixed(2)
        );
    
        calculated_alt_unit = `${altQty} ${item.alternative_unit_name}`;
        
    }
    
    return {
        ...item,
        calculated_alt_unit
    };
}


// =============================
// GET GST DETAILS
// =============================
const getGSTDetails = async (stock_item_id) => {

    const [rows] = await db.query(`
    
        SELECT *
        FROM stock_item_gst_details
        WHERE stock_item_id = ?
    
    `, [stock_item_id]);

    return rows[0];
};



// =============================
// GET OPENING STOCK
// =============================
const getOpeningStock = async (stock_item_id) => {
    const [rows] = await db.query(`
        SELECT
            os.*,
            g.godown_name,
            u.symbol AS per_unit_name
        FROM stock_item_opening_stock os

        LEFT JOIN godowns g
            ON os.godown_id = g.id

        LEFT JOIN units u
            ON os.per_unit_id = u.id

        WHERE os.stock_item_id = ?

    `, [stock_item_id]);

    return rows[0];
};



// =============================
// DELETE STOCK ITEM
// =============================
// const deleteStockItem = async (id) => {

//     const [result] = await db.query(`
//         DELETE FROM stock_items
//         WHERE id = ? `, [id]);

//     return result;
// };

const deleteStockItem = async (id) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // Tables where a match means "this item is in use" — block delete
        const blockingChecks = [
            { table: "sales_items", column: "stock_item_id" },
            { table: "sales_item_batches", column: "stock_item_id" },
            { table: "purchase_items", column: "stock_item_id" },
            { table: "purchase_item_batches", column: "stock_item_id" },
            { table: "credit_note_items", column: "stock_item_id" },
            { table: "debit_note_items", column: "stock_item_id" },
            { table: "debit_note_item_batches", column: "stock_item_id" },
            { table: "manufacturing_components", column: "item_id" },
            { table: "manufacturing_coproducts", column: "item_id" },
            { table: "manufacturing_entries", column: "finished_item_id" },
            { table: "stock_transactions", column: "stock_item_id" },
            { table: "stock_transfer_source_items", column: "item_id" },
            { table: "stock_transfer_destination_items", column: "item_id" },
        ];

        for (const { table, column } of blockingChecks) {
            const [rows] = await connection.query(
                `SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`,
                [id]
            );
            if (rows.length > 0) {
                await connection.rollback();
                const err = new Error(
                    `Cannot delete: this item has related records in ${table}`
                );
                err.code = "ITEM_IN_USE";
                err.blockingTable = table;
                throw err;
            }
        }

        // Safe to cascade — pure config/setup data
        await connection.query(`DELETE FROM stock_batches WHERE stock_item_id = ?`, [id]);
        await connection.query(`DELETE FROM stock_item_opening_stock WHERE stock_item_id = ?`, [id]);
        await connection.query(`DELETE FROM stock_item_gst_details WHERE stock_item_id = ?`, [id]);
        await connection.query(`DELETE FROM stock_item_supercash_prices WHERE stock_item_id = ?`, [id]);

        const [result] = await connection.query(`DELETE FROM stock_items WHERE id = ?`, [id]);

        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = {
    createStockItem, createGSTDetails,
    createOpeningStock, getStockItems,
    getStockItemById, getGSTDetails,
    getOpeningStock, deleteStockItem
};