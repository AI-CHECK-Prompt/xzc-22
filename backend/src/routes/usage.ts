import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";
import { writeAudit } from "../utils/audit";
import { z } from "zod";

export const usageRouter = Router();
usageRouter.use(authRequired);

const logSchema = z.object({
  bottleId: z.string(),
  qty: z.number(),
  experiment: z.string(),
  content: z.string().optional(),
  nextUse: z.string().optional(),
  loggedAt: z.string().optional(),
  offline: z.boolean().optional(),
  clientId: z.string().optional(),
});

usageRouter.post("/", async (req, res, next) => {
  try {
    const data = logSchema.parse(req.body);
    const bottle = await prisma.reagentBottle.findUnique({ where: { id: data.bottleId } });
    if (!bottle) return res.status(404).json({ code: 404, message: "试剂瓶不存在" });
    const remaining = Math.max(0, bottle.remainingQty - data.qty);
    await prisma.reagentBottle.update({
      where: { id: bottle.id },
      data: { remainingQty: remaining, lastUsedAt: new Date(), status: remaining <= 0 ? "DEPLETED" : bottle.status },
    });
    const log = await prisma.usageLog.create({
      data: {
        bottleId: bottle.id,
        userId: req.user!.id,
        qty: data.qty,
        remaining,
        experiment: data.experiment,
        content: data.content,
        nextUse: data.nextUse,
        loggedAt: data.loggedAt ? new Date(data.loggedAt) : new Date(),
        offline: data.offline ?? false,
        clientId: data.clientId,
      },
    });
    // 安全阈值告警
    let alert: string | null = null;
    if (remaining < bottle.initialQty * 0.1) alert = "剩余量低于初始量 10%，请安排续购";
    await writeAudit({
      actorId: req.user!.id,
      action: "USAGE_LOG",
      entityType: "bottle",
      entityId: bottle.id,
      traceCode: bottle.traceCode,
      payload: { qty: data.qty, remaining, experiment: data.experiment, alert },
    });
    res.json(ok({ log, alert }));
  } catch (e) {
    next(e);
  }
});

usageRouter.get("/bottle/:id", async (req, res, next) => {
  try {
    const list = await prisma.usageLog.findMany({
      where: { bottleId: req.params.id },
      include: { user: true },
      orderBy: { loggedAt: "desc" },
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});

usageRouter.post("/sync", async (req, res, next) => {
  try {
    const items = z
      .array(logSchema)
      .parse((req.body as any).items || []);
    const results: any[] = [];
    for (const it of items) {
      try {
        const bottle = await prisma.reagentBottle.findUnique({ where: { id: it.bottleId } });
        if (!bottle) {
          results.push({ clientId: it.clientId, ok: false, reason: "bottle not found" });
          continue;
        }
        const remaining = Math.max(0, bottle.remainingQty - it.qty);
        await prisma.reagentBottle.update({
          where: { id: bottle.id },
          data: { remainingQty: remaining, lastUsedAt: new Date() },
        });
        const log = await prisma.usageLog.create({
          data: {
            bottleId: bottle.id,
            userId: req.user!.id,
            qty: it.qty,
            remaining,
            experiment: it.experiment,
            content: it.content,
            loggedAt: it.loggedAt ? new Date(it.loggedAt) : new Date(),
            offline: true,
            clientId: it.clientId,
          },
        });
        results.push({ clientId: it.clientId, ok: true, logId: log.id });
      } catch (e: any) {
        results.push({ clientId: it.clientId, ok: false, reason: e.message });
      }
    }
    res.json(ok({ results }));
  } catch (e) {
    next(e);
  }
});
