const db = require('../config/db')

const createEmployeeTarget = async ({
  user_id,
  role,
  target_type,
  duration_type,
  start_date,
  end_date,
  target_amount,
  created_by
}) => {

  const [result] = await db.query(
    `
    INSERT INTO employee_targets
    (
      user_id,
      role,
      target_type,
      duration_type,
      start_date,
      end_date,
      target_amount,
      achieved_amount,
      pending_amount,
      created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      user_id,
      role,
      target_type,
      duration_type,
      start_date,
      end_date,
      target_amount,
      0,
      target_amount,
      created_by
    ]
  );

  return result.insertId;
};
const insertTargetCategories = async (
  connection,
  employee_target_id,
  categories
) => {

  const values = categories.map((category_id) => [
    employee_target_id,
    category_id
  ]);

  await connection.query(
    `INSERT INTO employee_target_categories
    (employee_target_id, category_id)
    VALUES ?`,
    [values]
  );
};


const getEmployeeTargets = async ({
  page = 1,
  limit = 10,
  search = "",
  role = "",
  target_type = "",
  duration_type = ""
}) => {

  const offset = (page - 1) * limit;

  let whereClause = `WHERE 1=1`;
  let queryParams = [];

  // ================= SEARCH =================
  if (search) {

    whereClause += `
      AND (
        et.role LIKE ?
        OR et.target_type LIKE ?
        OR et.duration_type LIKE ?
      )
    `;

    queryParams.push(
      `%${search}%`,
      `%${search}%`,
      `%${search}%`
    );
  }

  // ================= ROLE FILTER =================
  if (role) {
    whereClause += ` AND et.role = ?`;
    queryParams.push(role);
  }

  // ================= TARGET TYPE FILTER =================
  if (target_type) {
    whereClause += ` AND et.target_type = ?`;
    queryParams.push(target_type);
  }

  // ================= DURATION FILTER =================
  if (duration_type) {
    whereClause += ` AND et.duration_type = ?`;
    queryParams.push(duration_type);
  }


  // ================= TOTAL COUNT =================
  const [countResult] = await db.query(
    `
    SELECT COUNT(DISTINCT et.id) AS total

    FROM employee_targets et

    LEFT JOIN employee_target_categories etc
    ON et.id = etc.employee_target_id

    ${whereClause}
    `,
    queryParams
  );

  const total = countResult[0].total;


  // ================= MAIN DATA =================
const [rows] = await db.query(
  `
  SELECT
    et.id,
    et.user_id,

    u.name AS user_name,

    et.role,
    et.target_type,
    et.duration_type,
    et.start_date,
    et.end_date,
    et.target_amount,
    et.achieved_amount,
    et.pending_amount,
    et.created_at,

    GROUP_CONCAT(etc.category_id) AS category_ids

  FROM employee_targets et

  LEFT JOIN users u
  ON et.user_id = u.id

  LEFT JOIN employee_target_categories etc
  ON et.id = etc.employee_target_id

  ${whereClause}

  GROUP BY et.id

  ORDER BY et.id DESC

  LIMIT ?
  OFFSET ?
  `,
  [
    ...queryParams,
    Number(limit),
    Number(offset)
  ]
);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    data: rows
  };
};

// ================= GET SINGLE =================
const getEmployeeTargetById = async (id) => {

 const [rows] = await db.query(
  `
  SELECT
    et.id,
    et.user_id,

    u.name AS user_name,

    et.role,
    et.target_type,
    et.duration_type,
    et.start_date,
    et.end_date,
    et.target_amount,
    et.achieved_amount,
    et.pending_amount,
    et.created_at,

    GROUP_CONCAT(etc.category_id) AS category_ids

  FROM employee_targets et

  LEFT JOIN users u
  ON et.user_id = u.id

  LEFT JOIN employee_target_categories etc
  ON et.id = etc.employee_target_id

  WHERE et.id = ?

  GROUP BY et.id
  `,
  [id]
);

  return rows[0];
};


// ================= UPDATE =================
const updateEmployeeTarget = async ( connection, id, data ) => {

  const {
    user_id,
    role,
    target_type,
    duration_type,
    start_date,
    end_date,
    target_amount
  } = data;

  await connection.query(
    `
    UPDATE employee_targets
    SET
      user_id = ?,
      role = ?,
      target_type = ?,
      duration_type = ?,
      start_date = ?,
      end_date = ?,
      target_amount = ?,
      pending_amount = ?
    WHERE id = ?
    `,
    [
      user_id,
      role,
      target_type,
      duration_type,
      start_date,
      end_date,
      target_amount,
      target_amount,
      id
    ]
  );
};


// ================= DELETE OLD CATEGORIES =================
const deleteTargetCategories = async ( connection, employee_target_id ) => {

  await connection.query( ` DELETE FROM employee_target_categories WHERE employee_target_id = ? `, [employee_target_id] );
};


// ================= DELETE TARGET =================
const deleteEmployeeTarget = async ( connection, id) => {
  await connection.query( ` DELETE FROM employee_targets WHERE id = ? `, [id] );
};


module.exports = {
  createEmployeeTarget,
  insertTargetCategories,
  getEmployeeTargets,
  getEmployeeTargetById,
  updateEmployeeTarget,
  deleteTargetCategories,
  deleteEmployeeTarget
};