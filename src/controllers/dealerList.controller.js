// GET /dealer-list?search=&page=1&limit=20
// GET /dealer-list/:ledger_id/visits?page=1&limit=20
//
// Who sees which dealers:
//   - Admin / Super Admin, or a user with VIEW_ALL_DISTRIBUTORS: every dealer
//   - everybody else: dealers assigned (ledgers.employee_under) to him or to anybody below him
//     in the reporting line (users.reporting_under, user.model.getSubordinateIds)
// The access comes from the existing permission model (Permission.getUserAccess), the same one
// the permission middleware uses.
//
// is_mine on each dealer = assigned to the logged-in user himself. The app allows
// Visit / Order / Payment only for these (the forms list the user's own assigned ledgers).
const Permission = require("../models/permission.model");
const userModel = require("../models/user.model");
const dealers = require("../models/dealerList.model");
const { VIEW_ALL_DISTRIBUTORS } = require("../middleware/ledgerAccess.middleware");

// { access, seesAll, userIds } for the logged-in user; null when the account is inactive
const resolveScope = async (req) => {
  const access = req.access || (await Permission.getUserAccess(req.user.id));
  if (!access || !access.isActive) return null;
  const seesAll = access.isAdmin || access.codes.has(VIEW_ALL_DISTRIBUTORS);
  const userIds = seesAll ? null : (await userModel.getSubordinateIds(req.user.id)).map(Number);
  return { access, seesAll, userIds };
};

const inactive = (res) =>
  res.status(403).json({
    success: false,
    message: "Your account is not active. Please contact admin.",
  });

exports.getDealerList = async (req, res) => {
  try {
    const scope = await resolveScope(req);
    if (!scope) return inactive(res);

    const search = String(req.query.search || "").trim().slice(0, 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const result = await dealers.listDealers({ userIds: scope.userIds, search, page, limit });
    const me = Number(req.user.id);

    return res.status(200).json({
      success: true,
      message: "Dealer list fetched successfully",
      data: {
        items: result.items.map((d) => ({ ...d, is_mine: Number(d.officer_id) === me })),
        summary: result.summary,
        pagination: result.pagination,
        scope: scope.seesAll ? "ALL" : "TEAM",
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

// Visits made to one dealer. The route checks the dealer itself (allowOwnLedgerOr);
// the visits shown are the user's own + his team's (everybody's for admin / view-all),
// the same rule as the Follow-ups list.
exports.getDealerVisits = async (req, res) => {
  try {
    const ledgerId = Number(req.params.ledger_id);
    if (!Number.isInteger(ledgerId) || ledgerId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid dealer" });
    }
    const scope = await resolveScope(req);
    if (!scope) return inactive(res);

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const result = await dealers.listDealerVisits({ ledgerId, userIds: scope.userIds, page, limit });

    // can_open: the existing visit detail API (GET /my-visits/:id) opens only the user's own
    // visits, or any visit for ADMIN / SUPER_ADMIN (same role check as that controller)
    const me = Number(req.user.id);
    const roleAdmin = ["ADMIN", "SUPER_ADMIN"].includes(req.user.role);
    return res.status(200).json({
      success: true,
      message: "Dealer visits fetched successfully",
      data: {
        items: result.items.map((v) => ({ ...v, can_open: roleAdmin || Number(v.user_id) === me })),
        pagination: result.pagination,
      },
    });
  } catch (error) {
    console.error("getDealerVisits Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch dealer visits",
      error: error.message,
    });
  }
};

exports._resolveScope = resolveScope;
