const express = require("express");
const router = express.Router();

// ⚠ use the SAME auth middleware your other routes use (it must set req.user.id)
const authMiddleware = require("../middleware/auth.middleware");
const c = require("../controllers/beatPlan.controller");

router.use(authMiddleware);

// ---------- beats (used by the Day Plan screen) ----------
router.get("/beats/my", c.getMyBeats); //          list beats I can pick
router.post("/beats/location", c.addLocation); //  "+ ADD & SELECT LOCATION"
router.post("/beats", c.createBeat); //            manager creates / assigns a beat

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