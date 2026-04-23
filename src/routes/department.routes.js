const router = require('express').Router();
const controller = require('../controllers/department.controller');
const auth = require('../middleware/auth.middleware');
const { allowRoles } = require('../middleware/role.middleware');
const { checkAllowedIp, isAdmin, checkPermission} = require("../middleware/checkAllowedIp.middleware")

router.post(
  '/create-department',
  auth, 
  allowRoles('SUPER_ADMIN','ADMIN'), checkPermission('CREATE_DEPARTMENT'),
  controller.createDepartment
);

router.get('/get-deparments', auth, isAdmin, checkPermission('VIEW_DEPARTMENT'),
  //  isAdmin,
    controller.getDepartments);

router.put( '/update-department/:id', auth, isAdmin, controller.updateDepartment);
router.delete(
  '/delete-department/:id',
  auth,
  isAdmin,
  controller.deleteDepartment
);

module.exports = router;
