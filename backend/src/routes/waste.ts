import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";
import { writeAudit } from "../utils/audit";
import { z } from "zod";
import { WasteCategory } from "@prisma/client";

export const wasteRouter = Router();
wasteRouter.use(authRequired);

// 提取真实客户端 IP（兼容反向代理）
function clientIp(req: any): string {
  const xff = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return xff || req.ip || req.socket?.remoteAddress || "unknown";
}

// 相容性矩阵：同类或同安全等级才允许倒入
const COMPATIBILITY: Record<WasteCategory, WasteCategory[]> = {
  ORGANIC: ["ORGANIC"],
  HEAVY_METAL: ["HEAVY_METAL"],
  ACID: ["ACID"],
  ALKALI: ["ALKALI"],
  OXIDIZER: ["OXIDIZER"],
  UNKNOWN: [],
};

wasteRouter.post("/compat-check", async (req, res) => {
  const { bucketCategory, incomingCategory } = req.body as { bucketCategory: WasteCategory; incomingCategory: WasteCategory };
  const okFlag = COMPATIBILITY[incomingCategory]?.includes(bucketCategory) ?? false;
  res.json(ok({ compatible: okFlag, rule: `仅允许向同类废液桶倒入 ${incomingCategory}` }));
});

wasteRouter.get("/buckets", async (req, res, next) => {
  try {
    const { status, ownerOrgId, category } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (ownerOrgId) where.ownerOrgId = ownerOrgId;
    if (category) where.category = category;
    const list = await prisma.wasteBucket.findMany({
      where,
      include: { ownerOrg: true },
      orderBy: { bucketNo: "asc" },
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});

wasteRouter.post("/buckets", async (req, res, next) => {
  try {
    const data = z
      .object({
        bucketNo: z.string(),
        ownerOrgId: z.string(),
        category: z.nativeEnum(WasteCategory),
        capacity: z.number(),
        locatedAt: z.string(),
      })
      .parse(req.body);
    const b = await prisma.wasteBucket.create({ data });
    res.json(ok(b));
  } catch (e) {
    next(e);
  }
});

// ========== 阶段一：发起人(移交方) 提交交接申请 ==========
// 关键约束：发起阶段**只**记录 fromUserId (移交方) 与 fromClientIp；toUserId 必须留空，
// 由 toOrgId 内另一名独立账号在确认阶段独立写入。禁止发起人代填接收方，杜绝"两方字段
// 都被记为发起人"导致年终统计双向重复计入的根因。
const handoffSchema = z.object({
  bucketId: z.string(),
  toOrgId: z.string(),
  weight: z.number(),
  category: z.nativeEnum(WasteCategory),
  photoUrl: z.string().optional(),
  signature: z.string().optional(),
  remark: z.string().optional(),
});

wasteRouter.post("/handoff", async (req, res, next) => {
  try {
    const data = handoffSchema.parse(req.body);
    const callerId = req.user!.id;

    const bucket = await prisma.wasteBucket.findUnique({ where: { id: data.bucketId } });
    if (!bucket) return res.status(404).json({ code: 404, message: "废液桶不存在" });
    if (!COMPATIBILITY[data.category]?.includes(bucket.category)) {
      return res.status(400).json({ code: 400, message: `相容性校验失败：${bucket.category} 桶不允许倒入 ${data.category}` });
    }

    // 接收方必须为另一组织，防止同实验室自我交接造成归属虚化
    if (data.toOrgId === bucket.ownerOrgId) {
      return res.status(400).json({ code: 400, message: "接收方院系不能与废液桶所属院系相同，请选择跨学院接收方" });
    }

    // 发起阶段仅记录移交方信息；toUserId/toConfirmedAt/toClientIp 留空，等待接收方独立确认
    const ip = clientIp(req);
    const h = await prisma.wasteHandoff.create({
      data: {
        bucketId: data.bucketId,
        fromOrgId: bucket.ownerOrgId,
        toOrgId: data.toOrgId,
        fromUserId: callerId,
        fromClientIp: ip,
        // toUserId / toClientIp / toConfirmedAt 留空，强制由接收方在 confirm 阶段独立写入
        weight: data.weight,
        category: data.category,
        photoUrl: data.photoUrl,
        signature: data.signature,
        remark: data.remark,
      },
    });
    await prisma.wasteBucket.update({
      where: { id: data.bucketId },
      data: { currentVolume: { increment: data.weight }, lastHandoffAt: new Date(), status: "PENDING_HANDOVER" },
    });
    await writeAudit({
      actorId: callerId,
      action: "WASTE_HANDOFF_INIT",
      entityType: "bucket",
      entityId: data.bucketId,
      payload: {
        handoffId: h.id,
        fromOrgId: bucket.ownerOrgId,
        toOrgId: data.toOrgId,
        fromUserId: callerId,
        fromClientIp: ip,
        weight: data.weight,
        category: data.category,
        note: "移交方已发起，等待接收方独立确认",
      },
    });
    res.json(ok({ ...h, pendingReceiverConfirm: true }));
  } catch (e) {
    next(e);
  }
});

// ========== 阶段二：接收方独立确认（写入 toUserId 的唯一入口） ==========
// 强制要求：
//   1) 确认人必须来自 toOrgId（按组织身份判别接收方学院代表）；
//   2) 确认人不得与移交方同账号、同组织，杜绝同设备/同账号代签；
//   3) 接收方确认时同步落 toClientIp / toConfirmedAt，便于审计与年终去重。
wasteRouter.post("/handoff/:id/confirm", async (req, res, next) => {
  try {
    const callerId = req.user!.id;
    const ip = clientIp(req);

    const h = await prisma.wasteHandoff.findUnique({ where: { id: req.params.id } });
    if (!h) return res.status(404).json({ code: 404, message: "交接记录不存在" });

    // 1) 仅 PENDING (toUserId 为空) 可被确认
    if (h.toUserId) {
      return res.status(400).json({ code: 400, message: `交接已被接收方(${h.toUserId})确认，不可重复确认` });
    }

    // 2) 禁止移交方本人/同组织账号代签
    if (callerId === h.fromUserId) {
      await writeAudit({
        actorId: callerId,
        action: "WASTE_HANDOFF_CONFIRM_DENIED",
        entityType: "bucket",
        entityId: h.bucketId,
        payload: { handoffId: h.id, reason: "SAME_USER_AS_TRANSFEROR" },
      });
      return res.status(400).json({ code: 400, message: "移交方本人不能确认接收，请由接收方院系独立账号确认" });
    }

    // 3) 确认人必须来自接收方组织
    const receiver = await prisma.user.findUnique({ where: { id: callerId } });
    if (!receiver || !receiver.active) {
      return res.status(400).json({ code: 400, message: "确认账号无效或未启用" });
    }
    if (receiver.orgId !== h.toOrgId) {
      await writeAudit({
        actorId: callerId,
        action: "WASTE_HANDOFF_CONFIRM_DENIED",
        entityType: "bucket",
        entityId: h.bucketId,
        payload: {
          handoffId: h.id,
          reason: "RECEIVER_ORG_MISMATCH",
          expectedToOrgId: h.toOrgId,
          actualOrgId: receiver.orgId,
        },
      });
      return res.status(403).json({ code: 403, message: "确认人必须为接收方院系在册人员" });
    }

    // 4) 同一移交方与接收方在极端情况下不应来自同一客户端 IP
    if (h.fromClientIp && h.fromClientIp === ip) {
      return res.status(400).json({ code: 400, message: "移交方与接收方客户端 IP 相同，请使用独立终端独立登录后再次确认" });
    }

    const updated = await prisma.wasteHandoff.update({
      where: { id: h.id },
      data: {
        toUserId: callerId,
        toClientIp: ip,
        toConfirmedAt: new Date(),
      },
    });
    await prisma.wasteBucket.update({ where: { id: h.bucketId }, data: { status: "SEALED" } });
    await writeAudit({
      actorId: callerId,
      action: "WASTE_HANDOFF_CONFIRM",
      entityType: "bucket",
      entityId: h.bucketId,
      payload: {
        handoffId: h.id,
        fromOrgId: h.fromOrgId,
        toOrgId: h.toOrgId,
        fromUserId: h.fromUserId,
        toUserId: callerId,
        fromClientIp: h.fromClientIp,
        toClientIp: ip,
        weight: h.weight,
        category: h.category,
        note: "接收方已独立确认，电子交接完成",
      },
    });
    res.json(ok({ ...updated, confirmed: true }));
  } catch (e) {
    next(e);
  }
});

wasteRouter.get("/handoffs", async (_req, res, next) => {
  try {
    const list = await prisma.wasteHandoff.findMany({
      include: {
        bucket: true,
        fromUser: { select: { id: true, fullName: true, username: true, orgId: true } },
        toUser: { select: { id: true, fullName: true, username: true, orgId: true } },
      },
      orderBy: { handoverAt: "desc" },
      take: 200,
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});
