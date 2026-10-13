const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth.middleware");
const controller = require("../../controllers/assign-area-to-emp/collectionArea.controller");
const { allowRoles } = require("../../middleware/role.middleware");

router.get("/collection-area-config", auth, controller.getCollectionAreaConfig);
router.get("/geo/states", auth, controller.getStates);
router.get("/geo/districts", auth, controller.getDistricts);
router.get("/geo/tehsils", auth, controller.getTehsils);
router.get("/geo/villages", auth, controller.getVillages);

router.get("/employee-collection-areas/:employeeId", auth, controller.getEmployeeCollectionAreas);
router.put("/employee-collection-areas/:employeeId", auth, allowRoles("SUPER_ADMIN", "ADMIN"), controller.saveEmployeeCollectionAreas);
router.get("/collection-area-employees", auth, allowRoles("SUPER_ADMIN", "ADMIN"), controller.getEmployeesByRole);
router.post("/assign-collection-areas", auth, allowRoles("SUPER_ADMIN", "ADMIN"), controller.assignCollectionAreas);
module.exports = router;