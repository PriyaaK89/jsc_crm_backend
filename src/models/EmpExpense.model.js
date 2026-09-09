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

// NEW: same as getTotalUploaded, but scoped to a single calendar day —
// this is what actually makes the allocation a PER-DAY cap instead of
// a lifetime one. Left getTotalUploaded in place untouched in case
// anything else still depends on the lifetime total.
exports.getTotalUploadedForDate = async (allocationId, expenseType, date) => {

  const [rows] = await db.execute(
    `SELECT COALESCE(SUM(amount),0) as total
     FROM employee_expense_entries
     WHERE allocation_id=? AND expense_type=? AND DATE(expense_date)=?`,
    [allocationId, expenseType, date]
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

// NEW: same as getUsedAmountByType, but scoped to a single calendar
// day. This is the function the daily-reset allocation logic should
// use for its "already used" checks.
exports.getUsedAmountByTypeForDate = async (userId, expenseType, date) => {
  const [rows] = await db.execute(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM employee_expense_entries
     WHERE user_id = ? AND expense_type = ? AND DATE(expense_date) = ?`,
    [userId, expenseType, date]
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


// NEW: all of one employee's expense entries for a single calendar
// day — used by the admin "check by employee + date" lookup.
exports.getUserExpenseEntriesForDate = async (userId, date) => {
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
        hold_status,
        hold_reason,
        created_at
     FROM employee_expense_entries
     WHERE user_id = ? AND DATE(expense_date) = ?
     ORDER BY expense_type ASC`,
    [userId, date]
  );

  return rows;
};

const formatDate = (date) => {
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;

  return d.toISOString().slice(0, 19).replace("T", " ");
};

// Paginated + searchable employee list with their allocation (NO usage here)
exports.getAdminAllocationsPaginated = async ({ search, limit, offset }) => {
  const where = [];
  const values = [];

  if (search && search.trim()) {
    where.push("u.name LIKE ?");
    values.push(`%${search.trim()}%`);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countSql = `
    SELECT COUNT(*) AS total
    FROM employee_expense_allocations a
    JOIN users u ON u.id = a.user_id
    ${whereClause}
  `;
  const [countRows] = await db.execute(countSql, values);
  const total = countRows[0]?.total || 0;

  const finalLimit = parseInt(limit, 10) || 10;
  const finalOffset = parseInt(offset, 10) || 0;

  const dataSql = `
    SELECT
      u.id AS user_id,
      u.name AS employee_name,
      a.id AS allocation_id,
      a.hotel_amount,
      a.bus_train_toll_amount,
      a.petrol_diesel_amount,
      a.other_amount
    FROM employee_expense_allocations a
    JOIN users u ON u.id = a.user_id
    ${whereClause}
    ORDER BY u.name ASC
    LIMIT ${finalLimit} OFFSET ${finalOffset}
  `;
  const [rows] = await db.execute(dataSql, values);

  return { rows, total };
};

// Aggregated usage for a batch of user_ids, scoped to a date range (per-day cap logic)
exports.getUsageForUsersInRange = async (userIds, startDate, endDate) => {
  if (!userIds.length) return [];

  const placeholders = userIds.map(() => "?").join(",");

  const sql = `
    SELECT
      user_id,
      expense_type,
      COALESCE(SUM(amount), 0) AS total
    FROM employee_expense_entries
    WHERE user_id IN (${placeholders})
      AND DATE(expense_date) BETWEEN ? AND ?
    GROUP BY user_id, expense_type
  `;

  const [rows] = await db.execute(sql, [...userIds, startDate, endDate]);
  return rows;
};

// Raw entries for a batch of user_ids, scoped to a date range (for the "entries" list per user)
exports.getEntriesForUsersInRange = async (userIds, startDate, endDate) => {
  if (!userIds.length) return [];

  const placeholders = userIds.map(() => "?").join(",");

  const sql = `
    SELECT
      id,
      user_id,
      expense_type,
      expense_date,
      amount,
      bill_object_path,
      remarks,
      status,
      hold_status,
      hold_reason
    FROM employee_expense_entries
    WHERE user_id IN (${placeholders})
      AND DATE(expense_date) BETWEEN ? AND ?
    ORDER BY expense_date DESC, id DESC
  `;

  const [rows] = await db.execute(sql, [...userIds, startDate, endDate]);
  return rows;
};

exports.getAdminExpenseSummary = async ({
  search,
  expense_type,
  start_date,
  end_date,
  limit,
  offset,
}) => {
  try {
    let whereConditions = [];
    let values = [];

    //  SEARCH
    if (search && search.trim()) {
      whereConditions.push("u.name LIKE ?");
      values.push(`%${search.trim()}%`);
    }

    //  EXPENSE TYPE
    const validTypes = ["HOTEL", "BUS_TRAIN_TOLL", "PETROL_DIESEL", "OTHER"];
    if (expense_type && validTypes.includes(expense_type.toUpperCase())) {
      whereConditions.push("e.expense_type = ?");
      values.push(expense_type.toUpperCase());
    }

    //  DATE FILTER (STRICT)
    if (start_date && end_date) {
      const start = new Date(start_date);
      const end = new Date(end_date);

      if (isNaN(start) || isNaN(end)) {
        throw new Error("Invalid date format");
      }

      whereConditions.push("e.expense_date BETWEEN ? AND ?");
      values.push(
        start.toISOString().slice(0, 19).replace("T", " "),
        end.toISOString().slice(0, 19).replace("T", " ")
      );
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    //  LIMIT OFFSET (VERY IMPORTANT FIX)
    const finalLimit = parseInt(limit, 10);
    const finalOffset = parseInt(offset, 10);

    const sql = `
      SELECT 
        u.id AS user_id,
        u.name AS employee_name,

        a.hotel_amount,
        a.bus_train_toll_amount,
        a.petrol_diesel_amount,
        a.other_amount,

        COALESCE(SUM(CASE WHEN e.expense_type = 'HOTEL' THEN e.amount ELSE 0 END),0) AS hotel_used,
        COALESCE(SUM(CASE WHEN e.expense_type = 'BUS_TRAIN_TOLL' THEN e.amount ELSE 0 END),0) AS bus_used,
        COALESCE(SUM(CASE WHEN e.expense_type = 'PETROL_DIESEL' THEN e.amount ELSE 0 END),0) AS petrol_used,
        COALESCE(SUM(CASE WHEN e.expense_type = 'OTHER' THEN e.amount ELSE 0 END),0) AS other_used,

        GROUP_CONCAT(e.bill_url) AS bill_urls

      FROM employee_expense_allocations a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN employee_expense_entries e 
        ON e.allocation_id = a.id

      ${whereClause}

 GROUP BY 
  u.id,
  u.name,
  a.hotel_amount,
  a.bus_train_toll_amount,
  a.petrol_diesel_amount,
  a.other_amount

ORDER BY u.name ASC
LIMIT ${finalLimit} OFFSET ${finalOffset}
    `;

    const placeholders = (sql.match(/\?/g) || []).length;

    console.log("SQL:", sql);
    console.log("VALUES:", values);
    console.log("Placeholders:", placeholders);
    console.log("Values Count:", values.length);

    if (placeholders !== values.length) {
      throw new Error(" Placeholder mismatch");
    }

    const [rows] = await db.execute(sql, values);

    const countSql = `
      SELECT COUNT(DISTINCT u.id) as total
      FROM employee_expense_allocations a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN employee_expense_entries e 
        ON e.allocation_id = a.id
      ${whereClause}
    `;

    const countValues = [...values];

    const [countResult] = await db.execute(countSql, countValues);

    return {
      rows,
      total: countResult[0]?.total || 0,
    };
  } catch (error) {
    console.error(" ERROR in getAdminExpenseSummary:", error);
    throw error;
  }
};
// NEW: sum of used amount for a type, across a date range (not just one day)
exports.getUsedAmountByTypeForRange = async (userId, expenseType, startDate, endDate) => {
  const [rows] = await db.execute(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM employee_expense_entries
     WHERE user_id = ? AND expense_type = ? AND DATE(expense_date) BETWEEN ? AND ?`,
    [userId, expenseType, startDate, endDate]
  );

  return rows[0].total;
};

// NEW: paginated + searchable + type-filterable entries for ONE employee, across a date range
exports.getUserExpenseEntriesFiltered = async (userId, {
  expense_type,
  start_date,
  end_date,
  search,
  limit,
  offset
}) => {
  const where = ["e.user_id = ?"];
  const values = [userId];

  if (expense_type) {
    where.push("e.expense_type = ?");
    values.push(expense_type);
  }

  if (start_date && end_date) {
    where.push("DATE(e.expense_date) BETWEEN ? AND ?");
    values.push(start_date, end_date);
  }

  if (search && search.trim()) {
    where.push("(e.remarks LIKE ? OR e.expense_type LIKE ?)");
    values.push(`%${search.trim()}%`, `%${search.trim()}%`);
  }

  const whereClause = where.join(" AND ");

  // total count for pagination (before LIMIT)
  const countSql = `
    SELECT COUNT(*) AS total
    FROM employee_expense_entries e
    WHERE ${whereClause}
  `;
  const [countRows] = await db.execute(countSql, values);
  const total = countRows[0]?.total || 0;

  // same LIMIT/OFFSET-as-literal pattern you already use in getAdminExpenseSummary,
  // since db.execute + placeholders for LIMIT/OFFSET is unreliable on your mysql2 version
  const finalLimit = parseInt(limit, 10) || 10;
  const finalOffset = parseInt(offset, 10) || 0;

  const dataSql = `
    SELECT 
      e.id,
      e.allocation_id,
      e.expense_type,
      e.expense_date,
      e.amount,
      e.bill_object_path,
      e.bill_url,
      e.remarks,
      e.status,
      e.hold_status,
      e.hold_reason,
      e.created_at
    FROM employee_expense_entries e
    WHERE ${whereClause}
    ORDER BY e.expense_date DESC, e.id DESC
    LIMIT ${finalLimit} OFFSET ${finalOffset}
  `;

  const [rows] = await db.execute(dataSql, values);

  return { rows, total, limit: finalLimit, offset: finalOffset };
};

exports.getExpenseEntriesForAdmin = async (userId, filters = {}) => {
  let where = ["e.user_id = ?"];
  let values = [userId];

  if (filters.expense_type) {
    where.push("e.expense_type = ?");
    values.push(filters.expense_type.toUpperCase());
  }

  if (filters.start_date && filters.end_date) {
    const start = formatDate(filters.start_date);
    const end = formatDate(filters.end_date);

    if (start && end) {
      where.push("e.expense_date BETWEEN ? AND ?");
      values.push(start, end);
    }
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

  console.log("DETAIL SQL:", sql);
  console.log("DETAIL VALUES:", values);

  const [rows] = await db.execute(sql, values);
  return rows;
};