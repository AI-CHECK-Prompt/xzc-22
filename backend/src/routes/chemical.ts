import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";
import { z } from "zod";
import { userCanAccessHazardClass, parseHazardCategories } from "../utils/access";

export const chemicalRouter = Router();
chemicalRouter.use(authRequired);

chemicalRouter.get("/", async (req, res, next) => {
  try {
    const { q, hazardClass, storageClass, projectId } = req.query as any;
    const where: any = {};
    if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { casNo: { contains: q } }];
    if (hazardClass) where.hazardClass = hazardClass;
    if (storageClass) where.storageClass = storageClass;

    // 联动：按 projectId 过滤可领用的化学品类别
    //   - 化学品 hazardClass 必须落在 project.hazardCategories 内
    let allowedCategories: string[] | null = null;
    if (projectId) {
      const project = await prisma.project.findUnique({ where: { id: String(projectId) } });
      if (!project) return res.status(404).json({ code: 404, message: "项目不存在" });
      if (project.status !== "ACTIVE") {
        return res.status(400).json({ code: 400, message: `项目已${project.status === "COMPLETED" ? "结题" : "取消"}，无可领用化学品` });
      }
      allowedCategories = parseHazardCategories(project.hazardCategories);
      where.hazardClass = { in: allowedCategories };
    }

    const list = await prisma.chemical.findMany({ where, orderBy: { name: "asc" } });
    res.json(ok({ items: list, allowedCategories, projectId: projectId || null }));
  } catch (e) {
    next(e);
  }
});

// 列出"我当前可领用"的化学品：按我的资格 + 关联项目过滤
// 接受 ?projectId=... 可同时校验项目品类范围
chemicalRouter.get("/requisition-available", async (req, res, next) => {
  try {
    const { projectId, q } = req.query as any;
    const userId = req.user!.id;

    let allowedByProject: string[] | null = null;
    if (projectId) {
      const project = await prisma.project.findUnique({ where: { id: String(projectId) } });
      if (!project) return res.status(404).json({ code: 404, message: "项目不存在" });
      if (project.status !== "ACTIVE") {
        return res.status(400).json({ code: 400, message: `项目已${project.status === "COMPLETED" ? "结题" : "取消"}，无可领用化学品` });
      }
      allowedByProject = parseHazardCategories(project.hazardCategories);
    }

    const all = await prisma.chemical.findMany({
      where: q
        ? { OR: [{ name: { contains: String(q), mode: "insensitive" } }, { casNo: { contains: String(q) } }] }
        : undefined,
      orderBy: { name: "asc" },
    });

    const accessible = [];
    for (const ch of all) {
      if (allowedByProject && !allowedByProject.includes(ch.hazardClass)) continue;
      const okAccess = await userCanAccessHazardClass(userId, ch.hazardClass, projectId || undefined);
      if (!okAccess) continue;
      accessible.push(ch);
    }

    res.json(ok({ items: accessible, total: all.length, accessibleCount: accessible.length, projectId: projectId || null }));
  } catch (e) {
    next(e);
  }
});

const createSchema = z.object({
  casNo: z.string(),
  name: z.string(),
  nameEn: z.string().optional(),
  formula: z.string().optional(),
  hazardClass: z.string(),
  storageClass: z.string(),
  purchaseLimit: z.number().optional(),
  monthlyLimit: z.number().optional(),
  unit: z.string().default("mL"),
  description: z.string().optional(),
});

chemicalRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const ch = await prisma.chemical.create({ data: data as any });
    res.json(ok(ch));
  } catch (e) {
    next(e);
  }
});
