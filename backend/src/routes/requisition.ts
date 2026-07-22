import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";
import { genNo } from "../utils/code";
import { writeAudit } from "../utils/audit";
import { z } from "zod";

export const requisitionRouter = Router();
requisitionRouter.use(authRequired);

const createSchema = z.object({
  projectCode: z.string().optional(),
  purpose: z.string(),
  expectedTime: z.string(),
  bottles: z.array(z.object({ bottleId: z.string(), requestedQty: z.number() })),
});

requisitionRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    // 是否包含高危品类（易制毒 / 易制爆 / 剧毒）
    const bottleIds = data.bottles.map((b) => b.bottleId);
    const bottles = await prisma.reagentBottle.findMany({ where: { id: { in: bottleIds } }, include: { chemical: true } });
    // 需追加保卫处复核 + 主管领导审批的高危品类
    const regulatedClasses = ["PRECURSOR_DRUG", "EXPLOSIVE_PRECURSOR", "HIGHLY_TOXIC"];
    const hasRegulated = bottles.some((b) => regulatedClasses.includes(b.chemical.hazardClass));
    // 是否含易制爆（额外需要保卫处复核 + 主管领导审批，无论如何都必须留痕）
    const isExplosivePrecursor = bottles.some((b) => b.chemical.hazardClass === "EXPLOSIVE_PRECURSOR");
    const reqNo = genNo("REQ");
    // 基础三级审批
    const baseSteps = [
      { stepName: "导师审核", status: "PENDING" as const },
      { stepName: "项目负责人审核", status: "PENDING" as const },
      { stepName: "危化品管理员审核", status: "PENDING" as const },
    ];
    // 高危品类追加保卫处复核 + 主管领导审批
    const extraSteps = hasRegulated
      ? [
          { stepName: "保卫处复核", status: "PENDING" as const },
          { stepName: "主管领导审批", status: "PENDING" as const },
        ]
      : [];
    const r = await prisma.requisition.create({
      data: {
        reqNo,
        applicantId: req.user!.id,
        projectCode: data.projectCode,
        purpose: data.purpose,
        expectedTime: new Date(data.expectedTime),
        bottles: { create: data.bottles },
        approvals: {
          create: [...baseSteps, ...extraSteps],
        },
      },
      include: { bottles: { include: { bottle: { include: { chemical: true } } } }, approvals: true },
    });
    await writeAudit({
      actorId: req.user!.id,
      action: "REQUISITION_CREATE",
      entityType: "requisition",
      entityId: r.id,
      payload: {
        reqNo,
        hasRegulated,
        isExplosivePrecursor,
        bottles: data.bottles,
        approvalSteps: [...baseSteps, ...extraSteps].map((s) => s.stepName),
      },
    });
    res.json(ok(r));
  } catch (e) {
    next(e);
  }
});

requisitionRouter.get("/", async (req, res, next) => {
  try {
    const { status, applicantId } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (applicantId) where.applicantId = applicantId;
    const list = await prisma.requisition.findMany({
      where,
      include: { applicant: true, bottles: { include: { bottle: { include: { chemical: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});

requisitionRouter.get("/:id", async (req, res, next) => {
  try {
    const r = await prisma.requisition.findUnique({
      where: { id: req.params.id },
      include: {
        applicant: true,
        bottles: { include: { bottle: { include: { chemical: true, locationOrg: true } } } },
        approvals: { include: { approver: true } },
        verification: true,
      },
    });
    res.json(ok(r));
  } catch (e) {
    next(e);
  }
});

requisitionRouter.post("/:id/approve", async (req, res, next) => {
  try {
    const { stepName, decision, comment } = req.body;
    const r = await prisma.requisition.findUnique({ where: { id: req.params.id }, include: { approvals: true } });
    if (!r) return res.status(404).json({ code: 404, message: "申请不存在" });
    const step = r.approvals.find((a) => a.stepName === stepName && a.status === "PENDING");
    if (!step) return res.status(400).json({ code: 400, message: "无可审批的步骤" });
    await prisma.approvalStep.update({
      where: { id: step.id },
      data: { status: decision === "APPROVED" ? "APPROVED" : "REJECTED", approverId: req.user!.id, approvedAt: new Date(), comment },
    });
    const stillPending = r.approvals.filter((a) => a.status === "PENDING" && a.id !== step.id);
    let newStatus: any = r.status;
    if (decision !== "APPROVED") newStatus = "REJECTED";
    else if (stillPending.length === 0) newStatus = "APPROVED";
    await prisma.requisition.update({ where: { id: r.id }, data: { status: newStatus } });
    // 状态变更为 APPROVED 时把瓶状态标记为 RESERVED
    if (newStatus === "APPROVED") {
      const rb = await prisma.requisitionBottle.findMany({ where: { requisitionId: r.id } });
      for (const item of rb) {
        await prisma.reagentBottle.update({ where: { id: item.bottleId }, data: { status: "RESERVED" } });
      }
    }
    await writeAudit({
      actorId: req.user!.id,
      action: "REQUISITION_APPROVE",
      entityType: "requisition",
      entityId: r.id,
      payload: { stepName, decision, comment },
    });
    res.json(ok({ status: newStatus }));
  } catch (e) {
    next(e);
  }
});
