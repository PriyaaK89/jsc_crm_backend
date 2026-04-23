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
    `SELECT id, name  FROM job_roles  WHERE department_id = ? AND is_active = 1`,
    [departmentId]
  );
  return rows;
};

const getRoleById = async (id) => {
  const [rows] = await db.query(
    'SELECT id, name, level, department_id FROM job_roles WHERE id = ?',
    [id]
  );
  return rows[0];
};

const updateJobRole = async (id, departmentId, name) => {
  const [result] = await db.query(
    `UPDATE job_roles 
     SET department_id = ?, name = ?
     WHERE id = ? AND is_active = 1`,
    [departmentId, name, id]
  );

  return result.affectedRows;
};

const deleteJobRole = async (id) => {
  const [result] = await db.query(
    `UPDATE job_roles 
     SET is_active = 0
     WHERE id = ? AND is_active = 1`,
    [id]
  );

  return result.affectedRows;
};

const getUsersByLevel = async (level) => {
  const [rows] = await db.query(
    `SELECT u.id, u.name
     FROM users u
     JOIN job_roles jr ON u.job_role_id = jr.id
     WHERE jr.level = ? AND u.is_active = 1`,
    [level]
  );

  return rows;
};

module.exports = {
  createJobRole,
  getRolesByDepartment,
  getRoleById,
  updateJobRole,
  deleteJobRole, getUsersByLevel
};
