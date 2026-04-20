const db = require('../config/db')

const createEmployeeTarget = async ({
  user_id,
  role,
  target_type,
  duration_type,
  start_date,
  end_date,
  product_category,
  target_amount,
  created_by
}) => {

  const [result] = await db.query(
    `INSERT INTO employee_targets
    (user_id, role, target_type, duration_type, start_date, end_date,
     product_category, target_amount, achieved_amount, pending_amount, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user_id,
      role,
      target_type,
      duration_type,
      start_date,
      end_date,
      product_category,
      target_amount,
      0,
      target_amount,
      created_by
    ]
  );

  return result.insertId;
};

module.exports = {createEmployeeTarget}