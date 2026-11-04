const express = require("express");
const router = express.Router();
const { checkAnyPermission, checkPermission } = require("../middleware/permission.middleware");
const controller = require("../controllers/stockGroup.controller");
const auth = require("../middleware/auth.middleware");

router.post("/create-stockGroup", auth, checkPermission("CREATE_STOCK_GROUP"), controller.createStockGroup);
router.get("/get-stockGroup", auth, controller.getStockGroupsDropdown);

router.get("/get-stockGroup/:id", auth, checkAnyPermission(["VIEW_STOCK_GROUP", "UPDATE_STOCK_GROUP"]), controller.getStockGroupById);
router.put("/update-stockGroup/:id", auth, checkPermission("UPDATE_STOCK_GROUP"), controller.updateStockGroup);
router.delete("/delete-stockGroup/:id", auth, checkPermission("DELETE_STOCK_GROUP"), controller.deleteStockGroup);

module.exports = router;