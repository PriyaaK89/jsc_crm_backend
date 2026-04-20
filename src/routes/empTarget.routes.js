const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");

router.post('/employee-target', auth, allowRoles('SUPER_ADMIN', 'ADMIN'), controller.createEmployeeTarget);

module.exports = router;