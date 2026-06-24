const db = require("../../config/db");

exports.createApprovalConfig = async (data) => {

    const [result] = await db.query(
        ` INSERT INTO transaction_approval_config
        (
            employee_id,
            junior_accountant_id,
            dispatcher_id,
            senior_accountant_id,
            created_by
        )
        VALUES (?, ?, ?, ?, ?)
        `,
        [
            data.employee_id,
            data.junior_accountant_id,
            data.dispatcher_id,
            data.senior_accountant_id,
            data.created_by
        ]
    );

    return result.insertId;
};

exports.getApprovalConfigByEmployee = async (
    employee_id
) => {

    const [rows] = await db.query(
        `
        SELECT
            tac.*,

            e.name AS employee_name,
            ja.name AS junior_accountant_name,
            d.name AS dispatcher_name,
            sa.name AS senior_accountant_name

        FROM transaction_approval_config tac

        LEFT JOIN users e
            ON e.id = tac.employee_id

        LEFT JOIN users ja
            ON ja.id = tac.junior_accountant_id

        LEFT JOIN users d
            ON d.id = tac.dispatcher_id

        LEFT JOIN users sa
            ON sa.id = tac.senior_accountant_id

        WHERE tac.employee_id = ?
        `,
        [employee_id]
    );

    return rows[0] || null;
};

exports.getAllApprovalConfigs = async () => {

    const [rows] = await db.query(
        ` SELECT
            tac.*,

            e.name AS employee_name,
            ja.name AS junior_accountant_name,
            d.name AS dispatcher_name,
            sa.name AS senior_accountant_name

        FROM transaction_approval_config tac

        LEFT JOIN users e
            ON e.id = tac.employee_id

        LEFT JOIN users ja
            ON ja.id = tac.junior_accountant_id

        LEFT JOIN users d
            ON d.id = tac.dispatcher_id

        LEFT JOIN users sa
            ON sa.id = tac.senior_accountant_id

        ORDER BY tac.id DESC
        `
    );

    return rows;
};

exports.updateApprovalConfig = async ( id, data) => {

    const [result] = await db.query(
        `
        UPDATE transaction_approval_config
        SET
            junior_accountant_id = ?,
            dispatcher_id = ?,
            senior_accountant_id = ?,
            updated_by = ?
        WHERE id = ?
        `,
        [
            data.junior_accountant_id,
            data.dispatcher_id,
            data.senior_accountant_id,
            data.updated_by,
            id
        ]
    );

    return result;
};
