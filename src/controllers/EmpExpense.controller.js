const db = require("../config/db");
const expenseModel = require("../models/EmpExpense.model");
const { uploadFileToMinio } = require("../utils/fileUpload");
const { getPresignedUrl } = require("../utils/fileUpload");

exports.setExpenseAllocation = async (req, res) => {
  try {
    const { user_id, hotel_amount, bus_train_toll_amount, petrol_diesel_amount, other_amount } = req.body;

    if (!user_id) {
      return res.status(400).json({ message: "user_id is required" });
    }

    // check existing allocation
    const existing = await expenseModel.getAllocationByUserId(user_id);

    let result;

    if (existing) {
      // update
      result = await expenseModel.updateAllocation({ user_id, hotel_amount, bus_train_toll_amount, petrol_diesel_amount, other_amount });

      return res.json({
        message: "Expense allocation updated successfully"
      });

    } else {
      // insert
      result = await expenseModel.createAllocation({ user_id, hotel_amount, bus_train_toll_amount, petrol_diesel_amount, other_amount });

      return res.status(200).json({
        success: true,
        message: "Expense allocation created successfully",
        data: result
      });
    }
  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
};

const EXPENSE_TYPES = [
  "HOTEL",
  "BUS_TRAIN_TOLL",
  "PETROL_DIESEL",
  "OTHER"
];

const getAllocatedAmountByType = (allocation, expenseType) => {
  if (expenseType === "HOTEL") return parseFloat(allocation.hotel_amount || 0);
  if (expenseType === "BUS_TRAIN_TOLL") return parseFloat(allocation.bus_train_toll_amount || 0);
  if (expenseType === "PETROL_DIESEL") return parseFloat(allocation.petrol_diesel_amount || 0);
  if (expenseType === "OTHER") return parseFloat(allocation.other_amount || 0);
  return 0;
};

// The allocation amounts (hotel_amount, bus_train_toll_amount, etc.)
// are a PER-DAY cap, not a lifetime one — so "today" is the default
// scope everywhere we check "how much is left".
const todayDateOnly = () => new Date().toISOString().split("T")[0];
const dateOnly = (value) => new Date(value).toISOString().split("T")[0];

exports.getMyExpenseSummary = async (req, res) => {
  try {
    const userId = req.user?.id || req.params.userId || req.query.user_id;

    // CHANGED: this cap resets every day now. Defaults to today,
    // or pass ?date=YYYY-MM-DD to check a specific day.
    const date = req.query.date ? dateOnly(req.query.date) : todayDateOnly();

    if (!userId) {
      return res.status(400).json({
        message: "user_id is required"
      });
    }

    const allocation = await expenseModel.getAllocationByUserId(userId);

    if (!allocation) {
      return res.status(404).json({
        message: "No expense allocation found for this employee"
      });
    }

    const summary = {};

    for (const type of EXPENSE_TYPES) {
      const allocated = getAllocatedAmountByType(allocation, type);
      // CHANGED: was getUsedAmountByType (lifetime) — now scoped to `date`
      const used = parseFloat(await expenseModel.getUsedAmountByTypeForDate(userId, type, date));
      const remaining = allocated - used;

      summary[type] = {
        allocated_amount: allocated,
        used_amount: used,
        remaining_amount: remaining < 0 ? 0 : remaining
      };
    }

    return res.status(200).json({
      message: "Expense summary fetched successfully",
      data: {
        allocation_id: allocation.id,
        user_id: allocation.user_id,
        date,
        summary
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
};

exports.uploadMyExpense = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.user_id;
    const {
      expense_type,
      expense_date,
      amount,
      remarks
    } = req.body;

    if (!userId || !expense_type || !expense_date || !amount) {
      return res.status(400).json({
        message: "user_id, expense_type, expense_date and amount are required"
      });
    }

    if (!EXPENSE_TYPES.includes(expense_type)) {
      return res.status(400).json({
        message: "Invalid expense type"
      });
    }
     if (!req.file) {
      return res.status(400).json({
        message: "Please upload bill image"
      });
    }


    const parsedAmount = parseFloat(amount);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        message: "Amount must be greater than 0"
      });
    }

    const allocation = await expenseModel.getAllocationByUserId(userId);

    if (!allocation) {
      return res.status(400).json({
        message: "No expense allocation found for this employee"
      });
    }

const allocatedAmount = getAllocatedAmountByType(allocation, expense_type);

// CHANGED: was getTotalUploaded(allocation.id, expense_type), which
// summed EVERY entry ever uploaded — that's why the cap never reset.
// Now scoped to this specific expense_date, so each day gets its
// own fresh allocation.
const usedAmount = parseFloat(
  await expenseModel.getTotalUploadedForDate(allocation.id, expense_type, dateOnly(expense_date))
);

const remainingAmount = allocatedAmount - usedAmount;

if (parsedAmount > remainingAmount) {
  return res.status(400).json({
    message: "Uploaded amount exceeds remaining allocation for this date",
    data: {
      expense_type,
      expense_date,
      allocated_amount: allocatedAmount,
      used_amount: usedAmount,
      remaining_amount: remainingAmount < 0 ? 0 : remainingAmount
    }
  });
}

    let billUpload = {
      object_path: null,
      file_url: null
    };

    if (req.file) {
      billUpload = await uploadFileToMinio(req.file, "bills");
    }

    const createdExpense = await expenseModel.createExpenseEntry({
      allocation_id: allocation.id,
      user_id: userId,
      expense_type,
      expense_date,
      amount: parsedAmount,
      bill_object_path: billUpload.object_path,
      bill_url: billUpload.file_url,
      remarks: remarks || null
    });

    return res.status(201).json({
      message: "Expense uploaded successfully",
      data: createdExpense
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        message: "Same expense type already uploaded for this date"
      });
    }

    return res.status(500).json({
      error: error.message
    });
  }
};

