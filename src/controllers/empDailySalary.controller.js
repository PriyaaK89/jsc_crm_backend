const SalaryDaily = require("../models/empDailySalary.model");
const db = require('../config/db');

exports.generateDailySalary = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { date } = req.body;

    if (!date) {
      return res.status(400).json({ message: "Date is required" });
    }

    const totalMinutes = attendance.working_minutes || 0;

const hours = Math.floor(totalMinutes / 60);
const minutes = totalMinutes % 60;

const formattedWorkingHours = `${hours} hr ${minutes} min`;
    const year = new Date(date).getFullYear();
    const month = new Date(date).getMonth() + 1;

    const [[lockedRow]] = await db.query(
      `SELECT salary_locked FROM emp_salary 
   WHERE employee_id = ? AND month = ? AND year = ?`,
      [employeeId, month, year],
    );

    if (lockedRow && lockedRow.salary_locked === 1) {
      return res.status(400).json({
        message: "Cannot generate daily salary. Month is locked.",
      });
    }

    const user = await SalaryDaily.getUserSalaryInfo(employeeId);
    if (!user) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const attendance = await SalaryDaily.getAttendanceByDate(employeeId, date);
    if (!attendance) {
      return res
        .status(400)
        .json({ message: "Attendance not found for this date" });
    }

    // const year = new Date(date).getFullYear();
    // const month = new Date(date).getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();

    const perDaySalary = Number(user.salary) / daysInMonth;

    let basicSalary = 0;
    let allowanceMultiplier = 0;

    //  Attendance Based Logic
    if (attendance.attendance_unit === "full") {
      basicSalary = perDaySalary;
      allowanceMultiplier = 1;
    } else if (attendance.attendance_unit === "half") {
      basicSalary = perDaySalary * 0.5;
      allowanceMultiplier = 0.5;
    } else if (attendance.attendance_unit === "leave") {
      // Check if this is first paid leave of month
      const [leaveCountResult] = await db.query(
        `SELECT COUNT(*) as leaveCount
         FROM emp_salary_daily
         WHERE employee_id = ?
         AND attendance_type = 'leave'
         AND MONTH(salary_date) = ?
         AND YEAR(salary_date) = ?`,
        [employeeId, month, year],
      );

      const leaveCount = leaveCountResult[0].leaveCount;

      if (leaveCount < 1) {
        // First leave → paid
        basicSalary = perDaySalary;
        allowanceMultiplier = 1;
      } else {
        // After first leave → unpaid
        basicSalary = 0;
      }
    } else {
      // Absent
      basicSalary = 0;
    }

    //  Allowances (Half if half day)
    const travelAllowance =
      (user.travelling_allowance_per_km || 0) *
      (user.avg_travel_km_per_day || 0) *
      allowanceMultiplier;

    const cityAllowance =
      (user.city_allowance_per_km || 0) * allowanceMultiplier;

    const dailyAllowance =
      (user.daily_allowance_with_doc || 0) * allowanceMultiplier;

    const hotelAllowance = (user.hotel_allowance || 0) * allowanceMultiplier;

    const grossSalary =
      basicSalary +
      travelAllowance +
      cityAllowance +
      dailyAllowance +
      hotelAllowance;

    //  No PF & ESI deduction here
    const netSalary = grossSalary;

    await SalaryDaily.saveDailySalary([
      employeeId,
      date,
      attendance.attendance_unit,
      // attendance.working_hours || "0 hr",
       formattedWorkingHours,
      perDaySalary.toFixed(2),
      basicSalary.toFixed(2),
      travelAllowance.toFixed(2),
      cityAllowance.toFixed(2),
      dailyAllowance.toFixed(2),
      hotelAllowance.toFixed(2),
      0,
      grossSalary.toFixed(2),
      netSalary.toFixed(2),
    ]);

    res.json({ message: "Daily salary generated successfully" });
  } catch (error) {
    console.error("Daily Salary Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getSalaryByDateRange = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { startDate, endDate } = req.query;

    if (!employeeId || !startDate || !endDate) {
      return res.status(400).json({
        message: "Employee ID, startDate and endDate are required",
      });
    }

    const data = await SalaryDaily.getSalaryByDateRange(
      employeeId,
      startDate,
      endDate
    );

    if (!data.length) {
      return res.status(404).json({
        message: "No salary records found for selected date range",
      });
    }

    return res.json({
      success: true,
      count: data.length,
      data,
    });

  } catch (error) {
    console.error("Get Salary Range Error:", error);
    return res.status(500).json({
      message: "Server error",
    });
  }
};