const db = require("../config/db");

exports.createRetailer = async (data) => {

  const query = `
    INSERT INTO customers
    (
      type,
      name,
      firm_name,
      firm_address,
      contact_number,
      address,
      area,
      district,
      pincode,
      created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const [result] = await db.query(query, data);

  return result.insertId;
};

exports.getRetailers = async ({
  page = 1,
  limit = 10,
  search = ""
}) => {

  const offset = (page - 1) * limit;

  let whereClause = `WHERE type = 'retailer'`;
  let searchParams = [];

  // SEARCH FILTER
  if (search) {

    whereClause += `
      AND (
        name LIKE ?
        OR firm_name LIKE ?
        OR contact_number LIKE ?
      )
    `;

    const searchValue = `%${search}%`;

    searchParams.push(
      searchValue,
      searchValue,
      searchValue
    );
  }

  // TOTAL COUNT QUERY
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM customers
    ${whereClause}
  `;

  const [countResult] = await db.query(
    countQuery,
    searchParams
  );

  const total = countResult[0].total;

  // DATA QUERY
  const dataQuery = `
    SELECT
      id,
      name,
      firm_name,
      contact_number,
      district,
      area,
      created_at
    FROM customers
    ${whereClause}
    ORDER BY id DESC
    LIMIT ?
    OFFSET ?
  `;

  const [rows] = await db.query(
    dataQuery,
    [...searchParams, Number(limit), Number(offset)]
  );

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    data: rows
  };
};

exports.getRetailerById = async (id) => {

  const [rows] = await db.query(`
    SELECT *
    FROM customers
    WHERE id = ?
    AND type = 'retailer'
  `, [id]);

  return rows[0];
};

exports.updateRetailer = async (id, data) => {

  const query = `
    UPDATE customers
    SET
      name = ?,
      firm_name = ?,
      firm_address = ?,
      contact_number = ?,
      address = ?,
      area = ?,
      district = ?,
      pincode = ?
    WHERE id = ?
    AND type = 'retailer'
  `;

  const [result] = await db.query(query, [...data, id]);

  return result;
};

exports.checkRetailerExists = async (contact_number) => {

  const [rows] = await db.query(`
    SELECT *
    FROM customers
    WHERE contact_number = ?
    AND type = 'retailer'
  `, [contact_number]);

  return rows[0];
};