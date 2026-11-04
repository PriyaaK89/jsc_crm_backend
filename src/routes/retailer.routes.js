const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const auth = require("../middleware/auth.middleware");
const { createRetailer, getRetailers, getRetailerDetailsById, updateRetailer} = require("../controllers/retailer.controller");

router.post( "/create-retailer", auth, checkPermission("CREATE_RETAILER"), createRetailer );
router.get( "/get-retailer-list", auth, getRetailers);
router.get( "/getRetailerdetails/:id", auth, getRetailerDetailsById);
router.put( "/update-retailer/:id", auth, checkPermission("UPDATE_RETAILER"), updateRetailer);

module.exports = router;