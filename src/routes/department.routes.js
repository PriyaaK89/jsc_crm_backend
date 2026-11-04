const router = require('express').Router();
const { checkAnyPermission, checkPermission } = require("../middleware/permission.middleware");
const controller = require('../controllers/department.controller');
const auth = require('../middleware/auth.middleware');
const { allowRoles } = require('../middleware/role.middleware');
const { checkAllowedIp, isAdmin } = require("../middleware/checkAllowedIp.middleware")

router.post(
  '/create-department', auth, checkPermission("CREATE_DEPARTMENT"),
  controller.createDepartment
);

router.get('/get-deparments', auth, checkAnyPermission(["VIEW_DEPARTMENT", "CREATE_USER", "UPDATE_USER", "CREATE_JOB_ROLE", "VIEW_JOB_ROLE", "UPDATE_JOB_ROLE"]), 
  //  isAdmin,
    controller.getDepartments);

router.put( '/update-department/:id', auth, checkPermission("UPDATE_DEPARTMENT"), controller.updateDepartment);
router.delete(
  '/delete-department/:id', auth, checkPermission("DELETE_DEPARTMENT"),
  controller.deleteDepartment
);

module.exports = router;
