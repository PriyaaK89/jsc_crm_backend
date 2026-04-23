const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());

// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

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

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = app;