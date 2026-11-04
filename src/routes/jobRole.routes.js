const router = require('express').Router();
const { checkAnyPermission, checkPermission } = require("../middleware/permission.middleware");
const controller = require('../controllers/jobRole.controller');
const auth = require('../middleware/auth.middleware');
const { checkAllowedIp, isAdmin } = require('../middleware/checkAllowedIp.middleware');
const { allowRoles } = require('../middleware/role.middleware');

router.post('/create-jobRole', auth, checkPermission("CREATE_JOB_ROLE"), controller.createJobRole);
router.get( '/get-jobRole/:departmentId', auth, checkAnyPermission(["VIEW_JOB_ROLE", "CREATE_USER", "UPDATE_USER"]), 
      controller.getRolesByDepartment);

router.get('/get-jobRole-by-id/:id', auth, checkAnyPermission(["VIEW_JOB_ROLE", "UPDATE_JOB_ROLE"]), controller.getRoleById);
router.put('/update-jobRole/:id', auth, checkPermission("UPDATE_JOB_ROLE"), controller.updateJobRole);
router.delete('/delete-jobRole/:id', auth, checkPermission("DELETE_JOB_ROLE"), controller.deleteJobRole);
router.get('/users-by-level/:level', auth, controller.getUsersByLevel);

module.exports = router;