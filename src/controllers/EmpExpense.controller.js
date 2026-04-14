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

// exports.getAdminExpenseSummary = async (req, res) => {
//   try {
//     let {
//       page = 1,
//       limit = 10,
//       search,
//       expense_type,
//       start_date,
//       end_date
//     } = req.query;

//     page = parseInt(page);
//     limit = parseInt(limit);
//     const offset = (page - 1) * limit;

//     const result = await expenseModel.getAdminExpenseSummary({
//       search: search || null,
//       expense_type: expense_type || null,
//       start_date: start_date || null,
//       end_date: end_date || null,
//       limit,
//       offset
//     });

//     //  Format response
//  const formattedData = await Promise.all(
//   result.rows.map(async (row) => {

//     const entries = await expenseModel.getExpenseEntriesForAdmin(row.user_id, {
//       expense_type,
//       start_date,
//       end_date
//     });

//     const entriesWithUrls = await Promise.all(
//       entries.map(async (entry) => {
//         let bill_url = null;

//         if (entry.bill_object_path) {
//           bill_url = await getPresignedUrl(entry.bill_object_path);
//         }

//         return {
//           id: entry.id,
//           expense_type: entry.expense_type,
//           expense_date: entry.expense_date,
//           amount: entry.amount,
//           remarks: entry.remarks,
//           status: entry.status,
//           bill_url
//         };
//       })
//     );

//     return {
//       user_id: row.user_id,
//       employee_name: row.employee_name,

//       allocation: {
//         HOTEL: Number(row.hotel_amount || 0),
//         BUS_TRAIN_TOLL: Number(row.bus_train_toll_amount || 0),
//         PETROL_DIESEL: Number(row.petrol_diesel_amount || 0),
//         OTHER: Number(row.other_amount || 0)
//       },

//       usage: {
//         HOTEL: Number(row.hotel_used || 0),
//         BUS_TRAIN_TOLL: Number(row.bus_used || 0),
//         PETROL_DIESEL: Number(row.petrol_used || 0),
//         OTHER: Number(row.other_used || 0)
//       },

//       remaining: {
//         HOTEL: Number(row.hotel_amount || 0) - Number(row.hotel_used || 0),
//         BUS_TRAIN_TOLL: Number(row.bus_train_toll_amount || 0) - Number(row.bus_used || 0),
//         PETROL_DIESEL: Number(row.petrol_diesel_amount || 0) - Number(row.petrol_used || 0),
//         OTHER: Number(row.other_amount || 0) - Number(row.other_used || 0)
//       },

//       entries: entriesWithUrls  
//     };
//   })
// );

//     return res.status(200).json({
//       message: "Admin expense summary fetched successfully",
//       page,
//       limit,
//       totalItems: result.total,
//       total_pages: Math.ceil(result.total / limit),
//       data: formattedData,

//     });

//   } catch (error) {
//     return res.status(500).json({
//       error: error.message
//     });
//   }
// };

exports.getAdminExpenseSummary = async (req, res) => {
  try {
    let {
      page,
      limit,
      search,
      expense_type,
      start_date,
      end_date
    } = req.query;

    //  Safe parsing
    const pageNumber = Number(page) || 1;
    const limitNumber = Number(limit) || 10;
    const offset = (pageNumber - 1) * limitNumber;

    //  Clean filters (VERY IMPORTANT)
    const cleanSearch = search && search.trim() !== "" ? search.trim() : null;
    const cleanExpenseType =
      expense_type && expense_type.trim() !== ""
        ? expense_type.toUpperCase()
        : null;

    const cleanStartDate =
      start_date && start_date !== "" ? new Date(start_date) : null;

    const cleanEndDate =
      end_date && end_date !== "" ? new Date(end_date) : null;

    const result = await expenseModel.getAdminExpenseSummary({
      search: cleanSearch,
      expense_type: cleanExpenseType,
      start_date: cleanStartDate,
      end_date: cleanEndDate,
      limit: limitNumber,
      offset
    });

    //  Format response
    const formattedData = await Promise.all(
      result.rows.map(async (row) => {

        const entries = await expenseModel.getExpenseEntriesForAdmin(
          row.user_id,
          {
            expense_type: cleanExpenseType,
            start_date: cleanStartDate,
            end_date: cleanEndDate
          }
        );

        const entriesWithUrls = await Promise.all(
          entries.map(async (entry) => {
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
              bill_url
            };
          })
        );

        return {
          user_id: row.user_id,
          employee_name: row.employee_name,

          allocation: {
            HOTEL: Number(row.hotel_amount || 0),
            BUS_TRAIN_TOLL: Number(row.bus_train_toll_amount || 0),
            PETROL_DIESEL: Number(row.petrol_diesel_amount || 0),
            OTHER: Number(row.other_amount || 0)
          },

          usage: {
            HOTEL: Number(row.hotel_used || 0),
            BUS_TRAIN_TOLL: Number(row.bus_used || 0),
            PETROL_DIESEL: Number(row.petrol_used || 0),
            OTHER: Number(row.other_used || 0)
          },

          remaining: {
            HOTEL: Number(row.hotel_amount || 0) - Number(row.hotel_used || 0),
            BUS_TRAIN_TOLL:
              Number(row.bus_train_toll_amount || 0) - Number(row.bus_used || 0),
            PETROL_DIESEL:
              Number(row.petrol_diesel_amount || 0) - Number(row.petrol_used || 0),
            OTHER:
              Number(row.other_amount || 0) - Number(row.other_used || 0)
          },

          entries: entriesWithUrls
        };
      })
    );

    return res.status(200).json({
      message: "Admin expense summary fetched successfully",
      page: pageNumber,
      limit: limitNumber,
      totalItems: result.total,
      total_pages: Math.ceil(result.total / limitNumber),
      data: formattedData
    });

  } catch (error) {
    console.error("ERROR:", error); //  important for debugging

    return res.status(500).json({
      error: error.message
    });
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

    // Get already used amounts
    const usedHotel = await expenseModel.getUsedAmountByType(user_id, "HOTEL");
    const usedBus = await expenseModel.getUsedAmountByType(user_id, "BUS_TRAIN_TOLL");
    const usedPetrol = await expenseModel.getUsedAmountByType(user_id, "PETROL_DIESEL");
    const usedOther = await expenseModel.getUsedAmountByType(user_id, "OTHER");

    // VALIDATION (VERY IMPORTANT)
    if (hotel_amount < usedHotel) {
      return res.status(400).json({
        message: `Hotel allocation cannot be less than already used amount (${usedHotel})`
      });
    }

    if (bus_train_toll_amount < usedBus) {
      return res.status(400).json({
        message: `Bus/Train allocation cannot be less than already used amount (${usedBus})`
      });
    }

    if (petrol_diesel_amount < usedPetrol) {
      return res.status(400).json({
        message: `Petrol/Diesel allocation cannot be less than already used amount (${usedPetrol})`
      });
    }

    if (other_amount < usedOther) {
      return res.status(400).json({
        message: `Other allocation cannot be less than already used amount (${usedOther})`
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