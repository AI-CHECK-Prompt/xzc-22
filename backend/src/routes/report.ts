import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";

export const reportRouter = Router();
reportRouter.use(authRequired);

reportRouter.get("/procurement-amount", async (_req, res, next) => {
  try {
    const plans = await prisma.procurementPlan.findMany({
      select: { month: true, totalAmount: true, status: true },
    });
    const byMonth: Record<string, number> = {};
    plans.forEach((p) => (byMonth[p.month] = (byMonth[p.month] || 0) + p.totalAmount));
    res.json(ok(Object.entries(byMonth).map(([month, amount]) => ({ month, amount }))));
  } catch (e) {
    next(e);
  }
});

reportRouter.get("/usage-frequency", async (_req, res, next) => {
  try {
    const usages = await prisma.usageLog.findMany({
      include: { bottle: { include: { chemical: true } } },
    });
    const map: Record<string, { name: string; count: number; qty: number }> = {};
    usages.forEach((u) => {
      const id = u.bottle.chemicalId;
      if (!map[id]) map[id] = { name: u.bottle.chemical.name, count: 0, qty: 0 };
      map[id].count += 1;
      map[id].qty += u.qty;
    });
    res.json(ok(Object.values(map).sort((a, b) => b.count - a.count)));
  } catch (e) {
    next(e);
  }
});

reportRouter.get("/inventory-turnover", async (_req, res, next) => {
  try {
    const bottles = await prisma.reagentBottle.findMany({ include: { chemical: true } });
    const byChem: Record<string, { name: string; total: number; remaining: number; turnover: number }> = {};
    bottles.forEach((b) => {
      const id = b.chemicalId;
      if (!byChem[id]) byChem[id] = { name: b.chemical.name, total: 0, remaining: 0, turnover: 0 };
      byChem[id].total += b.initialQty;
      byChem[id].remaining += b.remainingQty;
    });
    Object.values(byChem).forEach((v) => (v.turnover = v.total ? +((v.total - v.remaining) / v.total).toFixed(2) : 0));
    res.json(ok(Object.values(byChem)));
  } catch (e) {
    next(e);
  }
});

reportRouter.get("/waste-stat", async (_req, res, next) => {
  try {
    const handoffs = await prisma.wasteHandoff.findMany();
    const byCategory: Record<string, number> = {};
    handoffs.forEach((h) => (byCategory[h.category] = (byCategory[h.category] || 0) + h.weight));
    const buckets = await prisma.wasteBucket.groupBy({
      by: ["category"],
      _sum: { currentVolume: true },
    });
    res.json(ok({
      byHandoff: byCategory,
      byBucket: buckets.map((b) => ({ category: b.category, volume: b._sum.currentVolume })),
    }));
  } catch (e) {
    next(e);
  }
});

reportRouter.get("/dashboard", async (_req, res, next) => {
  try {
    const [bottles, plans, requisitions, buckets, audits] = await Promise.all([
      prisma.reagentBottle.count(),
      prisma.procurementPlan.count(),
      prisma.requisition.count(),
      prisma.wasteBucket.count(),
      prisma.auditEvent.count(),
    ]);
    const highRisk = await prisma.reagentBottle.count({
      where: { chemical: { hazardClass: { in: ["PRECURSOR_DRUG", "EXPLOSIVE_PRECURSOR", "HIGHLY_TOXIC"] } } },
    });
    const lowStock = await prisma.reagentBottle.findMany({
      where: { remainingQty: { gt: 0 } },
      include: { chemical: true },
    });
    const lowAlerts = lowStock.filter((b) => b.remainingQty < b.initialQty * 0.1).length;
    res.json(ok({ bottles, plans, requisitions, buckets, audits, highRisk, lowAlerts }));
  } catch (e) {
    next(e);
  }
});
