const express = require("express");
const router = express.Router();

const {
  getMyTeamHierarchy
} = require("../controllers/rollingUser.controller");

const authMiddleware = require("../middleware/auth.middleware");

router.get(
  "/my-team",
  authMiddleware,
  getMyTeamHierarchy
);

module.exports = router;