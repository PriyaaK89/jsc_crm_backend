const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth.middleware")
const { getTeamOverview, getMemberDetails, getMemberDashboard,} = require("../../controllers/teams/teamOverview.controller");

router.get("/team-overview", auth, getTeamOverview);
router.get("/team-overview/member/:id", auth, getMemberDetails);
router.get("/team-overview/member/:id/dashboard", auth, getMemberDashboard);

module.exports = router;