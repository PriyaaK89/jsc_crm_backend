// Permission codes used in code. They must match permissions.code in the database.
const ACTIONS = {
  VIEW: "VIEW",
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
};

const MANAGE_USER_PERMISSIONS = "MANAGE_USER_PERMISSIONS";

module.exports = { ACTIONS, MANAGE_USER_PERMISSIONS };
