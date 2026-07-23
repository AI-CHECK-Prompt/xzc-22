// 培训记录 + 准入资格（基础 / 高危）发放
// 流程：保卫处登记培训记录 → 通过后由管理员/保卫处签发准入资格
// 用户处于 GRADUATED/LEFT/BLACKLISTED 状态时不可签发
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { authRequired, requireRole } from "../middleware/auth";
import { ok } from "../utils/response";
import { writeAudit } from "../utils/audit";
import { isUserActiveStatus } from "../utils/access";
import { UserRole } from "@prisma/client";

export const accessRouter = Router();
accessRouter.use(authRequired);

// ============== 培训记录 ==============

const trainingSchema = z.object({
  userId: z.string(),
  trainingType: z.enum(["BASIC_SAFETY", "HIGH_RISK_SPECIAL"]),
  score: z.number().min(0).max(100),
  passed: z.boolean(),
  evidence: z.string().optional(),
  trainedAt: z.string().optional(),
  remark: z.string().optional(),
});

accessRouter.post(
  "/trainings",
  requireRole(UserRole.ADMIN, UserRole.SECURITY_OFFICER),
  async (req, res, next) => {
    try {
      const data = trainingSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { id: data.userId } });
      if (!user) return res.status(404).json({ code: 404, message: "培训对象不存在" });

      const t = await prisma.trainingRecord.create({
        data: {
          userId: data.userId,
          trainingType: data.trainingType,
          score: data.score,
          passed: data.passed,
          evidence: data.evidence,
          trainedAt: data.trainedAt ? new Date(data.trainedAt) : new Date(),
          conductedById: req.user!.id,
          remark: data.remark,
        },
        include: { user: true, conductedBy: true },
      });
      await writeAudit({
        actorId: req.user!.id,
        action: "TRAINING_RECORD",
        entityType: "user",
        entityId: data.userId,
        payload: { trainingType: data.trainingType, score: data.score, passed: data.passed },
      });
      res.json(ok(t));
    } catch (e) {
      next(e);
    }
  }
);

accessRouter.get("/trainings", async (req, res, next) => {
  try {
    const { userId, trainingType } = req.query as any;
    const where: any = {};
    if (userId) where.userId = userId;
    if (trainingType) where.trainingType = trainingType;
    const list = await prisma.trainingRecord.findMany({
      where,
      include: { user: true, conductedBy: true },
      orderBy: { trainedAt: "desc" },
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});

// ============== 准入资格发放 ==============

const issueSchema = z.object({
  userId: z.string(),
  qualificationType: z.enum(["BASIC", "HIGH_RISK"]),
  // 资格有效期（可选；不传则长期有效直到撤销）
  expiresAt: z.string().optional(),
  remark: z.string().optional(),
});

accessRouter.post(
  "/qualifications",
  requireRole(UserRole.ADMIN, UserRole.SECURITY_OFFICER, UserRole.DEPT_LEAD),
  async (req, res, next) => {
    try {
      const data = issueSchema.parse(req.body);
      if (!(await isUserActiveStatus(data.userId))) {
        return res.status(400).json({ code: 400, message: "账号已毕业/离校/被禁用，无法签发准入资格" });
      }
      // 撤销同类型的旧 ACTIVE 资格
      await prisma.accessQualification.updateMany({
        where: { userId: data.userId, qualificationType: data.qualificationType, source: "TRAINING", status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: new Date(), revokedReason: "REISSUED" },
      });
      const q = await prisma.accessQualification.create({
        data: {
          userId: data.userId,
          qualificationType: data.qualificationType,
          source: "TRAINING",
          issuedById: req.user!.id,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          status: "ACTIVE",
        },
        include: { user: true, issuedBy: true },
      });
      await writeAudit({
        actorId: req.user!.id,
        action: "QUALIFICATION_ISSUE",
        entityType: "user",
        entityId: data.userId,
        payload: { qualificationType: data.qualificationType, source: "TRAINING", expiresAt: data.expiresAt },
      });
      res.json(ok(q));
    } catch (e) {
      next(e);
    }
  }
);

// 撤销某条准入资格
accessRouter.post(
  "/qualifications/:id/revoke",
  requireRole(UserRole.ADMIN, UserRole.SECURITY_OFFICER, UserRole.DEPT_LEAD),
  async (req, res, next) => {
    try {
      const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
      const q = await prisma.accessQualification.findUnique({ where: { id: req.params.id } });
      if (!q) return res.status(404).json({ code: 404, message: "资格记录不存在" });
      if (q.status !== "ACTIVE") return res.status(400).json({ code: 400, message: "该资格已非生效状态" });
      const updated = await prisma.accessQualification.update({
        where: { id: q.id },
        data: { status: "REVOKED", revokedAt: new Date(), revokedReason: reason },
      });
      await writeAudit({
        actorId: req.user!.id,
        action: "QUALIFICATION_REVOKE",
        entityType: "user",
        entityId: q.userId,
        payload: { qualificationId: q.id, qualificationType: q.qualificationType, reason },
      });
      res.json(ok(updated));
    } catch (e) {
      next(e);
    }
  }
);

// 查某用户的资格（带状态过滤）
accessRouter.get("/qualifications", async (req, res, next) => {
  try {
    const { userId, status } = req.query as any;
    const where: any = {};
    if (userId) where.userId = userId;
    if (status) where.status = status;
    const list = await prisma.accessQualification.findMany({
      where,
      include: { user: true, issuedBy: true, sourceProject: true },
      orderBy: { issuedAt: "desc" },
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});

// 查我自己的资格（含是否生效）
accessRouter.get("/qualifications/me", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const now = new Date();
    const list = await prisma.accessQualification.findMany({
      where: { userId },
      include: { sourceProject: true },
      orderBy: { issuedAt: "desc" },
    });
    const summary = list.map((q) => {
      let effective = q.status === "ACTIVE";
      if (effective && q.expiresAt && q.expiresAt <= now) effective = false;
      return { ...q, effective };
    });
    res.json(ok(summary));
  } catch (e) {
    next(e);
  }
});
