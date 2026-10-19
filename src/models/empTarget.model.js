const db = require("../config/db");

// Shared SELECT for list + single. Dates are formatted in SQL to avoid timezone shifts.
const TARGET_SELECT = `
  et.id,
  et.user_id,
  u.name AS user_name,
  et.role,
  et.target_type,
  et.duration_type,
  DATE_FORMAT(et.start_date, '%Y-%m-%d') AS start_date,
  DATE_FORMAT(et.end_date, '%Y-%m-%d') AS end_date,
  et.target_amount,
  et.created_at,
  GROUP_CONCAT(etc.category_id) AS category_ids
`;

// ================= COLLECTION (area-aware) =================
// l = the customer ledger of a receipt entry. Every area row stores its full path,
// so the most specific filled column decides the level it is matched at.
// ================= COLLECTION (target's own areas) =================
// l = the customer ledger of a receipt entry. Every stored area keeps its full path,
// so the most specific filled column decides the level it is matched at.
const AREA_MATCH = `
  EXISTS (
    SELECT 1
    FROM employee_target_areas a
    WHERE a.employee_target_id = ?
      AND (
           (a.village_id  IS NOT NULL AND a.village_id  = l.village_id)
        OR (a.village_id  IS NULL AND a.tehsil_id   IS NOT NULL AND a.tehsil_id   = l.tehsil_id)
        OR (a.tehsil_id   IS NULL AND a.district_id IS NOT NULL AND a.district_id = l.district_id)
        OR (a.district_id IS NULL AND a.state_id    IS NOT NULL AND a.state_id    = l.state_id)
      )
  )
`;

