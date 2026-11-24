// GET /dealer-list?search=&page=1&limit=20
//
// Who sees which dealers:
//   - Admin / Super Admin, or a user with VIEW_ALL_DISTRIBUTORS: every dealer
//   - everybody else: dealers assigned (ledgers.employee_under) to him or to anybody below him
//     in the reporting line (users.reporting_under, user.model.getSubordinateIds)
// The access comes from the existing permission model (Permission.getUserAccess), the same one
// the permission middleware uses.
const Permission = require("../models/permission.model");
const userModel = require("../models/user.model");
const dealers = require("../models/dealerList.model");
const { VIEW_ALL_DISTRIBUTORS } = require("../middleware/ledgerAccess.middleware");

exports.getDealerList = async (req, res) => {
  try {
    const access = req.access || (await Permission.getUserAccess(req.user.id));
    if (!access || !access.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account is not active. Please contact admin.",
      });
    }

    const seesAll = access.isAdmin || access.codes.has(VIEW_ALL_DISTRIBUTORS);
    const userIds = seesAll ? null : (await userModel.getSubordinateIds(req.user.id)).map(Number);

    const search = String(req.query.search || "").trim().slice(0, 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const result = await dealers.listDealers({ userIds, search, page, limit });

    return res.status(200).json({
      success: true,
      message: "Dealer list fetched successfully",
      data: {
        items: result.items,
        summary: result.summary,
        pagination: result.pagination,
        scope: seesAll ? "ALL" : "TEAM",
      },
    });
  } catch (error) {
    console.error("getDealerList Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch dealer list",
      error: error.message,
    });
  }
};
