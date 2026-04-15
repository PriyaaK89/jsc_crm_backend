const db = require("../config/db");

exports.create = async ({
  name,
  parent_id,
  add_quantity,
  gst_enabled,
  overdue_limit
}) => {
  //  Insert data
  const [result] = await db.query(
    `INSERT INTO stock_groups 
    (name, parent_id, add_quantity, gst_enabled, overdue_limit) 
    VALUES (?, ?, ?, ?, ?)`,
    [name, parent_id, add_quantity, gst_enabled, overdue_limit]
  );

  const insertId = result.insertId;

  //  Fetch full inserted record
  const [rows] = await db.query(
    `SELECT 
        id, 
        name, 
        parent_id, 
        add_quantity, 
        gst_enabled, 
        overdue_limit 
     FROM stock_groups 
     WHERE id = ?`,
    [insertId]
  );

  return rows[0]; //  full object
};
exports.getAllStockGroups = async () => {
  const [rows] = await db.query(
    `SELECT id, name FROM stock_groups ORDER BY name ASC`
  );
  return rows;
};

exports.getStockGroupById = async (id)=>{
    const [rows] = await db.query(
        `SELECT * FROM stock_groups WHERE id = ? `,[id] 
    );
    return rows[0];
};

exports.updateStockGroup = async ({
  id,
  name,
  parent_id,
  add_quantity,
  gst_enabled,
  overdue_limit
}) => {
  const [result] = await db.query(
    `UPDATE stock_groups 
     SET name = ?, parent_id = ?, add_quantity = ?, gst_enabled = ?, overdue_limit = ?
     WHERE id = ?`,
    [name, parent_id, add_quantity, gst_enabled, overdue_limit, id]
  );

  return result;
};

// Delete
exports.deleteStockGroup = async (id) => {
  const [result] = await db.query(
    `DELETE FROM stock_groups WHERE id = ?`,
    [id]
  );

  return result;
};

