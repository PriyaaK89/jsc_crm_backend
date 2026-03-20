const express = require("express");
const router = express.Router();

const esignController = require("../controllers/esign.controller");
const digioEsignController = require("../controllers/digioEsign.controller");
const auth = require("../middleware/auth.middleware");

// Existing
router.post("/documents/send-esign", auth, esignController?.sendForESign);
router.get("/document-status/:documentId", auth, esignController?.checkLeegalityStatus);

// Digio
router.post("/letters/send-esign", auth, digioEsignController.sendForESign);
router.get("/letters/document-status/:documentId", auth, digioEsignController.checkDigioStatus);
router.get("/download-signed-pdf/:documentId", digioEsignController.downloadSignedPdf);

module.exports = router;