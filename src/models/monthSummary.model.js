const db = require("../config/db");

exports.getMonthSummary = async (userId, startDate, endDate) => {
  // startDate = first day of month, endDate = first day of NEXT month (exclusive).
  // Using >= and < works for both DATE and DATETIME columns.
  const [rows] = await db.execute(
    `SELECT
      (SELECT COALESCE(SUM(amount), 0)
         FROM employee_expense_entries
        WHERE user_id = ?
          AND expense_date >= ? AND expense_date < ?) AS expenses_total,

      (SELECT COUNT(*)
         FROM sales
        WHERE created_by = ?
          AND sales_date >= ? AND sales_date < ?) AS sales_count,

      (SELECT COUNT(*)
         FROM receipts
        WHERE created_by = ?
          AND receipt_date >= ? AND receipt_date < ?) AS receipts_count`,
    [
      userId, startDate, endDate,
      userId, startDate, endDate,
      userId, startDate, endDate,
    ]
  );

  return rows[0];
};