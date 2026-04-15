const express = require("express");
const router = express.Router();
const controller = require("../controllers/stockGroup.controller");
const auth = require("../middleware/auth.middleware");

router.post("/create-stockGroup", auth, controller.createStockGroup);
router.get("/get-stockGroup", auth, controller.getStockGroupsDropdown);

router.get("/get-stockGroup/:id", auth, controller.getStockGroupById);
router.put("/update-stockGroup/:id", auth, controller.updateStockGroup);
router.delete("/delete-stockGroup/:id", auth, controller.deleteStockGroup);

module.exports = router;