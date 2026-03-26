const expenseModel = require("../models/EmpExpense.model");
const { uploadFileToMinio } = require("../utils/fileUpload");

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

exports.getMyExpenseSummary = async (req, res) => {
  try {
    const userId = req.user?.id || req.params.userId || req.query.user_id;

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
      const used = parseFloat(await expenseModel.getUsedAmountByType(userId, type));
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

const usedAmount = parseFloat(
  await expenseModel.getTotalUploaded(allocation.id, expense_type)
);

const remainingAmount = allocatedAmount - usedAmount;

if (parsedAmount > remainingAmount) {
  return res.status(400).json({
    message: "Uploaded amount exceeds remaining allocation",
    data: {
      expense_type,
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
    let {
      page = 1,
      limit = 10,
      search,
      expense_type,
      start_date,
      end_date
    } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);
    const offset = (page - 1) * limit;

    const result = await expenseModel.getAdminExpenseSummary({
      search: search || null,
      expense_type: expense_type || null,
      start_date: start_date || null,
      end_date: end_date || null,
      limit,
      offset
    });

    //  Format response
    const formattedData = result.rows.map((row) => {

      const allocation = {
        HOTEL: parseFloat(row.hotel_amount || 0),
        BUS_TRAIN_TOLL: parseFloat(row.bus_train_toll_amount || 0),
        PETROL_DIESEL: parseFloat(row.petrol_diesel_amount || 0),
        OTHER: parseFloat(row.other_amount || 0)
      };

      const usage = {
        HOTEL: parseFloat(row.hotel_used || 0),
        BUS_TRAIN_TOLL: parseFloat(row.bus_used || 0),
        PETROL_DIESEL: parseFloat(row.petrol_used || 0),
        OTHER: parseFloat(row.other_used || 0)
      };

      const remaining = {
        HOTEL: allocation.HOTEL - usage.HOTEL,
        BUS_TRAIN_TOLL: allocation.BUS_TRAIN_TOLL - usage.BUS_TRAIN_TOLL,
        PETROL_DIESEL: allocation.PETROL_DIESEL - usage.PETROL_DIESEL,
        OTHER: allocation.OTHER - usage.OTHER
      };

      return {
        user_id: row.user_id,
        employee_name: row.employee_name,
        allocation,
        usage,
        remaining
      };
    });

    return res.status(200).json({
      message: "Admin expense summary fetched successfully",
      page,
      limit,
      totalItems: result.total,
      total_pages: Math.ceil(result.total / limit),
      data: formattedData
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
};


