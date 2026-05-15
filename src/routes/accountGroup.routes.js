const express = require("express");
const router = express.Router();
const { createGroup, getGroups, getSingleGroup, updateGroup, deleteGroup, } = require("../controllers/accountGroup.controller");


router.post("/create-accounting-group", createGroup);
router.get("/account-group-list", getGroups);
router.get("/account-group-details/:id", getSingleGroup);
router.put("/update-account-group/:id", updateGroup);
router.delete("/delete-account-group/:id", deleteGroup);

module.exports = router;