const express = require("express");
const router = express.Router();

const expenseController = require("../controllers/EmpExpense.controller");
const upload = require("../middleware/upload.middleware");

router.post("/set-expense-allocation", expenseController.setExpenseAllocation);

// user side
router.get("/get-emp-expenses-summary", expenseController.getMyExpenseSummary);
router.post("/upload-my-expense", upload.single("bill"), expenseController.uploadMyExpense);
router.get("/my-uploaded-expenses", expenseController.getMyUploadedExpenses);
router.get("/getUploadedExpenses", expenseController.getAllExpensesAdmin);

module.exports = router;