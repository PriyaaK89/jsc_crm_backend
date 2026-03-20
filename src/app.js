const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middlewares

app.use(cors());

const digioWebhookRoute = require("../src/routes/digiowebhook.routes");
app.use(digioWebhookRoute);
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
const panVerificationRoute = require("../src/routes/panVerification.routes");
const digioPanVerificationRoute = require("../src/routes/digioPan.routes");
const EmpExpensesRoute = require("../src/routes/EmpExpense.route");

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
app.use(panVerificationRoute);
app.use(digioPanVerificationRoute);
app.use(EmpExpensesRoute);



// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = app;
