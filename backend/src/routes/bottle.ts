import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";
import { buildTraceCode } from "../utils/code";
import { writeAudit } from "../utils/audit";
import { z } from "zod";

export const bottleRouter = Router();
bottleRouter.use(authRequired);

bottleRouter.get("/", async (req, res, next) => {
  try {
    const { q, status, chemicalId, locationOrgId } = req.query as any;
    const where: any = {};
    if (q) where.OR = [{ traceCode: { contains: q } }, { rfidTag: { contains: q } }];
    if (status) where.status = status;
    if (chemicalId) where.chemicalId = chemicalId;
    if (locationOrgId) where.locationOrgId = locationOrgId;
    const list = await prisma.reagentBottle.findMany({
      where,
      include: { chemical: true, locationOrg: true },
      orderBy: { enteredAt: "desc" },
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});

bottleRouter.get("/scan/:code", async (req, res, next) => {
  try {
    const code = req.params.code;
    const bottle = await prisma.reagentBottle.findFirst({
      where: { OR: [{ traceCode: code }, { rfidTag: code }] },
      include: {
        chemical: true,
        locationOrg: true,
        usageLogs: { orderBy: { loggedAt: "desc" }, take: 10, include: { user: true } },
      },
    });
    if (!bottle) return res.status(404).json({ code: 404, message: "追溯码未找到" });
    res.json(ok(bottle));
  } catch (e) {
    next(e);
  }
});

const createSchema = z.object({
  chemicalId: z.string(),
  batchNo: z.string(),
  supplier: z.string(),
  manufactureDate: z.string(),
  expireDate: z.string().optional(),
  initialQty: z.number(),
  unit: z.string(),
  locationOrgId: z.string(),
  cabinet: z.string().optional(),
  inspectionReport: z.string().optional(),
});

bottleRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const traceCode = buildTraceCode();
    const rfidTag = `RFID-${traceCode.slice(5, 17)}`;
    const bottle = await prisma.reagentBottle.create({
      data: {
        traceCode,
        rfidTag,
        chemicalId: data.chemicalId,
        batchNo: data.batchNo,
        supplier: data.supplier,
        manufactureDate: new Date(data.manufactureDate),
        expireDate: data.expireDate ? new Date(data.expireDate) : null,
        initialQty: data.initialQty,
        remainingQty: data.initialQty,
        unit: data.unit,
        locationOrgId: data.locationOrgId,
        cabinet: data.cabinet,
        inspectionReport: data.inspectionReport,
      },
    });
    await writeAudit({
      actorId: req.user!.id,
      action: "BOTTLE_INBOUND",
      entityType: "bottle",
      entityId: bottle.id,
      traceCode: bottle.traceCode,
      payload: data,
    });
    res.json(ok(bottle));
  } catch (e) {
    next(e);
  }
});

bottleRouter.post("/:id/transfer", async (req, res, next) => {
  try {
    const { toOrgId, remark } = req.body;
    const b = await prisma.reagentBottle.update({
      where: { id: req.params.id },
      data: { locationOrgId: toOrgId },
    });
    await writeAudit({
      actorId: req.user!.id,
      action: "BOTTLE_TRANSFER",
      entityType: "bottle",
      entityId: b.id,
      traceCode: b.traceCode,
      payload: { toOrgId, remark },
    });
    res.json(ok(b));
  } catch (e) {
    next(e);
  }
});
