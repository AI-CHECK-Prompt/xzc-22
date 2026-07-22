import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";
import { writeAudit } from "../utils/audit";
import { z } from "zod";

export const dualVerificationRouter = Router();
dualVerificationRouter.use(authRequired);

// 提取真实客户端 IP（兼容反向代理）
function clientIp(req: any): string {
  const xff = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return xff || req.ip || req.socket?.remoteAddress || "unknown";
}

// ========== 阶段一：userA 发起双人核验（仅创建待核验记录，**不**开锁） ==========
// 提交后状态 result = null，柜锁保持关闭；userB 必须以本人账号独立登录后调用 /:id/confirm 才能开锁。
const initSchema = z.object({
  requisitionId: z.string(),
  userBId: z.string(),
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
  locationDesc: z.string().optional(),
  videoUrl: z.string().optional(),
});

dualVerificationRouter.post("/", async (req, res, next) => {
  try {
    const data = initSchema.parse(req.body);
    const userAId = req.user!.id;

    // 1) userA 与 userB 必须为不同账号，杜绝单人冒充
    if (data.userBId === userAId) {
      await writeAudit({
        actorId: userAId,
        action: "DUAL_VERIFY_INIT_DENIED",
        entityType: "requisition",
        entityId: data.requisitionId,
        payload: { reason: "SAME_USER", userBId: data.userBId },
      });
      return res.status(400).json({ code: 400, message: "userA 与 userB 不能为同一账号" });
    }

    // 2) 领用单必须存在且已审批通过；防止对 PENDING/REJECTED 等状态发起核验
    const requisition = await prisma.requisition.findUnique({ where: { id: data.requisitionId } });
    if (!requisition) return res.status(404).json({ code: 404, message: "领用单不存在" });
    if (requisition.status !== "APPROVED") {
      return res.status(400).json({ code: 400, message: `当前领用单状态为 ${requisition.status}，仅 APPROVED 可发起核验` });
    }

    // 3) userB 必须为系统内有效且启用账号
    const userB = await prisma.user.findUnique({ where: { id: data.userBId } });
    if (!userB || !userB.active) {
      return res.status(400).json({ code: 400, message: "userB 账号无效或未启用" });
    }

    // 4) 一张领用单只允许存在一条核验记录；已存在则拒绝重复发起
    const existing = await prisma.dualVerification.findUnique({ where: { requisitionId: data.requisitionId } });
    if (existing) {
      return res.status(400).json({ code: 400, message: "该领用单已存在核验记录，请等待 userB 独立确认" });
    }

    // 5) 仅创建 PENDING 记录，**不**触发开锁、不变更柜锁时间戳
    const v = await prisma.dualVerification.create({
      data: {
        requisitionId: data.requisitionId,
        userAId,
        userBId: data.userBId,
        locationLat: data.locationLat,
        locationLng: data.locationLng,
        locationDesc: data.locationDesc,
        videoUrl: data.videoUrl,
        userAClientIp: clientIp(req),
        result: null,
      },
    });
    // 状态推进为 VERIFYING（核验进行中，等待 userB 独立确认）
    await prisma.requisition.update({ where: { id: data.requisitionId }, data: { status: "VERIFYING" } });
    await writeAudit({
      actorId: userAId,
      action: "DUAL_VERIFY_INIT",
      entityType: "requisition",
      entityId: data.requisitionId,
      payload: {
        verificationId: v.id,
        userBId: data.userBId,
        userAClientIp: v.userAClientIp,
        location: data.locationDesc,
        video: data.videoUrl,
        note: "userA 已提交，待 userB 独立登录确认后开锁",
      },
    });
    res.json(ok({ ...v, pendingUserBConfirm: true }));
  } catch (e) {
    next(e);
  }
});

// ========== 阶段二：userB 独立登录后的二次确认（唯一开锁入口） ==========
// userB 提交的人脸特征/定位/录像等字段必须由其本人本次登录会话上报，
// 平台不接受 userA 客户端代为转发；只有此接口才会真正落 cabinetOpenedAt。
const confirmSchema = z.object({
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
  locationDesc: z.string().optional(),
  videoUrl: z.string().optional(),
  // 人脸特征可选字段，前端如有就传，平台只信任本次 userB 会话上报
  faceFeature: z.string().optional(),
  remark: z.string().optional(),
});

