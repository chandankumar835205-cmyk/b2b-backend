const jwt = require("jsonwebtoken");
const User = require("../models/User");

const blockCheck = (req, res, next) => {
  if (req.user && req.user.is_blocked) {
    return res.status(403).json({
      detail: "Your account is blocked by admin. Please contact support."
    });
  }
  next();
};

const protect = async (req, res, next) => {
  let token;
  if (req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      token = req.headers.authorization.split(" ")[1];

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET_KEY
      );

      // Get user data
      req.user = await User.findById(decoded.id).select("-hashed_password");

      if (!req.user) {
        return res.status(401).json({ detail: "User does not exist" });
      }

      return next();
    } catch (error) {
      return res.status(401).json({ detail: "Not authorized, token failed" });
    }
  }

  // No token found
  return res.status(401).json({ detail: "Not authorized, no token" });
};

// ROLE AUTHORIZATION
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        detail: `User role ${req.user ? req.user.role : undefined} is not authorized to access this route`,
      });
    }
    next();
  };
};

module.exports = {
  blockCheck,
  protect,
  authorize,
};
