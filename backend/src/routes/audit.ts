import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";

export const auditRouter = Router();
auditRouter.use(authRequired);

// 以追溯码为主键的全链路回溯
auditRouter.get("/trace/:code", async (req, res, next) => {
  try {
    const code = req.params.code;
    const bottle = await prisma.reagentBottle.findFirst({
      where: { OR: [{ traceCode: code }, { rfidTag: code }] },
      include: { chemical: true, locationOrg: true },
    });
    if (!bottle) return res.status(404).json({ code: 404, message: "追溯码未找到" });

    const events = await prisma.auditEvent.findMany({
      where: { OR: [{ entityId: bottle.id }, { traceCode: code }] },
      include: { actor: true },
      orderBy: { occurredAt: "asc" },
    });

    const usage = await prisma.usageLog.findMany({
      where: { bottleId: bottle.id },
      include: { user: true },
      orderBy: { loggedAt: "asc" },
    });

    const requisitions = await prisma.requisition.findMany({
      where: { bottles: { some: { bottleId: bottle.id } } },
      include: { applicant: true, approvals: { include: { approver: true } }, verification: { include: { userA: true, userB: true } } },
    });

    const empties = await prisma.emptyBottleOp.findMany({
      where: { bottleId: bottle.id },
      include: { operator: true },
      orderBy: { operatedAt: "asc" },
    });

    res.json(ok({ bottle, events, usage, requisitions, empties }));
  } catch (e) {
    next(e);
  }
});

auditRouter.get("/events", async (req, res, next) => {
  try {
    const { entityType, actorId, action, from, to, page = 1, pageSize = 50 } = req.query as any;
    const where: any = {};
    if (entityType) where.entityType = entityType;
    if (actorId) where.actorId = actorId;
    if (action) where.action = action;
    if (from || to) where.occurredAt = { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined };
    const list = await prisma.auditEvent.findMany({
      where,
      include: { actor: true },
      orderBy: { occurredAt: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    });
    const total = await prisma.auditEvent.count({ where });
    res.json(ok({ list, total }));
  } catch (e) {
    next(e);
  }
});

// 数据补录：写入历史事件以补全追溯链路
auditRouter.post("/backfill", async (req, res, next) => {
  try {
    const { traceCode, action, entityType, entityId, occurredAt, payload } = req.body;
    const e = await prisma.auditEvent.create({
      data: { action, entityType, entityId, traceCode, occurredAt: new Date(occurredAt), payload, actorId: req.user!.id },
    });
    res.json(ok(e));
  } catch (e) {
    next(e);
  }
});
