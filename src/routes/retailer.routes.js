const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const { createRetailer, getRetailers, getRetailerDetailsById, updateRetailer} = require("../controllers/retailer.controller");

router.post( "/create-retailer", auth, createRetailer );
router.get( "/get-retailer-list", auth, getRetailers);
router.get( "/getRetailerdetails/:id", auth, getRetailerDetailsById);
router.put( "/update-retailer/:id", auth, updateRetailer);

module.exports = router;