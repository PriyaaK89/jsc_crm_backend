const { getUserWithRole, getDirectSubordinates } = require("../models/rollingUser.model");

const getManagers = async (userId) => {
  let managers = [];
  let currentUser = await getUserWithRole(userId);
  while (currentUser && currentUser.reporting_under) {
    const manager = await getUserWithRole( currentUser.reporting_under );
    if (manager) {
      managers.push(manager);
      currentUser = manager;
    } else {
      break;
    }
  }
  return managers;
};

const getSubordinates = async (userId) => {
  let allSubordinates = [];
  const directSubs = await getDirectSubordinates(userId);
  for (const sub of directSubs) {
    allSubordinates.push(sub);
    const nestedSubs = await getSubordinates(sub.id);
    allSubordinates = [ ...allSubordinates, ...nestedSubs ]; }
  return allSubordinates;
};

// exports.getSubordinates = async (userId) => {
//   let allSubordinates = [];
//   const directSubs = await getDirectSubordinates(userId);

//   for (const sub of directSubs) {
//     allSubordinates.push(sub);
//     const nestedSubs = await getSubordinates(sub.id);
//     allSubordinates.push(...nestedSubs);
//   }
//   return allSubordinates;
// };
exports.getManagers = getManagers;
exports.getSubordinates = getSubordinates;
// ======================================
// MAIN API
// ======================================
exports.getMyTeamHierarchy = async (req, res) => {
  try {
    const userId = req.user.id;

    // current logged user
    const currentUser = await getUserWithRole(userId);
    if (!currentUser) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    // upper hierarchy
    const managers = await getManagers(userId);
    const team = await getSubordinates(userId);

    return res.status(200).json({ current_user: currentUser, managers, team });

  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: "Something went wrong",
      error: error.message
    });
  }
};

exports.getHierarchyIds = async (userId) => {
  const subs = await getSubordinates(userId);

  return [
    userId,
    ...subs.map(x => x.id)
  ];
};