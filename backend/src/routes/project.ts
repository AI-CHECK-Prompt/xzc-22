// 实验项目登记：学院/课题组登记在研项目，高危品类自动标记
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { authRequired, requireRole } from "../middleware/auth";
import { ok } from "../utils/response";
import { genNo } from "../utils/code";
import { writeAudit } from "../utils/audit";
import {
  calcIsHighRisk,
  revokeProjectCollabQualifications,
  serializeHazardCategories,
} from "../utils/access";
import { UserRole, UserStatus } from "@prisma/client";

export const projectRouter = Router();
projectRouter.use(authRequired);

// 项目登记
const createSchema = z.object({
  projectCode: z.string().optional(), // 不传则自动生成
  name: z.string(),
  description: z.string().optional(),
  leaderId: z.string(),
  leadOrgId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  hazardCategories: z.array(z.string()).min(1, "至少选择一类化学品"),
  memberUserIds: z.array(z.string()).optional(),
  remark: z.string().optional(),
});

projectRouter.post(
  "/",
  requireRole(UserRole.ADMIN, UserRole.DEPT_LEAD, UserRole.PROJECT_LEAD, UserRole.MENTOR),
  async (req, res, next) => {
    try {
      const data = createSchema.parse(req.body);

      // 校验时间区间
      const startDate = new Date(data.startDate);
      const endDate = new Date(data.endDate);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ code: 400, message: "项目时间格式不合法" });
      }
      if (endDate <= startDate) {
        return res.status(400).json({ code: 400, message: "项目结束时间必须晚于开始时间" });
      }

      // 项目负责人必须存在
      const leader = await prisma.user.findUnique({ where: { id: data.leaderId } });
      if (!leader) return res.status(404).json({ code: 404, message: "项目负责人不存在" });

      // 牵头学院必须存在
      const leadOrg = await prisma.organization.findUnique({ where: { id: data.leadOrgId } });
      if (!leadOrg) return res.status(404).json({ code: 404, message: "牵头学院不存在" });

      // 自动判定高危
      const isHighRisk = calcIsHighRisk(data.hazardCategories);

      const projectCode = data.projectCode || genNo("PRJ");

      const project = await prisma.project.create({
        data: {
          projectCode,
          name: data.name,
          description: data.description,
          leaderId: data.leaderId,
          leadOrgId: data.leadOrgId,
          startDate,
          endDate,
          hazardCategories: serializeHazardCategories(data.hazardCategories),
          isHighRisk,
          remark: data.remark,
          members: {
            create: [
              // 负责人默认进成员表
              { userId: data.leaderId, role: "LEADER" },
              // 其它成员
              ...(data.memberUserIds || [])
                .filter((uid) => uid !== data.leaderId)
                .map((uid) => ({ userId: uid, role: "MEMBER" as const })),
            ],
          },
        },
        include: { members: { include: { user: true } }, leader: true, leadOrg: true },
      });

      await writeAudit({
        actorId: req.user!.id,
        action: "PROJECT_CREATE",
        entityType: "project",
        entityId: project.id,
        payload: { projectCode, isHighRisk, hazardCategories: data.hazardCategories, leaderId: data.leaderId, leadOrgId: data.leadOrgId },
      });

      res.json(ok(project));
    } catch (e) {
      next(e);
    }
  }
);