// Returns { achieved, scope, unmapped, areaCount }
//  scope "ALL"   -> the target has no areas: every receipt of the employee (original behaviour)
//  scope "AREAS" -> only receipt entries from customers inside the target's areas
//  unmapped      -> amount from customers that could not be matched because they have no
//                   geography at the level the target's areas are set at
const getCollectionAchievement = async ({ id, user_id, start_date, end_date }) => {
  const [[areas]] = await db.query(
    `
    SELECT
      COUNT(*) AS area_count,
      COALESCE(SUM(village_id IS NOT NULL), 0) AS villages,
      COALESCE(SUM(village_id IS NULL AND tehsil_id IS NOT NULL), 0) AS tehsils,
      COALESCE(SUM(tehsil_id IS NULL AND district_id IS NOT NULL), 0) AS districts
    FROM employee_target_areas
    WHERE employee_target_id = ?
    `,
    [id || 0]
  );

  // ---------- no areas on this target: all of the employee's receipts ----------
  if (!Number(areas.area_count)) {
    const [rows] = await db.query(
      `
      SELECT COALESCE(SUM(r.total_amount), 0) AS achieved
      FROM receipts r
      WHERE r.employee_under_id = ?
        AND r.receipt_date >= ?
        AND r.receipt_date < DATE_ADD(?, INTERVAL 1 DAY)
      `,
      [user_id, start_date, end_date]
    );

    return { achieved: Number(rows[0].achieved), scope: "ALL", unmapped: 0, areaCount: 0 };
  }

  // ---------- areas on this target: only customers inside them ----------
  // level the customers must be mapped at (fixed list, never user input)
  const unitColumn =
    Number(areas.villages) > 0 ? "village_id"
    : Number(areas.tehsils) > 0 ? "tehsil_id"
    : Number(areas.districts) > 0 ? "district_id"
    : "state_id";

  const [rows] = await db.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN ${AREA_MATCH} THEN re.amount ELSE 0 END), 0) AS achieved,
      COALESCE(SUM(CASE WHEN NOT (${AREA_MATCH}) AND l.${unitColumn} IS NULL
                        THEN re.amount ELSE 0 END), 0) AS unmapped
    FROM receipts r
    INNER JOIN receipt_entries re ON re.receipt_id = r.id
    INNER JOIN ledgers l ON l.id = re.ledger_id
    WHERE r.employee_under_id = ?
      AND r.receipt_date >= ?
      AND r.receipt_date < DATE_ADD(?, INTERVAL 1 DAY)
    `,
    [id, id, user_id, start_date, end_date]
  );

  return {
    achieved: Number(rows[0].achieved),
    scope: "AREAS",
    unmapped: Number(rows[0].unmapped),
    areaCount: Number(areas.area_count)
  };
};

// ================= ACHIEVEMENT CALCULATION =================
const calculateAchievement = async (target) => {
  const { user_id, target_type, start_date, end_date } = target;

  const categoryIds = target.category_ids
    ? String(target.category_ids).split(",").map(Number)
    : [];

  // ---------- SALE: subtotal (pre-tax), selected categories only ----------
  if (target_type === "SALE") {
    let rows;

    if (categoryIds.length) {
      [rows] = await db.query(
        `
        SELECT COALESCE(SUM(si.amount), 0) AS achieved
        FROM sales s
        INNER JOIN sales_items si ON si.sale_id = s.id
        INNER JOIN stock_items st ON st.id = si.stock_item_id
        WHERE COALESCE(s.assign_employee_id, s.employee_under_id) = ?
          AND s.sales_date >= ?
          AND s.sales_date < DATE_ADD(?, INTERVAL 1 DAY)
          AND st.stock_category_id IN (?)
        `,
        [user_id, start_date, end_date, categoryIds]
      );
    } else {
      [rows] = await db.query(
        `
        SELECT COALESCE(SUM(s.subtotal), 0) AS achieved
        FROM sales s
        WHERE COALESCE(s.assign_employee_id, s.employee_under_id) = ?
          AND s.sales_date >= ?
          AND s.sales_date < DATE_ADD(?, INTERVAL 1 DAY)
        `,
        [user_id, start_date, end_date]
      );
    }

    return Number(rows[0].achieved);
  }

  // ---------- COLLECTION: receipts total ----------
 if (target_type === "COLLECTION") {
    const detail = await getCollectionAchievement(target);
    return detail.achieved;
  }

  // ---------- NEW_DISTRIBUTOR: new Sundry Debtors ledgers ----------
  if (target_type === "NEW_DISTRIBUTOR") {
    const [rows] = await db.query(
      `
      SELECT COUNT(*) AS achieved
      FROM ledgers l
      INNER JOIN account_groups ag ON ag.id = l.group_id
      WHERE ag.group_name = 'Sundry Debtors'
        AND l.employee_under = ?
        AND l.created_at >= ?
        AND l.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      `,
      [user_id, start_date, end_date]
    );

    return Number(rows[0].achieved);
  }

  return 0;
};

const attachAchievement = async (row) => {
  let achieved;
  let extra = {};

  if (row.target_type === "COLLECTION") {
    const detail = await getCollectionAchievement(row);
    achieved = detail.achieved;
    extra = {
      collection_scope: detail.scope,
      collection_area_count: detail.areaCount,
      unmapped_amount: detail.unmapped
    };
  } else {
    achieved = await calculateAchievement(row);
  }

  const targetAmount = Number(row.target_amount);

  return {
    ...row,
    ...extra,
    achieved_amount: achieved,
    pending_amount: Math.max(targetAmount - achieved, 0),
    achievement_percent:
      targetAmount > 0
        ? Number(((achieved / targetAmount) * 100).toFixed(2))
        : 0
  };
};

// ================= CREATE =================
const createEmployeeTarget = async (
  connection,
  { user_id, role, target_type, duration_type, start_date, end_date, target_amount, created_by }
) => {
  const [result] = await connection.query(
    `
    INSERT INTO employee_targets
      (user_id, role, target_type, duration_type, start_date, end_date,
       target_amount, achieved_amount, pending_amount, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      user_id, role, target_type, duration_type, start_date, end_date,
      target_amount, 0, target_amount, created_by
    ]
  );

  return result.insertId;
};

const insertTargetCategories = async (connection, employee_target_id, categories) => {
  if (!Array.isArray(categories) || categories.length === 0) return;

  const values = categories.map((category_id) => [employee_target_id, category_id]);

  await connection.query(
    `INSERT INTO employee_target_categories (employee_target_id, category_id) VALUES ?`,
    [values]
  );
};

