const db = require("../config/db");

// GET ROLE ID BY ROLE NAME
const getRoleIdByName = async (roleName) => {
  const [rows] = await db.query(
    "SELECT id FROM roles WHERE name = ?",
    [roleName]
  );

  return rows[0]?.id || null;
};

module.exports = {
  getRoleIdByName
};
