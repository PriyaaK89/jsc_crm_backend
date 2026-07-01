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
  let baseQuery = ` FROM visits v LEFT JOIN customers c ON v.customer_id = c.id LEFT JOIN users u ON v.user_id = u.id WHERE 1=1`;

  const params = [];

  //  Filters

if (filters.user_id) {
  baseQuery += ` AND v.user_id = ?`;
  params.push(filters.user_id);
}

// Hierarchy filter for non-admin
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
  const [countResult] = await db.query(`SELECT COUNT(*) as total ${baseQuery}`, params );

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
  return { total, page, limit, totalPages: Math.ceil(total / limit), data: rows };

};

exports.getVisitReportSummary = async (filters) => {
  let baseQuery = ` FROM visits v
    LEFT JOIN customers c ON v.customer_id = c.id
    LEFT JOIN users u ON v.user_id = u.id
    WHERE 1=1 `;

  const params = [];

  // ========================= FILTERS =========================

  if (filters.user_id) {
    baseQuery += ` AND v.user_id = ?`;
    params.push(filters.user_id);
  }

  if (filters.visit_type) {
    baseQuery += ` AND v.visit_type = ?`;
    params.push(filters.visit_type);
  }

  if (filters.district) {
    baseQuery += ` AND c.district = ?`;
    params.push(filters.district);
  }

  if (filters.from_date && filters.to_date) {
    baseQuery += ` AND DATE(v.created_at) BETWEEN ? AND ?`;
    params.push(filters.from_date, filters.to_date);
  }

  // =========================
  // SEARCH FILTER
  // =========================

  if (filters.search) {
    baseQuery += `
      AND (
        u.name LIKE ?
        OR c.name LIKE ?
        OR c.firm_name LIKE ?
        OR c.contact_number LIKE ?
        OR c.district LIKE ?
        OR v.comment LIKE ?
        OR v.visit_purpose LIKE ?
      ) `;

    const searchValue = `%${filters.search}%`;

    params.push(
      searchValue,
      searchValue,
      searchValue,
      searchValue,
      searchValue,
      searchValue,
      searchValue
    );
  }

  const countQuery = `
    SELECT COUNT(*) as total
    FROM (
      SELECT  v.user_id, v.customer_id, v.visit_purpose
      ${baseQuery}
      GROUP BY  v.user_id, v.customer_id, v.visit_purpose
    ) x
  `;

  const [countResult] = await db.query(countQuery, params);

  const total = countResult[0].total;

  const limit = Math.min(parseInt(filters.limit) || 10, 100);
  const page = parseInt(filters.page) || 1;
  const offset = (page - 1) * limit;

  // =========================
  // MAIN QUERY
  // =========================

  const dataQuery = `
    SELECT
      MAX(v.id) AS id,
      v.user_id,
      MAX(u.name) AS employee_name,
      MAX(v.visit_type) AS visit_type,
      MAX(v.customer_type) AS customer_type,
      MAX(v.visit_purpose) AS visit_purpose,
      MAX(v.comment) AS comment,
      MAX(v.reminder_date) AS reminder_date,
      MAX(v.image_path) AS image_path,
      MAX(v.created_at) AS created_at,
      v.customer_id,
      MAX(c.name) AS customer_name,
      MAX(c.firm_name) AS firm_name,
      MAX(c.contact_number) AS contact_number,
      MAX(c.address) AS address,
      MAX(c.area) AS area,
      MAX(c.district) AS district,
      MAX(c.pincode) AS pincode,
      COUNT(v.id) AS number_of_visits

    ${baseQuery}

    GROUP BY
      v.user_id,
      v.customer_id,
      v.visit_purpose

    ORDER BY MAX(v.id) DESC

    LIMIT ? OFFSET ? `;

  const [rows] = await db.query( dataQuery, [...params, limit, offset] );

  return { total, page, limit, totalPages: Math.ceil(total / limit), data: rows, };
};

exports.getHierarchyVisitSummary = async ( filters) => {

  let query = `
    SELECT u.id, u.name,  u.contact_no, jr.name AS role_name,
      COUNT(v.id) AS total_visits

    FROM users u
    JOIN job_roles jr ON jr.id = u.job_role_id
    LEFT JOIN visits v ON v.user_id = u.id

    WHERE u.id IN ( ${filters.user_ids.map(() => "?").join(",")} ) `;

  const params = [...filters.user_ids];

  if (filters.date) {
    query += ` AND DATE(v.created_at) = ? `;
    params.push(filters.date);
  }

  if (filters.level) {
    query += ` AND jr.level = ? `;
    params.push(filters.level);
  }

  if (filters.user_id) {
    query += ` AND u.id = ? `;
    params.push(filters.user_id);
  }

  query += ` GROUP BY
      u.id,
      u.name,
       u.contact_no,
      jr.name

    ORDER BY
      jr.level,
      u.name `;

  const [rows] = await db.query(query, params);
  return rows;
};

exports.getUserVisitDetails = async (userId, date) => {

  let query = `
    SELECT
      v.id, v.created_at, v.visit_type, v.customer_type, v.visit_purpose, v.comment, v.reminder_date, v.image_path,
      u.id AS user_id, u.name AS employee_name, u.contact_no,
      c.id AS customer_id, c.name AS customer_name, c.firm_name, c.contact_number, c.address, c.area, c.district, c.pincode
    FROM visits v
    LEFT JOIN users u ON u.id = v.user_id
    LEFT JOIN customers c ON c.id = v.customer_id
    WHERE v.user_id = ?
  `;

  const params = [userId];

  if (date) {
    query += ` AND DATE(v.created_at) = ?`;
    params.push(date);
  }

  query += ` ORDER BY v.created_at DESC`;

  const [rows] = await db.query(query, params);

  return rows;
};

// exports.getUserVisitDetails = async (userId) => {
//   const [rows] = await db.query(
//     ` SELECT
//       v.id, v.created_at, v.visit_type, v.customer_type, v.visit_purpose, v.comment, v.reminder_date, v.image_path,
//       u.id AS user_id, u.name AS employee_name, u.contact_no,
//       c.id AS customer_id, c.name AS customer_name, c.firm_name, c.contact_number, c.address, c.area, c.district, c.pincode

//     FROM visits v

//     LEFT JOIN users u ON u.id = v.user_id
//     LEFT JOIN customers c ON c.id = v.customer_id
//     WHERE v.user_id = ?

//     ORDER BY v.created_at DESC
//     `,
//     [userId]
//   );

//   return rows;
// };