const db = require("../config/db");
const minioClient = require("../config/minio");
const BUCKET = "jsc-crm";

const getPresignedUrl = async (
  objectPath,
  expiry = 60 * 60
) => {
  try {
    if (!objectPath) return null;

    if (
      objectPath.startsWith("http://") ||
      objectPath.startsWith("https://")
    ) {
      const url = new URL(objectPath);

      // pathname:
      // /jsc-crm/employee/expenses/bills/test.jpg

      objectPath = decodeURIComponent(
        url.pathname
      );

      // remove bucket name
      objectPath = objectPath.replace(
        `/${BUCKET}/`,
        ""
      );

      // remove leading slash
      objectPath = objectPath.replace(/^\/+/, "");
    }

    console.log(
      "FINAL OBJECT PATH =>",
      objectPath
    );

    const url =
      await minioClient.presignedGetObject(
        BUCKET,
        objectPath,
        expiry
      );

    return url;
  } catch (err) {
    console.error(
      "Presigned URL Error:",
      err
    );

    return null;
  }
};


exports.getEmployeeSalaryMonths = async (req, res) => {
  try {
    const { employee_id } = req.params;

    const [[user]] = await db.query(
      `
      SELECT date_of_joining
      FROM users
      WHERE id = ?
      `,
      [employee_id],
    );

    if (!user || !user.date_of_joining) {
      return res.status(404).json({
        success: false,
        message: "Joining date not found",
      });
    }

    const joiningDate = new Date(user.date_of_joining);

    // Current month should NOT appear
    const today = new Date();

    // Last completed month
    today.setMonth(today.getMonth() - 1);

    const endMonth = today.getMonth();
    const endYear = today.getFullYear();

    let current = new Date(
      joiningDate.getFullYear(),
      joiningDate.getMonth(),
      1,
    );

    const months = [];

    while (
      current.getFullYear() < endYear ||
      (current.getFullYear() === endYear && current.getMonth() <= endMonth)
    ) {
      const month = current.getMonth() + 1;
      const year = current.getFullYear();

      const label =
        current
          .toLocaleString("default", {
            month: "short",
          })
          .toUpperCase() + `-${year}`;

      months.push({
        month,
        year,
        label,
      });

      current.setMonth(current.getMonth() + 1);
    }

    return res.json({
      success: true,
      data: months,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * PASTE-IN REPLACEMENT for your existing exports.getEmployeeMonthlyReport.
 * Everything else in your controller file (imports, other exports)
 * stays exactly as-is — this only replaces this one function.
 *
 * WHAT THIS DOES:
 * - hotel_expense / other_expense / bus_train_toll_expense = the
 *   APPROVED, payable amount already sitting correctly in
 *   emp_salary_daily (esd.hotel_expense etc. — same source TA/DA use,
 *   kept accurate by generateDailySalaryInternal + Payment Hold)
 *   PLUS whatever is still PENDING approval for that same day/type.
 *   That's the combined total you asked for.
 * - Also included, for transparency/debugging: hotel_expense_approved
 *   and hotel_expense_pending (and same for other/toll) — so you can
 *   always see the breakdown behind the combined number. These are
 *   additive fields; nothing that reads hotel_expense today needs to
 *   change.
 * - Bill reference (for the document link) and pending-sum are both
 *   computed in ONE aggregated subquery per type — deliberately NOT a
 *   plain JOIN, because employee_expense_entries has no unique
 *   constraint on (user_id, expense_type, expense_date) yet. A plain
 *   JOIN against a table that could have duplicate rows for the same
 *   day would silently multiply esd.hotel_expense in the result set.
 *   Aggregating first avoids that entirely.
 */
exports.getEmployeeMonthlyReport = async (req, res) => {
  try {
    const {
      employee_id,
      month,
      year,
      page = 1,
      limit = 10,
      search = "",
    } = req.query;

    if (!employee_id || !month || !year) {
      return res.status(400).json({
        success: false,
        message: "employee_id, month and year required",
      });
    }

    const currentPage = parseInt(page);
    const perPage = parseInt(limit);
    const offset = (currentPage - 1) * perPage;

    let searchCondition = "";
    const searchParams = [];

    if (search && search.trim() !== "") {
      searchCondition = `
        AND (
          u.name LIKE ?
          OR esd.attendance_type LIKE ?
          OR DATE_FORMAT(esd.salary_date, '%Y-%m-%d') LIKE ?
        )
      `;

      searchParams.push(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`
      );
    }

    /* =====================================================
       COUNT QUERY (unchanged)
    ===================================================== */

    const [countResult] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM emp_salary_daily esd
      JOIN users u
        ON u.id = esd.employee_id
      WHERE esd.employee_id = ?
      AND MONTH(esd.salary_date) = ?
      AND YEAR(esd.salary_date) = ?
      ${searchCondition}
      `,
      [employee_id, month, year, ...searchParams]
    );

    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / perPage);

    /* =====================================================
       MAIN QUERY
    ===================================================== */

    const [rows] = await db.query(
      `
      SELECT

        esd.id,

        DATE(esd.salary_date) AS date,

        u.name,

        CASE
          WHEN esd.attendance_type = 'full' THEN 'P'
          WHEN esd.attendance_type = 'half' THEN 'H'
          WHEN esd.attendance_type = 'absent' THEN 'A'
          WHEN esd.attendance_type = 'week_off' THEN 'W'
          WHEN esd.attendance_type = 'leave' THEN 'L'
          ELSE '-'
        END AS attendance_type,

        esd.working_hours,

        esd.basic_salary AS salary,

        esd.total_reading AS total_reading,

        esd.travelling_allowance AS ta,

        esd.daily_allowance AS da,

        /* =========================
           HOTEL — approved (esd) + pending (entries), combined
        ========================= */

        esd.hotel_expense AS hotel_expense_approved,
        COALESCE(hotel.pending_amount, 0) AS hotel_expense_pending,
        (esd.hotel_expense + COALESCE(hotel.pending_amount, 0)) AS hotel_expense,
        hotel.bill_path AS hotel_bill,

        /* =========================
           OTHER
        ========================= */

        esd.other_expense AS other_expense_approved,
        COALESCE(otherExp.pending_amount, 0) AS other_expense_pending,
        (esd.other_expense + COALESCE(otherExp.pending_amount, 0)) AS other_expense,
        otherExp.bill_path AS other_bill,

        /* =========================
           BUS/TRAIN/TOLL
        ========================= */

        esd.bus_train_toll_expense AS bus_train_toll_expense_approved,
        COALESCE(bt.pending_amount, 0) AS bus_train_toll_expense_pending,
        (esd.bus_train_toll_expense + COALESCE(bt.pending_amount, 0)) AS bus_train_toll_expense,
        bt.bill_path AS bus_train_toll_bill

      FROM emp_salary_daily esd

      JOIN users u
        ON u.id = esd.employee_id

      LEFT JOIN emp_attendance ea
        ON ea.employee_id = esd.employee_id
        AND ea.attendance_date = DATE(esd.salary_date)

      /* =========================
         HOTEL — one aggregated row per user/day: sum of PENDING
         amounts (added on top of esd's approved figure) + a bill
         reference. Aggregating first avoids row-duplication risk
         from the missing unique constraint mentioned above.
      ========================= */

      LEFT JOIN (

        SELECT
          user_id,
          DATE(expense_date) AS expense_day,
          SUM(CASE WHEN status = 'PENDING' THEN amount ELSE 0 END) AS pending_amount,
          MAX(bill_object_path) AS bill_path

        FROM employee_expense_entries
        WHERE expense_type = 'HOTEL'
        GROUP BY user_id, DATE(expense_date)

      ) hotel

        ON hotel.user_id = esd.employee_id
        AND hotel.expense_day = DATE(esd.salary_date)

      /* =========================
         OTHER
      ========================= */

      LEFT JOIN (

        SELECT
          user_id,
          DATE(expense_date) AS expense_day,
          SUM(CASE WHEN status = 'PENDING' THEN amount ELSE 0 END) AS pending_amount,
          MAX(bill_object_path) AS bill_path

        FROM employee_expense_entries
        WHERE expense_type = 'OTHER'
        GROUP BY user_id, DATE(expense_date)

      ) otherExp

        ON otherExp.user_id = esd.employee_id
        AND otherExp.expense_day = DATE(esd.salary_date)

      /* =========================
         BUS/TRAIN/TOLL
      ========================= */

      LEFT JOIN (

        SELECT
          user_id,
          DATE(expense_date) AS expense_day,
          SUM(CASE WHEN status = 'PENDING' THEN amount ELSE 0 END) AS pending_amount,
          MAX(bill_object_path) AS bill_path

        FROM employee_expense_entries
        WHERE expense_type = 'BUS_TRAIN_TOLL'
        GROUP BY user_id, DATE(expense_date)

      ) bt

        ON bt.user_id = esd.employee_id
        AND bt.expense_day = DATE(esd.salary_date)

      WHERE esd.employee_id = ?
      AND MONTH(esd.salary_date) = ?
      AND YEAR(esd.salary_date) = ?

      ${searchCondition}

      ORDER BY esd.salary_date ASC

      LIMIT ? OFFSET ?
      `,
      [
        employee_id,
        month,
        year,
        ...searchParams,
        perPage,
        offset,
      ]
    );

    /* =====================================================
       CONVERT BILL OBJECT PATH TO PRESIGNED URL
    ===================================================== */

    const updatedRows = await Promise.all(
      rows.map(async (row) => {
        let hotel_bill_url = null;
        let other_bill_url = null;
        let bus_train_toll_bill_url = null;

        try {
          if (row.hotel_bill) {
            hotel_bill_url = await getPresignedUrl(row.hotel_bill);
          }

          if (row.other_bill) {
            other_bill_url = await getPresignedUrl(row.other_bill);
          }

          if (row.bus_train_toll_bill) {
            bus_train_toll_bill_url = await getPresignedUrl(row.bus_train_toll_bill);
          }
        } catch (err) {
          console.error("Presigned URL Error:", err);
        }

        return {
          ...row,
          hotel_bill: hotel_bill_url,
          other_bill: other_bill_url,
          bus_train_toll_bill: bus_train_toll_bill_url,
        };
      })
    );

    /* =====================================================
       TOTALS QUERY — approved (from esd) + pending (from entries),
       combined per type, same logic as the main query above
    ===================================================== */

    const [totalRows] = await db.query(
      `
      SELECT

        COALESCE(SUM(esd.basic_salary),0) AS total_salary,
        COALESCE(SUM(esd.travelling_allowance),0) AS total_ta,
        COALESCE(SUM(esd.daily_allowance),0) AS total_da,

        COALESCE(SUM(esd.hotel_expense),0) AS total_hotel_approved,
        COALESCE(SUM(esd.other_expense),0) AS total_other_approved,
        COALESCE(SUM(esd.bus_train_toll_expense),0) AS total_toll_approved,

        (
          SELECT COALESCE(SUM(amount),0)
          FROM employee_expense_entries
          WHERE user_id = ?
          AND MONTH(expense_date) = ?
          AND YEAR(expense_date) = ?
          AND expense_type = 'HOTEL'
          AND status = 'PENDING'
        ) AS total_hotel_pending,

        (
          SELECT COALESCE(SUM(amount),0)
          FROM employee_expense_entries
          WHERE user_id = ?
          AND MONTH(expense_date) = ?
          AND YEAR(expense_date) = ?
          AND expense_type = 'OTHER'
          AND status = 'PENDING'
        ) AS total_other_pending,

        (
          SELECT COALESCE(SUM(amount),0)
          FROM employee_expense_entries
          WHERE user_id = ?
          AND MONTH(expense_date) = ?
          AND YEAR(expense_date) = ?
          AND expense_type = 'BUS_TRAIN_TOLL'
          AND status = 'PENDING'
        ) AS total_toll_pending

      FROM emp_salary_daily esd

      WHERE esd.employee_id = ?
      AND MONTH(esd.salary_date) = ?
      AND YEAR(esd.salary_date) = ?
      `,
      [
        employee_id, month, year,
        employee_id, month, year,
        employee_id, month, year,
        employee_id, month, year,
      ]
    );

    const totalHotelApproved = Number(totalRows[0].total_hotel_approved || 0);
    const totalHotelPending = Number(totalRows[0].total_hotel_pending || 0);
    const totalOtherApproved = Number(totalRows[0].total_other_approved || 0);
    const totalOtherPending = Number(totalRows[0].total_other_pending || 0);
    const totalTollApproved = Number(totalRows[0].total_toll_approved || 0);
    const totalTollPending = Number(totalRows[0].total_toll_pending || 0);

    const totals = {
      salary: Number(totalRows[0].total_salary || 0),
      ta: Number(totalRows[0].total_ta || 0),
      da: Number(totalRows[0].total_da || 0),

      hotel: totalHotelApproved + totalHotelPending,
      hotel_approved: totalHotelApproved,
      hotel_pending: totalHotelPending,

      other: totalOtherApproved + totalOtherPending,
      other_approved: totalOtherApproved,
      other_pending: totalOtherPending,

      toll: totalTollApproved + totalTollPending,
      toll_approved: totalTollApproved,
      toll_pending: totalTollPending,
    };

    return res.status(200).json({
      success: true,

      pagination: {
        total_records: totalRecords,
        total_pages: totalPages,
        current_page: currentPage,
        per_page: perPage,
      },

      totals,

      data: updatedRows,
    });
  } catch (error) {
    console.error("Monthly Salary Report Error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// exports.getEmployeeMonthlyReport = async (req, res) => {
//   try {
//     const {
//       employee_id,
//       month,
//       year,
//       page = 1,
//       limit = 10,
//       search = "",
//     } = req.query;

//     if (!employee_id || !month || !year) {
//       return res.status(400).json({
//         success: false,
//         message: "employee_id, month and year required",
//       });
//     }

//     const currentPage = parseInt(page);
//     const perPage = parseInt(limit);
//     const offset = (currentPage - 1) * perPage;

//     let searchCondition = "";
//     const searchParams = [];

//     if (search && search.trim() !== "") {
//       searchCondition = `
//         AND (
//           u.name LIKE ?
//           OR esd.attendance_type LIKE ?
//           OR DATE_FORMAT(esd.salary_date, '%Y-%m-%d') LIKE ?
//         )
//       `;

//       searchParams.push(
//         `%${search}%`,
//         `%${search}%`,
//         `%${search}%`
//       );
//     }

//     /* =====================================================
//        COUNT QUERY
//     ===================================================== */

//     const [countResult] = await db.query(
//       `
//       SELECT COUNT(*) AS total
//       FROM emp_salary_daily esd
//       JOIN users u
//         ON u.id = esd.employee_id
//       WHERE esd.employee_id = ?
//       AND MONTH(esd.salary_date) = ?
//       AND YEAR(esd.salary_date) = ?
//       ${searchCondition}
//       `,
//       [employee_id, month, year, ...searchParams]
//     );

//     const totalRecords = countResult[0].total;
//     const totalPages = Math.ceil(totalRecords / perPage);

//     /* =====================================================
//        MAIN QUERY
//     ===================================================== */

//     const [rows] = await db.query(
//       `
//       SELECT

//         esd.id,

//         DATE(esd.salary_date) AS date,

//         u.name,

//         CASE
//           WHEN esd.attendance_type = 'full' THEN 'P'
//           WHEN esd.attendance_type = 'half' THEN 'H'
//           WHEN esd.attendance_type = 'absent' THEN 'A'
//           WHEN esd.attendance_type = 'week_off' THEN 'W'
//           WHEN esd.attendance_type = 'leave' THEN 'L'
//           ELSE '-'
//         END AS attendance_type,

//         esd.working_hours,

//         esd.basic_salary AS salary,

//         CASE
//   WHEN ea.day_over_odometer_reading IS NOT NULL
//    AND ea.odometer_reading IS NOT NULL
//   THEN
//     ea.day_over_odometer_reading - ea.odometer_reading
//   ELSE 0
// END AS total_reading,

//         esd.travelling_allowance AS ta,

//         esd.daily_allowance AS da,

//         /* =========================
//            HOTEL
//         ========================= */

//         COALESCE(hotel.hotel_expense, 0) AS hotel_expense,
//         hotel.hotel_bill,

//         /* =========================
//            OTHER
//         ========================= */

//         COALESCE(otherExp.other_expense, 0) AS other_expense,
//         otherExp.other_bill,

//         /* =========================
//            BUS/TRAIN/TOLL
//         ========================= */

//         COALESCE(bt.bus_train_toll_expense, 0)
//           AS bus_train_toll_expense,

//         bt.bus_train_toll_bill

//       FROM emp_salary_daily esd

//       JOIN users u
//         ON u.id = esd.employee_id

//         LEFT JOIN emp_attendance ea
//   ON ea.employee_id = esd.employee_id
//   AND ea.attendance_date = DATE(esd.salary_date)

//       /* =========================
//          HOTEL JOIN
//       ========================= */

//       LEFT JOIN (

//         SELECT
//           user_id,
//           DATE(expense_date) AS expense_day,
//           SUM(amount) AS hotel_expense,
//           MAX(bill_url) AS hotel_bill

//         FROM employee_expense_entries

//         WHERE expense_type = 'HOTEL'
//         AND status = 'PENDING'

//         GROUP BY
//           user_id,
//           DATE(expense_date)

//       ) hotel

//         ON hotel.user_id = esd.employee_id
//         AND hotel.expense_day = DATE(esd.salary_date)

//       /* =========================
//          OTHER JOIN
//       ========================= */

//       LEFT JOIN (

//         SELECT
//           user_id,
//           DATE(expense_date) AS expense_day,
//           SUM(amount) AS other_expense,
//           MAX(bill_url) AS other_bill

//         FROM employee_expense_entries

//         WHERE expense_type = 'OTHER'
//         AND status = 'PENDING'

//         GROUP BY
//           user_id,
//           DATE(expense_date)

//       ) otherExp

//         ON otherExp.user_id = esd.employee_id
//         AND otherExp.expense_day = DATE(esd.salary_date)

//       /* =========================
//          BUS/TRAIN/TOLL JOIN
//       ========================= */

//       LEFT JOIN (

//         SELECT
//           user_id,
//           DATE(expense_date) AS expense_day,
//           SUM(amount) AS bus_train_toll_expense,
//           MAX(bill_url) AS bus_train_toll_bill

//         FROM employee_expense_entries

//         WHERE expense_type = 'BUS_TRAIN_TOLL'
//         AND status = 'PENDING'

//         GROUP BY
//           user_id,
//           DATE(expense_date)

//       ) bt

//         ON bt.user_id = esd.employee_id
//         AND bt.expense_day = DATE(esd.salary_date)

//       WHERE esd.employee_id = ?
//       AND MONTH(esd.salary_date) = ?
//       AND YEAR(esd.salary_date) = ?

//       ${searchCondition}

//       ORDER BY esd.salary_date ASC

//       LIMIT ? OFFSET ?
//       `,
//       [
//         employee_id,
//         month,
//         year,
//         ...searchParams,
//         perPage,
//         offset,
//       ]
//     );

//     /* =====================================================
//        CONVERT BILL URL TO PRESIGNED URL
//     ===================================================== */

//     const updatedRows = await Promise.all(
//       rows.map(async (row) => {
//         let hotel_bill_url = null;
//         let other_bill_url = null;
//         let bus_train_toll_bill_url = null;

//         try {
//           if (row.hotel_bill) {
//             hotel_bill_url = await getPresignedUrl(
//               row.hotel_bill
//             );
//           }

//           if (row.other_bill) {
//             other_bill_url = await getPresignedUrl(
//               row.other_bill
//             );
//           }

//           if (row.bus_train_toll_bill) {
//             bus_train_toll_bill_url =
//               await getPresignedUrl(
//                 row.bus_train_toll_bill
//               );
//           }
//         } catch (err) {
//           console.error("Presigned URL Error:", err);
//         }

//         return {
//           ...row,

//           hotel_bill: hotel_bill_url,

//           other_bill: other_bill_url,

//           bus_train_toll_bill:
//             bus_train_toll_bill_url,
//         };
//       })
//     );

//     /* =====================================================
//        TOTALS QUERY
//     ===================================================== */

//     const [totalRows] = await db.query(
//       `
//       SELECT

//         COALESCE(SUM(esd.basic_salary),0)
//           AS total_salary,

//         COALESCE(SUM(esd.travelling_allowance),0)
//           AS total_ta,

//         COALESCE(SUM(esd.daily_allowance),0)
//           AS total_da,

//         /* HOTEL */

//         (
//           SELECT COALESCE(SUM(amount),0)
//           FROM employee_expense_entries
//           WHERE user_id = ?
//           AND MONTH(expense_date) = ?
//           AND YEAR(expense_date) = ?
//           AND expense_type = 'HOTEL'
//           AND status = 'PENDING'
//         ) AS total_hotel,

//         /* OTHER */

//         (
//           SELECT COALESCE(SUM(amount),0)
//           FROM employee_expense_entries
//           WHERE user_id = ?
//           AND MONTH(expense_date) = ?
//           AND YEAR(expense_date) = ?
//           AND expense_type = 'OTHER'
//           AND status = 'PENDING'
//         ) AS total_other,

//         /* BUS/TRAIN/TOLL */

//         (
//           SELECT COALESCE(SUM(amount),0)
//           FROM employee_expense_entries
//           WHERE user_id = ?
//           AND MONTH(expense_date) = ?
//           AND YEAR(expense_date) = ?
//           AND expense_type = 'BUS_TRAIN_TOLL'
//           AND status = 'PENDING'
//         ) AS total_toll

//       FROM emp_salary_daily esd

//       WHERE esd.employee_id = ?
//       AND MONTH(esd.salary_date) = ?
//       AND YEAR(esd.salary_date) = ?
//       `,
//       [
//         employee_id,
//         month,
//         year,

//         employee_id,
//         month,
//         year,

//         employee_id,
//         month,
//         year,

//         employee_id,
//         month,
//         year,
//       ]
//     );

//     const totals = {
//       salary: Number(totalRows[0].total_salary || 0),
//       ta: Number(totalRows[0].total_ta || 0),
//       da: Number(totalRows[0].total_da || 0),
//       hotel: Number(totalRows[0].total_hotel || 0),
//       other: Number(totalRows[0].total_other || 0),
//       toll: Number(totalRows[0].total_toll || 0),
//     };

//     return res.status(200).json({
//       success: true,

//       pagination: {
//         total_records: totalRecords,
//         total_pages: totalPages,
//         current_page: currentPage,
//         per_page: perPage,
//       },

//       totals,

//       data: updatedRows,
//     });
//   } catch (error) {
//     console.error(
//       "Monthly Salary Report Error:",
//       error
//     );

//     return res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// };
