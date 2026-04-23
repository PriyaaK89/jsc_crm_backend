const router = require('express').Router();
const controller = require('../controllers/jobRole.controller');
const auth = require('../middleware/auth.middleware');
const { checkAllowedIp, isAdmin } = require('../middleware/checkAllowedIp.middleware');
const { allowRoles } = require('../middleware/role.middleware');

router.post('/create-jobRole', auth, allowRoles('SUPER_ADMIN', 'ADMIN'), controller.createJobRole);
router.get( '/get-jobRole/:departmentId', auth,
     isAdmin,
      controller.getRolesByDepartment);

router.get('/get-jobRole-by-id/:id', auth, controller.getRoleById);
router.put('/update-jobRole/:id', auth, isAdmin, controller.updateJobRole);
router.delete('/delete-jobRole/:id', auth, isAdmin, controller.deleteJobRole);
router.get('/users-by-level/:level', auth, controller.getUsersByLevel);

module.exports = router;
