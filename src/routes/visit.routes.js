const express = require("express");
const router = express.Router();
const { createVisit, getVisits, getMyVisits, getTodayVisit,getTodayVisitCount } = require("../controllers/visit.controller");
const upload = require("../middleware/upload.middleware");
const auth = require("../middleware/auth.middleware");


router.post("/upload-visit",auth,upload.single("image"), createVisit);
router.get("/get-emp-visit",auth, getVisits);
router.get("/my-visits", auth, getMyVisits);
router.get("/my-today-visit", auth, getTodayVisit);
router.get("/get-my-todayVisitCount", auth, getTodayVisitCount);

module.exports = router;