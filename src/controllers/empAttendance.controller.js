const Attendance = require("../models/empAttendance.model");
const { calculateAttendanceUnit } = require("../utils/attendanceCalculator");
const SalaryDaily = require("../models/empDailySalary.model");
const db = require("../config/db");
const { getHierarchyIds } = require("../controllers/rollingUser.controller");
const { uploadFileToMinio, getPresignedUrl } = require("../utils/fileUpload");
const userModal = require("../models/user.model")

const generateDailySalaryInternal = async (employeeId, date) => {
  const user = await SalaryDaily.getUserSalaryInfo(employeeId);
  console.log("USER =>", employeeId, user ? "found" : "NOT FOUND");
  if (!user) return;

  const attendance = await SalaryDaily.getAttendanceByDate(employeeId, date);
  console.log("ATTENDANCE =>", employeeId, date, attendance);
  if (!attendance) return;

  const year = new Date(date).getFullYear();
  const month = new Date(date).getMonth() + 1;

  // Check if month locked
  const [[lockedRow]] = await require("../config/db").query(
    `SELECT salary_locked FROM emp_salary 
     WHERE employee_id = ? AND month = ? AND year = ?`,
    [employeeId, month, year],
  );

  if (lockedRow && lockedRow.salary_locked === 1) return;

  /* ---------- NEW: Payment Hold awareness (fail-open) ---------- */
  // If an admin has edited or held SALARY/TA/DA for this date via the
  // Payment Hold screen, this regeneration must not silently overwrite
  // that decision with a fresh attendance-based calculation.
  // Wrapped so any failure here (missing table, bad data, DB hiccup)
  // can never block attendance submission or daily salary generation —
  // it just falls back to the normal freshly-calculated values.
  let holdByType = {};
  let existingSalaryRow = null;

  try {
    const [holdRows] = await db.query(
      `SELECT type, status FROM emp_payment_hold WHERE employee_id = ? AND salary_date = ?`,
      [employeeId, date]
    );
    holdRows.forEach((r) => (holdByType[r.type] = r));

    const [[row]] = await db.query(
      `SELECT basic_salary, travelling_allowance, daily_allowance
     FROM emp_salary_daily WHERE employee_id = ? AND salary_date = ?`,
      [employeeId, date]
    );
    existingSalaryRow = row;
  } catch (error) {
    console.error(
      "PAYMENT HOLD CHECK FAILED =>", employeeId, date,
      error.sqlMessage || error.message
    );
    // fail-open: holdByType stays {}, existingSalaryRow stays null,
    // so the code below just uses the fresh attendance-based calculation
    // as if no hold existed — salary still generates.
  }
  /* --------------------------------------------------------------- */

  const daysInMonth = new Date(year, month, 0).getDate();

  const yearlySalary = Number(user.salary);
  const monthlySalary = yearlySalary / 12;
  const perDaySalary = monthlySalary / daysInMonth;

  let basicSalary = 0;

  if (attendance.attendance_unit === "full") {
    basicSalary = perDaySalary;
  } else if (attendance.attendance_unit === "half") {
    basicSalary = perDaySalary * 0.5;
  } else if (attendance.attendance_unit === "week_off") {
    basicSalary = perDaySalary;
  } else if (["absent", "leave"].includes(attendance.attendance_unit)) {
    basicSalary = 0;
    // Still continue — don't return early — so a ₹0 row gets saved
  }

  /* ---------- Working Hours Format ---------- */
  const totalMinutes = attendance.working_minutes || 0;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const formattedWorkingHours = `${hours} hr ${minutes} min`;

  /* ---------- Travel & Daily Allowance ---------- */
  let travelAllowance = 0;
  let dailyAllowance = 0;
  let totalReading = 0;

  if (attendance.attendance_unit !== "week_off" && attendance.check_out_time && attendance.work_type !== "wfh") {
    const startKm = Number(attendance.odometer_reading) || 0;
    const endKm = Number(attendance.day_over_odometer_reading) || 0;

    let travelledKm = endKm - startKm;

    if (travelledKm < 0) {
      travelledKm = 0;
    }

    totalReading = travelledKm;

    // Normalize vehicle type (prevents mismatch bugs)
    const vehicleType = (attendance.vehicle_type || "").toLowerCase();

    const rateMap = {
      two_wheeler: Number(user.two_wheeler_allowance_per_km) || 0,
      four_wheeler: Number(user.four_wheeler_allowance_per_km) || 0,
    };

    const perKmRate = rateMap[vehicleType] || 0;

    /* ---------- VALIDATION (No silent failure) ---------- */
    if (travelledKm > 0) {
      if (!vehicleType) {
        console.error(
          ` vehicle_type missing for employee ${employeeId} on ${date}`,
        );
      }

      if (!rateMap.hasOwnProperty(vehicleType)) {
        console.error(` Invalid vehicle_type: ${attendance.vehicle_type}`);
      }

      if (perKmRate === 0) {
        console.error(` Per KM rate is 0 for vehicle_type: ${vehicleType}`);
      }
    }

    //  Travel Allowance (ALWAYS FULL - as per your requirement)
    travelAllowance = travelledKm * perKmRate;

    //  Daily Allowance (ONLY for FULL DAY)
    if (
      attendance.attendance_unit === "full" &&
      travelledKm >= (user.avg_travel_km_per_day || 0)
    ) {
      dailyAllowance = Number(user.daily_allowance_with_doc) || 0;
    } else {
      dailyAllowance = 0;
    }

    /* ---------- Debug Logs ---------- */
    console.log({
      employeeId,
      date,
      vehicleType,
      travelledKm,
      perKmRate,
      travelAllowance,
      dailyAllowance,
    });
  }

  /* ---------- NEW: Apply Payment Hold overrides ---------- *
   * Must run AFTER the attendance-driven calculation above and
   * BEFORE expenses/gross/net, so a held field is forced to 0 and
   * an edited-but-not-held field keeps its current stored value
   * instead of being replaced by the recalculated figure.
   */
  if (holdByType.SALARY) {
    basicSalary = holdByType.SALARY.status === "HOLD"
      ? 0
      : Number(existingSalaryRow?.basic_salary ?? basicSalary);
  }

  if (holdByType.TA) {
    travelAllowance = holdByType.TA.status === "HOLD"
      ? 0
      : Number(existingSalaryRow?.travelling_allowance ?? travelAllowance);
  }

  if (holdByType.DA) {
    dailyAllowance = holdByType.DA.status === "HOLD"
      ? 0
      : Number(existingSalaryRow?.daily_allowance ?? dailyAllowance);
  }
  /* --------------------------------------------------------- */

  /* ---------- Expense Calculation ---------- */

  let hotelExpense = 0;
  let otherExpense = 0;
  let busTrainTollExpense = 0;

  const [expenses] = await db.query(
    `
  SELECT
    expense_type,
    SUM(amount) as total
  FROM employee_expense_entries
  WHERE user_id = ?
    AND DATE(expense_date) = ?
    AND status = 'APPROVED'
    AND hold_status = 'UNHOLD'
  GROUP BY expense_type
  `,
    [employeeId, date]
  );

  for (const exp of expenses) {

    const amount = Number(exp.total) || 0;

    if (exp.expense_type === "HOTEL") {
      hotelExpense = amount;
    }

    if (exp.expense_type === "OTHER") {
      otherExpense = amount;
    }

    if (exp.expense_type === "BUS_TRAIN_TOLL") {
      busTrainTollExpense = amount;
    }
  }

  /* ---------- Final Salary ---------- */
  const grossSalary = basicSalary + travelAllowance + dailyAllowance + hotelExpense +
    otherExpense +
    busTrainTollExpense;
  const netSalary = grossSalary;

  try {
    await SalaryDaily.saveDailySalary([
      employeeId,
      date,
      attendance.attendance_unit,
      formattedWorkingHours,
      perDaySalary.toFixed(2),
      basicSalary.toFixed(2),
      travelAllowance.toFixed(2),
      dailyAllowance.toFixed(2),

      hotelExpense.toFixed(2),
      otherExpense.toFixed(2),
      busTrainTollExpense.toFixed(2),
      totalReading.toFixed(2),

      grossSalary.toFixed(2),
      netSalary.toFixed(2),
    ]);
    console.log("SAVED OK =>", employeeId, date);

  } catch (error) {
    // console.error("SAVE FAILED =>", employeeId, date, err.sqlMessage);
    console.error("SAVE FAILED =>", employeeId, date, error.sqlMessage, error.message);
  }

};

