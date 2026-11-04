const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const paymentHoldController = require("../controllers/empPaymentHold.controller");
const auth = require("../middleware/auth.middleware");
// If you have an admin-only guard (e.g. checkRole("admin")), add it here
// after `auth` on all three routes — this data directly changes payouts.
router.get("/payment-hold/search", auth, checkPermission("payment_hold_manage"), paymentHoldController.searchPaymentHold);
router.put("/payment-hold/update-amount", auth, checkPermission("payment_hold_manage"), paymentHoldController.updateAmount);
router.put("/payment-hold/toggle-status", auth, checkPermission("payment_hold_manage"), paymentHoldController.toggleStatus);
module.exports = router;