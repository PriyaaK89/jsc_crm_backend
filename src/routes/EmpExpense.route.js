const express = require("express");
const router = express.Router();
const { checkAnyPermission, checkPermission } = require("../middleware/permission.middleware");

const expenseController = require("../controllers/EmpExpense.controller");
const upload = require("../middleware/upload.middleware");
const auth = require("../middleware/auth.middleware");

router.post("/set-expense-allocation", auth, checkPermission("expense_manage"), expenseController.setExpenseAllocation);
router.get("/admin-expense-summary", auth, checkAnyPermission(["VIEW_EMPLOYEE_REPORT", "expense_manage"]), expenseController.getAdminExpenseSummary);
router.get("/admin-expense-by-date", auth, checkAnyPermission(["VIEW_EMPLOYEE_REPORT", "expense_manage"]), expenseController.getEmployeeExpenseByDate); // NEW
router.put("/update-expense-allocation/:user_id", auth, checkPermission("expense_manage"), expenseController.updateExpenseAllocation);

// user side
router.get("/get-emp-expenses-summary",auth, expenseController.getMyExpenseSummary);
router.post("/upload-my-expense",auth, upload.single("bill"), expenseController.uploadMyExpense);
router.get("/my-uploaded-expenses",auth, expenseController.getMyUploadedExpenses);

module.exports = router;