const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");

const voucherController =require("../controllers/generateVoucher.controller");

router.get( "/next-voucher-no", auth, voucherController.getNextVoucherNo );

module.exports = router;