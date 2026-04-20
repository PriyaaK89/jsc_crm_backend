const router = require('express').Router();
const controller = require('../controllers/team.controller');
const auth = require('../middleware/auth.middleware');
const { allowRoles } = require('../middleware/role.middleware');

router.post( '/create-team', auth, allowRoles('SUPER_ADMIN', 'ADMIN'), controller.createTeam);
router.get('/get-teams', auth, allowRoles('SUPER_ADMIN', 'ADMIN'),controller.getTeams);
router.get('/get-subteams/:teamId', auth, controller.getSubTeams);
router.get('/getTeam/:id', auth, controller.getTeamById);
router.post( '/create-subteam', auth,  controller.createSubTeam);
router.post('/assign-target', auth, controller.assignTarget);
router.get('/get-assigned-targets', auth, controller.getAssignedTargets);

module.exports = router;