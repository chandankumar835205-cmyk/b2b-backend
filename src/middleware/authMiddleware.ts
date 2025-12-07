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

  try {
    // 1. Token from query → FIRST PRIORITY
    if (req.query.token) {
      token = String(req.query.token);
    }

    // 2. Token from Authorization header
    else if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({ detail: "Not authorized, no token" });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET_KEY!
    ) as JwtPayload;

    req.user = await User.findById(decoded.id).select("-hashed_password");

    if (!req.user) {
      return res.status(401).json({ detail: "User does not exist" });
    }

    next();
  } catch (error) {
    return res.status(401).json({ detail: "Not authorized, token failed" });
  }
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