exports.getMyUploadedExpenses = async (req, res) => {
  try {
    const userId = req.user?.id || req.params.userId || req.query.user_id;
    const { expense_type } = req.query;

    if (!userId) {
      return res.status(400).json({
        message: "user_id is required"
      });
    }

    let expenses;

    if (expense_type) {
      if (!EXPENSE_TYPES.includes(expense_type)) {
        return res.status(400).json({
          message: "Invalid expense type"
        });
      }

      expenses = await expenseModel.getUserExpenseEntriesByType(userId, expense_type);
    } else {
      expenses = await expenseModel.getUserExpenseEntries(userId);
    }

    return res.status(200).json({
      message: "Uploaded expenses fetched successfully",
      count: expenses.length,
      data: expenses
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
};

exports.getAdminExpenseSummary = async (req, res) => {
  try {
    const {
      search,
      expense_type,       // optional filter — only affects the "entries" list, allocation/usage always show all 4 types
      start_date,
      end_date,
      page,
      limit
    } = req.query;

    const validTypes = ["HOTEL", "BUS_TRAIN_TOLL", "PETROL_DIESEL", "OTHER"];
    const normalizedType = expense_type ? expense_type.toUpperCase() : null;
    if (normalizedType && !validTypes.includes(normalizedType)) {
      return res.status(400).json({ message: "Invalid expense_type" });
    }

    // default to TODAY when no range is selected — allocation is a per-day cap, never lifetime
    const today = dateOnly(new Date());
    const cleanStart = start_date ? dateOnly(start_date) : today;
    const cleanEnd = end_date ? dateOnly(end_date) : today;

    const currentPage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
    const pageSize = parseInt(limit, 10) > 0 ? parseInt(limit, 10) : 10;
    const offset = (currentPage - 1) * pageSize;

    const { rows: allocRows, total } = await expenseModel.getAdminAllocationsPaginated({
      search,
      limit: pageSize,
      offset
    });

    const userIds = allocRows.map((r) => r.user_id);

    const [usageRows, entryRows] = await Promise.all([
      expenseModel.getUsageForUsersInRange(userIds, cleanStart, cleanEnd),
      expenseModel.getEntriesForUsersInRange(userIds, cleanStart, cleanEnd)
    ]);

    // usage lookup: usageByUser[user_id][expense_type] = total
    const usageByUser = {};
    for (const row of usageRows) {
      if (!usageByUser[row.user_id]) usageByUser[row.user_id] = {};
      usageByUser[row.user_id][row.expense_type] = parseFloat(row.total);
    }

    // entries grouped by user, presigned + optionally filtered by expense_type
    const entriesByUser = {};
    for (const entry of entryRows) {
      if (normalizedType && entry.expense_type !== normalizedType) continue;
      if (!entriesByUser[entry.user_id]) entriesByUser[entry.user_id] = [];
      entriesByUser[entry.user_id].push(entry);
    }

    const data = await Promise.all(
      allocRows.map(async (row) => {
        const allocationMap = {
          HOTEL: row.hotel_amount,
          BUS_TRAIN_TOLL: row.bus_train_toll_amount,
          PETROL_DIESEL: row.petrol_diesel_amount,
          OTHER: row.other_amount
        };

        const usageMap = usageByUser[row.user_id] || {};

        const allocation = {};
        const usage = {};
        const remaining = {};

        for (const type of validTypes) {
          const allocated = parseFloat(allocationMap[type] || 0);
          const used = parseFloat(usageMap[type] || 0);
          allocation[type] = allocated;
          usage[type] = used;
          remaining[type] = allocated - used < 0 ? 0 : allocated - used;
        }

        const rawEntries = entriesByUser[row.user_id] || [];
        const entries = await Promise.all(
          rawEntries.map(async (entry) => {
            let bill_url = null;
            if (entry.bill_object_path) {
              bill_url = await getPresignedUrl(entry.bill_object_path);
            }
            return {
              id: entry.id,
              expense_type: entry.expense_type,
              expense_date: entry.expense_date,
              amount: entry.amount,
              remarks: entry.remarks,
              status: entry.status,
              hold_status: entry.hold_status,
              hold_reason: entry.hold_reason,
              bill_url
            };
          })
        );

        return {
          user_id: row.user_id,
          employee_name: row.employee_name,
          allocation,
          usage,
          remaining,
          entries
        };
      })
    );

    return res.status(200).json({
      message: "Admin expense summary fetched successfully",
      page: currentPage,
      limit: pageSize,
      totalItems: total,
      total_pages: Math.ceil(total / pageSize),
      start_date: cleanStart,
      end_date: cleanEnd,
      data
    });
  } catch (error) {
    console.error("ERROR in getAdminExpenseSummary:", error);
    return res.status(500).json({ error: error.message });
  }
};

exports.getEmployeeExpenseByDate = async (req, res) => {
  try {
    const {
      employee_id,
      expense_type,   // optional: HOTEL | BUS_TRAIN_TOLL | PETROL_DIESEL | OTHER
      start_date,
      end_date,
      search,         // optional: matches remarks
      page,
      limit
    } = req.query;

    if (!employee_id || !start_date || !end_date) {
      return res.status(400).json({
        message: "employee_id, start_date and end_date are required"
      });
    }

    const cleanStart = dateOnly(start_date);
    const cleanEnd = dateOnly(end_date);

    if (!cleanStart || !cleanEnd) {
      return res.status(400).json({ message: "Invalid start_date or end_date" });
    }

    const validTypes = ["HOTEL", "BUS_TRAIN_TOLL", "PETROL_DIESEL", "OTHER"];
    const normalizedType = expense_type ? expense_type.toUpperCase() : null;
    if (normalizedType && !validTypes.includes(normalizedType)) {
      return res.status(400).json({ message: "Invalid expense_type" });
    }

    const [[employee]] = await db.query(`SELECT id, name FROM users WHERE id = ?`, [employee_id]);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const allocation = await expenseModel.getAllocationByUserId(employee_id);
    if (!allocation) {
      return res.status(404).json({
        message: "No expense allocation found for this employee"
      });
    }

    // summary block — if a specific type was requested, only compute that one;
    // otherwise compute all 4 like before
    const typesToSummarize = normalizedType ? [normalizedType] : EXPENSE_TYPES;

    const summary = {};
    for (const type of typesToSummarize) {
      const allocated = getAllocatedAmountByType(allocation, type);
      const used = parseFloat(
        await expenseModel.getUsedAmountByTypeForRange(employee_id, type, cleanStart, cleanEnd)
      );
      const remaining = allocated - used;

      summary[type] = {
        allocated_amount: allocated,
        used_amount: used,
        remaining_amount: remaining < 0 ? 0 : remaining
      };
    }

    // pagination
    const currentPage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
    const pageSize = parseInt(limit, 10) > 0 ? parseInt(limit, 10) : 10;
    const offset = (currentPage - 1) * pageSize;

    const { rows: rawEntries, total } = await expenseModel.getUserExpenseEntriesFiltered(employee_id, {
      expense_type: normalizedType,
      start_date: cleanStart,
      end_date: cleanEnd,
      search,
      limit: pageSize,
      offset
    });

    const entries = await Promise.all(
      rawEntries.map(async (entry) => {
        let bill_url = null;
        if (entry.bill_object_path) {
          bill_url = await getPresignedUrl(entry.bill_object_path);
        }

        return {
          id: entry.id,
          expense_type: entry.expense_type,
          expense_date: entry.expense_date,
          amount: entry.amount,
          remarks: entry.remarks,
          status: entry.status,
          hold_status: entry.hold_status,
          hold_reason: entry.hold_reason,
          bill_url
        };
      })
    );

    return res.status(200).json({
      message: "Employee expense fetched successfully",
      data: {
        employee: { id: employee.id, name: employee.name },
        start_date: cleanStart,
        end_date: cleanEnd,
        expense_type: normalizedType || "ALL",
        allocation_id: allocation.id,
        summary,
        entries,
        pagination: {
          page: currentPage,
          limit: pageSize,
          total,
          total_pages: Math.ceil(total / pageSize)
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.updateExpenseAllocation = async (req, res) => {
  try {
    const { user_id } = req.params;

    const {
      hotel_amount = 0,
      bus_train_toll_amount = 0,
      petrol_diesel_amount = 0,
      other_amount = 0
    } = req.body;

    //  check allocation exists
    const existing = await expenseModel.getAllocationByUserId(user_id);

    if (!existing) {
      return res.status(404).json({
        message: "Allocation not found"
      });
    }

    // CHANGED: was getUsedAmountByType (lifetime total). Since the
    // allocation is a per-day cap, the only thing that makes sense to
    // guard against here is lowering TODAY's cap below what's already
    // been logged today — not the employee's entire history.
    const today = todayDateOnly();

    const usedHotel = await expenseModel.getUsedAmountByTypeForDate(user_id, "HOTEL", today);
    const usedBus = await expenseModel.getUsedAmountByTypeForDate(user_id, "BUS_TRAIN_TOLL", today);
    const usedPetrol = await expenseModel.getUsedAmountByTypeForDate(user_id, "PETROL_DIESEL", today);
    const usedOther = await expenseModel.getUsedAmountByTypeForDate(user_id, "OTHER", today);

    // VALIDATION (VERY IMPORTANT)
    if (hotel_amount < usedHotel) {
      return res.status(400).json({
        message: `Hotel allocation cannot be less than today's already used amount (${usedHotel})`
      });
    }

    if (bus_train_toll_amount < usedBus) {
      return res.status(400).json({
        message: `Bus/Train allocation cannot be less than today's already used amount (${usedBus})`
      });
    }

    if (petrol_diesel_amount < usedPetrol) {
      return res.status(400).json({
        message: `Petrol/Diesel allocation cannot be less than today's already used amount (${usedPetrol})`
      });
    }

    if (other_amount < usedOther) {
      return res.status(400).json({
        message: `Other allocation cannot be less than today's already used amount (${usedOther})`
      });
    }

    //  Update allocation
    await expenseModel.updateAllocation({
      user_id,
      hotel_amount,
      bus_train_toll_amount,
      petrol_diesel_amount,
      other_amount
    });

    return res.json({
      message: "Expense allocation updated successfully"
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
};