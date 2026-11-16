// Business Plan module — mounted at /business-plan (see app.js)
const express = require("express");
const router = express.Router();

const auth = require("../../middleware/auth.middleware");
const { checkPermission } = require("../../middleware/permission.middleware");
const Permission = require("../../models/permission.model");
const settings = require("../../controllers/business-plan/bpSettings.controller");
const plans = require("../../controllers/business-plan/bpPlan.controller");
const views = require("../../controllers/business-plan/bpAnalytics.controller");
const sheets = require("../../controllers/business-plan/bpTargetSheet.controller");

const SETTINGS = "MANAGE_BUSINESS_PLAN_SETTINGS";

// Access model (ownership + reporting hierarchy, enforced in the controllers):
//   - every ACTIVE user reaches the module; all data is scoped to self + reporting
//     team (Admin / Super Admin: everything) — bpHelpers.visibleIds
//   - a plan / sheet is changed by its owner, a CREATE_BUSINESS_PLAN holder above the
//     employee, or an admin — bpHelpers.canEditPlanOf
//   - approvals follow the approval steps (reporting line -> RSM / Admin) — bpWorkflow.authority
//   - settings and territories still need MANAGE_BUSINESS_PLAN_SETTINGS
// VIEW_BUSINESS_PLAN is no longer needed to see one's own data (it was the cause of
// "You do not have permission to perform this action" for employees).
const activeUser = async (req, res, next) => {
  try {
    const access = await Permission.getUserAccess(req.user.id);
    if (!access || !access.isActive) {
      return res.status(403).json({ success: false, message: "Your account is not active. Please contact admin." });
    }
    req.access = access;
    return next();
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
const canView = activeUser;
const canCreate = activeUser;
const canDecide = activeUser;
const canAct = activeUser;

router.use(auth);

// ---------- masters, settings, territories ----------
router.get("/masters", canView, settings.getMasters);
router.get("/settings", canView, settings.getSettings);
router.put("/settings", checkPermission(SETTINGS), settings.updateSettings);
router.post("/settings/reset", checkPermission(SETTINGS), settings.resetSettings);
router.post("/settings/options", checkPermission(SETTINGS), settings.addOption);
router.put("/settings/options/:id", checkPermission(SETTINGS), settings.updateOption);
router.delete("/settings/options/:id", checkPermission(SETTINGS), settings.deleteOption);
router.get("/territories", canView, settings.listTerritories);
router.post("/territories", checkPermission(SETTINGS), settings.createTerritory);
router.put("/territories/:id", checkPermission(SETTINGS), settings.updateTerritory);
router.delete("/territories/:id", checkPermission(SETTINGS), settings.deleteTerritory);

// ---------- lookups for the editors ----------
router.get("/lookups/states", canView, settings.lookupStates);
router.get("/lookups/employees", canView, settings.lookupEmployees);
router.get("/lookups/distributors", canView, settings.lookupDistributors);
router.get("/lookups/distributors/:ledgerId/profile", canView, settings.distributorProfile);
router.get("/lookups/retailers", canView, settings.lookupRetailers);
router.get("/lookups/retailers/:id/profile", canView, settings.retailerProfile);
router.get("/lookups/products", canView, settings.lookupProducts);

// ---------- dashboard & analysis ----------
router.get("/dashboard", canView, views.getDashboard);
router.get("/alerts", canView, views.getAlerts);
router.get("/plan-vs-actual", canView, views.getPlanVsActual);
router.get("/matrix", canView, views.getMatrix);
router.get("/forecast", canView, views.getForecast);
router.get("/reports", canView, views.listReports);
router.get("/reports/:key", canView, views.getReport);

// ---------- employee target sheets (own sheet needs no extra permission) ----------
router.get("/target-sheets/prefill", activeUser, sheets.prefill);
router.get("/target-sheets/quarter-targets", activeUser, sheets.getQuarterTargets);
router.get("/target-sheets", activeUser, sheets.listSheets);
router.post("/target-sheets", activeUser, sheets.createSheet);
router.get("/target-sheets/:id", activeUser, sheets.getSheet);
router.get("/target-sheets/:id/approval-history", activeUser, sheets.getSheetHistory);
router.put("/target-sheets/:id", activeUser, sheets.updateSheet);
router.delete("/target-sheets/:id", activeUser, sheets.deleteSheet);
router.post("/target-sheets/:id/submit", activeUser, sheets.submitSheet);
router.post("/target-sheets/:id/approve", activeUser, sheets.approveSheet);
router.post("/target-sheets/:id/return", activeUser, sheets.returnSheet);
// plan targets: re-acknowledge after a plan revision, move a legacy sheet, signed versions
router.post("/target-sheets/:id/reacknowledge", activeUser, sheets.reacknowledge);
router.post("/target-sheets/:id/rebase", activeUser, sheets.rebaseSheet);
router.get("/target-sheets/:id/versions/:versionNo", activeUser, sheets.getVersion);
// monthly performance review (actuals from transactions; employee writes reasons only)
router.get("/target-sheets/:id/review", activeUser, sheets.getReview);
router.put("/target-sheets/:id/review", activeUser, sheets.saveReview);
// target revision requests (employee disagrees with a plan target)
router.post("/target-sheets/:id/revision-requests", activeUser, sheets.createRevisionRequest);
router.get("/target-revision-requests", activeUser, sheets.listRevisionRequests);
router.post("/target-revision-requests/:requestId/decide", activeUser, sheets.decideRevisionRequest);
router.post("/target-revision-requests/:requestId/cancel", activeUser, sheets.cancelRevisionRequest);

// ---------- plans ----------
router.get("/plans", canView, plans.listPlans);
router.post("/plans", canCreate, plans.createPlan);
router.get("/plans/:id", canView, plans.getPlan);
router.put("/plans/:id", canCreate, plans.updatePlan);
router.delete("/plans/:id", activeUser, plans.deletePlan);
router.put("/plans/:id/development", canCreate, plans.updateDevelopment);

// workflow
router.post("/plans/:id/submit", canCreate, plans.submitPlan);
router.post("/plans/:id/approve", canDecide, plans.approvePlan);
router.post("/plans/:id/reject", canDecide, plans.rejectPlan);
router.post("/plans/:id/return", canDecide, plans.returnPlan);
router.post("/plans/:id/reopen", canCreate, plans.reopenPlan);
router.post("/plans/:id/close", canDecide, plans.closePlan);
// revisions: an ACTIVE plan is revised and re-approved; every final approval is a revision
router.post("/plans/:id/revise", canCreate, plans.revisePlan);
router.get("/plans/:id/revisions", canView, plans.listRevisions);
router.get("/plans/:id/revisions/:revisionNo", canView, plans.getRevision);
router.get("/plans/:id/target-sheets", canView, plans.listPlanSheets);

// distributor / retailer / product lines
router.get("/plans/:id/distributors", canView, plans.listDistributors);
router.post("/plans/:id/distributors", canCreate, plans.addDistributor);
router.put("/plans/:id/distributors/:lineId", canCreate, plans.updateDistributor);
router.delete("/plans/:id/distributors/:lineId", canCreate, plans.deleteDistributor);

router.get("/plans/:id/retailers", canView, plans.listRetailers);
router.post("/plans/:id/retailers", canCreate, plans.addRetailer);
router.put("/plans/:id/retailers/:lineId", canCreate, plans.updateRetailer);
router.delete("/plans/:id/retailers/:lineId", canCreate, plans.deleteRetailer);

router.get("/plans/:id/products", canView, plans.listProducts);
router.post("/plans/:id/products", canCreate, plans.addProduct);
router.put("/plans/:id/products/:lineId", canCreate, plans.updateProduct);
router.delete("/plans/:id/products/:lineId", canCreate, plans.deleteProduct);

// monthly plan
router.get("/plans/:id/monthly", canView, plans.getMonthly);
router.put("/plans/:id/monthly", canCreate, plans.saveMonthly);
router.delete("/plans/:id/monthly", canCreate, plans.resetMonthly);

// read-only tabs
router.get("/plans/:id/collection", canView, plans.getCollection);
router.get("/plans/:id/achievement", canView, plans.getAchievement);
router.get("/plans/:id/variance", canView, plans.getVariance);
router.get("/plans/:id/approval-history", canView, plans.getHistory);
router.get("/plans/:id/approval-steps", canView, plans.getApprovalSteps);
router.get("/plans/:id/audit-log", canView, plans.getAuditLog);

// corrective actions
router.get("/plans/:id/corrective-actions", canView, plans.listCorrectiveActions);
router.post("/plans/:id/corrective-actions", canAct, plans.addCorrectiveAction);
router.put("/plans/:id/corrective-actions/:actionId", canAct, plans.updateCorrectiveAction);
router.delete("/plans/:id/corrective-actions/:actionId", canAct, plans.deleteCorrectiveAction);

module.exports = router;
