const Salary = require("../models/EmpSalary.model");


exports.calculateMonthlySalary = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({
        message: "Month and year are required",
      });
    }

    const user = await Salary.getUserSalaryInfo(employeeId);

    if (!user) {
      return res.status(404).json({
        message: "Employee not found",
      });
    }

    // 🔹 Get totals from daily salary table
    const summary = await Salary.getMonthlySalarySummary(
      employeeId,
      month,
      year
    );

    if (!summary || !summary.total_gross) {
      return res.status(400).json({
        message: "No daily salary records found for this month",
      });
    }

    const fullDays = Number(summary.full_days) || 0;
    const halfDays = Number(summary.half_days) || 0;
    const absentDays = Number(summary.absent_days) || 0;
    const leaveDays = Number(summary.leave_days) || 0;

    const totalBasic = Number(summary.total_basic) || 0;
    const totalTravel = Number(summary.total_travel) || 0;
    const totalCity = Number(summary.total_city) || 0;
    const totalDaily = Number(summary.total_daily) || 0;
    const totalHotel = Number(summary.total_hotel) || 0;

    const grossSalary = Number(summary.total_gross) || 0;

    //  Monthly Deductions
    const pf = Number(user.pf) || 0;
    const esi = Number(user.esi) || 0;
    const totalDeductions = pf + esi;

    const netSalary = grossSalary - totalDeductions;

    //  Save into emp_salary table
    await Salary.saveMonthlySalary([
      employeeId,
      month,
      year,

      user.salary,             // monthly basic salary (original)
      0,                       // per_day_salary (not needed now)

      fullDays,
      halfDays,
      absentDays,
      leaveDays,

      fullDays + halfDays * 0.5,  // payable_days

      grossSalary.toFixed(2),

      totalTravel.toFixed(2),
      totalCity.toFixed(2),
      totalDaily.toFixed(2),
      totalHotel.toFixed(2),

      (totalTravel + totalCity + totalDaily + totalHotel).toFixed(2),

      pf,
      esi,
      totalDeductions,
      netSalary.toFixed(2),
    ]);

    return res.json({
      message: "Monthly salary calculated successfully",
      employee_id: employeeId,
      month,
      year,
      attendance: {
        full_days: fullDays,
        half_days: halfDays,
        absent_days: absentDays,
        leave_days: leaveDays,
      },
      salary_breakdown: {
        total_basic: totalBasic.toFixed(2),
        total_allowances: (
          totalTravel +
          totalCity +
          totalDaily +
          totalHotel
        ).toFixed(2),
        gross_salary: grossSalary.toFixed(2),
        total_deductions: totalDeductions,
        net_salary: netSalary.toFixed(2),
      },
    });

  } catch (error) {
    console.error("Monthly Salary Error:", error);
    return res.status(500).json({
      message: "Server error",
    });
  }
};


exports.lockMonthlySalary = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { month, year } = req.body;

    // Check if salary exists
    const [[row]] = await db.query(
      `SELECT id FROM emp_salary 
       WHERE employee_id = ? AND month = ? AND year = ?`,
      [employeeId, month, year]
    );

    if (!row) {
      return res.status(400).json({
        message: "Generate monthly salary before locking"
      });
    }

    await db.query(
      `UPDATE emp_salary
       SET salary_locked = 1
       WHERE employee_id = ? AND month = ? AND year = ?`,
      [employeeId, month, year]
    );

    res.json({ message: "Salary locked successfully" });

  } catch (error) {
    console.error("Lock Salary Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
