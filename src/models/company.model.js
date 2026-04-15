const db = require("../config/db");

const createCompany = async (data) => {
  const [result] = await db.query("INSERT INTO companies SET ?", data);
  return result.insertId;
};

const getCompanies = async ({ search, limit, offset }) => {
  let where = "WHERE 1=1";
  let values = [];

  if (search) {
    where += ` AND (
      company_name LIKE ? 
      OR gstin LIKE ? 
      OR phone LIKE ?
    )`;

    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const [data] = await db.query(
    `SELECT * FROM companies 
     ${where} 
     ORDER BY id DESC 
     LIMIT ? OFFSET ?`,
    [...values, Number(limit), Number(offset)]
  );

  const [countResult] = await db.query(
    `SELECT COUNT(*) as total FROM companies ${where}`,
    values
  );

  return {
    data,
    total: countResult[0].total,
  };
};

const getCompanyById = async (id) => {
  const [rows] = await db.query(
    "SELECT * FROM companies WHERE id = ?",
    [id]
  );
  return rows[0]; 
};

//  UPDATE
const updateCompany = async (id, data) => {
  const [result] = await db.query(
    "UPDATE companies SET ? WHERE id = ?",
    [data, id]
  );
  return result;
};

//  DELETE
const deleteCompany = async (id) => {
  const [result] = await db.query(
    "DELETE FROM companies WHERE id = ?",
    [id]
  );
  return result;
};

module.exports = { createCompany, getCompanies, updateCompany, deleteCompany, getCompanyById };