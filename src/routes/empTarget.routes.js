const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const controller = require("../controllers/empTarget.controller");
const { allowRoles } = require("../middleware/role.middleware");

router.post( "/assign-employee-target", auth, allowRoles("SUPER_ADMIN", "ADMIN"), controller.createEmployeeTarget);
router.get( "/get-employee-targets", auth, controller.getEmployeeTargets);
router.get( "/get-employee-targets-by-id/:id", auth, controller.getEmployeeTargetById);
router.put( "/update-employee-targets/:id", auth, allowRoles("SUPER_ADMIN", "ADMIN"), controller.updateEmployeeTarget);
router.delete( "/delete-employee-targets/:id", auth, allowRoles("SUPER_ADMIN", "ADMIN"), controller.deleteEmployeeTarget);

module.exports = router;