import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";
import { writeAudit } from "../utils/audit";
import { z } from "zod";
import { WasteCategory } from "@prisma/client";

export const wasteRouter = Router();
wasteRouter.use(authRequired);

// 相容性矩阵：同类或同安全等级才允许倒入
const COMPATIBILITY: Record<WasteCategory, WasteCategory[]> = {
  ORGANIC: ["ORGANIC"],
  HEAVY_METAL: ["HEAVY_METAL"],
  ACID: ["ACID"],
  ALKALI: ["ALKALI"],
  OXIDIZER: ["OXIDIZER"],
  UNKNOWN: [],
};

wasteRouter.post("/compat-check", async (req, res) => {
  const { bucketCategory, incomingCategory } = req.body as { bucketCategory: WasteCategory; incomingCategory: WasteCategory };
  const okFlag = COMPATIBILITY[incomingCategory]?.includes(bucketCategory) ?? false;
  res.json(ok({ compatible: okFlag, rule: `仅允许向同类废液桶倒入 ${incomingCategory}` }));
});

wasteRouter.get("/buckets", async (req, res, next) => {
  try {
    const { status, ownerOrgId, category } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (ownerOrgId) where.ownerOrgId = ownerOrgId;
    if (category) where.category = category;
    const list = await prisma.wasteBucket.findMany({
      where,
      include: { ownerOrg: true },
      orderBy: { bucketNo: "asc" },
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});

wasteRouter.post("/buckets", async (req, res, next) => {
  try {
    const data = z
      .object({
        bucketNo: z.string(),
        ownerOrgId: z.string(),
        category: z.nativeEnum(WasteCategory),
        capacity: z.number(),
        locatedAt: z.string(),
      })
      .parse(req.body);
    const b = await prisma.wasteBucket.create({ data });
    res.json(ok(b));
  } catch (e) {
    next(e);
  }
});

const handoffSchema = z.object({
  bucketId: z.string(),
  toOrgId: z.string(),
  weight: z.number(),
  category: z.nativeEnum(WasteCategory),
  photoUrl: z.string().optional(),
  signature: z.string().optional(),
  remark: z.string().optional(),
});

wasteRouter.post("/handoff", async (req, res, next) => {
  try {
    const data = handoffSchema.parse(req.body);
    const bucket = await prisma.wasteBucket.findUnique({ where: { id: data.bucketId } });
    if (!bucket) return res.status(404).json({ code: 404, message: "废液桶不存在" });
    if (!COMPATIBILITY[data.category]?.includes(bucket.category)) {
      return res.status(400).json({ code: 400, message: `相容性校验失败：${bucket.category} 桶不允许倒入 ${data.category}` });
    }
    const h = await prisma.wasteHandoff.create({
      data: {
        bucketId: data.bucketId,
        fromOrgId: bucket.ownerOrgId,
        toOrgId: data.toOrgId,
        fromUserId: req.user!.id,
        toUserId: req.user!.id,
        weight: data.weight,
        category: data.category,
        photoUrl: data.photoUrl,
        signature: data.signature,
        remark: data.remark,
      },
    });
    await prisma.wasteBucket.update({
      where: { id: data.bucketId },
      data: { currentVolume: { increment: data.weight }, lastHandoffAt: new Date(), status: "PENDING_HANDOVER" },
    });
    await writeAudit({
      actorId: req.user!.id,
      action: "WASTE_HANDOFF",
      entityType: "bucket",
      entityId: data.bucketId,
      payload: { toOrgId: data.toOrgId, weight: data.weight, category: data.category },
    });
    res.json(ok(h));
  } catch (e) {
    next(e);
  }
});

wasteRouter.post("/handoff/:id/confirm", async (req, res, next) => {
  try {
    const h = await prisma.wasteHandoff.findUnique({ where: { id: req.params.id } });
    if (!h) return res.status(404).json({ code: 404, message: "交接记录不存在" });
    await prisma.wasteHandoff.update({ where: { id: h.id }, data: { toUserId: req.user!.id } });
    await prisma.wasteBucket.update({ where: { id: h.bucketId }, data: { status: "SEALED" } });
    res.json(ok({ confirmed: true }));
  } catch (e) {
    next(e);
  }
});

wasteRouter.get("/handoffs", async (_req, res, next) => {
  try {
    const list = await prisma.wasteHandoff.findMany({
      include: { bucket: true },
      orderBy: { handoverAt: "desc" },
      take: 200,
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});