const autoClosePreviousDay = async (employeeId) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const dateStr = yesterday.toISOString().split("T")[0];

  const attendance = await SalaryDaily.getAttendanceByDate(employeeId, dateStr);

  if (
    attendance &&
    attendance.status === "present" &&
    attendance.check_in_time && //  ADD THIS
    !attendance.check_out_time
  ) {
    await Attendance.updateDayOver([0, "half", 0, null, null, attendance.id]);

    await generateDailySalaryInternal(employeeId, dateStr);
  }
};

// Add near the top of the controller, alongside other helpers
const isPastCheckInCutoff = (loginTime) => {
  // No login_time configured for this user -> don't block them
  if (!loginTime) return false;

  // mysql2 can return TIME columns either as "HH:MM:SS" strings
  // or as JS Date objects depending on your pool config — handle both
  let hh, mm, ss;
  if (loginTime instanceof Date) {
    hh = loginTime.getHours();
    mm = loginTime.getMinutes();
    ss = loginTime.getSeconds();
  } else {
    [hh, mm, ss] = String(loginTime).split(":").map(Number);
  }

  // "now" in IST regardless of server timezone
  const nowIST = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );

  const cutoff = new Date(nowIST);
  cutoff.setHours(hh, mm, ss || 0, 0);

  return nowIST > cutoff;
};