// ================= GET ALL =================
const getEmployeeTargets = async ({
  page = 1, limit = 10, search = "",
  role = "", target_type = "", duration_type = ""
}) => {
  const pageNum = Math.max(Number(page) || 1, 1);
  const limitNum = Math.max(Number(limit) || 10, 1);
  const offset = (pageNum - 1) * limitNum;

  let whereClause = `WHERE 1=1`;
  const queryParams = [];

  if (search) {
    whereClause += `
      AND ( et.role LIKE ?
        OR et.target_type LIKE ?
        OR et.duration_type LIKE ?
        OR u.name LIKE ? ) `;
    queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (role) {
    whereClause += ` AND et.role = ?`;
    queryParams.push(role);
  }

  if (target_type) {
    whereClause += ` AND et.target_type = ?`;
    queryParams.push(target_type);
  }

  if (duration_type) {
    whereClause += ` AND et.duration_type = ?`;
    queryParams.push(duration_type);
  }

  const [countResult] = await db.query(
    `
    SELECT COUNT(DISTINCT et.id) AS total
    FROM employee_targets et
    LEFT JOIN users u ON et.user_id = u.id
    ${whereClause}
    `,
    queryParams
  );

  const total = countResult[0].total;

  const [rows] = await db.query(
    `
    SELECT ${TARGET_SELECT}
    FROM employee_targets et
    LEFT JOIN users u ON et.user_id = u.id
    LEFT JOIN employee_target_categories etc ON et.id = etc.employee_target_id
    ${whereClause}
    GROUP BY et.id
    ORDER BY et.id DESC
    LIMIT ? OFFSET ?
    `,
    [...queryParams, limitNum, offset]
  );

  const data = await Promise.all(rows.map(attachAchievement));

  return {
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
    data
  };
};

// ================= GET SINGLE =================
const getEmployeeTargetById = async (id) => {
  const [rows] = await db.query(
    `
    SELECT ${TARGET_SELECT}
    FROM employee_targets et
    LEFT JOIN users u ON et.user_id = u.id
    LEFT JOIN employee_target_categories etc ON et.id = etc.employee_target_id
    WHERE et.id = ?
    GROUP BY et.id
    `,
    [id]
  );

   if (!rows[0]) return null;

  const target = await attachAchievement(rows[0]);

  // the chosen areas, with names, so the edit screen can pre-fill
  if (target.target_type === "COLLECTION") {
    target.collection_areas = await getTargetAreasWithLabels(target.id);
  }

  return target;
};

// ================= UPDATE =================
// pending_amount is no longer reset here; achievement is calculated live.
const updateEmployeeTarget = async (connection, id, data) => {
  const { user_id, role, target_type, duration_type, start_date, end_date, target_amount } = data;

  const [result] = await connection.query(
    ` UPDATE employee_targets
    SET
      user_id = ?,
      role = ?,
      target_type = ?,
      duration_type = ?,
      start_date = ?,
      end_date = ?,
      target_amount = ?
    WHERE id = ?
    `,
    [user_id, role, target_type, duration_type, start_date, end_date, target_amount, id]
  );

  return result.affectedRows;
};

const deleteTargetCategories = async (connection, employee_target_id) => {
  await connection.query(
    `DELETE FROM employee_target_categories WHERE employee_target_id = ?`,
    [employee_target_id]
  );
};

const deleteEmployeeTarget = async (connection, id) => {
  await connection.query(`DELETE FROM employee_targets WHERE id = ?`, [id]);
};

// ================= TARGETS BY FILTERS (my targets / team targets) =================
// userIds = null  -> no restriction (admin)
// no date range   -> targets whose period includes today
const getTargetsByFilters = async ({
  userIds = null, userId, level, targetType, durationType, startDate, endDate,
  search, allPeriods = false
}) => {

  if (Array.isArray(userIds) && userIds.length === 0) return [];

  const where = [];
  const params = [];

  if (Array.isArray(userIds)) {
    where.push(`et.user_id IN (${userIds.map(() => "?").join(",")})`);
    params.push(...userIds);
  }

  if (userId) {
    where.push(`et.user_id = ?`);
    params.push(userId);
  }

  if (level) {
    where.push(`jr.level = ?`);
    params.push(level);
  }

  if (targetType) {
    where.push(`et.target_type = ?`);
    params.push(targetType);
  }

  if (durationType) {
    where.push(`et.duration_type = ?`);
    params.push(durationType);
  }

   if (search) {
    where.push(`u.name LIKE ?`);
    params.push(`%${search}%`);
  }

  if (allPeriods) {
    // no date restriction: past, current and future targets
  } else if (startDate && endDate) {
    // any target whose period overlaps the selected range
    where.push(`et.start_date <= ? AND et.end_date >= ?`);
    params.push(endDate, startDate);
  } else {
    // default: currently running targets
    where.push(`et.start_date <= CURDATE() AND et.end_date >= CURDATE()`);
  }

  const [rows] = await db.query(
    `
    SELECT
      et.id,
      et.user_id,
      u.name AS user_name,
      u.contact_no,
      jr.name AS role_name,
      jr.level,
      et.role,
      et.target_type,
      et.duration_type,
      DATE_FORMAT(et.start_date, '%Y-%m-%d') AS start_date,
      DATE_FORMAT(et.end_date, '%Y-%m-%d') AS end_date,
      et.target_amount,
      (
        SELECT GROUP_CONCAT(etc.category_id)
        FROM employee_target_categories etc
        WHERE etc.employee_target_id = et.id
      ) AS category_ids
    FROM employee_targets et
    INNER JOIN users u ON u.id = et.user_id
    LEFT JOIN job_roles jr ON jr.id = u.job_role_id
    WHERE ${where.join(" AND ")}
    ORDER BY jr.level, u.name, et.start_date DESC
    `,
    params
  );

  return Promise.all(rows.map(attachAchievement));
};

// ================= TARGET AREAS (collection targets) =================
const countActiveAreas = async (connection, employeeId) => {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM employee_collection_areas
     WHERE employee_id = ? AND is_active = 1`,
    [employeeId]
  );
  return Number(rows[0].total);
};

// only returns rows that belong to this employee AND are currently active
const getActiveAreasByIds = async (connection, employeeId, areaIds) => {
  const [rows] = await connection.query(
    `SELECT id, state_id, district_id, tehsil_id, village_id
     FROM employee_collection_areas
     WHERE employee_id = ? AND is_active = 1 AND id IN (?)`,
    [employeeId, areaIds]
  );
  return rows;
};

const insertTargetAreas = async (connection, employee_target_id, areaRows) => {
  if (!Array.isArray(areaRows) || areaRows.length === 0) return;

  const values = areaRows.map((a) => [
    employee_target_id, a.state_id, a.district_id, a.tehsil_id, a.village_id
  ]);

  await connection.query(
    `INSERT INTO employee_target_areas
       (employee_target_id, state_id, district_id, tehsil_id, village_id)
     VALUES ?`,
    [values]
  );
};

const deleteTargetAreas = async (connection, employee_target_id) => {
  await connection.query(
    `DELETE FROM employee_target_areas WHERE employee_target_id = ?`,
    [employee_target_id]
  );
};

const buildAreaLabel = (r) =>
  (r.village_id ? [r.tehsil_name, r.village_name]
    : r.tehsil_id ? [r.district_name, r.tehsil_name]
    : r.district_id ? [r.state_name, r.district_name]
    : [r.state_name])
    .filter(Boolean)
    .join(" / ");

// for the edit screen / detail view
const getTargetAreasWithLabels = async (targetId) => {
  const [rows] = await db.query(
    `
    SELECT a.id, a.state_id, a.district_id, a.tehsil_id, a.village_id,
           s.state_name,
           d.district_name_english AS district_name,
           t.tehsil_name,
           v.village_name
    FROM employee_target_areas a
    LEFT JOIN geo_states s ON s.id = a.state_id
    LEFT JOIN geo_districts d ON d.id = a.district_id
    LEFT JOIN geo_tehsils t ON t.id = a.tehsil_id
    LEFT JOIN geo_villages v ON v.id = a.village_id
    WHERE a.employee_target_id = ?
    ORDER BY s.state_name, d.district_name_english, t.tehsil_name, v.village_name
    `,
    [targetId]
  );

  return rows.map((r) => ({ ...r, label: buildAreaLabel(r) }));
};

module.exports = { createEmployeeTarget, insertTargetCategories, getEmployeeTargets, 
  getEmployeeTargetById, updateEmployeeTarget, deleteTargetCategories, deleteEmployeeTarget,
  calculateAchievement, getTargetsByFilters, countActiveAreas, getActiveAreasByIds, insertTargetAreas, deleteTargetAreas };