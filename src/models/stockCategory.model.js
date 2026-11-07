const db = require("../config/db");

//  CREATE CATEGORY
exports.createStockCategory = async ({ name, stock_group_id }) => {
  const [result] = await db.query(
    `INSERT INTO stock_categories (name, stock_group_id) VALUES (?, ?)`,
    [name, stock_group_id]
  );

  const insertId = result.insertId;

  const [rows] = await db.query(
    `SELECT * FROM stock_categories WHERE id = ?`,
    [insertId]
  );

  return rows[0];
};

exports.getAllStockCategories = async (hiddenGroupIds = []) => {
  const hiddenSql = hiddenGroupIds.length ? `AND c.stock_group_id NOT IN (?)` : ``;
  const [rows] = await db.query(
    `SELECT c.id, c.name, c.stock_group_id, g.name AS group_name
     FROM stock_categories c
     LEFT JOIN stock_groups g ON c.stock_group_id = g.id
     WHERE c.is_deleted = 0 ${hiddenSql}
     ORDER BY c.id DESC`,
    hiddenGroupIds.length ? [hiddenGroupIds] : []
  );
  return rows;
};

exports.getCategoriesByStockGroup = async (stock_group_id, hiddenGroupIds = []) => {
  if (hiddenGroupIds.map(Number).includes(Number(stock_group_id))) return [];

  const [rows] = await db.query(
    `SELECT c.id, c.name, c.stock_group_id, g.name AS group_name
     FROM stock_categories c
     LEFT JOIN stock_groups g ON c.stock_group_id = g.id
     WHERE c.stock_group_id = ? AND c.is_deleted = 0
     ORDER BY c.name ASC`,
    [stock_group_id]
  );
  return rows;
};

exports.getStockCategoryById = async (id) => {
  const [rows] = await db.query(
    `SELECT 
        c.id,
        c.name,
        c.stock_group_id,
        g.name AS group_name
     FROM stock_categories c
     LEFT JOIN stock_groups g ON c.stock_group_id = g.id
     WHERE c.id = ? AND c.is_deleted = 0`,
    [id]
  );

  return rows[0];
};

exports.updateStockCategory = async ({ id, name, stock_group_id }) => {
  const [result] = await db.query(
    `UPDATE stock_categories 
     SET name = ?, stock_group_id = ?
     WHERE id = ?`,
    [name, stock_group_id, id]
  );

  return result;
};

exports.deleteStockCategory = async (id) => {
  const [result] = await db.query(
    `UPDATE stock_categories 
     SET is_deleted = 1 
     WHERE id = ?`,
    [id]
  );

  return result;
};