const formatTimeTo12Hour = (timeStr) => {
  if (!timeStr) return "";

  const [hh, mm] = String(timeStr).split(":").map(Number);

  const period = hh >= 12 ? "PM" : "AM";
  let hour12 = hh % 12;
  if (hour12 === 0) hour12 = 12;

  // Show minutes only if non-zero, e.g. "9 AM" vs "9:30 AM"
  return mm === 0
    ? `${hour12} ${period}`
    : `${hour12}:${String(mm).padStart(2, "0")} ${period}`;
};

exports.getTodayAttendance = async (req, res) => {
  try {
    const { employee_id } = req.params;

    const attendance = await Attendance.getTodayAttendance(employee_id);

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: "No attendance found for today",
      });
    }

    return res.json({
      success: true,
      data: attendance,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const MARKETING_DEPARTMENT_ID = 2;

const getEmployeeDepartmentId = async (employeeId) => {
  const [[row]] = await db.query(
    `SELECT department_id FROM users WHERE id = ?`,
    [employeeId]
  );
  return row ? row.department_id : null;
};

exports.markAttendance = async (req, res) => {
  try {
    const { employee_id, status } = req.body;

    if (!employee_id || !status) { return res.status(400).json({ message: "Required fields missing" }); }

    // await autoClosePreviousDay(employee_id);
    const todayAttendance = await Attendance.getTodayAttendance(employee_id);

    if (status === "leave") {
      if (!req.body.leave_reason) {
        return res.status(400).json({ message: "Leave reason required" });
      }

      if (todayAttendance) {
        return res.status(400).json({ message: "Attendance already marked" });
      }

      if (work_type === "office") {
        const departmentId = await getEmployeeDepartmentId(employee_id);

        if (departmentId === MARKETING_DEPARTMENT_ID) {
          return res.status(400).json({
            message:
              "Marketing employees cannot mark attendance as Office Sitting. Please mark attendance as Field work.",
          });
        }
      }

      await Attendance.createAttendance([
        employee_id,
        "leave",
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

      await generateDailySalaryInternal(
        employee_id,
        new Date().toISOString().split("T")[0],
      );
      return res.json({ message: "Leave marked successfully" });
    }

    /* ======================= PRESENT ======================= */
    if (status === "present") {
      if (todayAttendance) { return res.status(400).json({ message: "Attendance already marked" }); }

      const loginTime = await userModal.getEmployeeLoginTime(employee_id);

      if (isPastCheckInCutoff(loginTime)) {
        return res.status(400).json({
          message: `You can mark attendance only up to ${formatTimeTo12Hour(loginTime)}. Please contact your reporting manager for a late check-in.`,
        });
      }


      const { work_type, field_work_type, travel_mode, vehicle_type, public_transport, odometer_reading, visit_location, } = req.body;
      if (!work_type) { return res.status(400).json({ message: "Work type required" }); }
      if (work_type === "field" && !field_work_type) { return res.status(400).json({ message: "Field work type required" }); }

      if (!["office", "field", "wfh"].includes(work_type)) {
        return res.status(400).json({
          message: "Invalid work type",
        });
      }

      if (work_type === "office") {
        const departmentId = await getEmployeeDepartmentId(employee_id);

        if (departmentId === MARKETING_DEPARTMENT_ID) {
          return res.status(400).json({
            message:
              "Marketing employees cannot mark attendance as Office Sitting. Please mark attendance as Field work.",
          });
        }
      }

      if (work_type === "field" && travel_mode === "private" && !odometer_reading) {
        return res.status(400).json({ message: "Odometer reading required" });
      }

      const attendanceId = await Attendance.createAttendance([
        employee_id,
        "present",
        null,
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

      if (req.files) {
        for (const field in req.files) {
          const file = req.files[field][0];

          const upload = await uploadFileToMinio(
            file,
            "attendance_photo"
          );

          await Attendance.saveAttendanceImage([
            attendanceId,                 // attendance_id
            field,                        // image_type
            process.env.MINIO_BUCKET || "jsc-crm",                 // storage_bucket
            upload.object_path,           // object_path
            upload.file_url,              // file_url
            file.mimetype,                // mime_type
            Math.ceil(file.size / 1024),  // file_size_kb
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

      if (!todayAttendance.check_in_time) {
        return res.status(400).json({
          message: "Invalid attendance: check-in missing",
        });
      }

      if (todayAttendance.check_out_time) {
        return res.status(400).json({ message: "Day over already marked" });
      }

      const { day_over_odometer_reading, day_over_location } = req.body;

      if (todayAttendance.work_type === "field" && todayAttendance.travel_mode === "private" && !day_over_odometer_reading
      ) {
        return res.status(400).json({ message: "Odometer reading required" });
      }

      if (!req.files?.day_over_selfie) {
        return res.status(400).json({ message: "Day over selfie required", });
      }

      if (todayAttendance.work_type === "field" && todayAttendance.travel_mode === "private" && !req.files?.day_over_odometer) {
        return res.status(400).json({ message: "Day over odometer image required", });
      }

      const checkIn = new Date(todayAttendance.check_in_time);
      const checkOut = new Date();
      const workingMinutes = Math.floor((checkOut - checkIn) / (1000 * 60));

      if (workingMinutes <= 0) {
        return res.status(400).json({
          message: "Invalid working hours calculation",
        });
      }

      // ================== NEW LOGIC START ==================

      let totalVisits = 0;

      if (todayAttendance.work_type === "field") {
        const [visitRows] = await db.query(
          `SELECT COUNT(*) as total  FROM visits  WHERE user_id = ?  AND DATE(created_at) = CURDATE()`,
          [employee_id],
        );

        totalVisits = visitRows[0].total;
      }

      // Default calculation
      let { unit, late } = calculateAttendanceUnit({
        checkInTime: todayAttendance.check_in_time,
        workingMinutes,
      });

      let message = "Day over marked successfully";
      //  FORCE HALF DAY IF VISITS < 4
      if (todayAttendance.work_type === "field" && totalVisits < 4) {
        unit = "half";
        message = `Day over marked successfully. Only ${totalVisits} visits completed. Minimum 4 required. Half day counted.`;
      }

      // ================== NEW LOGIC END ==================

      await Attendance.updateDayOver([
        workingMinutes,
        unit,
        late,
        day_over_odometer_reading,
        day_over_location,
        todayAttendance.id,
      ]);
      await generateDailySalaryInternal(employee_id, new Date().toISOString().split("T")[0],);

      // Upload images
      for (const field in req.files) {
        const file = req.files[field][0];

        const upload = await uploadFileToMinio(file, "attendance_photo");

        await Attendance.saveAttendanceImage([
          todayAttendance.id,           // attendance_id
          field,                        // image_type
          process.env.MINIO_BUCKET || "jsc-crm",                // storage_bucket
          upload.object_path,           // object_path
          upload.file_url,              // file_url
          file.mimetype,                // mime_type
          Math.ceil(file.size / 1024),  // file_size_kb
        ]);
      }

      return res.json({
        message: message,
        working_minutes: workingMinutes,
        visits: todayAttendance.work_type === "field" ? totalVisits : null,
        attendance_unit: unit,
      });
    }

    return res.status(400).json({ message: "Invalid attendance status" });
  } catch (error) {
    console.error("Attendance Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.getAttendanceImagesByDate = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        message: "Date is required (YYYY-MM-DD)",
      });
    }

    const rows = await Attendance.getAttendanceImagesByDate(employeeId, date);

    if (!rows.length) {
      return res.status(404).json({
        message: "No attendance found for this date",
      });
    }

    const response = {
      employee_id: employeeId,
      attendance_date: date,
      images: {},
    };

    for (const row of rows) {
      if (row.image_type && row.object_path) {
        const presignedUrl = await getPresignedUrl(row.object_path);

        response.images[row.image_type] = presignedUrl;
      }
    }

    return res.json(response);
  } catch (error) {
    console.error("Get Attendance Images Error:", error);
    return res.status(500).json({
      message: "Server error",
    });
  }
};
exports.getMyAttendance = async (req, res) => {
  try {
    const employeeId = req.user?.id; // from token
    let { start_date, end_date, page = 1, limit = 10 } = req.query;

    page = Number(page);
    limit = Number(limit);
    const offset = (page - 1) * limit;

    const attendance = await Attendance.getDayWiseAttendance({
      employeeId, // force from token
      startDate: start_date,
      endDate: end_date,
      limit,
      offset,
    });

    const totalRecords = await Attendance.getDayWiseAttendanceCount({
      employeeId,
      startDate: start_date,
      endDate: end_date,
    });

    return res.json({
      pagination: {
        page,
        limit,
        total_records: totalRecords,
        total_pages: Math.ceil(totalRecords / limit),
      },
      attendance,
    });
  } catch (error) {
    console.error("My Attendance Error:", error);
    return res.status(500).json({
      message: "Server error",
    });
  }
};

exports.getDayWiseAttendance = async (req, res) => {
  try {
    let {
      employee_id,
      search,
      start_date,
      end_date,
      page = 1,
      limit = 10,
    } = req.query;

    page = Number(page);
    limit = Number(limit);
    const offset = (page - 1) * limit;

    const attendance = await Attendance.getDayWiseAttendance({
      employeeId: employee_id,
      search,
      startDate: start_date,
      endDate: end_date,
      limit,
      offset,
    });

    const totalRecords = await Attendance.getDayWiseAttendanceCount({
      employeeId: employee_id,
      search,
      startDate: start_date,
      endDate: end_date,
    });

    return res.json({
      filters: {
        employee_id: employee_id || null,
        search: search || null,
        start_date: start_date || null,
        end_date: end_date || null,
      },
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



exports.getDailyAttendanceSummary = async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        message: "Date is required",
      });
    }

    const summary = await Attendance.getDailyAttendanceSummary(date);

    return res.json({
      date,
      summary: {
        total_employees: Number(summary.total_employees),
        active_employees: Number(summary.active_employees),
        inactive_employees: Number(summary.inactive_employees),

        //  Updated fields
        checked_in: Number(summary.checked_in),
        completed_day: Number(summary.completed_day),
        half_day: Number(summary.half_day),
        leave_count: Number(summary.leave_count),
        absent_count: Number(summary.absent_count),
        present_total:
          Number(summary.checked_in) + Number(summary.completed_day),
      },
    });
  } catch (error) {
    console.error("Daily Summary Error:", error);
    return res.status(500).json({
      message: "Server error",
    });
  }
};

exports.getMyTeamAttendance = async (req, res) => {
  try {
    const loginUserId = req.user.id;
    const hierarchyIds = await getHierarchyIds(loginUserId);
    const data = await Attendance.getMyTeamAttendance({
      hierarchyIds,
      date: req.query.date,
      level: req.query.level,
      user_id: req.query.user_id
    });

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// exports.getAttendanceImagesByDate = async (req, res) => {
//   try {
//     const { employeeId } = req.params;
//     const { date } = req.query;

//     if (!date) {
//       return res.status(400).json({
//         message: "Date is required (YYYY-MM-DD)",
//       });
//     }

//     const rows = await Attendance.getAttendanceImagesByDate(employeeId, date);

//     if (!rows.length) {
//       return res.status(404).json({
//         message: "No attendance found for this date",
//       });
//     }

//     // Format response properly
//     const response = {
//       employee_id: employeeId,
//       attendance_date: date,
//       images: {},
//     };

//     rows.forEach((row) => {
//       if (row.image_type && row.file_url) {
//         response.images[row.image_type] = row.file_url;
//       }
//     });

//     return res.json(response);
//   } catch (error) {
//     console.error("Get Attendance Images Error:", error);
//     return res.status(500).json({
//       message: "Server error",
//     });
//   }
// };


// const generateDailySalaryInternal = async (employeeId, date) => {
//   const user = await SalaryDaily.getUserSalaryInfo(employeeId);
//   console.log("USER =>", employeeId, user ? "found" : "NOT FOUND");
//   if (!user) return;

//   const attendance = await SalaryDaily.getAttendanceByDate(employeeId, date);
//   console.log("ATTENDANCE =>", employeeId, date, attendance);
//   if (!attendance) return;

//   const year = new Date(date).getFullYear();
//   const month = new Date(date).getMonth() + 1;

//   // Check if month locked
//   const [[lockedRow]] = await require("../config/db").query(
//     `SELECT salary_locked FROM emp_salary 
//      WHERE employee_id = ? AND month = ? AND year = ?`,
//     [employeeId, month, year],
//   );

//   if (lockedRow && lockedRow.salary_locked === 1) return;

//   const daysInMonth = new Date(year, month, 0).getDate();

//   const yearlySalary = Number(user.salary);
//   const monthlySalary = yearlySalary / 12;
//   const perDaySalary = monthlySalary / daysInMonth;

//   let basicSalary = 0;

//   if (attendance.attendance_unit === "full") {
//     basicSalary = perDaySalary;
//   } else if (attendance.attendance_unit === "half") {
//     basicSalary = perDaySalary * 0.5;
//   } else if (["week_off", "absent", "leave"].includes(attendance.attendance_unit)) {
//   basicSalary = 0;
//   // Still continue — don't return early — so a ₹0 row gets saved
// }

//   /* ---------- Working Hours Format ---------- */
//   const totalMinutes = attendance.working_minutes || 0;
//   const hours = Math.floor(totalMinutes / 60);
//   const minutes = totalMinutes % 60;
//   const formattedWorkingHours = `${hours} hr ${minutes} min`;

//   /* ---------- Travel & Daily Allowance ---------- */
//   let travelAllowance = 0;
//   let dailyAllowance = 0;
//   let totalReading = 0;

//   if (attendance.check_out_time && attendance.work_type !== "wfh") {
//     const startKm = Number(attendance.odometer_reading) || 0;
//     const endKm = Number(attendance.day_over_odometer_reading) || 0;

//     let travelledKm = endKm - startKm;

// if (travelledKm < 0) {
//   travelledKm = 0;
// }

// totalReading = travelledKm;

//     // Normalize vehicle type (prevents mismatch bugs)
//     const vehicleType = (attendance.vehicle_type || "").toLowerCase();

//     const rateMap = {
//       two_wheeler: Number(user.two_wheeler_allowance_per_km) || 0,
//       four_wheeler: Number(user.four_wheeler_allowance_per_km) || 0,
//     };

//     const perKmRate = rateMap[vehicleType] || 0;

//     /* ---------- VALIDATION (No silent failure) ---------- */
//     if (travelledKm > 0) {
//       if (!vehicleType) {
//         console.error(
//           ` vehicle_type missing for employee ${employeeId} on ${date}`,
//         );
//       }

//       if (!rateMap.hasOwnProperty(vehicleType)) {
//         console.error(` Invalid vehicle_type: ${attendance.vehicle_type}`);
//       }

//       if (perKmRate === 0) {
//         console.error(` Per KM rate is 0 for vehicle_type: ${vehicleType}`);
//       }
//     }

//     //  Travel Allowance (ALWAYS FULL - as per your requirement)
//     travelAllowance = travelledKm * perKmRate;

//     //  Daily Allowance (ONLY for FULL DAY)
//     if (
//       attendance.attendance_unit === "full" &&
//       travelledKm >= (user.avg_travel_km_per_day || 0)
//     ) {
//       dailyAllowance = Number(user.daily_allowance_with_doc) || 0;
//     } else {
//       dailyAllowance = 0;
//     }

//     /* ---------- Debug Logs ---------- */
//     console.log({
//       employeeId,
//       date,
//       vehicleType,
//       travelledKm,
//       perKmRate,
//       travelAllowance,
//       dailyAllowance,
//     });
//   }

//   /* ---------- Expense Calculation ---------- */

// let hotelExpense = 0;
// let otherExpense = 0;
// let busTrainTollExpense = 0;

// const [expenses] = await db.query(
//   `
//   SELECT
//     expense_type,
//     SUM(amount) as total
//   FROM employee_expense_entries
//   WHERE user_id = ?
//     AND DATE(expense_date) = ?
//     AND status = 'APPROVED'
//   GROUP BY expense_type
//   `,
//   [employeeId, date]
// );

// for (const exp of expenses) {

//   const amount = Number(exp.total) || 0;

//   if (exp.expense_type === "HOTEL") {
//     hotelExpense = amount;
//   }

//   if (exp.expense_type === "OTHER") {
//     otherExpense = amount;
//   }

//   if (exp.expense_type === "BUS_TRAIN_TOLL") {
//     busTrainTollExpense = amount;
//   }
// }

//   /* ---------- Final Salary ---------- */
//   const grossSalary = basicSalary + travelAllowance + dailyAllowance + hotelExpense +
//   otherExpense +
//   busTrainTollExpense;
//   const netSalary = grossSalary;

//   try{
//      await SalaryDaily.saveDailySalary([
//     employeeId,
//     date,
//     attendance.attendance_unit,
//     formattedWorkingHours,
//     perDaySalary.toFixed(2),
//     basicSalary.toFixed(2),
//     travelAllowance.toFixed(2),
//     dailyAllowance.toFixed(2),

//      hotelExpense.toFixed(2),
//   otherExpense.toFixed(2),
//   busTrainTollExpense.toFixed(2),
//   totalReading.toFixed(2),

//     grossSalary.toFixed(2),
//     netSalary.toFixed(2),
//   ]);
//   console.log("SAVED OK =>", employeeId, date);

//   }catch(error){
// // console.error("SAVE FAILED =>", employeeId, date, err.sqlMessage);
// console.error("SAVE FAILED =>", employeeId, date, error.sqlMessage, error.message);
//   }

// };



module.exports.generateDailySalaryInternal = generateDailySalaryInternal;
