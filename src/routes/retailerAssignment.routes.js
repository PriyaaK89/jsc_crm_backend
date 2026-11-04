const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const auth = require("../middleware/auth.middleware");
const { assignRetailer, getRetailers } = require("../controllers/retailerAssignment.controller");

router.get(
  "/getRetailerlist",
  auth,
  getRetailers
);

router.post(
  "/assign-retailer", auth, checkPermission("UPDATE_RETAILER"),
  assignRetailer
);

module.exports = router;