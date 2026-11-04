const express = require("express");
const router = express.Router();
const { checkAnyPermission, checkPermission } = require("../middleware/permission.middleware");
const controller = require("../controllers/godown.controller");
const auth = require("../middleware/auth.middleware");

router.post("/create-godown", auth, checkPermission("CREATE_GODOWN"), controller.createGodown);

router.get("/getGodownList", auth, controller.getAllGodowns);

router.get("/getGodownDetails/:id", auth, checkAnyPermission(["VIEW_GODOWN", "UPDATE_GODOWN"]), controller.getGodownById);

router.put("/update-godown/:id", auth, checkPermission("UPDATE_GODOWN"), controller.updateGodown);

router.delete("/delete-godown/:id", auth, checkPermission("DELETE_GODOWN"), controller.deleteGodown);

module.exports = router;