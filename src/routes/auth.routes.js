const express = require('express');
const router = express.Router();
const auth = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { allowRoles } = require('../middleware/role.middleware');
const {isAdmin} = require("../middleware/checkAllowedIp.middleware")


router.post('/create-admin', authMiddleware, allowRoles('SUPER_ADMIN'),
  (req, res, next) => {
    req.body.roleName = 'ADMIN';
      next(); }, auth.createUserByRole );

router.post('/create-user', authMiddleware, isAdmin,
  (req, res, next) => { req.body.roleName = 'USER';
    next();
  },
  auth.createUserByRole
);

router.get("/get-ip-requests", authMiddleware, isAdmin, auth.getPendingIpRequests);
router.post( "/approve-ip/:ipId", authMiddleware, isAdmin, auth.approveIpRequest);
router.post('/login', auth.login);
router.get( '/get-users', authMiddleware, isAdmin, auth.getUsersList);
router.put( "/update-user/:id", authMiddleware, isAdmin, auth.updateUserById);

router.post(
  "/set-password/:userId",
  authMiddleware,
  allowRoles("ADMIN", "SUPER_ADMIN"),
  auth.setUserPassword
);

module.exports = router;
