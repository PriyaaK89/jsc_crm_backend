const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const contraController = require("../controllers/contra.controller");
const auth = require("../middleware/auth.middleware");

router.post( "/create-contra-entry", auth, checkPermission("CREATE_TRANSACTION"), contraController.createContra);
router.get("/get-contra-account-dropdown", auth , contraController.getContraAccountDropdown);
router.get("/get-contra-voucher", auth, contraController.getContraVoucher);
router.get( "/get-contra-invoice/:id", auth, contraController.getContraInvoice );

module.exports = router;