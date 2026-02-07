const db = require('../config/db');

const createJobRole = async (departmentId, name) => {
  const [result] = await db.query(
    'INSERT INTO job_roles (department_id, name) VALUES (?, ?)',
    [departmentId, name]
  );
  return result.insertId;
};

const getRolesByDepartment = async (departmentId) => {
  const [rows] = await db.query(
    `SELECT id, name 
     FROM job_roles 
     WHERE department_id = ? AND is_active = 1`,
    [departmentId]
  );
  return rows;
};

module.exports = {
  createJobRole,
  getRolesByDepartment
};
