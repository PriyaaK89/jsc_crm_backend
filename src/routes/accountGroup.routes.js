const express = require("express");
const router = express.Router();
const { createGroup, getGroups, getSingleGroup, updateGroup, deleteGroup, } = require("../controllers/accountGroup.controller");
const auth = require("../middleware/auth.middleware");
const { checkAllowedIp, isAdmin, checkPermission} = require("../middleware/checkAllowedIp.middleware")


router.post("/create-accounting-group", auth, createGroup);
router.get("/account-group-list", auth, getGroups);
router.get("/account-group-details/:id", auth, getSingleGroup);
router.put("/update-account-group/:id", auth, updateGroup);
router.delete("/delete-account-group/:id", auth, deleteGroup);

module.exports = router;