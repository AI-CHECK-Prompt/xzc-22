import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";
import { genNo } from "../utils/code";
import { writeAudit } from "../utils/audit";
import { checkRequisitionEligibility, isHighRiskCategory } from "../utils/access";
import { z } from "zod";
import { UserRole } from "@prisma/client";

export const requisitionRouter = Router();
requisitionRouter.use(authRequired);

// 步骤名称 -> 允许审批该步骤的角色集合（最小权限原则：仅对应角色可审批）
const STEP_REQUIRED_ROLES: Record<string, UserRole[]> = {
  "导师审核": ["MENTOR"],
  "项目负责人审核": ["PROJECT_LEAD"],
  "危化品管理员审核": ["HAZMAT_ADMIN"],
  "保卫处复核": ["SECURITY_OFFICER"],
  "主管领导审批": ["DEPT_LEAD", "RESEARCH_DEPT"],
};

const createSchema = z.object({
  projectCode: z.string().optional(),
  projectId: z.string().optional(),
  purpose: z.string(),
  expectedTime: z.string(),
  bottles: z.array(z.object({ bottleId: z.string(), requestedQty: z.number() })),
});

requisitionRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);

    // 联动校验：黑名单/离校/资格/项目品类/项目结题 —— 任何一项不通过均直接拒
    const eligibility = await checkRequisitionEligibility({
      applicantId: req.user!.id,
      bottles: data.bottles,
      projectId: data.projectId,
    });
    if (!eligibility.ok) {
      const code = eligibility.code ?? 400;
      await writeAudit({
        actorId: req.user!.id,
        action: "REQUISITION_CREATE_DENIED",
        entityType: "requisition",
        entityId: req.user!.id,
        payload: { reason: eligibility.message, bottles: data.bottles, projectId: data.projectId },
      });
      return res.status(code).json({ code, message: eligibility.message });
    }
    const bottles = eligibility.bottles!;
    const hazardClasses = eligibility.hazardClasses!;

    // 高危判定：易制毒/易制爆/剧毒 → 追加保卫处复核 + 主管领导审批
    const hasRegulated = hazardClasses.some((hc: string) => isHighRiskCategory(hc));
    const isExplosivePrecursor = hazardClasses.includes("EXPLOSIVE_PRECURSOR");
    const reqNo = genNo("REQ");
    // 基础三级审批
    const baseSteps = [
      { stepName: "导师审核", status: "PENDING" as const, targetType: "requisition" as const, targetId: "__DEFER__" },
      { stepName: "项目负责人审核", status: "PENDING" as const, targetType: "requisition" as const, targetId: "__DEFER__" },
      { stepName: "危化品管理员审核", status: "PENDING" as const, targetType: "requisition" as const, targetId: "__DEFER__" },
    ];
    // 高危品类追加保卫处复核 + 主管领导审批
    const extraSteps = hasRegulated
      ? [
          { stepName: "保卫处复核", status: "PENDING" as const, targetType: "requisition" as const, targetId: "__DEFER__" },
          { stepName: "主管领导审批", status: "PENDING" as const, targetType: "requisition" as const, targetId: "__DEFER__" },
        ]
      : [];
    const r = await prisma.requisition.create({
      data: {
        reqNo,
        applicantId: req.user!.id,
        projectCode: data.projectCode,
        projectId: data.projectId,
        purpose: data.purpose,
        expectedTime: new Date(data.expectedTime),
        bottles: { create: data.bottles },
        // 注意：ApprovalStep.targetId 为必填，Prisma 在嵌套 create 时无法引用父 ID
        // 这里用占位符创建，拿到 req.id 后再批量回填
        approvals: {
          create: [...baseSteps, ...extraSteps].map((s) => ({
            stepName: s.stepName,
            status: s.status,
            targetType: s.targetType,
            targetId: reqNo, // 临时使用 reqNo 作为占位，回填阶段再覆盖
          })),
        },
      },
      include: { bottles: { include: { bottle: { include: { chemical: true } } } }, approvals: true, project: true },
    });
    // 回填 targetId 为 requisition.id（避免嵌套 create 无法引用父 id 的限制）
    if (r.approvals.length > 0) {
      await prisma.approvalStep.updateMany({
        where: { requisitionId: r.id },
        data: { targetId: r.id },
      });
    }
    await writeAudit({
      actorId: req.user!.id,
      action: "REQUISITION_CREATE",
      entityType: "requisition",
      entityId: r.id,
      payload: {
        reqNo,
        hasRegulated,
        isExplosivePrecursor,
        hazardClasses,
        projectId: data.projectId,
        projectCode: data.projectCode,
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

    // 1) 步骤必须存在且仍为 PENDING（防止重复审批）
    const target = r.approvals.find((a) => a.stepName === stepName);
    if (!target) return res.status(400).json({ code: 400, message: "审批步骤不存在" });
    if (target.status !== "PENDING") {
      return res.status(400).json({ code: 400, message: "该步骤已审批，不可重复操作" });
    }

    // 2) 角色校验：当前登录用户的角色必须与该步骤对应
    const allowedRoles = STEP_REQUIRED_ROLES[stepName];
    if (!allowedRoles) {
      return res.status(400).json({ code: 400, message: "未配置该步骤的审批角色" });
    }
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      await writeAudit({
        actorId: req.user?.id,
        action: "REQUISITION_APPROVE_DENIED",
        entityType: "requisition",
        entityId: r.id,
        payload: { stepName, decision, actorRole: req.user?.role, reason: "ROLE_MISMATCH", allowedRoles },
      });
      return res.status(403).json({ code: 403, message: "当前用户角色无权审批此步骤" });
    }

    // 3) 顺序校验：必须前面所有步骤都已完成（APPROVED/REJECTED），不允许跳过中间环节
    const targetIndex = r.approvals.findIndex((a) => a.id === target.id);
    const previousSteps = r.approvals.slice(0, targetIndex);
    const pendingPrevious = previousSteps.filter((a) => a.status === "PENDING");
    if (pendingPrevious.length > 0) {
      await writeAudit({
        actorId: req.user.id,
        action: "REQUISITION_APPROVE_DENIED",
        entityType: "requisition",
        entityId: r.id,
        payload: { stepName, decision, actorRole: req.user.role, reason: "ORDER_VIOLATION", pendingPrevious: pendingPrevious.map((a) => a.stepName) },
      });
      return res.status(400).json({ code: 400, message: "请先完成前置审批步骤" });
    }

    // 4) 执行审批更新
    await prisma.approvalStep.update({
      where: { id: target.id },
      data: { status: decision === "APPROVED" ? "APPROVED" : "REJECTED", approverId: req.user.id, approvedAt: new Date(), comment },
    });
    // 重新查询最新审批状态，避免使用过期的 r.approvals 计算剩余步骤
    const updatedApprovals = await prisma.approvalStep.findMany({ where: { requisitionId: r.id } });
    const stillPending = updatedApprovals.filter((a) => a.status === "PENDING");
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
      actorId: req.user.id,
      action: "REQUISITION_APPROVE",
      entityType: "requisition",
      entityId: r.id,
      payload: { stepName, decision, comment, actorRole: req.user.role },
    });
    res.json(ok({ status: newStatus }));
  } catch (e) {
    next(e);
  }
});
