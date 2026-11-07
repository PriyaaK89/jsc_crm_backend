const db = require("../config/db");

const MARKETING_DEPARTMENT_ID = 2;

// Returns [] for everyone except Marketing employees
exports.getHiddenGroupIds = async (departmentId) => {
  if (Number(departmentId) !== MARKETING_DEPARTMENT_ID) return [];

  const [groups] = await db.query(
    `SELECT id, parent_id, hide_from_marketing FROM stock_groups`
  );

  // start with groups flagged as hidden
  const hidden = new Set(
    groups.filter((g) => Number(g.hide_from_marketing) === 1).map((g) => g.id)
  );

  // keep adding children of hidden groups until nothing new is added
  let added = true;
  while (added) {
    added = false;
    for (const g of groups) {
      if (!hidden.has(g.id) && g.parent_id != null && hidden.has(g.parent_id)) {
        hidden.add(g.id);
        added = true;
      }
    }
  }

  return [...hidden];
};

exports.create = async ({ name, parent_id, add_quantity, gst_enabled, overdue_limit, hide_from_marketing }) => {
  const [result] = await db.query(
    `INSERT INTO stock_groups
     (name, parent_id, add_quantity, gst_enabled, overdue_limit, hide_from_marketing)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, parent_id, add_quantity, gst_enabled, overdue_limit, hide_from_marketing ? 1 : 0]
  );

  const [rows] = await db.query(
    `SELECT id, name, parent_id, add_quantity, gst_enabled, overdue_limit, hide_from_marketing
     FROM stock_groups WHERE id = ?`,
    [result.insertId]
  );
  return rows[0];
};

exports.getAllStockGroups = async (hiddenGroupIds = []) => {
  const where = hiddenGroupIds.length ? `WHERE id NOT IN (?)` : ``;
  const [rows] = await db.query(
    `SELECT id, name, parent_id, add_quantity, gst_enabled, overdue_limit, hide_from_marketing
     FROM stock_groups
     ${where}
     ORDER BY name ASC`,
    hiddenGroupIds.length ? [hiddenGroupIds] : []
  );
  return rows;
};

exports.getStockGroupById = async (id)=>{
    const [rows] = await db.query( `SELECT * FROM stock_groups WHERE id = ? `,[id]  );
    return rows[0];
};

exports.updateStockGroup = async ({ id, name, parent_id, add_quantity, gst_enabled, overdue_limit, hide_from_marketing }) => {
  const [result] = await db.query(
    `UPDATE stock_groups
     SET name = ?, parent_id = ?, add_quantity = ?, gst_enabled = ?, overdue_limit = ?, hide_from_marketing = ?
     WHERE id = ?`,
    [name, parent_id, add_quantity, gst_enabled, overdue_limit, hide_from_marketing ? 1 : 0, id]
  );
  return result;
};

// Delete
exports.deleteStockGroup = async (id) => {
  const [result] = await db.query( `DELETE FROM stock_groups WHERE id = ?`, [id] );

  return result;
};

