const db = require("../config/db");

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

      searchParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

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
      [employee_id, month, year, ...searchParams],
    );

    const totalRecords = countResult[0].total;

    const totalPages = Math.ceil(totalRecords / perPage);

    const [rows] = await db.query(
      `
  SELECT

    esd.id,

    DATE(esd.salary_date) AS date,

    u.name,

    CASE

      WHEN esd.attendance_type = 'full'
        THEN 'P'

      WHEN esd.attendance_type = 'half'
        THEN 'H'

      WHEN esd.attendance_type = 'absent'
        THEN 'A'

      WHEN esd.attendance_type = 'week_off'
        THEN 'W'

      WHEN esd.attendance_type = 'leave'
        THEN 'L'

      ELSE '-'

    END AS attendance_type,

    esd.working_hours,

    esd.basic_salary AS salary,

    esd.total_reading,

    esd.travelling_allowance AS ta,

    esd.daily_allowance AS da,

    /* =========================
       HOTEL
    ========================= */

    COALESCE(hotel.hotel_expense, 0)
      AS hotel_expense,

    hotel.hotel_bill,

    /* =========================
       OTHER
    ========================= */

    COALESCE(otherExp.other_expense, 0)
      AS other_expense,

    otherExp.other_bill,

    /* =========================
       BUS/TRAIN/TOLL
    ========================= */

    COALESCE(bt.bus_train_toll_expense, 0)
      AS bus_train_toll_expense,

    bt.bus_train_toll_bill

  FROM emp_salary_daily esd

  JOIN users u
    ON u.id = esd.employee_id

  /* =========================
     HOTEL JOIN
  ========================= */

  LEFT JOIN (

    SELECT

      user_id,

      DATE(expense_date) AS expense_day,

      SUM(amount) AS hotel_expense,

      MAX(bill_url) AS hotel_bill

    FROM employee_expense_entries

    WHERE expense_type = 'HOTEL'

    AND status = 'PENDING'

    GROUP BY
      user_id,
      DATE(expense_date)

  ) hotel

    ON hotel.user_id = esd.employee_id

    AND hotel.expense_day
      = DATE(esd.salary_date)

  /* =========================
     OTHER JOIN
  ========================= */

  LEFT JOIN (

    SELECT

      user_id,

      DATE(expense_date) AS expense_day,

      SUM(amount) AS other_expense,

      MAX(bill_url) AS other_bill

    FROM employee_expense_entries

    WHERE expense_type = 'OTHER'

    AND status = 'PENDING'

    GROUP BY
      user_id,
      DATE(expense_date)

  ) otherExp

    ON otherExp.user_id = esd.employee_id

    AND otherExp.expense_day
      = DATE(esd.salary_date)

  /* =========================
     BUS/TRAIN/TOLL JOIN
  ========================= */

  LEFT JOIN (

    SELECT

      user_id,

      DATE(expense_date) AS expense_day,

      SUM(amount)
        AS bus_train_toll_expense,

      MAX(bill_url)
        AS bus_train_toll_bill

    FROM employee_expense_entries

    WHERE expense_type = 'BUS_TRAIN_TOLL'

    AND status = 'PENDING'

    GROUP BY
      user_id,
      DATE(expense_date)

  ) bt

    ON bt.user_id = esd.employee_id

    AND bt.expense_day
      = DATE(esd.salary_date)

  WHERE esd.employee_id = ?

  AND MONTH(esd.salary_date) = ?

  AND YEAR(esd.salary_date) = ?

  ${searchCondition}

  ORDER BY esd.salary_date ASC

  LIMIT ?

  OFFSET ?
  `,
      [employee_id, month, year, ...searchParams, perPage, offset],
    );

    const [totalRows] = await db.query(
      `
      SELECT
        COALESCE(SUM(esd.basic_salary),0) AS total_salary,
        COALESCE(SUM(esd.travelling_allowance),0) AS total_ta,
        COALESCE(SUM(esd.daily_allowance),0) AS total_da,

        /* HOTEL */

        (
          SELECT COALESCE(SUM(amount),0)
          FROM employee_expense_entries
          WHERE user_id = ?
          AND MONTH(expense_date) = ?
          AND YEAR(expense_date) = ?
          AND expense_type = 'HOTEL'
          AND status = 'PENDING'
        ) AS total_hotel,

        /* OTHER */
        (
          SELECT COALESCE(SUM(amount),0)
          FROM employee_expense_entries
          WHERE user_id = ?
          AND MONTH(expense_date) = ?
          AND YEAR(expense_date) = ?
          AND expense_type = 'OTHER'
          AND status = 'PENDING'
        ) AS total_other,
        /* BUS/TRAIN/TOLL */
        (
          SELECT COALESCE(SUM(amount),0)
          FROM employee_expense_entries
          WHERE user_id = ?
          AND MONTH(expense_date) = ?
          AND YEAR(expense_date) = ?
          AND expense_type = 'BUS_TRAIN_TOLL'
          AND status = 'PENDING'
        ) AS total_toll
      FROM emp_salary_daily esd
      WHERE esd.employee_id = ?
      AND MONTH(esd.salary_date) = ?
      AND YEAR(esd.salary_date) = ?
      `,
      [
        employee_id,
        month,
        year,
        employee_id,
        month,
        year,
        employee_id,
        month,
        year,
        employee_id,
        month,
        year,
      ],
    );

    const totals = {
      salary: Number(totalRows[0].total_salary || 0),
      ta: Number(totalRows[0].total_ta || 0),
      da: Number(totalRows[0].total_da || 0),
      hotel: Number(totalRows[0].total_hotel || 0),
      other: Number(totalRows[0].total_other || 0),
      toll: Number(totalRows[0].total_toll || 0),
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
      data: rows,
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
