const router = require('express').Router();
const controller = require('../controllers/stockTransfer.controller');
const auth = require('../middleware/auth.middleware');

router.post('/create-stock-transfer', auth, controller.createStockTransfer);
router.get("/get-stock-transfer-report", auth, controller.getStockTransferReport)

module.exports = router