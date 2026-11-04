const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const stockItemController = require("../controllers/stockItem.controller");
const auth = require("../middleware/auth.middleware");

router.post( "/create-stock-item", auth, checkPermission("CREATE_STOCK_ITEM"), stockItemController.createStockItem );
router.get( "/get-stock-items", auth, stockItemController.getStockItems );
router.get( "/getstockItemByID/:id", auth, stockItemController.getStockItemById);
router.put( "/update-stock-item/:id", auth, checkPermission("UPDATE_STOCK_ITEM"), stockItemController.updateStockItem );
router.delete( "/delete-stock-item/:id", auth, checkPermission("DELETE_STOCK_ITEM"), stockItemController.deleteStockItem);
router.get("/get-price-list", auth, stockItemController.getPriceList);


module.exports = router;