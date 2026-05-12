const db = require("../config/db");

const createGodown = async (data) => {

    const sql = `
        INSERT INTO godowns (
            godown_name,
            parent_id,
            allow_storage_material,
            our_stock_with_third_party,
            third_party_stock_with_us,
            created_by
        )
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    const values = [
        data.godown_name,
        data.parent_id || null,
        data.allow_storage_material,
        data.our_stock_with_third_party,
        data.third_party_stock_with_us,
        data.created_by
    ];

    const [result] = await db.query(sql, values);

    return result;
};

const getAllGodowns = async ({
  page = 1,
  limit = 10,
  search = "",
}) => {

  const offset = (page - 1) * limit;

  // ======================================
  // SEARCH QUERY
  // ======================================

  let searchQuery = "";

  let queryParams = [];

  if (search) {

    searchQuery = `
      AND (
        g.godown_name LIKE ?
        OR pg.godown_name LIKE ?
      )
    `;

    queryParams.push(`%${search}%`);
    queryParams.push(`%${search}%`);
  }

  // ======================================
  // MAIN DATA QUERY
  // ======================================

  const dataQuery = `
    SELECT
      g.id,
      g.godown_name,
      pg.godown_name AS parent_name,
      g.allow_storage_material,
      g.our_stock_with_third_party,
      g.third_party_stock_with_us,
      g.created_at

    FROM godowns g

    LEFT JOIN godowns pg
      ON g.parent_id = pg.id

    WHERE g.is_active = 1

    ${searchQuery}

    ORDER BY g.id DESC

    LIMIT ?
    OFFSET ?
  `;

  const dataParams = [
    ...queryParams,
    Number(limit),
    Number(offset),
  ];

  const [rows] = await db.query(
    dataQuery,
    dataParams
  );

  const countQuery = `
    SELECT COUNT(*) AS total

    FROM godowns g

    LEFT JOIN godowns pg
      ON g.parent_id = pg.id

    WHERE g.is_active = 1

    ${searchQuery}
  `;

  const [countRows] = await db.query(
    countQuery,
    queryParams
  );

  return {
    rows,
    total: countRows[0].total,
  };
};


const getGodownById = async (id) => {

    const [rows] = await db.query(
        `SELECT * FROM godowns WHERE id = ?`,
        [id]
    );

    return rows[0];
};

const updateGodown = async (id, data) => {

    const sql = `
        UPDATE godowns
        SET
            godown_name = ?,
            parent_id = ?,
            allow_storage_material = ?,
            our_stock_with_third_party = ?,
            third_party_stock_with_us = ?,
            updated_by = ?
        WHERE id = ?
    `;

    const values = [
        data.godown_name,
        data.parent_id || null,
        data.allow_storage_material,
        data.our_stock_with_third_party,
        data.third_party_stock_with_us,
        data.updated_by,
        id
    ];

    const [result] = await db.query(sql, values);

    return result;
};

const deleteGodown = async (id) => {

    const [result] = await db.query(
        `UPDATE godowns SET is_active = 0 WHERE id = ?`,
        [id]
    );

    return result;
};

module.exports = {
    createGodown,
    getAllGodowns,
    getGodownById,
    updateGodown,
    deleteGodown
};