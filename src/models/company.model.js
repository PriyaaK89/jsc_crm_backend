const db = require("../config/db");

const createCompany = async (data) => {
  const [result] = await db.query("INSERT INTO companies SET ?", data);
  return result.insertId;
};

module.exports = {
  createCompany,
};