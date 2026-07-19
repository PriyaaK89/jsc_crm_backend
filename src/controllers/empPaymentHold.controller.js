const db = require("../config/db");
const holdModel = require("../models/empPaymentHold.model");
const expenseModel = require("../models/EmpExpense.model");

const { TYPES, TYPE_TO_SALARY_FIELD, isExpenseType } = holdModel;

const LABELS = {
  SALARY: "Salary",
  TA: "TA",
  DA: "DA",
  HOTEL: "Hotel Expense",
  OTHER: "Other Expense",
  BUS_TRAIN_TOLL: "Bus/Train/Toll Expense",
};

// employee_expense_entries.expense_type values that correspond to our
// three expense rows (they already match 1:1 — HOTEL, OTHER, BUS_TRAIN_TOLL).
const getAllocatedAmount = (allocation, type) => {
  if (type === "HOTEL") return Number(allocation.hotel_amount) || 0;
  if (type === "BUS_TRAIN_TOLL") return Number(allocation.bus_train_toll_amount) || 0;
  if (type === "OTHER") return Number(allocation.other_amount) || 0;
  return 0;
};

/**
 * GET /payment-hold/search?employee_id=&date=YYYY-MM-DD
 */
exports.searchPaymentHold = async (req, res) => {
  try {
    const { employee_id, date } = req.query;

    if (!employee_id || !date) {
      return res.status(400).json({ message: "employee_id and date are required" });
    }

    const [[employee]] = await db.query(`SELECT id, name FROM users WHERE id = ?`, [employee_id]);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const salaryRow = await holdModel.getSalaryDailyRow(employee_id, date);
    if (!salaryRow) {
      return res.status(404).json({
        message: "No salary record generated for this employee on this date",
      });
    }

    const holdRows = await holdModel.getHoldRows(employee_id, date);
    const holdByType = {};
    holdRows.forEach((r) => (holdByType[r.type] = r));

    const locked = await holdModel.isMonthLocked(employee_id, date);

    const data = TYPES.map((type) => {
      const hold = holdByType[type];

      return {
        type,
        label: LABELS[type],
        amount: Number(salaryRow[TYPE_TO_SALARY_FIELD[type]]) || 0,
        status: hold ? hold.status : "UNHOLD",
        reason_amount_update: hold ? hold.reason_amount_update : null,
        reason_hold: hold ? hold.reason_hold : null,
      };
    });

    return res.json({
      success: true,
      employee: { id: employee.id, name: employee.name },
      date,
      month_locked: locked,
      gross_salary: Number(salaryRow.gross_salary) || 0,
      net_salary: Number(salaryRow.net_salary) || 0,
      data,
    });
  } catch (error) {
    console.error("searchPaymentHold error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * PUT /payment-hold/update-amount
 * Body: { employee_id, date, type, amount, reason }
 */
exports.updateAmount = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { employee_id, date, type, amount, reason } = req.body;

    if (!employee_id || !date || !type || amount === undefined) {
      connection.release();
      return res.status(400).json({ message: "employee_id, date, type and amount are required" });
    }

    if (!TYPES.includes(type)) {
      connection.release();
      return res.status(400).json({ message: "Invalid type" });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      connection.release();
      return res.status(400).json({ message: "Invalid amount" });
    }

    const salaryRow = await holdModel.getSalaryDailyRow(employee_id, date);
    if (!salaryRow) {
      connection.release();
      return res.status(404).json({
        message: "No salary record generated for this employee on this date",
      });
    }

    if (await holdModel.isMonthLocked(employee_id, date)) {
      connection.release();
      return res.status(400).json({ message: "Salary for this month is locked and cannot be edited" });
    }

    const existingHold = await holdModel.getHoldRow(employee_id, date, type);
    if (existingHold && existingHold.status === "HOLD") {
      connection.release();
      return res.status(400).json({
        message: "This item is on hold. Unhold it before editing the amount.",
      });
    }

    const originalAmount = Number(salaryRow[TYPE_TO_SALARY_FIELD[type]]) || 0;

    if (parsedAmount !== originalAmount && !reason) {
      connection.release();
      return res.status(400).json({ message: "Reason is required when changing the amount" });
    }

    let expenseEntry = null;

    if (isExpenseType(type)) {
      expenseEntry = await holdModel.getExpenseEntry(employee_id, date, type);
      if (!expenseEntry) {
        connection.release();
        return res.status(404).json({
          message: `No ${LABELS[type]} entry found for this employee on this date`,
        });
      }

      // Respect the same allocation cap uploadMyExpense enforces —
      // editing shouldn't silently push the employee over budget.
      const allocation = await expenseModel.getAllocationByUserId(employee_id);
      if (allocation) {
        const allocated = getAllocatedAmount(allocation, type);
        const usedTotal = parseFloat(await expenseModel.getUsedAmountByType(employee_id, type)) || 0;
        const usedExcludingThis = usedTotal - Number(expenseEntry.amount);
        const remaining = allocated - usedExcludingThis;

        if (parsedAmount > remaining) {
          connection.release();
          return res.status(400).json({
            message: "Updated amount exceeds remaining allocation",
            allocated_amount: allocated,
            remaining_amount: remaining < 0 ? 0 : remaining,
          });
        }
      }
    }

    await connection.beginTransaction();

    if (isExpenseType(type)) {
      await holdModel.writeExpenseEntryAmount(connection, employee_id, date, type, parsedAmount.toFixed(2));
    }

    const { grossSalary, netSalary } = await holdModel.writeSalaryField(
      connection,
      employee_id,
      date,
      TYPE_TO_SALARY_FIELD[type],
      parsedAmount.toFixed(2)
    );

    await holdModel.upsertAmountEditLog(connection, {
      employeeId: employee_id,
      date,
      type,
      reason: parsedAmount !== originalAmount ? reason : null,
      updatedBy: req.user?.id || null,
    });

    await connection.commit();

    return res.json({
      message: "Amount updated successfully",
      gross_salary: grossSalary,
      net_salary: netSalary,
    });
  } catch (error) {
    await connection.rollback();
    console.error("updateAmount error:", error);
    return res.status(500).json({ message: "Server error" });
  } finally {
    connection.release();
  }
};

/**
 * PUT /payment-hold/toggle-status
 * Body: { employee_id, date, type, status: 'HOLD' | 'UNHOLD', reason }
 */
exports.toggleStatus = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { employee_id, date, type, status, reason } = req.body;

    if (!employee_id || !date || !type || !status) {
      connection.release();
      return res.status(400).json({ message: "employee_id, date, type and status are required" });
    }

    if (!TYPES.includes(type)) {
      connection.release();
      return res.status(400).json({ message: "Invalid type" });
    }

    if (!["HOLD", "UNHOLD"].includes(status)) {
      connection.release();
      return res.status(400).json({ message: "Invalid status" });
    }

    if (status === "HOLD" && !reason) {
      connection.release();
      return res.status(400).json({ message: "Reason is required to hold a payment" });
    }

    const salaryRow = await holdModel.getSalaryDailyRow(employee_id, date);
    if (!salaryRow) {
      connection.release();
      return res.status(404).json({
        message: "No salary record generated for this employee on this date",
      });
    }

    if (await holdModel.isMonthLocked(employee_id, date)) {
      connection.release();
      return res.status(400).json({ message: "Salary for this month is locked and cannot be edited" });
    }

    let expenseEntry = null;
    if (isExpenseType(type)) {
      expenseEntry = await holdModel.getExpenseEntry(employee_id, date, type);
      if (!expenseEntry) {
        connection.release();
        return res.status(404).json({
          message: `No ${LABELS[type]} entry found for this employee on this date`,
        });
      }
    }

    const field = TYPE_TO_SALARY_FIELD[type];
    const existingHold = await holdModel.getHoldRow(employee_id, date, type);

    await connection.beginTransaction();

    let grossSalary, netSalary;

    if (status === "HOLD") {
      const alreadyHeld = isExpenseType(type)
        ? expenseEntry.hold_status === "HOLD"
        : existingHold && existingHold.status === "HOLD";

      if (alreadyHeld) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ message: "This item is already on hold" });
      }

      let amountBeforeHold = null;

      if (isExpenseType(type)) {
        // Bill amount stays intact on the entry — only mark it held
        // and zero out the payable copy in emp_salary_daily.
        await holdModel.setExpenseEntryHold(connection, employee_id, date, type, "HOLD", reason);
        ({ grossSalary, netSalary } = await holdModel.writeSalaryField(
          connection, employee_id, date, field, "0.00"
        ));
      } else {
        amountBeforeHold = (Number(salaryRow[field]) || 0).toFixed(2);
        ({ grossSalary, netSalary } = await holdModel.writeSalaryField(
          connection, employee_id, date, field, "0.00"
        ));
      }

      await holdModel.upsertHoldStatus(connection, {
        employeeId: employee_id,
        date,
        type,
        status: "HOLD",
        amountBeforeHold,
        reason,
        updatedBy: req.user?.id || null,
      });
    } else {
      const currentlyHeld = isExpenseType(type)
        ? expenseEntry.hold_status === "HOLD"
        : existingHold && existingHold.status === "HOLD";

      if (!currentlyHeld) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ message: "This item is not currently on hold" });
      }

      if (isExpenseType(type)) {
        await holdModel.setExpenseEntryHold(connection, employee_id, date, type, "UNHOLD", null);
        // restore the payable copy from the entry's real, untouched amount
        ({ grossSalary, netSalary } = await holdModel.writeSalaryField(
          connection, employee_id, date, field, Number(expenseEntry.amount).toFixed(2)
        ));
      } else {
        const restoreAmount = Number(existingHold.amount_before_hold) || 0;
        ({ grossSalary, netSalary } = await holdModel.writeSalaryField(
          connection, employee_id, date, field, restoreAmount.toFixed(2)
        ));
      }

      await holdModel.upsertHoldStatus(connection, {
        employeeId: employee_id,
        date,
        type,
        status: "UNHOLD",
        amountBeforeHold: null,
        reason: null,
        updatedBy: req.user?.id || null,
      });
    }

    await connection.commit();

    return res.json({
      message: `Payment ${status === "HOLD" ? "held" : "unheld"} successfully`,
      gross_salary: grossSalary,
      net_salary: netSalary,
    });
  } catch (error) {
    await connection.rollback();
    console.error("toggleStatus error:", error);
    return res.status(500).json({ message: "Server error" });
  } finally {
    connection.release();
  }
};