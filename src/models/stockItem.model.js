const db = require("../config/db");

const createStockItem = async (data) => {
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
        created_by
    } = data;

    const [result] = await db.query(
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
            stock_category_id,
            unit_id,
            gst_applicable,
            set_gst_details,
            type_of_supply,
            rate_of_duty,
            description,
            created_by
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
        cess
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
            state_tax,
            cess
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            cess
        ]
    );

    return result.insertId;
};




// CREATE OPENING STOCK
const createOpeningStock = async (stock_item_id, data) => {

    const {
        godown_id,
        batch_no,
        mfg_date,
        expiry_date,
        quantity,
        rate,
        per_unit_id,
        amount
    } = data;

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
            per_unit_id,
            amount
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            stock_item_id,
            godown_id,
            batch_no,
            mfg_date,
            expiry_date,
            quantity,
            rate,
            per_unit_id,
            amount
        ]
    );

    return result.insertId;
};



module.exports = {
    createStockItem,
    createGSTDetails,
    createOpeningStock
};