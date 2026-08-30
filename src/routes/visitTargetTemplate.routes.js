const express = require("express");
const router = express.Router();

const visitTargetController = require("../controllers/visitTargetTemplate.controller");
// Adjust to your actual auth/permission middleware names
// const { authorize } = require("../middleware/role.middleware");
const auth = require('../middleware/auth.middleware');



/**
 * Templates
 */
router.post("/visit-targets/templates", auth, visitTargetController.createTemplate);
router.get("/visit-targets/templates", auth, visitTargetController.listTemplates);
router.get("/visit-targets/templates/dropdown", auth, visitTargetController.templateDropdown);
router.get("/visit-targets/templates/:id", auth, visitTargetController.getTemplate);
router.put("/visit-targets/templates/:id", auth, visitTargetController.updateTemplate);
router.delete("/visit-targets/templates/:id", auth, visitTargetController.deleteTemplate);
router.patch("/visit-targets/templates/:id/reactivate", auth, visitTargetController.reactivateTemplate);
router.delete("/visit-targets/templates/:id/permanent-delete", auth, visitTargetController.hardDeleteTemplate);
router.patch("/visit-targets/templates/:id/hold", auth, visitTargetController.holdTemplate);
router.patch("/visit-targets/templates/:id/unhold", auth, visitTargetController.unholdTemplate);
/**
 * Assignments
 */
router.get("/visit-targets/assignments/:id", auth, visitTargetController.getAssignment);
router.get("/visit-targets/assignments/:id/progress", auth, visitTargetController.getAssignmentProgress);
router.patch("/visit-targets/assignments/:id/complete", auth, visitTargetController.completeAssignment);
router.patch("/visit-targets/assignments/:id/expire", auth, visitTargetController.expireAssignment);

/**
 * Progress / reporting
 */
router.get("/visit-targets/progress/employee/:employeeId", auth, visitTargetController.getEmployeeProgress);
router.get("/visit-targets/progress/admin", auth, visitTargetController.getAdminProgress);
router.get("/visit-targets/progress/history",auth, visitTargetController.getAssignmentHistory);

router.get("/get-teamwise-visit-target-template", auth, visitTargetController.getTeamProgress);

module.exports = router;

/**
 * Mount this in your main app/router, e.g.:
 *   app.use("/api/visit-targets", require("./routes/visitTarget.routes"));
 *
 * If certain endpoints (create/update/delete templates, admin progress,
 * manual complete/expire) should be restricted to specific roles
 * (e.g. RSM/ZSM/admin only, not a plain SO/FA), uncomment the
 * `authorize` import above and wrap those routes, e.g.:
 *   router.post("/templates", authorize(["ADMIN", "RSM", "ZSM"]), visitTargetController.createTemplate);
 * I left this out since your role model/middleware name wasn't specified.
 */