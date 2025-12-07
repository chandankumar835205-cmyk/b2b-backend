import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload, VerifyErrors } from "jsonwebtoken";
import User from "../models/User";

export interface AuthRequest extends Request {
  user?: any;
}

export const blockCheck = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user && req.user.is_blocked) {
    return res.status(403).json({
      detail: "Your account is blocked by admin. Please contact support."
    });
  }
  next();
};

export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let token: string | undefined;
if (req.query.token) {
  req.headers.authorization = `Bearer ${req.query.token}`;
}

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      token = req.headers.authorization.split(" ")[1];

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET_KEY!
      ) as JwtPayload;

      // Get user data
      req.user = await User.findById(decoded.id).select("-hashed_password");

      if (!req.user) {
        res.status(401).json({ detail: "User does not exist" });
        return; // 🔥 CRITICAL
      }

      return next(); // ✔ Continue only here

    } catch (error) {
      res.status(401).json({ detail: "Not authorized, token failed" });
      return; // 🔥 CRITICAL
    }
  }

  // No token found
  res.status(401).json({ detail: "Not authorized, no token" });
  return; // 🔥 CRITICAL
};


// ROLE AUTHORIZATION (also needs return)
export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({
        detail: `User role ${req.user?.role} is not authorized to access this route`,
      });
      return; // 🔥 CRITICAL
    }
    next(); // ✔ OK
  };
};


