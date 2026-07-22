import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  orgId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authRequired(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ code: 401, message: "未登录" });
  const token = header.replace(/^Bearer\s+/i, "");
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-secret") as AuthUser;
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ code: 401, message: "登录已过期" });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ code: 401, message: "未登录" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ code: 403, message: "无权限" });
    }
    next();
  };
}
