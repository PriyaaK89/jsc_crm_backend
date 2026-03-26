const express = require("express");
const router = express.Router();
const PincodeController = require("../controllers/pincode.controller");

router.get("/getstatecity/:pincode", PincodeController.getByPincode);

router.get("/district", PincodeController.getByDistrict);
router.get("/areas", PincodeController.getAreasByPincode);

router.get("/get-districts", PincodeController.getDistricts);

module.exports = router;
