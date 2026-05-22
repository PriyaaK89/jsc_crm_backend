const router = require('express').Router();
const controller = require('../controllers/stockTransfer.controller');
const auth = require('../middleware/auth.middleware');

router.post('/create-stock-transfer', auth, controller.createStockTransfer);

module.exports = router