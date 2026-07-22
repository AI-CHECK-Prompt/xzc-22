import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";
import { genNo } from "../utils/code";
import { writeAudit } from "../utils/audit";
import { z } from "zod";

export const procurementRouter = Router();
procurementRouter.use(authRequired);

// 智能建议采购量
procurementRouter.post("/suggest", async (req, res, next) => {
  try {
    const { chemicalIds, departmentId } = req.body as { chemicalIds: string[]; departmentId: string };
    const result: any[] = [];
    for (const cid of chemicalIds || []) {
      const chem = await prisma.chemical.findUnique({ where: { id: cid } });
      if (!chem) continue;
      // 库存：同部门下同化学品的 remainingQty 合计
      const orgIds = await getDescendantOrgIds(departmentId);
      const stock = await prisma.reagentBottle.aggregate({
        _sum: { remainingQty: true },
        where: { chemicalId: cid, locationOrgId: { in: orgIds }, status: "IN_STORAGE" },
      });
      const inStock = stock._sum.remainingQty || 0;
      // 估算月用量：基于过去 90 天使用记录
      const usage = await prisma.usageLog.aggregate({
        _sum: { qty: true },
        where: { bottle: { chemicalId: cid } },
      });
      const monthlyUsage = (usage._sum.qty || 0) / 3 || 1000;
      const monthlyLimit = chem.monthlyLimit || Number.MAX_SAFE_INTEGER;
      const purchaseLimit = chem.purchaseLimit || Number.MAX_SAFE_INTEGER;
      const targetStock = monthlyUsage * 1.5;
      const suggested = Math.max(0, Math.min(targetStock - inStock, monthlyLimit, purchaseLimit));
      result.push({
        chemicalId: cid,
        name: chem.name,
        casNo: chem.casNo,
        unit: chem.unit,
        inStock,
        monthlyUsage: Math.round(monthlyUsage),
        suggestedQty: Math.round(suggested),
        overLimit: suggested >= monthlyLimit || suggested >= purchaseLimit,
        monthlyLimit,
        purchaseLimit,
      });
    }
    res.json(ok(result));
  } catch (e) {
    next(e);
  }
});

async function getDescendantOrgIds(rootId: string): Promise<string[]> {
  const ids: string[] = [rootId];
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift()!;
    const children = await prisma.organization.findMany({ where: { parentId: cur } });
    for (const c of children) {
      ids.push(c.id);
      queue.push(c.id);
    }
  }
  return ids;
}

const createSchema = z.object({
  month: z.string(),
  departmentId: z.string(),
  remark: z.string().optional(),
  items: z.array(
    z.object({
      chemicalId: z.string(),
      requestedQty: z.number(),
      suggestedQty: z.number(),
      estPrice: z.number(),
      remark: z.string().optional(),
    }),
  ),
});

procurementRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const planNo = genNo("PLAN");
    const total = data.items.reduce((s, i) => s + i.estPrice * i.requestedQty, 0);
    const plan = await prisma.procurementPlan.create({
      data: {
        planNo,
        month: data.month,
        departmentId: data.departmentId,
        applicantId: req.user!.id,
        remark: data.remark,
        totalAmount: total,
        items: { create: data.items },
        approvals: {
          create: [
            { stepName: "设备秘书提交", status: "APPROVED", approverId: req.user!.id, approvedAt: new Date() },
            { stepName: "科研处审核", status: "PENDING" },
            { stepName: "保卫处审核", status: "PENDING" },
          ],
        },
      },
      include: { items: { include: { chemical: true } }, approvals: true },
    });
    await writeAudit({
      actorId: req.user!.id,
      action: "PROCUREMENT_CREATE",
      entityType: "plan",
      entityId: plan.id,
      payload: { planNo, total },
    });
    res.json(ok(plan));
  } catch (e) {
    next(e);
  }
});

procurementRouter.get("/", async (req, res, next) => {
  try {
    const { status, month, departmentId } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (month) where.month = month;
    if (departmentId) where.departmentId = departmentId;
    const list = await prisma.procurementPlan.findMany({
      where,
      include: { items: { include: { chemical: true } }, approvals: true, applicant: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});

procurementRouter.get("/:id", async (req, res, next) => {
  try {
    const plan = await prisma.procurementPlan.findUnique({
      where: { id: req.params.id },
      include: { items: { include: { chemical: true } }, approvals: { include: { approver: true } }, applicant: true },
    });
    res.json(ok(plan));
  } catch (e) {
    next(e);
  }
});

procurementRouter.post("/:id/approve", async (req, res, next) => {
  try {
    const { stepName, decision, comment } = req.body;
    const plan = await prisma.procurementPlan.findUnique({ where: { id: req.params.id }, include: { approvals: true } });
    if (!plan) return res.status(404).json({ code: 404, message: "计划不存在" });
    const step = plan.approvals.find((a) => a.stepName === stepName && a.status === "PENDING");
    if (!step) return res.status(400).json({ code: 400, message: "无可审批的步骤" });
    await prisma.approvalStep.update({
      where: { id: step.id },
      data: { status: decision === "APPROVED" ? "APPROVED" : "REJECTED", approverId: req.user!.id, approvedAt: new Date(), comment },
    });
    let newStatus = plan.status;
    if (decision !== "APPROVED") newStatus = "REJECTED";
    else if (stepName === "科研处审核") newStatus = "RESEARCH_APPROVED";
    else if (stepName === "保卫处审核") newStatus = "SECURITY_APPROVED";
    await prisma.procurementPlan.update({ where: { id: plan.id }, data: { status: newStatus } });
    await writeAudit({
      actorId: req.user!.id,
      action: "PROCUREMENT_APPROVE",
      entityType: "plan",
      entityId: plan.id,
      payload: { stepName, decision, comment },
    });
    res.json(ok({ status: newStatus }));
  } catch (e) {
    next(e);
  }
});
