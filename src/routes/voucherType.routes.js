const express = require("express");
const router = express.Router();
const { createVoucherType, getAllVoucherTypes, getVoucherTypeById, updateVoucherType, deleteVoucherType, getVoucherTypeDropdown, getVoucherByType, activateVoucher} = require("../controllers/voucherType.controller");
const auth = require("../middleware/auth.middleware");

router.post("/create_voucher",auth, createVoucherType);
router.get("/get_voucher_list", auth, getAllVoucherTypes);
router.get("/get_voucher_details/:id", auth, getVoucherTypeById);
router.put("/update_voucher/:id", auth, updateVoucherType);
router.delete("/delete_voucher/:id", auth, deleteVoucherType);

router.get(
  "/voucher-type-dropdown",
  getVoucherTypeDropdown
);

router.get(
  "/voucher-by-type",
  getVoucherByType
);

router.put(
  "/activate-voucher/:id",
  activateVoucher
);

module.exports = router;