// 实验项目—准入资格—化学品授权 联动：核心判定工具
// 单一事实源：高危品类集合、资格等级判定、申请前预校验
// 设计：所有 prisma 访问通过参数注入，便于测试时使用 SQLite 验证库

import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db/prisma";

// 高危化学品类别（与 Chemical.hazardClass 同步）
export const HIGH_RISK_HAZARD_CLASSES = [
  "PRECURSOR_DRUG",      // 易制毒
  "EXPLOSIVE_PRECURSOR", // 易制爆
  "HIGHLY_TOXIC",        // 剧毒
] as const;

export type HazardClassLike = string;

export function isHighRiskCategory(hazardClass: HazardClassLike) {
  return (HIGH_RISK_HAZARD_CLASSES as readonly string[]).includes(hazardClass);
}

// 项目是否包含高危品类（用于自动标记 isHighRisk）
export function calcIsHighRisk(hazardCategories: string[]) {
  return hazardCategories.some((c) => isHighRiskCategory(c));
}

// 解析 Project.hazardCategories（DB 中以 JSON 字符串持久化）
export function parseHazardCategories(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
    return [];
  } catch {
    return [];
  }
}

// 序列化为可落库的 JSON 字符串
export function serializeHazardCategories(list: string[]) {
  return JSON.stringify(Array.from(new Set(list)));
}

// 当前时间（便于测试时注入；保持函数式避免散落 `new Date()`）
export function now() {
  return new Date();
}

// 工具类型：默认 prisma 用于生产路由；测试可通过参数覆盖
type PrismaLike = PrismaClient;

// 判断用户是否处于黑名单有效期内
export async function isUserBlacklisted(userId: string, at: Date = now(), db: PrismaLike = defaultPrisma) {
  const entry = await db.blacklistEntry.findFirst({
    where: {
      userId,
      active: true,
      expiresAt: { gt: at },
    },
  });
  return !!entry;
}

// 判断用户是否在岗/在校（非 GRADUATED / LEFT / BLACKLISTED）
export async function isUserActiveStatus(userId: string, db: PrismaLike = defaultPrisma) {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { active: true, userStatus: true },
  });
  if (!u || !u.active) return false;
  if (u.userStatus === "GRADUATED" || u.userStatus === "LEFT" || u.userStatus === "BLACKLISTED") return false;
  return true;
}

// 拉取用户在指定时刻仍生效的资格（基础 / 高危）
export async function getActiveQualifications(userId: string, at: Date = now(), db: PrismaLike = defaultPrisma) {
  const list = await db.accessQualification.findMany({
    where: {
      userId,
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
    },
  });
  return list;
}

// 拉取某用户在某项目中通过跨学院备案获得的临时资格
export async function getCrossCollabQualifications(userId: string, projectId: string, at: Date = now(), db: PrismaLike = defaultPrisma) {
  const list = await db.accessQualification.findMany({
    where: {
      userId,
      source: "CROSS_COLLAB_TEMP",
      sourceProjectId: projectId,
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
    },
  });
  return list;
}

// 判定用户对指定 hazardClass 是否具备准入资格
export async function userCanAccessHazardClass(
  userId: string,
  hazardClass: HazardClassLike,
  projectId?: string,
  at: Date = now(),
  db: PrismaLike = defaultPrisma
) {
  const quals = await getActiveQualifications(userId, at, db);
  if (isHighRiskCategory(hazardClass)) {
    return quals.some((q) => q.qualificationType === "HIGH_RISK");
  }
  if (quals.some((q) => q.qualificationType === "BASIC")) return true;
  if (projectId) {
    const collabQuals = await getCrossCollabQualifications(userId, projectId, at, db);
    if (collabQuals.length > 0) return true;
  }
  return false;
}

// 化学品领用前的一站式预校验
export async function checkRequisitionEligibility(
  opts: {
    applicantId: string;
    bottles: { bottleId: string }[];
    projectId?: string;
    at?: Date;
  },
  db: PrismaLike = defaultPrisma
): Promise<{
  ok: boolean;
  code?: number;
  message?: string;
  bottles?: Awaited<ReturnType<typeof defaultPrisma.reagentBottle.findMany>>;
  hazardClasses?: string[];
  projectHazardCategories?: string[];
}> {
  const at = opts.at ?? now();
  const userId = opts.applicantId;

  // 1) 黑名单优先（更具体的拒绝原因）
  if (await isUserBlacklisted(userId, at, db)) {
    return { ok: false, code: 403, message: "账号处于黑名单期内，禁止申领任何化学品" };
  }
  // 2) 用户状态
  if (!(await isUserActiveStatus(userId, db))) {
    return { ok: false, code: 403, message: "账号已毕业/离校/被禁用，无法领用化学品" };
  }

  // 2) 解析 bottles → chemicals
  const bottles = await db.reagentBottle.findMany({
    where: { id: { in: opts.bottles.map((b) => b.bottleId) } },
    include: { chemical: true },
  });
  if (bottles.length !== opts.bottles.length) {
    return { ok: false, code: 400, message: "存在无效的试剂瓶 ID" };
  }
  const hazardClasses = Array.from(new Set(bottles.map((b) => b.chemical.hazardClass)));

  // 3) 项目状态
  let projectHazardCategories: string[] = [];
  if (opts.projectId) {
    const project = await db.project.findUnique({ where: { id: opts.projectId } });
    if (!project) return { ok: false, code: 404, message: "关联项目不存在" };
    if (project.status !== "ACTIVE") {
      return { ok: false, code: 400, message: `项目已${project.status === "COMPLETED" ? "结题" : "取消"}，无法发起新领用` };
    }
    projectHazardCategories = parseHazardCategories(project.hazardCategories);

    // 4) 项目品类与化学品类别联动
    const notInProject = hazardClasses.filter((hc) => !projectHazardCategories.includes(hc));
    if (notInProject.length > 0) {
      return {
        ok: false,
        code: 400,
        message: `化学品类别 ${notInProject.join(", ")} 不在项目 "${project.name}" 的授权品类范围内`,
      };
    }
  }

  // 5) 资格等级联动
  for (const hc of hazardClasses) {
    const can = await userCanAccessHazardClass(userId, hc, opts.projectId, at, db);
    if (!can) {
      const label = isHighRiskCategory(hc) ? "高危专项" : "基础";
      return {
        ok: false,
        code: 403,
        message: `缺少 ${label}准入资格，无法领用 ${hc} 类化学品`,
      };
    }
  }

  return { ok: true, bottles, hazardClasses, projectHazardCategories };
}

// 回收用户的所有 ACTIVE 准入资格（用于毕业/离校/违规等场景）
export async function revokeUserQualifications(userId: string, reason: string, at: Date = now(), db: PrismaLike = defaultPrisma) {
  const result = await db.accessQualification.updateMany({
    where: { userId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: at, revokedReason: reason },
  });
  return result.count;
}

// 项目结题时回收协作学院临时资格
export async function revokeProjectCollabQualifications(projectId: string, reason: string, at: Date = now(), db: PrismaLike = defaultPrisma) {
  const result = await db.accessQualification.updateMany({
    where: { sourceProjectId: projectId, source: "CROSS_COLLAB_TEMP", status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: at, revokedReason: reason },
  });
  await db.projectCollaboratorOrg.updateMany({
    where: { projectId, status: "ACTIVE" },
    data: { status: "EXPIRED" },
  });
  return result.count;
}
