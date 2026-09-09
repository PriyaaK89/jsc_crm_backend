const express = require("express");
const router = express.Router();
const { runRemindersNow } = require("../controllers/reminder.controller");

// TODO: add your auth/admin-only middleware here, same as your other
// sensitive routes — this endpoint sends real WhatsApp messages to real
// customers, it shouldn't be publicly callable.
router.post("/run-now", runRemindersNow);

module.exports = router;