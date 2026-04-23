const db = require("../config/db");

exports.createTarget = async (values) => {
  const query = `
    INSERT INTO visit_targets
    (assigned_by, assigned_to, category_id, target_type, target_value, start_date, end_date)
    VALUES ?
  `;

  const [result] = await db.query(query, [values]);
  return result;
};

exports.getTargets = async (userId) => {
  const [rows] = await db.query(
    `
    SELECT 
      vt.id,
      vt.assigned_to,
      vt.target_value,
      vt.target_type,
      vt.start_date,
      vt.end_date,
      tc.name as category_name

    FROM visit_targets vt
    LEFT JOIN target_categories tc ON vt.category_id = tc.id

    WHERE vt.assigned_to = ?
    ORDER BY vt.id DESC
    `,
    [userId]
  );

  return rows;
};
//  GET TARGETS WITH CATEGORY NAME

exports.getVisitStats = async (userIds, type) => {
let dateFilter = "";

switch (type) {
  case "DAILY":
    dateFilter = "DATE(v.created_at) = CURDATE()";
    break;

  case "WEEKLY":
    dateFilter = "YEARWEEK(v.created_at, 1) = YEARWEEK(CURDATE(), 1)";
    break;

  case "MONTHLY":
    dateFilter = "MONTH(v.created_at) = MONTH(CURDATE()) AND YEAR(v.created_at) = YEAR(CURDATE())";
    break;

  case "FORTNIGHT":
    dateFilter = "v.created_at >= DATE_SUB(CURDATE(), INTERVAL 15 DAY)";
    break;

  default:
    dateFilter = "1=1";
}

const [rows] = await db.query(
  `
  SELECT 
    v.user_id,
    u.name,
    jr.name AS job_role,   
    COUNT(*) as totalVisits

  FROM visits v
  LEFT JOIN users u ON v.user_id = u.id
  LEFT JOIN job_roles jr ON u.job_role_id = jr.id

  WHERE v.user_id IN (${userIds.map(() => "?").join(",")})
  AND ${dateFilter}

  GROUP BY v.user_id, u.name, jr.name
  `,
  userIds
);

  return rows;
};