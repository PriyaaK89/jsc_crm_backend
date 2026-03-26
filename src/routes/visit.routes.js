const express = require("express");
const router = express.Router();
const { createVisit, getVisits } = require("../controllers/visit.controller");
const upload = require("../middleware/upload.middleware");
const auth = require("../middleware/auth.middleware");


router.post("/upload-visit",auth,upload.single("image"), createVisit);
router.get("/get-emp-visit",auth, getVisits)

module.exports = router;