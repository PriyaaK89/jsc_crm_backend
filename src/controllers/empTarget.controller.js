const empTargetModel = require("../models/empTarget.model")

function calculateEndDate(start_date, duration_type) {
  const start = new Date(start_date);

  if (duration_type === 'MONTHLY') start.setMonth(start.getMonth() + 1);
  if (duration_type === 'QUARTERLY') start.setMonth(start.getMonth() + 3);
  if (duration_type === 'HALF_YEARLY') start.setMonth(start.getMonth() + 6);
  if (duration_type === 'YEARLY') start.setFullYear(start.getFullYear() + 1);

  start.setDate(start.getDate() - 1);

  return start.toISOString().split('T')[0];
}

exports.createEmployeeTarget = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const {
      user_id,
      role,
      target_type,
      duration_type,
      start_date,
      categories,
      target_amount
    } = req.body;

    if (
      !user_id ||
      !role ||
      !target_type ||
      !duration_type ||
      !start_date ||
      !target_amount ||
      !categories ||
      !categories.length
    ) {
      return res.status(400).json({
        message: 'All fields including categories are required'
      });
    }

    const created_by = req.user.id;

    const end_date = calculateEndDate(start_date, duration_type);

    await connection.beginTransaction();

    // 1. Insert employee target
    const [result] = await connection.query(
      `INSERT INTO employee_targets
      (user_id, role, target_type, duration_type, start_date, end_date,
       target_amount, achieved_amount, pending_amount, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        role,
        target_type,
        duration_type,
        start_date,
        end_date,
        target_amount,
        0,
        target_amount,
        created_by
      ]
    );

    const employeeTargetId = result.insertId;

    // 2. Insert categories mapping
    const categoryValues = categories.map((catId) => [
      employeeTargetId,
      catId
    ]);

    await connection.query(
      `INSERT INTO employee_target_categories
      (employee_target_id, category_id)
      VALUES ?`,
      [categoryValues]
    );

    await connection.commit();

    res.status(201).json({
      message: 'Employee target created successfully',
      id: employeeTargetId
    });

  } catch (error) {
    await connection.rollback();

    res.status(500).json({
      message: error.message
    });
  } finally {
    connection.release();
  }
};