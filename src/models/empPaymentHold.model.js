const db = require("../config/db");
const SalaryDaily = require("./empDailySalary.model");

const TYPE_TO_SALARY_FIELD = {
  SALARY: "basic_salary",
  TA: "travelling_allowance",
  DA: "daily_allowance",
  HOTEL: "hotel_expense",
  OTHER: "other_expense",
  BUS_TRAIN_TOLL: "bus_train_toll_expense",
};

// These three types have a real row in employee_expense_entries.
// SALARY/TA/DA only ever exist in emp_salary_daily.
const EXPENSE_TYPES = ["HOTEL", "OTHER", "BUS_TRAIN_TOLL"];

exports.TYPES = Object.keys(TYPE_TO_SALARY_FIELD);
exports.TYPE_TO_SALARY_FIELD = TYPE_TO_SALARY_FIELD;
exports.EXPENSE_TYPES = EXPENSE_TYPES;
exports.isExpenseType = (type) => EXPENSE_TYPES.includes(type);

exports.getSalaryDailyRow = async (employeeId, date, connection = db) => {
  const [[row]] = await connection.query(
    `SELECT * FROM emp_salary_daily WHERE employee_id = ? AND salary_date = ?`,
    [employeeId, date]
  );
  return row;
};

// Auto-creates a zero-value emp_salary_daily row if generateDailySalaryInternal
// never ran for this employee/date (new hire, attendance never marked
// that day, cron didn't reach them, etc.). Lets an admin still record a
// manual hold/edit for that day instead of being hard-blocked.
// NOTE: assumes attendance_type is nullable / not an ENUM restricted to
// specific attendance values. Confirm with `SHOW CREATE TABLE
// emp_salary_daily` — if attendance_type is NOT NULL or ENUM-constrained,
// swap the `null` below for whatever value that column actually allows.
exports.ensureSalaryDailyRow = async (employeeId, date, connection = db) => {
  const existing = await exports.getSalaryDailyRow(employeeId, date, connection);
  if (existing) return existing;

  await SalaryDaily.saveDailySalary([
    employeeId,
    date,
    null,          // attendance_type — no attendance data for this day
    "0 hr 0 min",  // working_hours
    "0.00",        // per_day_salary
    "0.00",        // basic_salary
    "0.00",        // travelling_allowance
    "0.00",        // daily_allowance
    "0.00",        // hotel_expense
    "0.00",        // other_expense
    "0.00",        // bus_train_toll_expense
    "0.00",        // total_reading
    "0.00",        // gross_salary
    "0.00",        // net_salary
  ]);

  return exports.getSalaryDailyRow(employeeId, date, connection);
};

exports.isMonthLocked = async (employeeId, date, connection = db) => {
  const year = new Date(date).getFullYear();
  const month = new Date(date).getMonth() + 1;

  const [[row]] = await connection.query(
    `SELECT salary_locked FROM emp_salary WHERE employee_id = ? AND month = ? AND year = ?`,
    [employeeId, month, year]
  );

  return !!(row && row.salary_locked === 1);
};

exports.getHoldRow = async (employeeId, date, type, connection = db) => {
  const [[row]] = await connection.query(
    `SELECT * FROM emp_payment_hold WHERE employee_id = ? AND salary_date = ? AND type = ?`,
    [employeeId, date, type]
  );
  return row;
};

exports.getHoldRows = async (employeeId, date, connection = db) => {
  const [rows] = await connection.query(
    `SELECT * FROM emp_payment_hold WHERE employee_id = ? AND salary_date = ?`,
    [employeeId, date]
  );
  return rows;
};

// The actual bill entry backing a HOTEL/OTHER/BUS_TRAIN_TOLL cell.
exports.getExpenseEntry = async (employeeId, date, expenseType, connection = db) => {
  const [[row]] = await connection.query(
    `SELECT * FROM employee_expense_entries
     WHERE user_id = ? AND expense_type = ? AND DATE(expense_date) = ?`,
    [employeeId, expenseType, date]
  );
  return row;
};

