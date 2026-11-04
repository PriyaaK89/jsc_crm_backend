const express = require('express');
const router = express.Router();
const { checkPermissionOrSelf } = require("../middleware/permission.middleware");
const locationController = require('../controllers/location.controller');
const auth = require('../middleware/auth.middleware');

router.post('/save-location', auth, locationController.saveLocation);
router.get('/get-route', auth, checkPermissionOrSelf(["VIEW_EMPLOYEE_REPORT"], "employeeId"), locationController.getEmployeeRoute);

module.exports = router;