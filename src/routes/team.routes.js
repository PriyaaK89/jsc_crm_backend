const router = require('express').Router();
const { checkAnyPermission, checkPermission } = require("../middleware/permission.middleware");
const controller = require('../controllers/team.controller');
const auth = require('../middleware/auth.middleware');
const { allowRoles } = require('../middleware/role.middleware');

router.post( '/create-team', auth, checkPermission("CREATE_TEAM"), controller.createTeam);
router.get('/get-teams', auth, checkAnyPermission(["VIEW_TEAM", "CREATE_TEAM", "CREATE_TARGET"]), controller.getTeams);
router.get('/get-subteams/:teamId', auth, checkAnyPermission(["VIEW_TEAM", "CREATE_TEAM", "CREATE_TARGET"]), controller.getSubTeams);
router.get('/getTeam/:id', auth, checkAnyPermission(["VIEW_TEAM", "UPDATE_TEAM"]), controller.getTeamById);
router.post( '/create-subteam', auth, checkPermission("CREATE_TEAM"), controller.createSubTeam);
router.post('/assign-target', auth, checkPermission("CREATE_TARGET"), controller.assignTarget);
router.get('/get-assigned-targets', auth, checkPermission("VIEW_TARGET"), controller.getAssignedTargets);
router.put( '/edit-assigned-target/:id', auth, checkPermission("UPDATE_TARGET"), controller.updateAssignedTarget );
router.delete( '/delete-assigned-target/:id', auth, checkPermission("DELETE_TARGET"), controller.deleteAssignedTarget);
router.get( '/get-assigned-target/:id', auth, checkAnyPermission(["VIEW_TARGET", "UPDATE_TARGET"]), controller.getAssignedTargetById);

// TEAM

router.put(
  '/update-team/:id', auth, checkPermission("UPDATE_TEAM"),
  controller.updateTeam
);

router.delete(
  '/delete-team/:id', auth, checkPermission("DELETE_TEAM"),
  controller.deleteTeam
);

// SUBTEAM

router.put(
  '/update-subteam/:id', auth, checkPermission("UPDATE_TEAM"),
  controller.updateSubTeam
);

router.delete(
  '/delete-subteam/:id', auth, checkPermission("DELETE_TEAM"),
  controller.deleteSubTeam
);

module.exports = router;