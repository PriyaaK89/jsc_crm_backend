const express = require("express");
const router = express.Router();
const controller = require("../controllers/godown.controller");

router.post("/create-godown", controller.createGodown);

router.get("/getGodownList", controller.getAllGodowns);

router.get("/getGodownDetails/:id", controller.getGodownById);

router.put("/update-godown/:id", controller.updateGodown);

router.delete("/delete-godown/:id", controller.deleteGodown);

module.exports = router;