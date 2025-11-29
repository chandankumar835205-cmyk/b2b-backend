import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";

// Extend Request interface to include user
export interface AuthRequest extends Request {
  user?: any;
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      // Get token from header
      token = req.headers.authorization.split(" ")[1];

      // Verify token
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET_KEY || "secret");

      // Get user from the token
      req.user = await User.findById(decoded.id).select("-hashed_password");

      next();
    } catch (error) {
      res.status(401).json({ detail: "Not authorized, token failed" });
    }
  }

  if (!token) {
    res.status(401).json({ detail: "Not authorized, no token" });
  }
};

// Middleware to check for specific roles
export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ 
        detail: `User role ${req.user?.role} is not authorized to access this route` 
      });
    }
    next();
  };
};