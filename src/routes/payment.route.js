const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const paymentController = require("../controllers/payment.controller");
const auth = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");

router.post( "/create-payment", auth, checkPermission("CREATE_TRANSACTION"),  upload.single("attachment"), paymentController.createPayment);
router.get( "/bank-ledger-dropdown", auth, paymentController.getPaymentAccountDropdown );
router.get( "/bill-references/:ledgerId", auth, paymentController.getBillReferences);
router.get("/payment-invoice/print/:id", auth,  paymentController.getPaymentVoucher );

module.exports = router;
