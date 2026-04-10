const express = require('express');
const router = express.Router();
const locationController = require('../controllers/location.controller');
const auth = require('../middleware/auth.middleware');

router.post('/save-location', auth, locationController.saveLocation);
router.get('/get-route',auth, locationController.getEmployeeRoute);

module.exports = router;