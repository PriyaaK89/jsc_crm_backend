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

exports.getAllExpenseAllocationsForAdmin = async ({
  page,
  limit,
  user_id,
  search
}) => {
  let whereConditions = [];
  let values = [];

  const limitNum = Number(limit) || 10;
  const pageNum = Number(page) || 1;
  const offsetNum = (pageNum - 1) * limitNum;

  // search by employee name/email
  if (search && search.trim() !== "") {
    whereConditions.push("(emp.name LIKE ? OR emp.email LIKE ?)");
    values.push(`%${search}%`, `%${search}%`);
  }

  // filter by specific employee
  if (user_id) {
    whereConditions.push("a.user_id = ?");
    values.push(user_id);
  }

  const whereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  const [rows] = await db.execute(
    `
    SELECT
      a.id,
      a.user_id,
      emp.name AS employee_name,
      emp.email AS employee_email,
      a.hotel_amount,
      a.bus_train_toll_amount,
      a.petrol_diesel_amount,
      a.other_amount,
      a.created_by,
      admin.name AS allocated_by_name,
      admin.email AS allocated_by_email,
      a.created_at,
      a.updated_at
    FROM employee_expense_allocations a
    LEFT JOIN users emp ON emp.id = a.user_id
    LEFT JOIN users admin ON admin.id = a.created_by
    ${whereClause}
    ORDER BY a.id DESC
    LIMIT ? OFFSET ?
    `,
    [...values, limitNum, offsetNum]
  );

  const [countResult] = await db.execute(
    `
    SELECT COUNT(*) AS total
    FROM employee_expense_allocations a
    LEFT JOIN users emp ON emp.id = a.user_id
    LEFT JOIN users admin ON admin.id = a.created_by
    ${whereClause}
    `,
    values
  );

  return {
    data: rows,
    total: countResult[0].total
  };
};