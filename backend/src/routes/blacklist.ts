// 黑名单 + 用户状态管理
// 黑名单：多次违规或事故的师生进入黑名单，黑名单期内禁止申领任何化学品
// 状态：与教务系统对接，毕业/离校时自动回收所有准入资格
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { authRequired, requireRole } from "../middleware/auth";
import { ok } from "../utils/response";
import { writeAudit } from "../utils/audit";
import { revokeUserQualifications } from "../utils/access";
import { UserRole, UserStatus } from "@prisma/client";

export const blacklistRouter = Router();
blacklistRouter.use(authRequired);

// ============== 黑名单 ==============

const addSchema = z.object({
  userId: z.string(),
  reason: z.string().min(1, "请填写违规原因"),
  violationCount: z.number().int().min(1).default(1),
  // 黑名单有效期（默认 180 天）
  expiresAt: z.string().optional(),
  remark: z.string().optional(),
});

blacklistRouter.post(
  "/",
  requireRole(UserRole.ADMIN, UserRole.SECURITY_OFFICER, UserRole.HAZMAT_ADMIN, UserRole.DEPT_LEAD),
  async (req, res, next) => {
    try {
      const data = addSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { id: data.userId } });
      if (!user) return res.status(404).json({ code: 404, message: "用户不存在" });

      const expiresAt = data.expiresAt
        ? new Date(data.expiresAt)
        : new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

      const entry = await prisma.blacklistEntry.create({
        data: {
          userId: data.userId,
          reason: data.reason,
          violationCount: data.violationCount,
          expiresAt,
          active: true,
          createdById: req.user!.id,
          remark: data.remark,
        },
        include: { user: true, createdBy: true },
      });

      // 同时把用户 userStatus 标记为 BLACKLISTED
      await prisma.user.update({
        where: { id: data.userId },
        data: { userStatus: "BLACKLISTED", statusChangedAt: new Date(), statusReason: data.reason },
      });

      // 进入黑名单时立即回收其所有 ACTIVE 准入资格
      const revoked = await revokeUserQualifications(data.userId, "BLACKLIST");

      await writeAudit({
        actorId: req.user!.id,
        action: "BLACKLIST_ADD",
        entityType: "user",
        entityId: data.userId,
        payload: { reason: data.reason, violationCount: data.violationCount, expiresAt, revokedQuals: revoked },
      });

      res.json(ok({ ...entry, revokedQuals: revoked }));
    } catch (e) {
      next(e);
    }
  }
);

// 解除黑名单
blacklistRouter.post(
  "/:id/lift",
  requireRole(UserRole.ADMIN, UserRole.SECURITY_OFFICER),
  async (req, res, next) => {
    try {
      const entry = await prisma.blacklistEntry.findUnique({ where: { id: req.params.id } });
      if (!entry) return res.status(404).json({ code: 404, message: "黑名单记录不存在" });
      if (!entry.active) return res.status(400).json({ code: 400, message: "该黑名单已解除" });

      const updated = await prisma.blacklistEntry.update({
        where: { id: entry.id },
        data: { active: false },
      });
      // 若用户当前无其它生效黑名单，则恢复 userStatus = ACTIVE
      const stillActive = await prisma.blacklistEntry.findFirst({
        where: { userId: entry.userId, active: true, expiresAt: { gt: new Date() } },
      });
      if (!stillActive) {
        await prisma.user.update({
          where: { id: entry.userId },
          data: { userStatus: "ACTIVE", statusChangedAt: new Date(), statusReason: null },
        });
      }
      await writeAudit({
        actorId: req.user!.id,
        action: "BLACKLIST_LIFT",
        entityType: "user",
        entityId: entry.userId,
        payload: { entryId: entry.id, reason: (req.body && req.body.reason) || "LIFTED" },
      });
      res.json(ok(updated));
    } catch (e) {
      next(e);
    }
  }
);

blacklistRouter.get("/", async (req, res, next) => {
  try {
    const { userId, active } = req.query as any;
    const where: any = {};
    if (userId) where.userId = userId;
    if (active !== undefined) where.active = active === "true" || active === true;
    const list = await prisma.blacklistEntry.findMany({
      where,
      include: { user: true, createdBy: true },
      orderBy: { enteredAt: "desc" },
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});

// ============== 用户状态 ==============

const statusSchema = z.object({
  userStatus: z.enum(["ACTIVE", "GRADUATED", "LEFT", "BLACKLISTED"]),
  reason: z.string().optional(),
});

export const userStatusRouter = Router();
userStatusRouter.use(authRequired);

// 修改用户在学/在职状态：毕业 / 离校时自动回收所有 ACTIVE 准入资格
userStatusRouter.post(
  "/:id/status",
  requireRole(UserRole.ADMIN, UserRole.DEPT_LEAD, UserRole.MENTOR),
  async (req, res, next) => {
    try {
      const data = statusSchema.parse(req.body);
      const u = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!u) return res.status(404).json({ code: 404, message: "用户不存在" });
      const before = u.userStatus;
      const updated = await prisma.user.update({
        where: { id: u.id },
        data: {
          userStatus: data.userStatus as UserStatus,
          statusChangedAt: new Date(),
          statusReason: data.reason,
          // 毕业/离校时关闭账号；黑名单由黑名单接口统一管
          active: data.userStatus === "GRADUATED" || data.userStatus === "LEFT" ? false : u.active,
        },
      });
      let revokedQuals = 0;
      if (data.userStatus === "GRADUATED" || data.userStatus === "LEFT") {
        revokedQuals = await revokeUserQualifications(
          u.id,
          `USER_STATUS_${data.userStatus}` + (data.reason ? `:${data.reason}` : "")
        );
      }
      await writeAudit({
        actorId: req.user!.id,
        action: "USER_STATUS_CHANGE",
        entityType: "user",
        entityId: u.id,
        payload: { before, after: data.userStatus, reason: data.reason, revokedQuals },
      });
      res.json(ok({ ...updated, revokedQuals }));
    } catch (e) {
      next(e);
    }
  }
);

// 用户自助上报毕业/离校（仅更新状态文本，实质回收由管理员触发）
userStatusRouter.post("/me/graduated", async (req, res, next) => {
  try {
    const u = req.user!;
    // 仅做提示性记录，真正的状态变更由管理员接口处理以保证留痕
    await writeAudit({
      actorId: u.id,
      action: "USER_SELF_REPORT_GRADUATED",
      entityType: "user",
      entityId: u.id,
      payload: { note: "用户自助上报毕业/离校，等待管理员确认" },
    });
    res.json(ok({ note: "已记录，请联系学院主管或管理员确认状态变更与资格回收" }));
  } catch (e) {
    next(e);
  }
});
