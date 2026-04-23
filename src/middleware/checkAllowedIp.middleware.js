const UserIp = require("../models/UserIp.model");

const getClientIp = (req) => {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.ip
  );
};

const checkAllowedIp = async (req, res, next) => {
  try {
    const userId = req.user.id; // from JWT
    const ipAddress = getClientIp(req);

    const ipRecord = await UserIp.getByUserIdAndIp(userId, ipAddress);

    if (!ipRecord || ipRecord.is_allowed === 0) {
      return res.status(403).json({
        message: "Access from this IP is not allowed. Please contact admin."
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

const checkPermission = (code) => {
  return async (req, res, next) => {
    try {
      const user = req.user;

      //  BYPASS for ADMIN / SUPER_ADMIN
      if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
        return next();
      }

      const [rows] = await db.query(`
        SELECT up.is_allowed
        FROM user_permissions up
        JOIN permissions p ON p.id = up.permission_id
        WHERE up.user_id = ? AND p.code = ?
      `, [user.id, code]);

      if (!rows.length || rows[0].is_allowed === 0) {
        return res.status(403).json({ message: 'Access denied' });
      }

      next();
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  };
};

module.exports = {checkAllowedIp, isAdmin, checkPermission};
