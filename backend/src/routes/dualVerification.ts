import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";
import { writeAudit } from "../utils/audit";
import { z } from "zod";

export const dualVerificationRouter = Router();
dualVerificationRouter.use(authRequired);

const createSchema = z.object({
  requisitionId: z.string(),
  userBId: z.string(),
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
  locationDesc: z.string().optional(),
  videoUrl: z.string().optional(),
});

dualVerificationRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const v = await prisma.dualVerification.create({
      data: {
        requisitionId: data.requisitionId,
        userAId: req.user!.id,
        userBId: data.userBId,
        locationLat: data.locationLat,
        locationLng: data.locationLng,
        locationDesc: data.locationDesc,
        videoUrl: data.videoUrl,
        result: "PASS",
      },
    });
    // 触发电子锁具打开（mock）
    await prisma.dualVerification.update({ where: { id: v.id }, data: { cabinetOpenedAt: new Date() } });
    await prisma.requisition.update({ where: { id: data.requisitionId }, data: { status: "VERIFYING" } });
    await writeAudit({
      actorId: req.user!.id,
      action: "DUAL_VERIFY",
      entityType: "requisition",
      entityId: data.requisitionId,
      payload: { userBId: data.userBId, location: data.locationDesc, video: data.videoUrl },
    });
    res.json(ok(v));
  } catch (e) {
    next(e);
  }
});

dualVerificationRouter.post("/:id/close", async (req, res, next) => {
  try {
    const v = await prisma.dualVerification.update({
      where: { id: req.params.id },
      data: { cabinetClosedAt: new Date() },
    });
    // 完成后将该领用的瓶状态改为 IN_USE
    const r = await prisma.requisition.findUnique({ where: { id: v.requisitionId }, include: { bottles: true } });
    if (r) {
      await prisma.requisition.update({ where: { id: r.id }, data: { status: "COMPLETED" } });
      for (const rb of r.bottles) {
        await prisma.reagentBottle.update({ where: { id: rb.bottleId }, data: { status: "IN_USE" } });
      }
    }
    await writeAudit({
      actorId: req.user!.id,
      action: "DUAL_VERIFY_CLOSE",
      entityType: "requisition",
      entityId: v.requisitionId,
    });
    res.json(ok(v));
  } catch (e) {
    next(e);
  }
});

dualVerificationRouter.get("/", async (_req, res, next) => {
  try {
    const list = await prisma.dualVerification.findMany({
      include: { userA: true, userB: true, requisition: true },
      orderBy: { checkInAt: "desc" },
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});
