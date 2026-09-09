const express = require("express");
const router = express.Router();
 
const paymentHoldController = require("../controllers/empPaymentHold.controller");
const auth = require("../middleware/auth.middleware");
// If you have an admin-only guard (e.g. checkRole("admin")), add it here
// after `auth` on all three routes — this data directly changes payouts.
 
router.get("/payment-hold/search", auth, paymentHoldController.searchPaymentHold);
router.put("/payment-hold/update-amount", auth, paymentHoldController.updateAmount);
router.put("/payment-hold/toggle-status", auth, paymentHoldController.toggleStatus);
 
module.exports = router;