const express = require("express");
const router = express.Router();
const { getMyMonthSummary } = require("../controllers/monthSummary.controller");
const auth = require("../middleware/auth.middleware"); // use your existing auth middleware

router.get("/my-month-summary", auth, getMyMonthSummary);

module.exports = router;