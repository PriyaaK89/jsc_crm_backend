const express = require("express");
const router = express.Router();
const manufacturingController = require("../controllers/materialManufacturing.controller");
const auth = require('../middleware/auth.middleware');

router.get( "/get-stock-items/dropdown", auth, manufacturingController.getStockItemsDropdown );
router.get( "/get-stock-item/batches", auth, manufacturingController.getStockItemBatches);

router.post( "/create-material-mfg", auth, manufacturingController.createManufacturing);
router.get( "/get-available-stock", auth, manufacturingController.getAvailableStockQty);
router.get("/get-manufacturing-report", auth, manufacturingController.getManufacturingReport);

module.exports = router;