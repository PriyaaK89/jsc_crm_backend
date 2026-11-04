const express = require("express");
const router = express.Router();
const { checkPermission } = require("../../middleware/permission.middleware");
const auth = require("../../middleware/auth.middleware");
const transactionDocumentsController = require("../../controllers/reports/transactionDocuments.controller");

router.get("/get-transaction-documents", auth, checkPermission("VIEW_FINANCIAL_REPORT"), transactionDocumentsController.getTransactionDocuments);

module.exports = router;