const Attendance = require("../models/empAttendance.model");
const uploadToS3 = require("../utils/S3Upload");
const { calculateAttendanceUnit } = require("../utils/attendanceCalculator");
const SalaryDaily = require("../models/empDailySalary.model");

const generateDailySalaryInternal = async (employeeId, date) => {
  const user = await SalaryDaily.getUserSalaryInfo(employeeId);
  if (!user) return;

  const attendance = await SalaryDaily.getAttendanceByDate(employeeId, date);
  if (!attendance) return;

  const year = new Date(date).getFullYear();
  const month = new Date(date).getMonth() + 1;

  //  Check if month locked
  const [[lockedRow]] = await require("../config/db").query(
    `SELECT salary_locked FROM emp_salary 
     WHERE employee_id = ? AND month = ? AND year = ?`,
    [employeeId, month, year],
  );

  if (lockedRow && lockedRow.salary_locked === 1) {
    return; // stop silently
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const perDaySalary = Number(user.salary) / daysInMonth;

  let basicSalary = 0;
  let allowanceMultiplier = 0;

  if (attendance.attendance_unit === "full") {
    basicSalary = perDaySalary;
    allowanceMultiplier = 1;
  } else if (attendance.attendance_unit === "half") {
    basicSalary = perDaySalary * 0.5;
    allowanceMultiplier = 0.5;
  } else {
    basicSalary = 0;
  }

  const travelAllowance =
    (user.travelling_allowance_per_km || 0) *
    (user.avg_travel_km_per_day || 0) *
    allowanceMultiplier;

  const cityAllowance = (user.city_allowance_per_km || 0) * allowanceMultiplier;

  const dailyAllowance =
    (user.daily_allowance_with_doc || 0) * allowanceMultiplier;

  const hotelAllowance = (user.hotel_allowance || 0) * allowanceMultiplier;

  const grossSalary =
    basicSalary +
    travelAllowance +
    cityAllowance +
    dailyAllowance +
    hotelAllowance;

  await SalaryDaily.saveDailySalary([
    employeeId,
    date,
    attendance.attendance_unit,
    attendance.working_minutes || "0 hr",
    perDaySalary.toFixed(2),
    basicSalary.toFixed(2),
    travelAllowance.toFixed(2),
    cityAllowance.toFixed(2),
    dailyAllowance.toFixed(2),
    hotelAllowance.toFixed(2),
    0,
    grossSalary.toFixed(2),
    grossSalary.toFixed(2),
  ]);
};

exports.markAttendance = async (req, res) => {
  try {
    const { employee_id, status } = req.body;

    if (!employee_id || !status) {
      return res.status(400).json({ message: "Required fields missing" });
    }

    const todayAttendance = await Attendance.getTodayAttendance(employee_id);

    /* ======================= LEAVE ======================= */
    if (status === "leave") {
      if (!req.body.leave_reason) {
        return res.status(400).json({ message: "Leave reason required" });
      }

      if (todayAttendance) {
        return res.status(400).json({ message: "Attendance already marked" });
      }

      await Attendance.createAttendance([
        employee_id,
        "leave",
        null, // work_type
        null, // field_work_type
        null, // travel_mode
        null, // vehicle_type
        null, // public_transport
        null, // odometer
        null, // visit_location
        null, // check_in_time
        req.body.leave_reason,
      ]);

      return res.json({ message: "Leave marked successfully" });
    }

    /* ======================= PRESENT ======================= */
    if (status === "present") {
      if (todayAttendance) {
        return res.status(400).json({ message: "Attendance already marked" });
      }

      const {
        work_type,
        field_work_type,
        travel_mode,
        vehicle_type,
        public_transport,
        odometer_reading,
        visit_location,
      } = req.body;

      if (!work_type) {
        return res.status(400).json({ message: "Work type required" });
      }

      if (work_type === "field" && !field_work_type) {
        return res.status(400).json({ message: "Field work type required" });
      }

      if (
        work_type === "field" &&
        travel_mode === "private" &&
        !odometer_reading
      ) {
        return res.status(400).json({ message: "Odometer reading required" });
      }

      const attendanceId = await Attendance.createAttendance([
        employee_id,
        "present",
        work_type,
        field_work_type,
        travel_mode,
        vehicle_type,
        public_transport,
        odometer_reading,
        visit_location,
        new Date(), // check_in_time
        null,
      ]);

      // Upload images to S3
      if (req.files) {
        for (const field in req.files) {
          const file = req.files[field][0];

          const s3Data = await uploadToS3(file, employee_id, "attendance");

          await Attendance.saveAttendanceImage([
            attendanceId,
            field,
            s3Data.bucket,
            s3Data.key,
            s3Data.url,
            s3Data.mimeType,
            s3Data.sizeKb,
          ]);
        }
      }

      return res.json({ message: "Attendance marked successfully" });
    }

    /* ======================= DAY OVER ======================= */
    if (status === "day_over") {
      if (!todayAttendance || todayAttendance.status !== "present") {
        return res.status(400).json({
          message: "Present attendance required before day over",
        });
      }

      if (todayAttendance.check_out_time) {
        return res.status(400).json({ message: "Day over already marked" });
      }

      const { day_over_odometer_reading, day_over_location } = req.body;

      if (
  todayAttendance.work_type === "field" &&
  todayAttendance.travel_mode === "private" &&
  !day_over_odometer_reading
) {
  return res.status(400).json({ message: "Odometer reading required" });
}

      // if (!req.files?.day_over_selfie || !req.files?.day_over_odometer) {
      //   return res.status(400).json({
      //     message: "Day over selfie and odometer image required",
      //   });
      // }
      if (!req.files?.day_over_selfie) {
  return res.status(400).json({
    message: "Day over selfie required",
  });
}

if (
  todayAttendance.work_type === "field" &&
  todayAttendance.travel_mode === "private" &&
  !req.files?.day_over_odometer
) {
  return res.status(400).json({
    message: "Day over odometer image required",
  });
}

      const checkIn = new Date(todayAttendance.check_in_time);
      const checkOut = new Date();
      const workingMinutes = Math.floor((checkOut - checkIn) / (1000 * 60));
      const { unit, late } = calculateAttendanceUnit({
        checkInTime: todayAttendance.check_in_time,
        workingMinutes,
      });

      if (workingMinutes <= 0) {
        return res.status(400).json({
          message: "Invalid working hours calculation",
        });
      }

      await Attendance.updateDayOver([
        workingMinutes,
        unit, // full / half / absent
        late, // 1 or 0
        day_over_odometer_reading,
        day_over_location,
        todayAttendance.id,
       
      ]);
      await generateDailySalaryInternal(
  employee_id,
  new Date().toISOString().split("T")[0]
);


      // Upload day-over images
      for (const field in req.files) {
        const file = req.files[field][0];

        const s3Data = await uploadToS3(file, employee_id, "attendance");

        await Attendance.saveAttendanceImage([
          todayAttendance.id,
          field,
          s3Data.bucket,
          s3Data.key,
          s3Data.url,
          s3Data.mimeType,
          s3Data.sizeKb,
        ]);
      }

      return res.json({
        message: "Day over marked successfully",
        working_minutes: workingMinutes,
      });
    }

    return res.status(400).json({ message: "Invalid attendance status" });
  } catch (error) {
    console.error("Attendance Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.getDayWiseAttendance = async (req, res) => {
  try {
    const { employeeId } = req.params;

    let { start_date, end_date, page = 1, limit = 10 } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({
        message: "start_date and end_date are required",
      });
    }

    page = Number(page);
    limit = Number(limit);
    const offset = (page - 1) * limit;

    const attendance = await Attendance.getDayWiseAttendance({
      employeeId,
      startDate: start_date,
      endDate: end_date,
      limit,
      offset,
    });

    const totalRecords = await Attendance.getDayWiseAttendanceCount(
      employeeId,
      start_date,
      end_date,
    );

    return res.json({
      employee_id: employeeId,
      start_date,
      end_date,
      pagination: {
        page,
        limit,
        total_records: totalRecords,
        total_pages: Math.ceil(totalRecords / limit),
      },
      attendance,
    });
  } catch (error) {
    console.error("Day-wise Attendance Error:", error);
    return res.status(500).json({
      message: "Server error",
    });
  }
};

exports.getMonthlyAttendanceSummary = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({
        message: "Month and year are required",
      });
    }

    const summary = await Attendance.getMonthlyAttendanceSummary(
      employeeId,
      month,
      year,
    );

    const [[user]] = await require("../config/db").query(
      `SELECT name FROM users WHERE id = ?`,
      [employeeId],
    );

    return res.json({
      employee_id: employeeId,
      employee_name: user?.name || null,
      month: Number(month),
      year: Number(year),
      summary: {
        full_days: Number(summary.full_days),
        half_days: Number(summary.half_days),
        absent_days: Number(summary.absent_days),
        leave_days: Number(summary.leave_days),
        total_working_days: Number(summary.total_days),
      },
    });
  } catch (error) {
    console.error("Monthly Summary Error:", error);
    return res.status(500).json({
      message: "Server error",
    });
  }
};
