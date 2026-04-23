const db = require("../config/db");
const Target = require("../models/visitTarget.model");
const User = require("../models/user.model");

exports.createTarget = async (req, res) => {
  try {
    const loggedInUser = req.user;

    const {
      assigned_to_ids,
      category_id,
      target_type,
      target_value,
      start_date,
      end_date
    } = req.body;

    //  VALIDATION
    if (!assigned_to_ids || assigned_to_ids.length === 0) {
      return res.status(400).json({ message: "Select users" });
    }

    if (!category_id || !target_type || !target_value) {
      return res.status(400).json({ message: "Missing fields" });
    }

    //  CHECK CATEGORY EXISTS
    const [cat] = await db.query(
      `SELECT id FROM target_categories WHERE id = ?`,
      [category_id]
    );

    if (cat.length === 0) {
      return res.status(400).json({ message: "Invalid category" });
    }

    //  HIERARCHY CHECK
    if (!["ADMIN", "SUPER_ADMIN"].includes(loggedInUser.role)) {
      const allowedUsers = await User.getSubordinateIds(loggedInUser.id);

      for (let id of assigned_to_ids) {
        if (!allowedUsers.includes(id)) {
          return res.status(403).json({
            message: `User ${id} is not your subordinate`
          });
        }
      }
    }

    //  BULK INSERT PREPARE
    const values = assigned_to_ids.map((userId) => ([
      loggedInUser.id,
      userId,
      category_id,
      target_type,
      target_value,
      start_date,
      end_date
    ]));

    await Target.createTarget(values);

    res.status(201).json({
      success: true,
      message: "Targets assigned successfully"
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

exports.getMyTargets = async (req, res) => {
  try {
    const userId = req.user.id;

    const targets = await Target.getTargets(userId);

    res.json({
      success: true,
      data: targets
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



exports.getVisitStats = async (req, res) => {
  try {
    const loggedInUser = req.user;
    const { type } = req.query; // DAILY / WEEKLY / MONTHLY / FORTNIGHT

    let userIds = [];

    if (["ADMIN", "SUPER_ADMIN"].includes(loggedInUser.role)) {
      // all users
      const [users] = await db.query(`SELECT id FROM users`);
      userIds = users.map(u => u.id);
    } else {
      userIds = await User.getSubordinateIds(loggedInUser.id);
    }

    const stats = await Target.getVisitStats(userIds, type);

    res.json({
      success: true,
      type,
      data: stats
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};