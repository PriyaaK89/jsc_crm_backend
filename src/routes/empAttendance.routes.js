const express = require("express");
const router = express.Router();
const { checkAdmin, checkPermission, checkPermissionOrSelf } = require("../middleware/permission.middleware");
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
router.get( "/get-emp-attendance", auth, checkPermission("VIEW_ATTENDANCE_REPORT"), attendanceController.getDayWiseAttendance);
router.get( "/get-attendance-images/:employeeId", auth, checkPermissionOrSelf(["VIEW_ATTENDANCE_REPORT"], "employeeId"), attendanceController.getAttendanceImagesByDate);
router.get( "/my-attendance", auth, attendanceController.getMyAttendance);
router.get( "/attendance/monthly-summary/:employeeId", auth, checkPermissionOrSelf(["VIEW_ATTENDANCE_REPORT"], "employeeId"), attendanceController.getMonthlyAttendanceSummary);
router.get("/daily-summary", auth, checkPermission("VIEW_ATTENDANCE_REPORT"), attendanceController.getDailyAttendanceSummary);
router.get( "/today-attendance/:employee_id", auth, checkPermissionOrSelf(["VIEW_ATTENDANCE_REPORT"], "employee_id"), attendanceController.getTodayAttendance);
router.get( "/my-team-attendance", auth, attendanceController.getMyTeamAttendance );
router.get("/get-my-today-attendance/:employee_id", auth, checkPermissionOrSelf(["VIEW_ATTENDANCE_REPORT"], "employee_id"), attendanceController.getMyTodayAttendance);

router.get("/test-sunday-salary", auth, checkAdmin, async (req, res) => {
  try {
    await attendanceController.generateDailySalaryInternal(1, "2026-05-31"); // real employee id, last sunday
    res.json({ message: "done, check console logs" });
  } catch(err) {
    res.json({ error: err.message });
  }
});

module.exports = router;