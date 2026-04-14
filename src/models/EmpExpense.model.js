const db = require("../config/db");

exports.createAllocation = async ({ user_id, hotel_amount, bus_train_toll_amount, petrol_diesel_amount, other_amount}) => {
  const [result] = await db.execute(
    `INSERT INTO employee_expense_allocations
    (user_id, hotel_amount, bus_train_toll_amount, petrol_diesel_amount, other_amount)
    VALUES (?, ?, ?, ?, ?)`,
    [
      user_id,
      hotel_amount || 0,
      bus_train_toll_amount || 0,
      petrol_diesel_amount || 0,
      other_amount || 0
    ]
  );

  return result;
};

exports.updateAllocation = async ({
  user_id,
  hotel_amount,
  bus_train_toll_amount,
  petrol_diesel_amount,
  other_amount
}) => {
  const [result] = await db.execute(
    `UPDATE employee_expense_allocations
     SET 
        hotel_amount = ?,
        bus_train_toll_amount = ?,
        petrol_diesel_amount = ?,
        other_amount = ?
     WHERE user_id = ?`,
    [
      hotel_amount || 0,
      bus_train_toll_amount || 0,
      petrol_diesel_amount || 0,
      other_amount || 0,
      user_id
    ]
  );

  return result;
};

exports.getAllocation = async (userId) => {

  const [rows] = await db.execute(
    `SELECT * FROM employee_expense_allocations WHERE user_id = ?`,
    [userId]
  );

  return rows[0];
};


exports.getTotalUploaded = async (allocationId, expenseType) => {

  const [rows] = await db.execute(
    `SELECT COALESCE(SUM(amount),0) as total
     FROM employee_expense_entries
     WHERE allocation_id=? AND expense_type=?`,
    [allocationId, expenseType]
  );

  return rows[0].total;
};


exports.insertExpense = async (data) => {

  const sql = `
    INSERT INTO employee_expense_entries
    (
      allocation_id,
      user_id,
      expense_type,
      expense_date,
      amount,
      bill_object_path,
      bill_url,
      remarks
    )
    VALUES (?,?,?,?,?,?,?,?)
  `;

  const [result] = await db.execute(sql, [
    data.allocation_id,
    data.user_id,
    data.expense_type,
    data.expense_date,
    data.amount,
    data.bill_object_path,
    data.bill_url,
    data.remarks
  ]);

  return result;
};

exports.getAllocationByUserId = async (userId) => {
  const [rows] = await db.execute(
    `SELECT * 
     FROM employee_expense_allocations
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [userId]
  );

  return rows[0];
};

exports.getUsedAmountByType = async (userId, expenseType) => {
  const [rows] = await db.execute(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM employee_expense_entries
     WHERE user_id = ? AND expense_type = ?`,
    [userId, expenseType]
  );

  return rows[0].total;
};

