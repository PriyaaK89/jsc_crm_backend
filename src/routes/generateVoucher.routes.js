const express = require("express");
const router = express.Router();

const voucherController =require("../controllers/generateVoucher.controller");

router.get( "/next-voucher-no", voucherController.getNextVoucherNo );

module.exports = router;