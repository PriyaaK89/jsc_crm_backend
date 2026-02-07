const db = require('../config/db');

const createDepartment = async (name) => {
  const [result] = await db.query(
    'INSERT INTO department (name) VALUES (?)',
    [name]
  );
  return result.insertId;
};

const getAllDepartments = async () => {
  const [rows] = await db.query(
    'SELECT id, name FROM department WHERE is_active = 1 ORDER BY name'
  );
  return rows;
};

const deactivateDepartment = async (id) => {
  await db.query(
    'UPDATE department SET is_active = 0 WHERE id = ?',
    [id]
  );
};

module.exports = {
  createDepartment,
  getAllDepartments,
  deactivateDepartment
};
