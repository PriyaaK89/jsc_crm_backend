const router = require('express').Router();
const { checkPermission } = require("../middleware/permission.middleware");
const controller = require('../controllers/stockTransfer.controller');
const auth = require('../middleware/auth.middleware');

router.post('/create-stock-transfer', auth, checkPermission("CREATE_STOCK_TRANSFER"), controller.createStockTransfer);
router.get("/get-stock-transfer-report", auth, controller.getStockTransferReport)

module.exports = router