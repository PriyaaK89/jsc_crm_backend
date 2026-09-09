const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth.middleware");
const transactionDocumentsController = require("../../controllers/reports/transactionDocuments.controller");

router.get("/get-transaction-documents", transactionDocumentsController.getTransactionDocuments);

module.exports = router;