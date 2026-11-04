const express = require("express");
const router = express.Router();
const { checkAnyPermission, checkPermission } = require("../middleware/permission.middleware");
const { createGroup, getGroups, getSingleGroup, updateGroup, deleteGroup, } = require("../controllers/accountGroup.controller");
const auth = require("../middleware/auth.middleware");
const { checkAllowedIp, isAdmin } = require("../middleware/checkAllowedIp.middleware")


router.post("/create-accounting-group", auth, checkPermission("CREATE_ACCOUNT_GROUP"), createGroup);
router.get("/account-group-list", auth, getGroups);
router.get("/account-group-details/:id", auth, checkAnyPermission(["VIEW_ACCOUNT_GROUP", "UPDATE_ACCOUNT_GROUP"]), getSingleGroup);
router.put("/update-account-group/:id", auth, checkPermission("UPDATE_ACCOUNT_GROUP"), updateGroup);
router.delete("/delete-account-group/:id", auth, checkPermission("DELETE_ACCOUNT_GROUP"), deleteGroup);

module.exports = router;