// 项目列表
projectRouter.get("/", async (req, res, next) => {
  try {
    const { status, leadOrgId, isHighRisk, q } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (leadOrgId) where.leadOrgId = leadOrgId;
    if (isHighRisk !== undefined) where.isHighRisk = isHighRisk === "true" || isHighRisk === true;
    if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { projectCode: { contains: q, mode: "insensitive" } }];

    const list = await prisma.project.findMany({
      where,
      include: { leader: true, leadOrg: true, members: { include: { user: true } }, collaborators: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(ok(list.map((p) => ({ ...p, hazardCategories: JSON.parse(p.hazardCategories || "[]") }))));
  } catch (e) {
    next(e);
  }
});

// 我参与的项目
projectRouter.get("/mine", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const list = await prisma.project.findMany({
      where: {
        OR: [{ leaderId: userId }, { members: { some: { userId, active: true } } }],
      },
      include: { leadOrg: true, leader: true, members: { include: { user: true } }, collaborators: { include: { } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});

projectRouter.get("/:id", async (req, res, next) => {
  try {
    const p = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        leader: true,
        leadOrg: true,
        members: { include: { user: true } },
        collaborators: { include: { approvedBy: true } },
        qualifications: { where: { status: "ACTIVE" }, include: { user: true } },
        requisitions: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!p) return res.status(404).json({ code: 404, message: "项目不存在" });
    res.json(ok({ ...p, hazardCategories: JSON.parse(p.hazardCategories || "[]") }));
  } catch (e) {
    next(e);
  }
});

// 项目结题（与科研处系统对接，简化以管理员/项目负责人/学院主管可触发）
const closeSchema = z.object({
  remark: z.string().optional(),
});

projectRouter.post(
  "/:id/close",
  requireRole(UserRole.ADMIN, UserRole.DEPT_LEAD, UserRole.PROJECT_LEAD, UserRole.RESEARCH_DEPT),
  async (req, res, next) => {
    try {
      const data = closeSchema.parse(req.body);
      const p = await prisma.project.findUnique({ where: { id: req.params.id } });
      if (!p) return res.status(404).json({ code: 404, message: "项目不存在" });
      if (p.status === "COMPLETED") return res.status(400).json({ code: 400, message: "项目已结题" });
      if (p.status === "CANCELLED") return res.status(400).json({ code: 400, message: "项目已取消" });

      // 项目结题：自动回收协作学院临时资格（联动核心）
      const revokedCount = await revokeProjectCollabQualifications(p.id, "PROJECT_COMPLETED");

      const updated = await prisma.project.update({
        where: { id: p.id },
        data: { status: "COMPLETED", remark: data.remark ?? p.remark },
      });
      await writeAudit({
        actorId: req.user!.id,
        action: "PROJECT_COMPLETE",
        entityType: "project",
        entityId: p.id,
        payload: { revokedCollabQuals: revokedCount, remark: data.remark },
      });
      res.json(ok({ ...updated, revokedCollabQuals: revokedCount }));
    } catch (e) {
      next(e);
    }
  }
);

// 跨学院项目协作备案
const collabSchema = z.object({
  orgId: z.string(),
  validFrom: z.string(),
  validTo: z.string(),
  // 协作学院下要拿临时资格的学生 userIds（不传则只备案学院，不发资格）
  userIds: z.array(z.string()).optional(),
});

projectRouter.post(
  "/:id/collaborators",
  requireRole(UserRole.ADMIN, UserRole.DEPT_LEAD, UserRole.PROJECT_LEAD, UserRole.MENTOR),
  async (req, res, next) => {
    try {
      const data = collabSchema.parse(req.body);
      const p = await prisma.project.findUnique({ where: { id: req.params.id } });
      if (!p) return res.status(404).json({ code: 404, message: "项目不存在" });
      if (p.status !== "ACTIVE") return res.status(400).json({ code: 400, message: "仅在研项目可新增协作备案" });

      const validFrom = new Date(data.validFrom);
      const validTo = new Date(data.validTo);
      if (isNaN(validFrom.getTime()) || isNaN(validTo.getTime())) {
        return res.status(400).json({ code: 400, message: "协作时间格式不合法" });
      }
      if (validTo <= validFrom) {
        return res.status(400).json({ code: 400, message: "协作结束时间必须晚于开始时间" });
      }
      if (data.orgId === p.leadOrgId) {
        return res.status(400).json({ code: 400, message: "协作学院不能与牵头学院相同" });
      }
      // 临时资格有效期不能超出项目周期
      if (validFrom < p.startDate || validTo > p.endDate) {
        return res.status(400).json({ code: 400, message: "临时资格有效期需落在项目周期内" });
      }

      const collab = await prisma.projectCollaboratorOrg.upsert({
        where: { projectId_orgId: { projectId: p.id, orgId: data.orgId } },
        update: { validFrom, validTo, status: "ACTIVE", approvedById: req.user!.id, approvedAt: new Date() },
        create: {
          projectId: p.id,
          orgId: data.orgId,
          approvedById: req.user!.id,
          validFrom,
          validTo,
        },
      });

      let issued = 0;
      const userIds = (data.userIds || []).filter(Boolean);
      // 默认给协作学院下所有 active 且 userStatus=ACTIVE 的学生发临时基础资格
      let targetUserIds = userIds;
      if (targetUserIds.length === 0) {
        const students = await prisma.user.findMany({
          where: { orgId: data.orgId, active: true, userStatus: "ACTIVE" },
          select: { id: true },
        });
        targetUserIds = students.map((s) => s.id);
      }
      for (const uid of targetUserIds) {
        const u = await prisma.user.findUnique({ where: { id: uid } });
        if (!u || !u.active || u.userStatus !== "ACTIVE") continue;
        // 撤销该用户已存在的同源临时资格
        await prisma.accessQualification.updateMany({
          where: { userId: uid, source: "CROSS_COLLAB_TEMP", sourceProjectId: p.id, status: "ACTIVE" },
          data: { status: "REVOKED", revokedAt: new Date(), revokedReason: "REISSUED" },
        });
        await prisma.accessQualification.create({
          data: {
            userId: uid,
            qualificationType: "BASIC",
            source: "CROSS_COLLAB_TEMP",
            sourceProjectId: p.id,
            issuedById: req.user!.id,
            expiresAt: validTo,
            status: "ACTIVE",
          },
        });
        issued += 1;
      }

      await writeAudit({
        actorId: req.user!.id,
        action: "PROJECT_COLLABORATOR_REGISTER",
        entityType: "project",
        entityId: p.id,
        payload: { collabOrgId: data.orgId, validFrom, validTo, issuedTempQuals: issued },
      });

      res.json(ok({ collab, issuedTempQuals: issued }));
    } catch (e) {
      next(e);
    }
  }
);

// 列出某项目下的协作学院备案
projectRouter.get("/:id/collaborators", async (req, res, next) => {
  try {
    const list = await prisma.projectCollaboratorOrg.findMany({
      where: { projectId: req.params.id },
      include: { approvedBy: true },
      orderBy: { approvedAt: "desc" },
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});

// 列出某项目下协作学院学生获得的临时资格
projectRouter.get("/:id/temp-qualifications", async (req, res, next) => {
  try {
    const list = await prisma.accessQualification.findMany({
      where: { sourceProjectId: req.params.id, source: "CROSS_COLLAB_TEMP" },
      include: { user: true },
      orderBy: { issuedAt: "desc" },
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});
