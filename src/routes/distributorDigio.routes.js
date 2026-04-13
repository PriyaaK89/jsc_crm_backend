const express = require("express");
const router = express.Router();

const {
  sendDistributorForESign,
  checkDistributorStatus,
  downloadDistributorSignedPdf
} = require("../controllers/distributorDigio.controller");

router.post("/distributor/send-esign", sendDistributorForESign);
router.get("/distributor/status/:distributor_id", checkDistributorStatus);
router.get("/distributor/download/:distributor_id", downloadDistributorSignedPdf);

module.exports = router;