const db = require("../config/db");
const StockGroup = require("../models/stockGroup.model");

exports.getHiddenGroupIdsForRequest = async (req) => {
  const userId = req.user?.id;
  if (!userId) return [];

  // cache per request so multiple calls in one request don't re-query
  if (req._hiddenGroupIds) return req._hiddenGroupIds;

  const [rows] = await db.query(
    `SELECT department_id FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );

  const departmentId = rows[0]?.department_id;
  req._hiddenGroupIds = await StockGroup.getHiddenGroupIds(departmentId);

  return req._hiddenGroupIds;
};