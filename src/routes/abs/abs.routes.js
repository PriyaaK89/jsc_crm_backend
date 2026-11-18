// /abs — Advance Booking System (seed advance booking)
//
// Access: every active user can book for parties in their area and see their reporting
// team's bookings (data scoped in the controllers). Office steps need these permissions
// (Admin / Super Admin always pass):
//   CONFIRM_ABS_BOOKING  order confirmation, cancel / short-close confirmed bookings, close
//   ALLOCATE_ABS_STOCK   stock allocation
//   VERIFY_ABS_PAYMENT   verify advances (post Receipt vouchers), refunds
//   DISPATCH_ABS         dispatch (Sales invoice)
//   MANAGE_ABS_SETTINGS  seasons, booking price list, schemes, settings
//   VIEW_ALL_ABS         see every booking
const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth.middleware");
const upload = require("../../middleware/upload.middleware");
const { checkPermission } = require("../../middleware/permission.middleware");
const Permission = require("../../models/permission.model");
const setup = require("../../controllers/abs/absSetup.controller");
const bookings = require("../../controllers/abs/absBooking.controller");
const payments = require("../../controllers/abs/absPayment.controller");
const allocation = require("../../controllers/abs/absAllocation.controller");
const dispatch = require("../../controllers/abs/absDispatch.controller");
const reports = require("../../controllers/abs/absReport.controller");

const activeUser = async (req, res, next) => {
  try {
    const access = await Permission.getUserAccess(req.user.id);
    if (!access || !access.isActive) return res.status(403).json({ success: false, message: "Your account is not active. Please contact admin." });
    req.access = access;
    return next();
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
const settingsOnly = checkPermission("MANAGE_ABS_SETTINGS");

router.use(auth, activeUser);

// masters, parties
router.get("/masters", setup.getMasters);
router.get("/parties", setup.listParties);
router.get("/parties/:ledgerId", setup.getPartySummary);

// settings, seasons, booking price list, schemes
router.get("/settings", setup.getSettings);
router.put("/settings", settingsOnly, setup.updateSettings);
router.get("/seasons", setup.listSeasons);
router.post("/seasons", settingsOnly, setup.createSeason);
router.get("/seasons/:id", setup.getSeason);
router.put("/seasons/:id", settingsOnly, setup.updateSeason);
router.post("/seasons/:id/status", settingsOnly, setup.setSeasonStatus);
router.put("/seasons/:id/products", settingsOnly, setup.saveSeasonProducts);
router.post("/seasons/:id/schemes", settingsOnly, setup.createScheme);
router.put("/seasons/:id/schemes/:schemeId", settingsOnly, setup.updateScheme);
router.delete("/seasons/:id/schemes/:schemeId", settingsOnly, setup.deleteScheme);

// dashboard, reports
router.get("/dashboard", reports.dashboard);
router.get("/reports/:kind", reports.report);

// bookings
router.get("/bookings", bookings.listBookings);
router.post("/bookings", bookings.createBooking);
router.get("/bookings/:id", bookings.getBooking);
router.put("/bookings/:id", bookings.updateBooking);
router.delete("/bookings/:id", bookings.deleteBooking);
router.get("/bookings/:id/history", bookings.getHistory);
router.post("/bookings/:id/submit", bookings.submitBooking);
router.post("/bookings/:id/approve", bookings.approveBooking);
router.post("/bookings/:id/return", bookings.returnBooking);
router.post("/bookings/:id/reject", bookings.rejectBooking);
router.post("/bookings/:id/confirm", bookings.confirmBooking);
router.post("/bookings/:id/cancel", bookings.cancelBooking);
router.post("/bookings/:id/close", bookings.closeBooking);
router.post("/bookings/:id/items/:itemId/short-close", bookings.shortCloseItem);

// advance payments, refunds
router.post("/bookings/:id/payments", upload.single("proof_image"), payments.recordPayment);
router.get("/payments", payments.listPayments);
router.post("/payments/:paymentId/verify", payments.verifyPayment);
router.post("/payments/:paymentId/bounce", payments.bouncePayment);
router.post("/payments/:paymentId/reject", payments.rejectPayment);
router.get("/refunds", payments.listRefunds);
router.post("/refunds/:refundId/settle", payments.settleRefund);

// stock allocation
router.get("/allocation/availability", allocation.getAvailability);
router.get("/allocation/queue", allocation.getQueue);
router.post("/allocation/auto", allocation.autoAllocate);
router.post("/bookings/:id/allocations", allocation.allocateBooking);
router.post("/allocations/:allocationId/release", allocation.releaseAllocation);

// dispatch, delivery
router.get("/bookings/:id/dispatch-preview", dispatch.previewDispatch);
router.post("/bookings/:id/dispatches", dispatch.createDispatch);
router.get("/dispatches", dispatch.listDispatches);
router.get("/dispatches/:dispatchId", dispatch.getDispatch);
router.post("/dispatches/:dispatchId/deliver", upload.single("pod_image"), dispatch.confirmDelivery);

module.exports = router;
