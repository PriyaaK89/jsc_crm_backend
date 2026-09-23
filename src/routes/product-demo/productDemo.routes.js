// routes/demoRoutes.js
// STEP 4: routes + file upload (multer memory storage -> MinIO helper)
const express = require('express');
const router = express.Router();
const auth = require("../../middleware/auth.middleware");
const c = require('../../controllers/product-demo/productDemo.controller');
const upload = require("../../middleware/upload.middleware");



const proofUpload = upload.fields([
  { name: 'farm_image', maxCount: 1 },
  { name: 'consent_doc', maxCount: 1 },
]);
const resultUpload = upload.array('result_photos', 5);


// NOTE: fixed paths must stay ABOVE '/:id'
router.get('/me/access', auth, c.myAccess);
router.get('/followup-eligible',auth, c.followupEligible);

// notifications (own table: demo_notifications)
router.get('/get-demo-notifications',auth, c.myNotifications);
router.get('/product-demo/notifications/unread-count',auth, c.unreadCount);
router.put('/product-demo/notifications/read-all',auth, c.markAllNotificationsRead);
router.put('/product-demo/notifications/:nid/read',auth, c.markNotificationRead);

router.get('/get-customers', auth, c.partyDropdown);
router.post('/demo-requests', auth, proofUpload, c.createDemo);
router.get('/get-demo-request-list', auth, c.listDemos);
router.get('/get-demo-request-details/:id', auth, c.getDemo);
router.put('/:id', auth, proofUpload, c.updateDemo);

router.post('/:id/approve', auth, c.approveDemo);
router.post('/:id/reject', auth, c.rejectDemo);
router.post('/:id/results', auth, resultUpload, c.addResult);
router.get('/field-officers', auth, c.fieldOfficers);

module.exports = router;
