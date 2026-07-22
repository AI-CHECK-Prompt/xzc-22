import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";
import { z } from "zod";

export const chemicalRouter = Router();
chemicalRouter.use(authRequired);

chemicalRouter.get("/", async (req, res, next) => {
  try {
    const { q, hazardClass, storageClass } = req.query as any;
    const where: any = {};
    if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { casNo: { contains: q } }];
    if (hazardClass) where.hazardClass = hazardClass;
    if (storageClass) where.storageClass = storageClass;
    const list = await prisma.chemical.findMany({ where, orderBy: { name: "asc" } });
    res.json(ok(list));
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
