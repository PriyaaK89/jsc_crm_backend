const express = require("express");
const router = express.Router();
const { getTeamOverview } = require("../../controllers/teams/teamOverview.controller");
const auth = require("../../middleware/auth.middleware")

router.get("/team-overview", auth, getTeamOverview);

module.exports = router;