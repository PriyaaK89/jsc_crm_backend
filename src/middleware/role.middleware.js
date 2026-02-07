exports.allowRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    if (!req.user || !req.user.role) {
  return res.status(401).json({ message: 'Unauthorized' });
   }
    next();
  };
};
