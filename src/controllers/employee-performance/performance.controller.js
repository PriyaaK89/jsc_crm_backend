const service = require("../../services/performance.service");

const parseScope = (q) => (String(q.scope).toLowerCase() === "role" ? "role" : "team");
const wantsRefresh = (q) => q.refresh === "1" || q.refresh === "true";

// GET /api/my-performance?period=6M|3M|1M&scope=team|role&refresh=1
exports.getMyPerformance = async (req, res) => {
  try {
    const p = String(req.query.period || "6M").toUpperCase();
    const period = ["6M", "3M", "1M"].includes(p) ? p : "6M";

    const data = await service.getFullReport(Number(req.user.id), {
      period,
      scope: parseScope(req.query),
      refresh: wantsRefresh(req.query),
    });

    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("getMyPerformance error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/my-performance/summary  (dashboard card)
exports.getMyPerformanceSummary = async (req, res) => {
  try {
    const data = await service.getSummary(Number(req.user.id), {
      scope: parseScope(req.query),
      refresh: wantsRefresh(req.query),
    });

    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("getMyPerformanceSummary error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};