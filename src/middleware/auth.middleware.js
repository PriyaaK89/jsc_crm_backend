const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  try {
    //  Check Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Authorization header missing'
      });
    }

    //  Check Bearer token format
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token format'
      });
    }

    //  Extract token
    const token = authHeader.split(' ')[1];

    //  Verify token using ENV secret
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    //  Attach user data to request
    req.user = {
      id: decoded.id,
      role: decoded.role
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};
