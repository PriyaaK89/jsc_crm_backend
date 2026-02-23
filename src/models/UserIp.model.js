const db = require("../config/db");

const getByUserIdAndIp = async (userId, ip) => {
  const [rows] = await db.query(
    `SELECT * FROM user_ips WHERE user_id = ? AND ip_address = ?`,
    [userId, ip]
  );
  return rows[0];
};

const getAnyIpForUser = async (userId) => {
  const [rows] = await db.query(
    `SELECT * FROM user_ips WHERE user_id = ?`,
    [userId]
  );
  return rows.length > 0;
};


const createIp = async (userId, ip, is_allowed = 0) => {
  await db.query(
    `INSERT INTO user_ips (user_id, ip_address, is_allowed) VALUES (?, ?, ?)`,
    [userId, ip, is_allowed]
  );
};

// const approveIp = async (ipId, adminId) => {
//   await db.query(
//     `UPDATE user_ips SET is_allowed = 1, approved_at = NOW(), approved_by = ? WHERE id = ?`,
//     [adminId, ipId]
//   );
// };

const findById = async (id) => {
  const [rows] = await db.query(
    "SELECT * FROM users WHERE id = ?",
    [id]
  );

  return rows[0];
};


const approveIp = async (ipId, adminId) => {
  await db.query(
    `UPDATE user_ips 
     SET is_allowed = 1, 
         approved_at = NOW(), 
         approved_by = ? 
     WHERE id = ?`,
    [adminId, ipId]
  );

  const [rows] = await db.query(
    `SELECT * FROM user_ips WHERE id = ?`,
    [ipId]
  );

  return rows[0]; //  required
};

const getPendingRequests = async () => {
  const [rows] = await db.query(
    `SELECT ui.*, u.name as user_name FROM user_ips ui JOIN users u ON u.id = ui.user_id WHERE is_allowed = 0`
  );
  return rows;
};

module.exports = { getByUserIdAndIp, getAnyIpForUser, createIp, approveIp, getPendingRequests, findById };
