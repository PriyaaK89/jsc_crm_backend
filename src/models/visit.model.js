const db = require("../config/db");

exports.createVisit = async (data) => {
  const query = `
    INSERT INTO visits 
    (user_id, customer_id, visit_type, customer_type, visit_purpose, comment, reminder_date, image_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ? )`;

  const [result] = await db.query(query, data);
  return result.insertId;
};


exports.getVisits = async (filters) => {
  let baseQuery = ` FROM visits v LEFT JOIN customers c ON v.customer_id = c.id LEFT JOIN users u ON v.user_id = u.id
    WHERE 1=1`;

  const params = [];

  //  Filters

if (filters.user_ids && filters.user_ids.length > 0) {
  baseQuery += ` AND v.user_id IN (${filters.user_ids.map(() => "?").join(",")})`;
  params.push(...filters.user_ids);
}

  if (filters.visit_type) {
    baseQuery += " AND v.visit_type = ?";
    params.push(filters.visit_type);}

  if (filters.district) {
    baseQuery += " AND c.district = ?";
    params.push(filters.district);
  }

  if (filters.from_date && filters.to_date) {
    baseQuery += " AND DATE(v.created_at) BETWEEN ? AND ?";
    params.push(filters.from_date, filters.to_date);
  }

  //  SEARCH FILTER (MAIN PART)
  if (filters.search) {
    baseQuery += `
      AND (
        c.name LIKE ?
        OR u.name LIKE ?
        OR c.contact_number LIKE ?
        OR c.district LIKE ?
        OR v.comment LIKE ?
      )
    `;
    const searchValue = `%${filters.search}%`;
    params.push(searchValue, searchValue, searchValue, searchValue, searchValue);
  }

  //  Total count
  const [countResult] = await db.query(
    `SELECT COUNT(*) as total ${baseQuery}`,
    params
  );

  const total = countResult[0].total;

  //  Pagination
  const limit = Math.min(parseInt(filters.limit) || 10, 50);
  const page = parseInt(filters.page) || 1;
  const offset = (page - 1) * limit;

  //  Data query
  const dataQuery = `
    SELECT 
      v.id,
      v.user_id,
      u.name as emp_name,
      v.visit_type,
      v.customer_type,
      v.visit_purpose,
      v.comment,
      v.reminder_date,
      v.image_path,
      v.created_at,

      c.name AS customer_name,
      c.firm_name,
      c.firm_address,
      c.contact_number,
      c.address,
      c.area,
      c.district,
      c.pincode

    ${baseQuery}
    ORDER BY v.id DESC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await db.query(dataQuery, [...params, limit, offset]);

  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    data: rows
  };
};