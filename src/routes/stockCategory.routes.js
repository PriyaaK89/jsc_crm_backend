const express = require("express");
const router = express.Router();
const { checkAnyPermission, checkPermission } = require("../middleware/permission.middleware");
const controller = require("../controllers/stockCategory.controller");
const auth = require("../middleware/auth.middleware");

router.post("/create-stock-category", auth, checkPermission("CREATE_STOCK_CATEGORY"), controller.createStockCategory);

router.get("/get-stock-categories", auth, controller.getAllStockCategories);
router.get("/get-stock-category/:id", auth, checkAnyPermission(["VIEW_STOCK_CATEGORY", "UPDATE_STOCK_CATEGORY"]), controller.getStockCategoryById);

router.put("/update-stock-category/:id", auth, checkPermission("UPDATE_STOCK_CATEGORY"), controller.updateStockCategory);
router.delete("/delete-stock-category/:id", auth, checkPermission("DELETE_STOCK_CATEGORY"), controller.deleteStockCategory);

router.get( "/get-categories-by-stock-group/:stock_group_id", auth, controller.getCategoriesByStockGroup);

module.exports = router;