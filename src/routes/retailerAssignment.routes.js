const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const { assignRetailer, getRetailers } = require("../controllers/retailerAssignment.controller");

router.get(
  "/getRetailerlist",
  auth,
  getRetailers
);

router.post(
  "/assign-retailer",
  auth,
  assignRetailer
);

module.exports = router;