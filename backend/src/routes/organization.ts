import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";

export const orgRouter = Router();

orgRouter.use(authRequired);

orgRouter.get("/", async (req, res, next) => {
  try {
    const { type, parentId, q } = req.query as any;
    const where: any = {};
    if (type) where.type = type;
    if (parentId) where.parentId = parentId;
    if (q) where.name = { contains: q, mode: "insensitive" };
    const list = await prisma.organization.findMany({ where, include: { children: true, parent: true } });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});

orgRouter.get("/tree", async (_req, res, next) => {
  try {
    const all = await prisma.organization.findMany();
    const map: Record<string, any> = {};
    all.forEach((o) => (map[o.id] = { ...o, children: [] }));
    const roots: any[] = [];
    all.forEach((o) => {
      if (o.parentId && map[o.parentId]) map[o.parentId].children.push(map[o.id]);
      else roots.push(map[o.id]);
    });
    res.json(ok(roots));
  } catch (e) {
    next(e);
  }
});
