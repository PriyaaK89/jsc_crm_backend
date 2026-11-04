const express = require("express");
const router = express.Router();
const { checkAnyPermission, checkPermission } = require("../middleware/permission.middleware");
const auth = require("../middleware/auth.middleware");
const controller = require("../controllers/empTarget.controller");
const { allowRoles } = require("../middleware/role.middleware");

router.post( "/assign-employee-target", auth, checkPermission("CREATE_TARGET"), controller.createEmployeeTarget);
router.get( "/get-employee-targets", auth, checkPermission("VIEW_TARGET"), controller.getEmployeeTargets);
router.get( "/get-employee-targets-by-id/:id", auth, checkAnyPermission(["VIEW_TARGET", "UPDATE_TARGET"]), controller.getEmployeeTargetById);
router.put( "/update-employee-targets/:id", auth, checkPermission("UPDATE_TARGET"), controller.updateEmployeeTarget);
router.delete( "/delete-employee-targets/:id", auth, checkPermission("DELETE_TARGET"), controller.deleteEmployeeTarget);
router.get("/all-targets", auth, checkPermission("VIEW_TARGET"), controller.getAllTargets);

router.get("/my-employee-targets", auth, controller.getMyTargets);
router.get("/team-employee-targets", auth, controller.getTeamTargets);

module.exports = router;