exports.createExpenseEntry = async ({ allocation_id, user_id, expense_type, expense_date, amount, bill_object_path, bill_url, remarks
}) => {
  const [result] = await db.execute(
    `INSERT INTO employee_expense_entries
    (
      allocation_id,
      user_id,
      expense_type,
      expense_date,
      amount,
      bill_object_path,
      bill_url,
      remarks
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [ allocation_id, user_id, expense_type, expense_date, amount, bill_object_path, bill_url, remarks]
  );

  return {
    id: result.insertId,
    allocation_id,
    user_id,
    expense_type,
    expense_date,
    amount,
    bill_object_path,
    bill_url,
    remarks
  };
};

exports.getUserExpenseEntries = async (userId) => {
  const [rows] = await db.execute(
    `SELECT 
        id,
        allocation_id,
        user_id,
        expense_type,
        expense_date,
        amount,
        bill_object_path,
        bill_url,
        remarks,
        status,
        created_at,
        updated_at
     FROM employee_expense_entries
     WHERE user_id = ?
     ORDER BY expense_date DESC, id DESC`,
    [userId]
  );

  return rows;
};

exports.getUserExpenseEntriesByType = async (userId, expenseType) => {
  const [rows] = await db.execute(
    `SELECT 
        id,
        allocation_id,
        user_id,
        expense_type,
        expense_date,
        amount,
        bill_object_path,
        bill_url,
        remarks,
        status,
        created_at,
        updated_at
     FROM employee_expense_entries
     WHERE user_id = ? AND expense_type = ?
     ORDER BY expense_date DESC, id DESC`,
    [userId, expenseType]
  );

  return rows;
};

exports.getAdminExpenseSummary = async ({
  search,
  expense_type,
  start_date,
  end_date,
  limit,
  offset
}) => {

  let whereConditions = [];
  let values = [];

  if (search && search.trim() !== "") {
  whereConditions.push("u.name LIKE ?");
  values.push(`%${search}%`);
}

if (expense_type && expense_type.trim() !== "") {
  whereConditions.push("e.expense_type = ?");
  values.push(expense_type.toUpperCase());
}

if (start_date && end_date && start_date !== "" && end_date !== "") {
  whereConditions.push("e.expense_date BETWEEN ? AND ?");
  values.push(new Date(start_date), new Date(end_date));
}

  const whereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  const sql = `
    SELECT 
      u.id AS user_id,
      u.name AS employee_name,

      a.hotel_amount,
      a.bus_train_toll_amount,
      a.petrol_diesel_amount,
      a.other_amount,

      --  Usage aggregation
      SUM(CASE WHEN e.expense_type = 'HOTEL' THEN e.amount ELSE 0 END) AS hotel_used,
      SUM(CASE WHEN e.expense_type = 'BUS_TRAIN_TOLL' THEN e.amount ELSE 0 END) AS bus_used,
      SUM(CASE WHEN e.expense_type = 'PETROL_DIESEL' THEN e.amount ELSE 0 END) AS petrol_used,
      SUM(CASE WHEN e.expense_type = 'OTHER' THEN e.amount ELSE 0 END) AS other_used,

 GROUP_CONCAT(e.bill_url) AS bill_urls

    FROM employee_expense_allocations a
    JOIN users u ON u.id = a.user_id
  

    LEFT JOIN employee_expense_entries e 
ON e.allocation_id = a.id
AND (${expense_type ? "e.expense_type = ?" : "1=1"})
  

    ${whereClause}

    GROUP BY u.id

    ORDER BY u.name ASC
    LIMIT ? OFFSET ?
  `;

  limit = Number(limit) || 10;
offset = Number(offset) || 0;

values.push(limit, offset);

  const [rows] = await db.execute(sql, values);

  //  COUNT QUERY
  const countSql = `
    SELECT COUNT(*) as total
    FROM employee_expense_allocations a
    JOIN users u ON u.id = a.user_id
    ${search ? "WHERE u.name LIKE ?" : ""}
  `;

  const countValues = search ? [`%${search}%`] : [];

  const [countResult] = await db.execute(countSql, countValues);

  return {
    rows,
    total: countResult[0].total
  };
}

exports.getExpenseEntriesForAdmin = async (userId, filters = {}) => {
  let where = ["e.user_id = ?"];
  let values = [userId];

  if (filters.expense_type) {
    where.push("e.expense_type = ?");
    values.push(filters.expense_type);
  }

  if (filters.start_date && filters.end_date) {
    where.push("e.expense_date BETWEEN ? AND ?");
    values.push(filters.start_date, filters.end_date);
  }

  

  const sql = `
    SELECT 
      e.id,
      e.expense_type,
      e.expense_date,
      e.amount,
      e.bill_object_path,
      e.remarks,
      e.status
    FROM employee_expense_entries e
    WHERE ${where.join(" AND ")}
    ORDER BY e.expense_date DESC
  `;

  const [rows] = await db.execute(sql, values);
  return rows;
};

