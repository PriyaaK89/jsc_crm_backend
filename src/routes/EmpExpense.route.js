const express = require("express");
const router = express.Router();

const expenseController = require("../controllers/EmpExpense.controller");
const upload = require("../middleware/upload.middleware");
const auth = require("../middleware/auth.middleware");

router.post("/set-expense-allocation",auth, expenseController.setExpenseAllocation);
router.get("/admin-expense-summary",auth, expenseController.getAdminExpenseSummary);
router.put("/update-expense-allocation/:user_id", auth, expenseController.updateExpenseAllocation);

// user side
router.get("/get-emp-expenses-summary",auth, expenseController.getMyExpenseSummary);
router.post("/upload-my-expense",auth, upload.single("bill"), expenseController.uploadMyExpense);
router.get("/my-uploaded-expenses",auth, expenseController.getMyUploadedExpenses);

module.exports = router;