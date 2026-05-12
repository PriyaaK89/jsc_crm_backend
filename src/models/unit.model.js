const db = require("../config/db");

const getAllUQC = async () => {

    const [rows] = await db.query(`
        SELECT *
        FROM unit_quantity_codes
        WHERE status = 1
        ORDER BY code ASC
    `);

    return rows;
};

// CREATE UNIT
const createUnit = async (data) => {

    const {
        type,
        symbol,
        formal_name,
        uqc,
        decimal_places,
        first_unit_id,
        conversion_value,
        second_unit_id
    } = data;

    const [result] = await db.query(
        `
        INSERT INTO units
        (
            type,
            symbol,
            formal_name,
            uqc,
            decimal_places,
            first_unit_id,
            conversion_value,
            second_unit_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            type,
            symbol,
            formal_name,
            uqc,
            decimal_places || 0,
            first_unit_id || null,
            conversion_value || null,
            second_unit_id || null
        ]
    );

    return result;
};

const getSimpleUnits = async () => {

    const [rows] = await db.query(`
        SELECT
            id,
            symbol,
            formal_name,
            type
        FROM units
        WHERE type = 'SIMPLE'
        ORDER BY symbol ASC
    `);

    return rows;
};

// GET ALL UNITS WITH PAGINATION + SEARCH
const getAllUnits = async (search, page, limit) => {

    const offset = (page - 1) * limit;

    let query = `
        SELECT
            u.*,
            fu.symbol AS first_unit,
            su.symbol AS second_unit
        FROM units u
        LEFT JOIN units fu ON fu.id = u.first_unit_id
        LEFT JOIN units su ON su.id = u.second_unit_id
        WHERE 1=1
    `;

    let countQuery = `
        SELECT COUNT(*) AS total
        FROM units u
        WHERE 1=1
    `;

    const params = [];
    const countParams = [];

    if (search) {
        query += `
            AND (
                u.symbol LIKE ?
                OR u.formal_name LIKE ?
                OR u.uqc LIKE ?
                OR u.type LIKE ?
            )
        `;

        countQuery += `
            AND (
                u.symbol LIKE ?
                OR u.formal_name LIKE ?
                OR u.uqc LIKE ?
                OR u.type LIKE ?
            )
        `;

        const searchValue = `%${search}%`;

        params.push(searchValue, searchValue, searchValue, searchValue);
        countParams.push(searchValue, searchValue, searchValue, searchValue);
    }

    query += `
        ORDER BY u.id DESC
        LIMIT ? OFFSET ?
    `;

    params.push(Number(limit), Number(offset));

    const [rows] = await db.query(query, params);

    const [countRows] = await db.query(countQuery, countParams);

    return {
        data: rows,
        total: countRows[0].total
    };
};

// GET UNIT BY ID
const getUnitById = async (id) => {

    const [rows] = await db.query(
        `
        SELECT
            u.*,
            fu.symbol AS first_unit,
            su.symbol AS second_unit
        FROM units u
        LEFT JOIN units fu ON fu.id = u.first_unit_id
        LEFT JOIN units su ON su.id = u.second_unit_id
        WHERE u.id = ?
        `,
        [id]
    );

    return rows[0];
};

// UPDATE UNIT
const updateUnit = async (id, data) => {

    const {
        type,
        symbol,
        formal_name,
        uqc,
        decimal_places,
        first_unit_id,
        conversion_value,
        second_unit_id
    } = data;

    const [result] = await db.query(
        `
        UPDATE units
        SET
            type = ?,
            symbol = ?,
            formal_name = ?,
            uqc = ?,
            decimal_places = ?,
            first_unit_id = ?,
            conversion_value = ?,
            second_unit_id = ?
        WHERE id = ?
        `,
        [
            type,
            symbol,
            formal_name,
            uqc,
            decimal_places || 0,
            first_unit_id || null,
            conversion_value || null,
            second_unit_id || null,
            id
        ]
    );

    return result;
};

// DELETE UNIT
const deleteUnit = async (id) => {

    const [result] = await db.query(
        `DELETE FROM units WHERE id = ?`,
        [id]
    );

    return result;
};

module.exports = {
    createUnit,
    getAllUnits,
    getUnitById,
    updateUnit,
    deleteUnit,
    getAllUQC, getSimpleUnits
};