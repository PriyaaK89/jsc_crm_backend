const db = require("../config/db");

exports.createCustomer = async (data) => {
  const query = `INSERT INTO customers 
    (type, name, firm_name, firm_address, contact_number, address, area, district, pincode, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) `;

  const [result] = await db.query(query, data);
  return result.insertId;
};

exports.getCustomersByType = async (type) => {
  const [rows] = await db.query(
    "SELECT id, name FROM customers WHERE type = ?",
    [type]
  );
  return rows;
};

exports.getCustomerById = async (id) => {
  const [rows] = await db.query(
    "SELECT * FROM customers WHERE id = ?",
    [id]
  );
  return rows[0];
};

exports.findCustomer = async (contact_number, type) => {
  const [rows] = await db.query(
    `SELECT * FROM customers 
     WHERE contact_number = ?`,
    [contact_number, type]
  );

  return rows[0];
};