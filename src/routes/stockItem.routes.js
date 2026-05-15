const express = require("express");

const router = express.Router();

const stockItemController =
require("../controllers/stockItem.controller");



// CREATE
router.post(
    "/create-stock-item",
    stockItemController.createStockItem
);



// GET LIST
router.get(
    "/get-stock-items",
    stockItemController.getStockItems
);



// GET DETAILS
router.get(
    "/getstockItemByID/:id",
    stockItemController.getStockItemById
);



// UPDATE
router.put(
    "/update-stock-item/:id",
    stockItemController.updateStockItem
);



// DELETE
router.delete(
    "/delete-stock-item/:id",
    stockItemController.deleteStockItem
);



module.exports = router;