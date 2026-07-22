import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { ok } from "../utils/response";
import { writeAudit } from "../utils/audit";
import { UserRole } from "@prisma/client";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { username },
      include: { org: true },
    });
    if (!user || !user.active) return res.status(401).json({ code: 401, message: "账号不存在或已停用" });
    const okPwd = await bcrypt.compare(password, user.passwordHash);
    if (!okPwd) return res.status(401).json({ code: 401, message: "密码错误" });
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, orgId: user.orgId },
      process.env.JWT_SECRET || "dev-secret",
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
    );
    await writeAudit({ actorId: user.id, action: "LOGIN", entityType: "user", entityId: user.id });
    res.json(
      ok({
        token,
        user: {
          id: user.id,
          username: user.username,
          fullName: user.fullName,
          role: user.role,
          org: user.org,
        },
      }),
    );
  } catch (e) {
    next(e);
  }
});

authRouter.get("/me", async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ code: 401, message: "未登录" });
    const decoded = jwt.verify(header.replace(/^Bearer\s+/i, ""), process.env.JWT_SECRET || "dev-secret") as any;
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { org: true },
    });
    if (!user) return res.status(401).json({ code: 401, message: "账号已注销" });
    res.json(ok(user));
  } catch (e) {
    next(e);
  }
});