dualVerificationRouter.post("/:id/confirm", async (req, res, next) => {
  try {
    const data = confirmSchema.parse(req.body);
    const userBId = req.user!.id;

    const v = await prisma.dualVerification.findUnique({ where: { id: req.params.id } });
    if (!v) return res.status(404).json({ code: 404, message: "核验记录不存在" });

    // 1) 必须由 userB 本人登录确认，禁止 userA 或其他账号代为确认
    if (v.userBId !== userBId) {
      await writeAudit({
        actorId: userBId,
        action: "DUAL_VERIFY_CONFIRM_DENIED",
        entityType: "requisition",
        entityId: v.requisitionId,
        payload: { reason: "USERB_MISMATCH", expectedUserBId: v.userBId, actualUserId: userBId },
      });
      return res.status(403).json({ code: 403, message: "仅 userB 本人可独立确认" });
    }

    // 2) 不能与 userA 同人（与 init 阶段一致的兜底校验）
    if (v.userAId === userBId) {
      return res.status(400).json({ code: 400, message: "userA 与 userB 不能为同一账号" });
    }

    // 3) 状态机：仅 PENDING（result=null 且未开锁）可进入确认
    if (v.result !== null) {
      return res.status(400).json({ code: 400, message: `核验已结束（result=${v.result}），不可重复确认` });
    }
    if (v.cabinetOpenedAt) {
      return res.status(400).json({ code: 400, message: "柜锁已开启，请勿重复确认" });
    }

    const ip = clientIp(req);
    // 4) 两端必须来自不同客户端 IP，规避同设备/同浏览器代签
    if (v.userAClientIp && v.userAClientIp === ip) {
      await writeAudit({
        actorId: userBId,
        action: "DUAL_VERIFY_CONFIRM_DENIED",
        entityType: "requisition",
        entityId: v.requisitionId,
        payload: { reason: "SAME_IP_AS_USERA", userAClientIp: v.userAClientIp, userBClientIp: ip },
      });
      return res.status(400).json({ code: 400, message: "userB 端与 userA 端客户端 IP 相同，请使用独立终端独立登录后再次确认" });
    }

    const updated = await prisma.dualVerification.update({
      where: { id: v.id },
      data: {
        userBLocationLat: data.locationLat,
        userBLocationLng: data.locationLng,
        userBLocationDesc: data.locationDesc,
        userBVideoUrl: data.videoUrl,
        userBConfirmedAt: new Date(),
        userBClientIp: ip,
        result: "PASS",
        cabinetOpenedAt: new Date(),
        remark: data.remark,
      },
    });
    await writeAudit({
      actorId: userBId,
      action: "DUAL_VERIFY_CONFIRM",
      entityType: "requisition",
      entityId: v.requisitionId,
      payload: {
        verificationId: v.id,
        userBId,
        userBClientIp: ip,
        userAClientIp: v.userAClientIp,
        userBLocation: data.locationDesc,
        userBVideo: data.videoUrl,
        faceFeature: data.faceFeature,
        note: "userB 已独立确认，柜锁开启",
      },
    });
    res.json(ok(updated));
  } catch (e) {
    next(e);
  }
});

// ========== 关闭柜锁：仅 userA / userB 本人可调用 ==========
dualVerificationRouter.post("/:id/close", async (req, res, next) => {
  try {
    const v = await prisma.dualVerification.findUnique({ where: { id: req.params.id } });
    if (!v) return res.status(404).json({ code: 404, message: "核验记录不存在" });
    const callerId = req.user!.id;
    if (callerId !== v.userAId && callerId !== v.userBId) {
      await writeAudit({
        actorId: callerId,
        action: "DUAL_VERIFY_CLOSE_DENIED",
        entityType: "requisition",
        entityId: v.requisitionId,
        payload: { reason: "NOT_PARTICIPANT", userAId: v.userAId, userBId: v.userBId },
      });
      return res.status(403).json({ code: 403, message: "仅本次核验的 userA / userB 可关闭柜锁" });
    }
    const updated = await prisma.dualVerification.update({
      where: { id: v.id },
      data: { cabinetClosedAt: new Date() },
    });
    const r = await prisma.requisition.findUnique({ where: { id: v.requisitionId }, include: { bottles: true } });
    if (r) {
      await prisma.requisition.update({ where: { id: r.id }, data: { status: "COMPLETED" } });
      for (const rb of r.bottles) {
        await prisma.reagentBottle.update({ where: { id: rb.bottleId }, data: { status: "IN_USE" } });
      }
    }
    await writeAudit({
      actorId: callerId,
      action: "DUAL_VERIFY_CLOSE",
      entityType: "requisition",
      entityId: v.requisitionId,
      payload: { verificationId: v.id, callerRole: callerId === v.userAId ? "USERA" : "USERB" },
    });
    res.json(ok(updated));
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
