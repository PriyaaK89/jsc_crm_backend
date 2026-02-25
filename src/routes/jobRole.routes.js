const router = require('express').Router();
const controller = require('../controllers/jobRole.controller');
const auth = require('../middleware/auth.middleware');
const { checkAllowedIp, isAdmin } = require('../middleware/checkAllowedIp.middleware');
const { allowRoles } = require('../middleware/role.middleware');

router.post('/create-jobRole', auth, allowRoles('SUPER_ADMIN', 'ADMIN'), controller.createJobRole);
router.get( '/get-jobRole/:departmentId', auth, isAdmin, controller.getRolesByDepartment);

module.exports = router;
