const express = require("express");
const router = express.Router();
const controller = require("../controllers/stockCategory.controller");
const auth = require("../middleware/auth.middleware");

router.post("/create-stock-category", auth, controller.createStockCategory);

router.get("/get-stock-categories", auth, controller.getAllStockCategories);
router.get("/get-stock-category/:id", auth, controller.getStockCategoryById);

router.put("/update-stock-category/:id", auth, controller.updateStockCategory);
router.delete("/delete-stock-category/:id", auth, controller.deleteStockCategory);

router.get( "/get-categories-by-stock-group/:stock_group_id", auth, controller.getCategoriesByStockGroup);

module.exports = router;