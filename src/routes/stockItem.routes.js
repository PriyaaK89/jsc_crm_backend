const express = require("express");

const router = express.Router();

const stockItemController =
    require("../controllers/stockItem.controller");
const auth = require("../middleware/auth.middleware");



// CREATE
router.post(
    "/create-stock-item", auth,
    stockItemController.createStockItem
);



// GET LIST
router.get(
    "/get-stock-items", auth,
    stockItemController.getStockItems
);



// GET DETAILS
router.get(
    "/getstockItemByID/:id", auth,
    stockItemController.getStockItemById
);



// UPDATE
router.put(
    "/update-stock-item/:id", auth,
    stockItemController.updateStockItem
);



// DELETE
router.delete(
    "/delete-stock-item/:id", auth,
    stockItemController.deleteStockItem
);



module.exports = router;