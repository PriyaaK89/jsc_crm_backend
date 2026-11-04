const express = require("express");
const router = express.Router();
const { checkAnyPermission, checkPermission } = require("../middleware/permission.middleware");
const { createVoucherType, getAllVoucherTypes, getVoucherTypeById, updateVoucherType, deleteVoucherType, getVoucherTypeDropdown, getVoucherByType, activateVoucher} = require("../controllers/voucherType.controller");
const auth = require("../middleware/auth.middleware");

router.post("/create_voucher", auth, checkPermission("CREATE_VOUCHER"), createVoucherType);
router.get("/get_voucher_list", auth, getAllVoucherTypes);
router.get("/get_voucher_details/:id", auth, checkAnyPermission(["VIEW_VOUCHER", "UPDATE_VOUCHER"]), getVoucherTypeById);
router.put("/update_voucher/:id", auth, checkPermission("UPDATE_VOUCHER"), updateVoucherType);
router.delete("/delete_voucher/:id", auth, checkPermission("DELETE_VOUCHER"), deleteVoucherType);

router.get(
  "/voucher-type-dropdown", auth,
  getVoucherTypeDropdown
);

router.get(
  "/voucher-by-type", auth,
  getVoucherByType
);

router.put(
  "/activate-voucher/:id", auth, checkPermission("UPDATE_VOUCHER"),
  activateVoucher
);

module.exports = router;