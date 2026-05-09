const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const controller = require("../controllers/empTarget.controller")
const { allowRoles } = require('../middleware/role.middleware');

router.post('/assign-employee-target', auth, allowRoles('SUPER_ADMIN', 'ADMIN'), controller.createEmployeeTarget);

module.exports = router;