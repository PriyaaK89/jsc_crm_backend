const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/payment.controller");
const auth = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");

router.post( "/create-payment",  upload.single("attachment"), auth, paymentController.createPayment);
router.get( "/bank-ledger-dropdown", auth, paymentController.getPaymentAccountDropdown );
router.get( "/bill-references/:ledgerId", auth, paymentController.getBillReferences);
router.get("/payment-invoice/print/:id",  paymentController.getPaymentVoucher );
router.get( "/payment/pdf/:id",  paymentController.generatePaymentPdf);

module.exports = router;
