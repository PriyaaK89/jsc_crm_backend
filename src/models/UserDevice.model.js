const db = require("../config/db");

const getByUserIdAndDeviceId = async (userId, deviceId) => {
  const [rows] = await db.query(
    `SELECT * FROM user_devices WHERE user_id = ? AND device_id = ?`,
    [userId, deviceId]
  );
  return rows[0];
};

const getAnyDeviceForUser = async (userId) => {
  const [rows] = await db.query(
    `SELECT * FROM user_devices WHERE user_id = ?`,
    [userId]
  );
  return rows.length > 0;
};

const createDevice = async (
  userId,
  deviceId,
  deviceName = null,
  platform = null,
  isAllowed = 0
) => {
  await db.query(
    `INSERT INTO user_devices (user_id, device_id, device_name, platform, is_allowed)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, deviceId, deviceName, platform, isAllowed]
  );
};

const approveDevice = async (deviceRequestId, adminId) => {
  await db.query(
    `UPDATE user_devices
     SET is_allowed = 1, approved_at = NOW(), approved_by = ?
     WHERE id = ?`,
    [adminId, deviceRequestId]
  );

  const [rows] = await db.query(
    `SELECT * FROM user_devices WHERE id = ?`,
    [deviceRequestId]
  );

  return rows[0];
};

const getPendingRequests = async () => {
  const [rows] = await db.query(
    `SELECT ud.*, u.name AS user_name, u.email
     FROM user_devices ud
     JOIN users u ON u.id = ud.user_id
     WHERE ud.is_allowed = 0`
  );
  return rows;
};

const findUserById = async (id) => {
  const [rows] = await db.query(
    `SELECT * FROM users WHERE id = ?`,
    [id]
  );
  return rows[0];
};

module.exports = {
  getByUserIdAndDeviceId,
  getAnyDeviceForUser,
  createDevice,
  approveDevice,
  getPendingRequests,
  findUserById,
};