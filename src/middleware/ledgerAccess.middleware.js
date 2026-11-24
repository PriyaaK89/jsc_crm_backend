// Party ledger access for field employees.
//
// allowOwnLedgerOr(codes, key = "ledger_id")
//   Lets the request through when ANY of these is true:
//     1. the user is Admin / Super Admin, or has one of `codes` (the normal permission check)
//     2. the ledger (read from params / query / body `key`) is assigned (ledgers.employee_under)
//        to the user or to somebody below him in the reporting line (users.reporting_under)
//     3. the ledger is a dealer ("Sundry Debtors") and the user has VIEW_ALL_DISTRIBUTORS
//        (he sees every dealer on the Dealer List, so he may open their ledger)
//   Otherwise it answers 403 exactly like checkPermission (the same audit-mode rule too).
const Permission = require("../models/permission.model");
const userModel = require("../models/user.model");
const { isAuditMode } = require("./permission.middleware");
const dealers = require("../models/dealerList.model");

const VIEW_ALL_DISTRIBUTORS = "VIEW_ALL_DISTRIBUTORS";

const deny = (req, res, next, codes) => {
  if (isAuditMode()) {
    console.warn(
      `[PERMISSION AUDIT] user ${req.user.id} would be denied ${req.method} ${req.originalUrl} (needs ${codes.join(" or ")} or own ledger)`,
    );
    return next();
  }
  return res.status(403).json({
    success: false,
    message: "You do not have permission to perform this action",
  });
};

const allowOwnLedgerOr = (codes, key = "ledger_id") => {
  const list = Array.isArray(codes) ? codes : [codes];
  return async (req, res, next) => {
    try {
      const access = await Permission.getUserAccess(req.user.id);
      if (!access || !access.isActive) {
        return res.status(403).json({
          success: false,
          message: "Your account is not active. Please contact admin.",
        });
      }
      req.access = access;

      // 1. the normal permission check
      if (access.isAdmin || list.some((c) => access.codes.has(c))) return next();

      const raw = req.params[key] ?? req.query[key] ?? req.body?.[key];
      const ledgerId = Number(raw);
      if (!Number.isInteger(ledgerId) || ledgerId <= 0) return deny(req, res, next, list);

      const ledger = await dealers.getLedgerOwner(ledgerId);
      // unknown ledger: let the controller answer (it returns 404 / empty as before) only for
      // users who would pass anyway; everybody else gets the normal 403
      if (!ledger) return deny(req, res, next, list);

      // 3. view-all dealers
      if (ledger.group_name === dealers.DEBTOR_GROUP && access.codes.has(VIEW_ALL_DISTRIBUTORS)) return next();

      // 2. own ledger or a ledger of the reporting team
      if (ledger.employee_under) {
        const team = await userModel.getSubordinateIds(req.user.id);
        if (team.map(Number).includes(Number(ledger.employee_under))) return next();
      }
      return deny(req, res, next, list);
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  };
};

module.exports = { allowOwnLedgerOr, VIEW_ALL_DISTRIBUTORS };
