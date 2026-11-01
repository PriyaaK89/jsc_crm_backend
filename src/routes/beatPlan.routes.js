const express = require("express");
const router = express.Router();

// ⚠ use the SAME auth middleware your other routes use (it must set req.user.id)
const authMiddleware = require("../middleware/auth.middleware");
const c = require("../controllers/beatPlan.controller");
const r = require("../controllers/beatReport.controller");

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

// ---------- team today (manager) ----------
router.get("/team/today", r.teamToday); //            home preview + Team's Day page

// ---------- reports ----------
router.get("/reports/beat-performance", r.beatPerformance);
router.get("/reports/my-kpis", r.myKpis);
router.get("/reports/party-coverage", r.partyCoverage);
router.get("/reports/recovery-priority", r.recoveryPriority);
router.get("/reports/exceptions", r.exceptions);

// ---------- beat change requests ----------
//  ⚠ fixed paths must stay ABOVE the ":id" route
router.get("/change-requests/context", r.changeContext); //  current beat + manager name
router.get("/change-requests/mine", r.myChangeRequests); //  My Beat Change Requests
router.get("/change-requests/pending", r.pendingChangeRequests); // manager
router.post("/change-requests", r.createChangeRequest); //   SUBMIT REQUEST
router.post("/change-requests/:id/decide", r.decideChangeRequest); // manager

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

router.get("/reports/week-compliance", r.weekCompliance);

// ---------- notifications ----------
// ---------- notifications ----------
router.get("/notifications", c.myNotifications);
router.get("/notifications/unread-count", c.unreadNotificationCount);
router.patch("/notifications/read-all", c.markAllNotificationsRead);
router.patch("/notifications/:nid/read", c.markNotificationRead);
router.delete("/notifications", c.deleteAllNotifications);
router.delete("/notifications/:nid", c.deleteNotification);
router.get("/beat-plan-week-summary", c.getWeekSummary);
router.get("/beat/route-overview", c.getRouteOverview)
module.exports = router;