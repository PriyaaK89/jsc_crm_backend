const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());

// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use((req, res, next) => {
    const start = Date.now();

    console.log(`[START] ${req.method} ${req.originalUrl}`);

    res.on("finish", () => {
        const duration = Date.now() - start;

        console.log(
            `[END] ${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`
        );
    });

    next();
});


const departmentRoute = require("../src/routes/department.routes");
const jobRoleRoute = require("../src/routes/jobRole.routes");
const authRoutes = require('../src/routes/auth.routes');
const userDocumentRoute = require("../src/routes/userDocument.routes");
const pincodeRoute = require("../src/routes/pincode.routes");
const uploadEmpSalaryRoute = require("../src/routes/uploadEmpSalary.routes");
const empAttendanceRoute = require("../src/routes/empAttendance.routes");
const empSalaryRoute = require("../src/routes/empSalary.routes");
const empDailySalaryRoute = require("../src/routes/empDailySalary.routes");
const locationRoute = require("../src/routes/location.routes");
const uploadRoute = require("../src/routes/upload.routes");
const documentRoute = require("../src/routes/document.routes");
const leegalityRoute = require("../src/routes/esign.routes");
const leegalityWebhookRoute = require("../src/routes/leegalityWebhook.routes");

const EmpExpensesRoute = require("../src/routes/EmpExpense.route");
const customerRoute = require("../src/routes/customer.routes");
const visitRoute = require("../src/routes/visit.routes");
const gstVerificationRoute = require("../src/routes/gst.routes");
const distributorOnBoardingRoute = require("../src/routes/distributor.routes");
const panVerificationRoute = require("../src/routes/panVerification.route");
const digioVerificationRoute = require("../src/routes/digioKyc.routes");
const distributorDigioRoute = require("../src/routes/distributorDigio.routes");
const companyRoute = require("../src/routes/company.routes");
const stockGroupRoute = require("../src/routes/stockGroup.routes");
const stockCategoryRoute = require("../src/routes/stockCategory.routes");
const teamRoute = require("../src/routes/team.routes");
const visitTargetRoute = require("../src/routes/visitTarget.routes");
const dailyReportRoute = require("../src/routes/dailyReport.route");
const rollingUserRoute = require("../src/routes/rollingUser.routes");
const empTargetRoute = require("../src/routes/empTarget.routes");
const godownRoute = require("../src/routes/godown.routes");
const unitOfMeasureRoute = require("../src/routes/unit.routes");
const stockItemRoute = require("../src/routes/stockItem.routes");
const accountGroupRoute = require("../src/routes/accountGroup.routes");
const ledgerRoute = require("../src/routes/ledger.routes");
const voucherRoute = require("../src/routes/voucherType.routes");
const materialManufacturingRoute = require("../src/routes/materialManufacturing.routes");
const stockTransferRoute = require("../src/routes/stockTransfer.route");
const retailerRoute = require("../src/routes/retailer.routes");
const retailerAssignmentRoute = require("../src/routes/retailerAssignment.routes");
const generateVoucherRoute = require("../src/routes/generateVoucher.routes");
const purchaseTxnMasterRoute = require("../src/routes/purchaseTxnMaster.routes");
const partyLedgerReportRoute = require("../src/routes/partyLedgerReport.routes");
const paymentTxnRoute = require("../src/routes/payment.route");
const salesTxnRoute = require("../src/routes/sales.routes");
const receiptTxnRoute = require("../src/routes/receipt.routes");
const creditNoteTxnRoute = require("../src/routes/creditNote.routes");
const debitNoteTxnRoute = require("../src/routes/debitNote.routes");
const contraTxnRoute = require("../src/routes/contra.routes");
const journalTxnRoute = require("../src/routes/journal.routes");
const partyTransactionReportRoute = require("./routes/partyTransactionReport.routes");
const transactionApprovalConfig = require("../src/routes/transaction-flow/transactionApprovalConfig.routes")
// for sales order request in apk
const transactionApproval = require("../src/routes/transaction-flow/transactionApproval.routes");
const visitTargetTemplate = require("../src/routes/visitTargetTemplate.routes");
const receiptApproval = require("../src/routes/transaction-flow/receiptApproval.routes");
const empPaymentHold = require("../src/routes/empPaymentHold.routes");
const transactionDocumentRoute = require("../src/routes/reports/transactionDocuments.routes");
const testRoute = require("../src/routes/test.route");

// Health check
app.get('/', (req, res) => {
  res.send('CRM API is running');
});

// Routes
app.use('/auth', authRoutes);
app.use('/department', departmentRoute);
app.use(jobRoleRoute);
app.use(userDocumentRoute);
app.use(pincodeRoute);
app.use(uploadEmpSalaryRoute);
app.use(empAttendanceRoute);
app.use(empSalaryRoute);
app.use(empDailySalaryRoute);
app.use(locationRoute);
app.use(uploadRoute);
app.use(documentRoute);
app.use(leegalityRoute);
app.use(leegalityWebhookRoute);

app.use(EmpExpensesRoute);
app.use(customerRoute);
app.use(visitRoute);
app.use(gstVerificationRoute);
app.use(distributorOnBoardingRoute);
app.use(panVerificationRoute);
app.use(digioVerificationRoute);
app.use(distributorDigioRoute);
app.use(companyRoute);
app.use(stockGroupRoute);
app.use(stockCategoryRoute);
app.use(teamRoute);
app.use(visitTargetRoute);
app.use(dailyReportRoute);
app.use(rollingUserRoute);
app.use(empTargetRoute);
app.use(godownRoute);
app.use(unitOfMeasureRoute);
app.use(stockItemRoute);
app.use(accountGroupRoute);
app.use(ledgerRoute);
app.use(voucherRoute);
app.use(materialManufacturingRoute);
app.use(stockTransferRoute);
app.use(retailerRoute);
app.use(retailerAssignmentRoute);
app.use(generateVoucherRoute);
app.use(purchaseTxnMasterRoute);
app.use(partyLedgerReportRoute);
app.use(paymentTxnRoute);
app.use(salesTxnRoute);
app.use(receiptTxnRoute);
app.use(creditNoteTxnRoute);
app.use(debitNoteTxnRoute);
app.use(contraTxnRoute);
app.use(journalTxnRoute);
app.use(partyTransactionReportRoute);
app.use(transactionApprovalConfig);
app.use(transactionApproval);
app.use(visitTargetTemplate);
app.use(receiptApproval);
app.use(empPaymentHold);
app.use(transactionDocumentRoute);
app.use(testRoute);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = app;