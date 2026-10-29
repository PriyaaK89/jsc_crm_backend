const express = require("express");
const router = express.Router();

// ⚠ use the SAME auth middleware your other routes use (it must set req.user.id)
const authMiddleware = require("../middleware/auth.middleware");
const c = require("../controllers/beatPlan.controller");

router.use(authMiddleware);

// ---------- beats: employee (Day Plan screen) ----------
router.get("/beats/my", c.getMyBeats); //            beats assigned to me
router.post("/beats/location", c.addLocation); //    "+ ADD & SELECT LOCATION"

// ---------- beats: manager (Manage Beats screen) ----------
//  ⚠ fixed paths (/managed, /team, /parties) must stay ABOVE "/beats/:id"
router.get("/team", c.getTeam); //                   is_manager + team members
router.get("/parties", c.searchParties); //          party picker
router.get("/beats/managed", c.listManagedBeats); // beats of my team
router.post("/beats", c.createBeat); //              create + assign
router.get("/beats/:id", c.getManagedBeat); //       one beat with parties
router.put("/beats/:id", c.updateBeat); //           edit / reassign
router.post("/beats/:id/status", c.setBeatStatus); // activate / deactivate

// ---------- Beat Plan home screen ----------
router.get("/today", c.getToday); //                 today's beat + counts

// ---------- manager: approvals ----------
router.get("/approvals/pending", c.pendingApprovals);

// ---------- employee: weekly plan ----------
router.get("/plans", c.listMyPlans); //                    Weekly Beat Plan list
router.post("/plans", c.openPlan); //                      "+ New Plan" / open a week
router.get("/plans/:id", c.getPlan); //                    Weekly Plan Editor
router.put("/plans/:id/days/:date", c.saveDay); //         SAVE DAY PLAN
router.delete("/plans/:id/days/:date", c.clearDay); //     clear a day
router.post("/plans/:id/submit", c.submitPlan); //         SUBMIT FOR APPROVAL
router.post("/plans/:id/withdraw", c.withdrawPlan); //     take back before manager acts

// ---------- manager: decide ----------
router.post("/plans/:id/approve", c.approvePlan);
router.post("/plans/:id/reject", c.rejectPlan);

module.exports = router;

// In app.js / server.js add:
//   app.use("/api/beat-plan", require("./routes/beatPlanRoutes"));