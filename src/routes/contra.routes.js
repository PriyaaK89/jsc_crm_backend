const express = require("express");
const router = express.Router();
const contraController = require("../controllers/contra.controller");
const auth = require("../middleware/auth.middleware");

router.post( "/create-contra-entry", auth , contraController.createContra);
router.get("/get-contra-account-dropdown", auth , contraController.getContraAccountDropdown);
router.get("/get-contra-voucher", contraController.getContraVoucher);
router.get( "/get-contra-invoice/:id", contraController.getContraInvoice );

module.exports = router;