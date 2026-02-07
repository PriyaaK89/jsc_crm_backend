const router = require('express').Router();
const controller = require('../controllers/department.controller');
const auth = require('../middleware/auth.middleware');
const { allowRoles } = require('../middleware/role.middleware');
const { checkAllowedIp} = require("../middleware/checkAllowedIp.middleware")

router.post(
  '/create-department',
  auth,
  allowRoles('SUPER_ADMIN','ADMIN'),
  controller.createDepartment
);

router.get('/get-deparments', auth, checkAllowedIp, controller.getDepartments);

module.exports = router;
