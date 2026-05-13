const express = require("express");
const router = express.Router();
const stockItemController = require("../controllers/stockItem.controller");

router.post( "/create-stock-item",  stockItemController.createStockItem);

module.exports = router;