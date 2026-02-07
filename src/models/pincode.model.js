const db = require("../config/db");

exports.searchPincode = async (pincode) => {
  const [rows] = await db.query(
    "SELECT * FROM pincodes WHERE pincode = ?",
    [pincode]
  );
  return rows;
};

exports.searchByDistrict = async (district) => {
  const [rows] = await db.query(
    "SELECT * FROM pincodes WHERE district LIKE ? LIMIT 100",
    [`%${district}%`]
  );
  return rows;
};

exports.getAreasByPincode = async (pincode) => {
  const [rows] = await db.query(
    `
    SELECT DISTINCT officename
    FROM pincodes
    WHERE pincode = ?
    ORDER BY officename
    `,
    [pincode]
  );
  return rows;
};