// routes/demoRoutes.js
const express = require('express');
const router = express.Router();
const auth = require("../../middleware/auth.middleware");
const c = require('../../controllers/product-demo/productDemo.controller');
const upload = require("../../middleware/upload.middleware");
const { MAX_RESULT_PHOTOS } = require('../../models/product-demo/productDemo.model');
const dr = require('../../controllers/product-demo/demoResult.controller');
const tr = require('../../controllers/product-demo/demoTracking.controller');

const proofUpload = upload.fields([
  { name: 'farm_image', maxCount: 1 },
  { name: 'consent_doc', maxCount: 1 },
]);

// Wrapped so multer errors come back as JSON instead of Express's HTML error page
const resultUpload = (req, res, next) => {
  upload.array('result_photos', MAX_RESULT_PHOTOS)(req, res, (err) => {
    if (!err) return next();
    let message = err.message || 'File upload failed';
    if (err.code === 'LIMIT_UNEXPECTED_FILE') message = `You can upload up to ${MAX_RESULT_PHOTOS} photos per result`;
    if (err.code === 'LIMIT_FILE_SIZE') message = 'A photo is too large';
    return res.status(400).json({ success: false, message });
  });
};

// NOTE: fixed paths must stay ABOVE '/:id'
router.get('/me/access', auth, c.myAccess);
router.get('/followup-eligible', auth, c.followupEligible);
router.get('/my-approved-demos', auth, c.myApprovedDemos);   // NEW (employee)
router.get('/demo-results', auth, c.listAllResults);         // NEW (admin)

// notifications (own table: demo_notifications)
router.get('/get-demo-notifications', auth, c.myNotifications);
router.get('/product-demo/notifications/unread-count', auth, c.unreadCount);
router.put('/product-demo/notifications/read-all', auth, c.markAllNotificationsRead);
router.put('/product-demo/notifications/:nid/read', auth, c.markNotificationRead);
router.get('/pending-approval-count', auth, c.pendingApprovalCount);

router.get('/get-customers', auth, c.partyDropdown);
router.get('/field-officers', auth, c.fieldOfficers);
router.post('/demo-requests', auth, proofUpload, c.createDemo);
router.get('/get-demo-request-list', auth, c.listDemos);
router.get('/get-demo-request-details/:id', auth, c.getDemo);

router.get('/:id/results', auth, c.getDemoResults);          // NEW (employee + admin)
router.post('/add-result/:id/results', auth, resultUpload, c.addResult);
router.post('/:id/approve', auth, c.approveDemo);
router.post('/:id/reject', auth, c.rejectDemo);
router.put('/:id', auth, proofUpload, c.updateDemo);

router.get('/eligible-customers', auth, c.eligibleCustomers);

router.get('/my-pending-result-customers', auth, dr.myPendingResultCustomers);

router.get('/:id/customers', auth, c.getDemoCustomers);
router.get('/:id/customers-progress', auth, dr.listDemoCustomersWithProgress);
router.patch('/:id/crop', auth, dr.setCrop);

router.get('/:id/customers/:customerId/results', auth, dr.getResultsForCustomer);
router.get('/:id/customers/:customerId/results/2/growth-fields', auth, dr.getGrowthFieldsForm);
router.post('/:id/customers/:customerId/results/:resultNo', auth, resultUpload, dr.addResult);
router.get('/:id/customers/:customerId/results/3/final-form', auth, dr.getFinalEvaluationForm);

router.get('/:id/customers/:customerId/results/context', auth, dr.getResultContext);

// ---- field tracking ----
router.get('/tracking/active', auth, tr.myActiveTrack);
router.get('/tracking/:trackId', auth, tr.getTrack);
router.post('/tracking/:trackId/points', auth, tr.addPoints);
router.post('/tracking/:trackId/end', auth, tr.endTracking);
router.post('/:id/customers/:customerId/results/:resultNo/tracking/start', auth, tr.startTracking);
router.get('/:id/tracks', auth, tr.listDemoTracks);

module.exports = router;