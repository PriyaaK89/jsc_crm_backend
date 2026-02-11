const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


const departmentRoute = require("../src/routes/department.routes");
const jobRoleRoute = require("../src/routes/jobRole.routes");
const authRoutes = require('../src/routes/auth.routes');
const userDocumentRoute = require("../src/routes/userDocument.routes");
const pincodeRoute = require("../src/routes/pincode.routes");
const uploadEmpSalaryRoute = require("../src/routes/uploadEmpSalary.routes");
const empAttendanceRoute = require("../src/routes/empAttendance.routes");
const empSalaryRoute = require("../src/routes/empSalary.route")

// Health check
app.get('/', (req, res) => {
  res.send('CRM API is running');
});


// Routes
app.use('/auth', authRoutes);
app.use('/department', departmentRoute);
app.use( jobRoleRoute);
app.use(userDocumentRoute);
app.use(pincodeRoute);
app.use(uploadEmpSalaryRoute);
app.use(empAttendanceRoute);
app.use(empSalaryRoute);


// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = app;
