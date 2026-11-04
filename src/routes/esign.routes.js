const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");

const esignController = require("../controllers/esign.controller");
const digioEsignController = require("../controllers/digioEsign.controller");
const auth = require("../middleware/auth.middleware");

// Existing
router.post("/documents/send-esign", auth, checkPermission("hr_letter_manage"), esignController?.sendForESign);
router.get("/document-status/:documentId", auth, checkPermission("hr_letter_manage"), esignController?.checkLeegalityStatus);

// Digio
router.post("/letters/send-esign", auth, checkPermission("hr_letter_manage"), digioEsignController.sendForESign);
router.get("/letters/document-status/:documentId", auth, checkPermission("hr_letter_manage"), digioEsignController.checkDigioStatus);
router.get("/download-signed-pdf/:documentId", digioEsignController.downloadSignedPdf);

module.exports = router;