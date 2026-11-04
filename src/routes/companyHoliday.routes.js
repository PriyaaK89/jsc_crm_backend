const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/permission.middleware");
const holidayController = require("../controllers/holiday-calendar/companyHoliday.controller");
const holidaySuggestion = require("../controllers/holiday-calendar/festivalSuggestion.controller");
const auth = require("../middleware/auth.middleware");

router.get("/get-holidays", auth, holidayController.getHolidays);
router.post("/add-holidays", auth, checkPermission("CREATE_HOLIDAY"), holidayController.addHolidays);
router.put("/update-holidays/:id", auth, checkPermission("UPDATE_HOLIDAY"), holidayController.updateHoliday);
router.delete("/delete-holidays/:id", auth, checkPermission("DELETE_HOLIDAY"), holidayController.deleteHoliday);
router.get("/get-holidays-yearly", auth, holidayController.getYearlyHolidays);

router.get("/festival-suggestions", auth, holidaySuggestion.getFestivalSuggestions);

module.exports = router;