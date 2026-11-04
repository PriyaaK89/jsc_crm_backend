const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const auth = require("../middleware/auth.middleware");

const {
  sendDistributorForESign,
  checkDistributorStatus,
  downloadDistributorSignedPdf
} = require("../controllers/distributorDigio.controller");

router.post("/distributor/send-esign", auth, checkPermission("UPDATE_DISTRIBUTOR"), sendDistributorForESign);
router.get("/distributor/status/:distributor_id", auth, checkPermission("VIEW_DISTRIBUTOR"), checkDistributorStatus);
router.get("/distributor/download/:distributor_id", auth, checkPermission("VIEW_DISTRIBUTOR"), downloadDistributorSignedPdf);

module.exports = router;