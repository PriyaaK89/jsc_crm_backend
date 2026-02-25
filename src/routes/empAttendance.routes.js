const express = require("express");
const router = express.Router();
const attendanceController = require("../controllers/empAttendance.controller");
const upload = require("../middleware/upload.middleware");
const auth = require('../middleware/auth.middleware');

router.post("/mark-emp-attendance", auth, (req, res) => {
  upload.fields([
    { name: "office_selfie", maxCount: 1 },
    { name: "field_selfie", maxCount: 1 },
    { name: "odometer", maxCount: 1 },
    { name: "day_over_selfie", maxCount: 1 },
    { name: "day_over_odometer", maxCount: 1 }
  ])(req, res, function (err) {

    if (err) {
      console.error("Multer Error:", err);
      return res.status(400).json({
        message: err.message || "File upload error"
      });
    }

    attendanceController.markAttendance(req, res);
  });
});
router.get( "/attendance/daywise/:employeeId", auth, attendanceController.getDayWiseAttendance);
router.get( "/attendance/monthly-summary/:employeeId", auth, attendanceController.getMonthlyAttendanceSummary);
router.get( "/get-attendance-images/:employeeId", auth, attendanceController.getAttendanceImagesByDate);

module.exports = router;
