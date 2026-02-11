const Salary = require("../models/empSalary.model");

exports.calculateMonthlySalary = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({
        message: "Month and year are required",
      });
    }

    //  Get user salary + allowance info
    const user = await Salary.getUserSalaryInfo(employeeId);

    if (!user || !user.salary) {
      return res.status(404).json({
        message: "Employee salary not found",
      });
    }

    //  Get attendance
    const attendance = await Salary.getMonthlyAttendanceCounts(
      employeeId,
      month,
      year
    );

    const fullDays = Number(attendance.full_days) || 0;
    const halfDays = Number(attendance.half_days) || 0;
    const absentDays = Number(attendance.absent_days) || 0;
    const leaveDays = Number(attendance.leave_days) || 0;

    const totalDays = fullDays + halfDays + absentDays + leaveDays;

    if (totalDays <= 0) {
      return res.status(400).json({
        message: "No attendance found for this month",
      });
    }

    //  Salary calculation
    const payableDays = fullDays + halfDays * 0.5;
    const perDaySalary = Number(user.salary) / totalDays;
    const grossSalary = payableDays * perDaySalary;

    //  Allowance calculations (FORCED NUMBERS)
    const travelPerKm = Number(user.travelling_allowance_per_km) || 0;
    const avgKm = Number(user.avg_travel_km_per_day) || 0;
    const cityPerKm = Number(user.city_allowance_per_km) || 0;
    const dailyWithDoc = Number(user.daily_allowance_with_doc) || 0;
    const hotelPerDay = Number(user.hotel_allowance) || 0;

    const travelAllowance = travelPerKm * avgKm * payableDays;
    const cityAllowance = cityPerKm * payableDays;
    const dailyAllowance = dailyWithDoc * payableDays;
    const hotelAllowance = hotelPerDay * payableDays;

    const totalAllowances =
      travelAllowance +
      cityAllowance +
      dailyAllowance +
      hotelAllowance;

    // Deductions
    const pf = Number(user.pf) || 0;
    const esi = Number(user.esi) || 0;
    const totalDeductions = pf + esi;

    //  Net salary
    const netSalary =
      grossSalary + totalAllowances - totalDeductions;

    //  Save salary (MATCHES TABLE + INSERT)
    await Salary.saveMonthlySalary([
      employeeId,
      month,
      year,

      user.salary,
      perDaySalary.toFixed(2),

      fullDays,
      halfDays,
      absentDays,
      leaveDays,

      payableDays,
      grossSalary.toFixed(2),

      travelAllowance.toFixed(2),
      cityAllowance.toFixed(2),
      dailyAllowance.toFixed(2),
      hotelAllowance.toFixed(2),
      totalAllowances.toFixed(2),

      pf,
      esi,
      totalDeductions,
      netSalary.toFixed(2),
    ]);

    //  Response
    return res.json({
      employee_id: employeeId,
      employee_name: user.name,
      month,
      year,
      salary_breakdown: {
        basic_salary: user.salary,
        per_day_salary: perDaySalary.toFixed(2),
        attendance: {
          full_days: fullDays,
          half_days: halfDays,
          absent_days: absentDays,
          leave_days: leaveDays,
          payable_days: payableDays,
        },
        gross_salary: grossSalary.toFixed(2),
        allowances: {
          travelling: travelAllowance.toFixed(2),
          city: cityAllowance.toFixed(2),
          daily: dailyAllowance.toFixed(2),
          hotel: hotelAllowance.toFixed(2),
          total: totalAllowances.toFixed(2),
        },
        deductions: {
          pf,
          esi,
          total: totalDeductions,
        },
        net_salary: netSalary.toFixed(2),
      },
    });
  } catch (error) {
    console.error("Salary Error:", error);
    return res.status(500).json({
      message: "Server error",
    });
  }
};
