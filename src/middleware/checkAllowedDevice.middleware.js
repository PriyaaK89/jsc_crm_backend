const UserDevice = require("../models/UserDevice.model");

const getClientDevice = (req) => {
  return {
    deviceId: req.body.device_id || req.headers["x-device-id"],
    deviceName: req.body.device_name || req.headers["x-device-name"] || null,
    platform: req.body.platform || req.headers["x-platform"] || null,
  };
};

const checkAllowedDevice = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { deviceId } = getClientDevice(req);

    if (!deviceId) {
      return res.status(400).json({
        message: "Device ID is required",
      });
    }

    const deviceRecord = await UserDevice.getByUserIdAndDeviceId(userId, deviceId);

    if (!deviceRecord || deviceRecord.is_allowed === 0) {
      return res.status(403).json({
        message: "Access from this device is not allowed. Please contact admin.",
      });
    }

    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== "ADMIN" && req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ message: "Access denied" });
  }
  next();
};

module.exports = {
  checkAllowedDevice,
  isAdmin,
  getClientDevice,
};