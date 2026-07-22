import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";

export const userRouter = Router();
userRouter.use(authRequired);

userRouter.get("/", async (req, res, next) => {
  try {
    const { role, orgId, q } = req.query as any;
    const where: any = { active: true };
    if (role) where.role = role;
    if (orgId) where.orgId = orgId;
    if (q) where.fullName = { contains: q, mode: "insensitive" };
    const list = await prisma.user.findMany({ where, include: { org: true } });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});
