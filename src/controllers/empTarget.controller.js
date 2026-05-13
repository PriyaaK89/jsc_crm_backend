const db = require("../config/db");
const empTargetModel = require("../models/empTarget.model");

function calculateEndDate(start_date, duration_type) {

  const start = new Date(start_date);

  switch (duration_type) {

    case "MONTHLY":
      start.setMonth(start.getMonth() + 1);
      break;

    case "QUARTERLY":
      start.setMonth(start.getMonth() + 3);
      break;

    case "HALF_YEARLY":
      start.setMonth(start.getMonth() + 6);
      break;

    case "YEARLY":
      start.setFullYear(start.getFullYear() + 1);
      break;
  }

  start.setDate(start.getDate() - 1);

  return start.toISOString().split("T")[0];
}


// ================= CREATE =================
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
        message: "All fields are required"
      });
    }

    const created_by = req.user.id;

    const end_date = calculateEndDate(
      start_date,
      duration_type
    );

    await connection.beginTransaction();

    const employeeTargetId =
  await empTargetModel.createEmployeeTarget({
    user_id,
    role,
    target_type,
    duration_type,
    start_date,
    end_date,
    target_amount,
    created_by
  });

    await empTargetModel.insertTargetCategories(
      connection,
      employeeTargetId,
      categories
    );

    await connection.commit();

    res.status(201).json({
      message: "Employee target created successfully",
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


// ================= GET ALL =================
exports.getEmployeeTargets = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      role = "",
      target_type = "",
      duration_type = ""
    } = req.query;

    const targets =
      await empTargetModel.getEmployeeTargets({
        page,
        limit,
        search,
        role,
        target_type,
        duration_type
      });

    res.status(200).json({
      message: "Targets fetched successfully",
      ...targets
    });

  } catch (error) {

    res.status(500).json({
      message: error.message
    });
  }
};


// ================= GET SINGLE =================
exports.getEmployeeTargetById = async (req, res) => {

  try {

    const target =
      await empTargetModel.getEmployeeTargetById(
        req.params.id
      );

    if (!target) {
      return res.status(404).json({
        message: "Target not found"
      });
    }

    res.status(200).json({
      message: "Target fetched successfully",
      data: target
    });

  } catch (error) {

    res.status(500).json({
      message: error.message
    });
  }
};


// ================= UPDATE =================
exports.updateEmployeeTarget = async (req, res) => {

  const connection = await db.getConnection();

  try {

    const { id } = req.params;

    const {
      user_id,
      role,
      target_type,
      duration_type,
      start_date,
      categories,
      target_amount
    } = req.body;

    const end_date = calculateEndDate(
      start_date,
      duration_type
    );

    await connection.beginTransaction();

    await empTargetModel.updateEmployeeTarget(
      connection,
      id,
      {
        user_id,
        role,
        target_type,
        duration_type,
        start_date,
        end_date,
        target_amount
      }
    );

    // delete old categories
    await empTargetModel.deleteTargetCategories(
      connection,
      id
    );

    // insert new categories
    await empTargetModel.insertTargetCategories(
      connection,
      id,
      categories
    );

    await connection.commit();

    res.status(200).json({
      message: "Employee target updated successfully"
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


// ================= DELETE =================
exports.deleteEmployeeTarget = async (req, res) => {

  const connection = await db.getConnection();

  try {

    const { id } = req.params;

    await connection.beginTransaction();

    await empTargetModel.deleteTargetCategories(
      connection,
      id
    );

    await empTargetModel.deleteEmployeeTarget(
      connection,
      id
    );

    await connection.commit();

    res.status(200).json({
      message: "Employee target deleted successfully"
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