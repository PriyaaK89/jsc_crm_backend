const db = require("../config/db");

exports.submitDailyTargetReportonDayOver = async (data) => {
  const query = `
    INSERT INTO daily_reports
    (user_id, report_date, visits, sales, collection, new_distributor, retailer_visit, farmer_meet)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      visits = VALUES(visits),
      sales = VALUES(sales),
      collection = VALUES(collection),
      new_distributor = VALUES(new_distributor),
      retailer_visit = VALUES(retailer_visit),
      farmer_meet = VALUES(farmer_meet)
  `;

  const [result] = await db.query(query, data);
  return result;
};

exports.getTargetVsAchievement = async ({
  userIds,
  role,
  search,
  category_id,   //  NEW
  limit,
  offset
}) => {

  let where = `WHERE u.id IN (${userIds.map(() => "?").join(",")})`;
  const params = [...userIds];

  //  SEARCH
  if (search) {
    where += ` AND u.name LIKE ?`;
    params.push(`%${search}%`);
  }

  //  ROLE FILTER
  if (role) {
  where += ` AND jr.level = ?`;
  params.push(role);
}

  //  CATEGORY FILTER
  if (category_id) {
    where += ` AND tc.id = ?`;
    params.push(category_id);
  }

  const query = `
    SELECT 
      u.id as user_id,
      u.name,
      jr.name as job_role,
      tc.name as category,

      IFNULL(vt.target, 0) as target,

      CASE 
        WHEN tc.name = 'VISIT' THEN IFNULL(dr.visits, 0)
        WHEN tc.name = 'SALES' THEN IFNULL(dr.sales, 0)
        WHEN tc.name = 'COLLECTION' THEN IFNULL(dr.collection, 0)
        WHEN tc.name = 'NEW_DISTRIBUTOR' THEN IFNULL(dr.new_distributor, 0)
        WHEN tc.name = 'RETAILER_VISIT' THEN IFNULL(dr.retailer_visit, 0)
        WHEN tc.name = 'FARMER_MEET' THEN IFNULL(dr.farmer_meet, 0)
        ELSE 0
      END as achieved

    FROM users u

    LEFT JOIN job_roles jr ON u.job_role_id = jr.id

    --  TARGETS
    LEFT JOIN (
      SELECT assigned_to, category_id, SUM(target_value) as target
      FROM visit_targets
      GROUP BY assigned_to, category_id
    ) vt ON vt.assigned_to = u.id

    LEFT JOIN target_categories tc ON tc.id = vt.category_id

    --  REPORTS
    LEFT JOIN (
      SELECT 
        user_id,
        SUM(visits) as visits,
        SUM(sales) as sales,
        SUM(collection) as collection,
        SUM(new_distributor) as new_distributor,
        SUM(retailer_visit) as retailer_visit,
        SUM(farmer_meet) as farmer_meet
      FROM daily_reports
      GROUP BY user_id
    ) dr ON dr.user_id = u.id

    ${where}

    ORDER BY u.id DESC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await db.query(query, [...params, limit, offset]);

  return rows;
};