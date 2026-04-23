const Report = require("../models/dailyReport.model");
const db = require("../config/db");
const User = require("../models/user.model");



exports.submitDailyTargetReportonDayOver = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      visits,
      sales,
      collection,
      new_distributor,
      retailer_visit,
      farmer_meet
    } = req.body;

    const today = new Date().toISOString().split("T")[0];

    await Report.submitDailyTargetReportonDayOver([
      userId,
      today,
      visits || 0,
      sales || 0,
      collection || 0,
      new_distributor || 0,
      retailer_visit || 0,
      farmer_meet || 0
    ]);

    res.json({
      success: true,
      message: "Day report submitted successfully"
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTargetVsAchievement = async (req, res) => {
  try {
    const loggedInUser = req.user;

    const {
      role,
      search,
      category_id,   //  NEW
      page = 1,
      limit = 10
    } = req.query;

    let userIds = [];

    //  HIERARCHY
    if (["ADMIN", "SUPER_ADMIN"].includes(loggedInUser.role)) {
      const [users] = await db.query(`SELECT id FROM users`);
      userIds = users.map(u => u.id);
    } else {
      userIds = await User.getSubordinateIds(loggedInUser.id);
    }

    const offset = (page - 1) * limit;

    const data = await Report.getTargetVsAchievement({
      userIds,
      role,
      search,
      category_id,
      limit: parseInt(limit),
      offset
    });

    res.status(200).json({
      success: true,
      page: parseInt(page),
      limit: parseInt(limit),
      data
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};