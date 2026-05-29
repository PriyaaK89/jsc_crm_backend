const express = require("express");
const router = express.Router();
const controller = require("../controllers/godown.controller");
const auth = require("../middleware/auth.middleware");

router.post("/create-godown", auth, controller.createGodown);

router.get("/getGodownList", auth, controller.getAllGodowns);

router.get("/getGodownDetails/:id", auth, controller.getGodownById);

router.put("/update-godown/:id", auth, controller.updateGodown);

router.delete("/delete-godown/:id", auth, controller.deleteGodown);

module.exports = router;