// Recalculates gross_salary/net_salary from whatever is currently in
// emp_salary_daily and writes them back. Call after any field write.
exports.recalculateTotals = async (connection, employeeId, date) => {
  const [[row]] = await connection.query(
    `SELECT basic_salary, travelling_allowance, daily_allowance,
            hotel_expense, other_expense, bus_train_toll_expense
     FROM emp_salary_daily WHERE employee_id = ? AND salary_date = ?`,
    [employeeId, date]
  );

  const grossSalary =
    Number(row.basic_salary) +
    Number(row.travelling_allowance) +
    Number(row.daily_allowance) +
    Number(row.hotel_expense) +
    Number(row.other_expense) +
    Number(row.bus_train_toll_expense);

  const netSalary = grossSalary; // matches generateDailySalaryInternal's current formula

  await connection.query(
    `UPDATE emp_salary_daily SET gross_salary = ?, net_salary = ? WHERE employee_id = ? AND salary_date = ?`,
    [grossSalary.toFixed(2), netSalary.toFixed(2), employeeId, date]
  );

  return { grossSalary, netSalary };
};

// Writes one field in emp_salary_daily, then recalculates totals.
exports.writeSalaryField = async (connection, employeeId, date, field, value) => {
  await connection.query(
    `UPDATE emp_salary_daily SET ${field} = ? WHERE employee_id = ? AND salary_date = ?`,
    [value, employeeId, date]
  );
  return exports.recalculateTotals(connection, employeeId, date);
};

// Writes the real amount on the expense entry (for edits), keeping
// hold_status/hold_reason untouched.
exports.writeExpenseEntryAmount = async (connection, employeeId, date, expenseType, amount) => {
  await connection.query(
    `UPDATE employee_expense_entries
     SET amount = ?
     WHERE user_id = ? AND expense_type = ? AND DATE(expense_date) = ?`,
    [amount, employeeId, expenseType, date]
  );
};

// Marks the expense entry held/unheld, without touching its amount.
exports.setExpenseEntryHold = async (connection, employeeId, date, expenseType, status, reason) => {
  await connection.query(
    `UPDATE employee_expense_entries
     SET hold_status = ?, hold_reason = ?
     WHERE user_id = ? AND expense_type = ? AND DATE(expense_date) = ?`,
    [status, reason, employeeId, expenseType, date]
  );
};

// Creates a brand-new expense entry when no bill was ever uploaded for
// this employee/type/date (e.g. "forgot to upload"). No bill file —
// this is an administrative entry, always recorded as APPROVED so it
// counts toward payout like a normal approved bill would.
// NOTE: relies on a unique key on (user_id, expense_type, expense_date)
// in employee_expense_entries — the same one your uploadMyExpense
// ER_DUP_ENTRY handling already assumes exists. Confirm it's actually
// there; if not, add it before using this.
exports.createAdminExpenseEntry = async (connection, {
  allocationId,
  employeeId,
  date,
  expenseType,
  amount,
  remarks,
}) => {
  await connection.query(
    `
    INSERT INTO employee_expense_entries
      (allocation_id, user_id, expense_type, expense_date, amount, status, hold_status, remarks)
    VALUES (?, ?, ?, ?, ?, 'APPROVED', 'UNHOLD', ?)
    ON DUPLICATE KEY UPDATE
      amount = VALUES(amount),
      status = VALUES(status),
      remarks = VALUES(remarks)
    `,
    [allocationId, employeeId, expenseType, date, amount, remarks]
  );
};

exports.upsertAmountEditLog = async (connection, { employeeId, date, type, reason, updatedBy }) => {
  await connection.query(
    `
    INSERT INTO emp_payment_hold
      (employee_id, salary_date, type, reason_amount_update, updated_by)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      reason_amount_update = VALUES(reason_amount_update),
      updated_by = VALUES(updated_by)
    `,
    [employeeId, date, type, reason, updatedBy]
  );
};

exports.upsertHoldStatus = async (connection, {
  employeeId,
  date,
  type,
  status,
  amountBeforeHold,
  reason,
  updatedBy,
}) => {
  await connection.query(
    `
    INSERT INTO emp_payment_hold
      (employee_id, salary_date, type, status, amount_before_hold, reason_hold, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      status = VALUES(status),
      amount_before_hold = VALUES(amount_before_hold),
      reason_hold = VALUES(reason_hold),
      updated_by = VALUES(updated_by)
    `,
    [employeeId, date, type, status, amountBeforeHold, reason, updatedBy]
  );
};