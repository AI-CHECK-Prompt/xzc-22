// 端到端回归测试：验证"实验项目—准入资格—化学品授权"联动核心场景
// 1) 项目登记与高危品类自动标记
// 2) 基础/高危培训与准入资格签发
// 3) 领用前资格 + 项目品类 + 用户状态 联动校验
// 4) 跨学院项目协作 → 临时资格 → 项目结题自动回收
// 5) 毕业/离校自动回收 + 黑名单禁领
// 用 SQLite 验证库（verify-access-schema.prisma）做最小集成验证，验证通过后保留作为回归用例。
// 必须在 new PrismaClient() 之前设置 DATABASE_URL，避免误连生产 Postgres
const DB_FILE = path.resolve(__dirname, "dev-access.db").replace(/\\/g, "/");
process.env.DATABASE_URL = `file:${DB_FILE}`;

import { execSync } from "child_process";
import { PrismaClient } from "../node_modules/.prisma/verify-access-client";
import path from "path";
import {
  calcIsHighRisk,
  checkRequisitionEligibility,
  isUserBlacklisted,
  isUserActiveStatus,
  parseHazardCategories,
  serializeHazardCategories,
  userCanAccessHazardClass,
  revokeUserQualifications,
  revokeProjectCollabQualifications,
} from "../src/utils/access";

const prisma = new PrismaClient();

function header(name: string) {
  console.log(`\n========== ${name} ==========`);
}

function assert(cond: any, msg: string) {
  if (!cond) {
    console.error("【FAIL】", msg);
    process.exit(1);
  } else {
    console.log("【OK】", msg);
  }
}

async function reset() {
  // 验证库仅含本测试关注的表，依赖 verify-access-schema.prisma 已 db push 完成
  await prisma.approvalStep.deleteMany();
  await prisma.requisition.deleteMany();
  await prisma.reagentBottle.deleteMany();
  await prisma.chemical.deleteMany();
  await prisma.accessQualification.deleteMany();
  await prisma.blacklistEntry.deleteMany();
  await prisma.trainingRecord.deleteMany();
  await prisma.projectCollaboratorOrg.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.wasteBucket.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
}

async function main() {
  // 准备数据库
  const schemaPath = path.resolve(__dirname, "verify-access-schema.prisma").replace(/\\/g, "/");
  process.env.DATABASE_URL = `file:${DB_FILE}`;
  try {
    execSync(`npx prisma db push --schema="${schemaPath}" --skip-generate --accept-data-loss --force-reset`, {
      stdio: "ignore",
      env: { ...process.env, DATABASE_URL: `file:${DB_FILE}` },
    });
  } catch (e) {
    console.warn("【Verify】prisma db push 失败，可能数据库未就绪，尝试继续:", (e as Error).message);
  }
  await reset();

  // ====================== 准备数据 ======================
  const chemDept = await prisma.organization.create({ data: { name: "化工学院", type: "DEPARTMENT" } });
  const bioDept = await prisma.organization.create({ data: { name: "生科院", type: "DEPARTMENT" } });

  const security = await prisma.user.create({
    data: { username: "sec", passwordHash: "x", fullName: "周保卫", role: "SECURITY_OFFICER", orgId: chemDept.id, active: true, userStatus: "ACTIVE" },
  });
  const mentor = await prisma.user.create({
    data: { username: "mentor", passwordHash: "x", fullName: "王导师", role: "MENTOR", orgId: chemDept.id, active: true, userStatus: "ACTIVE" },
  });
  const gradStudent = await prisma.user.create({
    data: { username: "stu_grad", passwordHash: "x", fullName: "研究生-小张", role: "RESEARCHER", orgId: chemDept.id, active: true, userStatus: "ACTIVE" },
  });
  const blackStudent = await prisma.user.create({
    data: { username: "stu_bad", passwordHash: "x", fullName: "违规生-小李", role: "RESEARCHER", orgId: chemDept.id, active: true, userStatus: "ACTIVE" },
  });
  // 跨学院协作：生科院的协作学生
  const bioStudent = await prisma.user.create({
    data: { username: "stu_bio", passwordHash: "x", fullName: "生科协作-小陈", role: "RESEARCHER", orgId: bioDept.id, active: true, userStatus: "ACTIVE" },
  });

  const flammable = await prisma.chemical.create({ data: { casNo: "67-56-1", name: "甲醇", hazardClass: "FLAMMABLE", storageClass: "易燃" } });
  const precursor = await prisma.chemical.create({ data: { casNo: "100-41-4", name: "乙苯(易制毒)", hazardClass: "PRECURSOR_DRUG", storageClass: "易制毒" } });
  const highlyToxic = await prisma.chemical.create({ data: { casNo: "108-95-2", name: "苯酚(剧毒)", hazardClass: "HIGHLY_TOXIC", storageClass: "剧毒" } });
  const explosive = await prisma.chemical.create({ data: { casNo: "7722-84-1", name: "过氧化氢 30%(易制爆)", hazardClass: "EXPLOSIVE_PRECURSOR", storageClass: "易制爆" } });

  const bottle1 = await prisma.reagentBottle.create({
    data: { traceCode: "T1", chemicalId: flammable.id, batchNo: "B1", supplier: "S1", manufactureDate: new Date("2026-01-01"), initialQty: 1000, remainingQty: 800, unit: "mL", locationOrgId: chemDept.id, status: "IN_STORAGE" },
  });
  const bottle2 = await prisma.reagentBottle.create({
    data: { traceCode: "T2", chemicalId: precursor.id, batchNo: "B2", supplier: "S1", manufactureDate: new Date("2026-01-01"), initialQty: 500, remainingQty: 500, unit: "mL", locationOrgId: chemDept.id, status: "IN_STORAGE" },
  });
  const bottle3 = await prisma.reagentBottle.create({
    data: { traceCode: "T3", chemicalId: highlyToxic.id, batchNo: "B3", supplier: "S1", manufactureDate: new Date("2026-01-01"), initialQty: 100, remainingQty: 100, unit: "g", locationOrgId: chemDept.id, status: "IN_STORAGE" },
  });
  const bottle4 = await prisma.reagentBottle.create({
    data: { traceCode: "T4", chemicalId: explosive.id, batchNo: "B4", supplier: "S1", manufactureDate: new Date("2026-01-01"), initialQty: 200, remainingQty: 200, unit: "mL", locationOrgId: chemDept.id, status: "IN_STORAGE" },
  });

  // ====================== 阶段一：项目登记 + 高危自动标记 ======================
  header("阶段一：项目登记与高危品类自动标记");
  assert(calcIsHighRisk(["FLAMMABLE", "GENERAL"]) === false, "普品 → 非高危");
  assert(calcIsHighRisk(["FLAMMABLE", "PRECURSOR_DRUG"]) === true, "含易制毒 → 高危");
  assert(calcIsHighRisk(["EXPLOSIVE_PRECURSOR"]) === true, "含易制爆 → 高危");
  assert(calcIsHighRisk(["HIGHLY_TOXIC"]) === true, "含剧毒 → 高危");

  const generalProject = await prisma.project.create({
    data: {
      projectCode: "PRJ-GEN-001",
      name: "普通溶剂项目",
      leaderId: mentor.id,
      leadOrgId: chemDept.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2027-12-31"),
      hazardCategories: serializeHazardCategories(["FLAMMABLE", "GENERAL"]),
      isHighRisk: calcIsHighRisk(["FLAMMABLE", "GENERAL"]),
      members: { create: [{ userId: mentor.id, role: "LEADER" }, { userId: gradStudent.id, role: "MEMBER" }] },
    },
  });
  assert(generalProject.isHighRisk === false, "普品项目 isHighRisk=false");

  const highRiskProject = await prisma.project.create({
    data: {
      projectCode: "PRJ-HR-001",
      name: "易制爆/易制毒项目",
      leaderId: mentor.id,
      leadOrgId: chemDept.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2027-12-31"),
      hazardCategories: serializeHazardCategories(["FLAMMABLE", "PRECURSOR_DRUG", "EXPLOSIVE_PRECURSOR"]),
      isHighRisk: calcIsHighRisk(["FLAMMABLE", "PRECURSOR_DRUG", "EXPLOSIVE_PRECURSOR"]),
      members: { create: [{ userId: mentor.id, role: "LEADER" }] },
    },
  });
  assert(highRiskProject.isHighRisk === true, "高危项目 isHighRisk=true（自动标记）");
  assert(parseHazardCategories(highRiskProject.hazardCategories).includes("PRECURSOR_DRUG"), "hazardCategories 反序列化正确");

  // ====================== 阶段二：培训记录 + 准入资格签发 ======================
  header("阶段二：培训记录与基础/高危准入资格签发");
  // 小张通过基础安全培训
  const t1 = await prisma.trainingRecord.create({
    data: { userId: gradStudent.id, trainingType: "BASIC_SAFETY", score: 92, passed: true, conductedById: security.id },
  });
  assert(t1.passed === true, "小张基础安全培训通过");

  // 签发基础准入资格
  const basicQ = await prisma.accessQualification.create({
    data: { userId: gradStudent.id, qualificationType: "BASIC", source: "TRAINING", issuedById: security.id, status: "ACTIVE" },
  });
  assert(basicQ.status === "ACTIVE", "基础资格已签发");

  // 小张未通过高危专项 → 无 HIGH_RISK 资格
  const canPrecursor = await userCanAccessHazardClass(gradStudent.id, "PRECURSOR_DRUG", undefined, undefined, prisma);
  assert(canPrecursor === false, "无高危资格的研究生 → 不能领用易制毒");

  const canFlammable = await userCanAccessHazardClass(gradStudent.id, "FLAMMABLE", undefined, undefined, prisma);
  assert(canFlammable === true, "有基础资格 → 可领用易燃品");

  // 补上高危专项培训 + 签发
  await prisma.trainingRecord.create({
    data: { userId: gradStudent.id, trainingType: "HIGH_RISK_SPECIAL", score: 88, passed: true, conductedById: security.id },
  });
  await prisma.accessQualification.create({
    data: { userId: gradStudent.id, qualificationType: "HIGH_RISK", source: "TRAINING", issuedById: security.id, status: "ACTIVE" },
  });
  const canPrecursor2 = await userCanAccessHazardClass(gradStudent.id, "PRECURSOR_DRUG", undefined, undefined, prisma);
  assert(canPrecursor2 === true, "高危资格签发后 → 可领用易制毒");

  // ====================== 阶段三：领用前资格 + 项目品类 + 用户状态 联动校验 ======================
  header("阶段三：领用申请联动校验");

  // 3.1) 普品项目 + 普品 → 通过
  const ok1 = await checkRequisitionEligibility({
    applicantId: gradStudent.id,
    bottles: [{ bottleId: bottle1.id }],
    projectId: generalProject.id,
  }, prisma);
  assert(ok1.ok === true, "基础资格 + 普品项目 + 普品 → 通过");

  // 3.2) 普品项目 + 高危品 → 拒
  const ok2 = await checkRequisitionEligibility({
    applicantId: gradStudent.id,
    bottles: [{ bottleId: bottle2.id }],
    projectId: generalProject.id,
  }, prisma);
  assert(ok2.ok === false && ok2.message?.includes("不在项目"), "普品项目申请高危品 → 拒绝（项目品类不覆盖）");

  // 3.3) 高危项目 + 普品 → 通过
  const ok3 = await checkRequisitionEligibility({
    applicantId: gradStudent.id,
    bottles: [{ bottleId: bottle1.id }],
    projectId: highRiskProject.id,
  }, prisma);
  assert(ok3.ok === true, "高危项目申请普品 → 通过");

  // 3.4) 高危项目 + 高危品 + 已具备高危资格 → 通过
  const ok4 = await checkRequisitionEligibility({
    applicantId: gradStudent.id,
    bottles: [{ bottleId: bottle2.id }, { bottleId: bottle4.id }],
    projectId: highRiskProject.id,
  }, prisma);
  assert(ok4.ok === true, "高危项目 + 高危品 + 已具备高危资格 → 通过");

  // 3.5) 把小张的高危资格撤销 → 申请应被拒
  await prisma.accessQualification.update({
    where: { id: (await prisma.accessQualification.findFirst({ where: { userId: gradStudent.id, qualificationType: "HIGH_RISK" } }))!.id },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: "TEST" },
  });
  const ok5 = await checkRequisitionEligibility({
    applicantId: gradStudent.id,
    bottles: [{ bottleId: bottle2.id }],
    projectId: highRiskProject.id,
  }, prisma);
  assert(ok5.ok === false && ok5.message?.includes("高危专项"), "高危资格被撤销后 → 申请高危品被拒");

  // 恢复以继续后续测试
  await prisma.accessQualification.create({
    data: { userId: gradStudent.id, qualificationType: "HIGH_RISK", source: "TRAINING", issuedById: security.id, status: "ACTIVE" },
  });

  // ====================== 阶段四：跨学院项目协作 → 临时资格 → 项目结题回收 ======================
  header("阶段四：跨学院协作 → 临时资格 → 项目结题自动回收");
  // 生科院小陈在化工学院的项目下获得临时基础资格
  const collab = await prisma.projectCollaboratorOrg.create({
    data: {
      projectId: highRiskProject.id,
      orgId: bioDept.id,
      approvedById: mentor.id,
      validFrom: new Date("2026-01-01"),
      validTo: new Date("2027-12-31"),
      status: "ACTIVE",
    },
  });
  // 给小陈签发临时基础资格
  const tempQ = await prisma.accessQualification.create({
    data: {
      userId: bioStudent.id,
      qualificationType: "BASIC",
      source: "CROSS_COLLAB_TEMP",
      sourceProjectId: highRiskProject.id,
      issuedById: mentor.id,
      expiresAt: collab.validTo,
      status: "ACTIVE",
    },
  });
  assert(tempQ.source === "CROSS_COLLAB_TEMP", "协作学生拿到临时基础资格（source=CROSS_COLLAB_TEMP）");

  // 小陈在协作项目内可领普品
  const collabOk = await checkRequisitionEligibility({
    applicantId: bioStudent.id,
    bottles: [{ bottleId: bottle1.id }],
    projectId: highRiskProject.id,
  }, prisma);
  assert(collabOk.ok === true, "协作学生在协作项目内可领普品");

  // 小陈在协作项目内领高危品应被拒（无 HIGH_RISK 资格）
  const collabHr = await checkRequisitionEligibility({
    applicantId: bioStudent.id,
    bottles: [{ bottleId: bottle2.id }],
    projectId: highRiskProject.id,
  }, prisma);
  assert(collabHr.ok === false && collabHr.message?.includes("高危专项"), "协作学生无高危资格 → 协作项目内领高危品仍被拒");

  // 项目结题 → 临时资格自动回收
  const revokedCount = await revokeProjectCollabQualifications(highRiskProject.id, "PROJECT_COMPLETED", undefined, prisma);
  assert(revokedCount === 1, "项目结题后自动回收协作临时资格 1 条");
  const afterClose = await prisma.accessQualification.findFirst({ where: { id: tempQ.id } });
  assert(afterClose?.status === "REVOKED", "临时资格状态置为 REVOKED");
  assert(afterClose?.revokedReason === "PROJECT_COMPLETED", "回收原因记录为 PROJECT_COMPLETED");
  const collabAfter = await prisma.projectCollaboratorOrg.findUnique({ where: { id: collab.id } });
  assert(collabAfter?.status === "EXPIRED", "协作备案状态置为 EXPIRED");

  // ====================== 阶段五：黑名单 + 毕业/离校 自动回收 ======================
  header("阶段五：黑名单 / 毕业 / 离校 的自动回收与禁领");

  // 5.1) 把违规生加入黑名单
  const bl = await prisma.blacklistEntry.create({
    data: {
      userId: blackStudent.id,
      reason: "私藏易制毒",
      violationCount: 1,
      expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
      active: true,
      createdById: security.id,
    },
  });
  await prisma.user.update({ where: { id: blackStudent.id }, data: { userStatus: "BLACKLISTED", statusChangedAt: new Date(), statusReason: "私藏易制毒" } });
  // 给违规生先签发基础资格
  await prisma.accessQualification.create({
    data: { userId: blackStudent.id, qualificationType: "BASIC", source: "TRAINING", issuedById: security.id, status: "ACTIVE" },
  });
  // 入黑名单时回收其资格（模拟实际接口行为）
  await revokeUserQualifications(blackStudent.id, "BLACKLIST", undefined, prisma);
  const isBl = await isUserBlacklisted(blackStudent.id, undefined, prisma);
  assert(isBl === true, "违规生处于黑名单期内");
  const okBl = await checkRequisitionEligibility({
    applicantId: blackStudent.id,
    bottles: [{ bottleId: bottle1.id }],
  }, prisma);
  assert(okBl.ok === false && okBl.message?.includes("黑名单"), "黑名单用户领用被拒");

  // 5.2) 离校：自动回收 + 状态联动
  await prisma.accessQualification.create({
    data: { userId: gradStudent.id, qualificationType: "BASIC", source: "TRAINING", issuedById: security.id, status: "ACTIVE" },
  });
  const beforeLeft = await prisma.accessQualification.count({ where: { userId: gradStudent.id, status: "ACTIVE" } });
  assert(beforeLeft >= 1, "离校前具备 ACTIVE 资格");
  // 触发离校
  await prisma.user.update({ where: { id: gradStudent.id }, data: { userStatus: "LEFT", active: false } });
  const revokedLeft = await revokeUserQualifications(gradStudent.id, "USER_STATUS_LEFT", undefined, prisma);
  const afterLeft = await prisma.accessQualification.count({ where: { userId: gradStudent.id, status: "ACTIVE" } });
  assert(revokedLeft >= 1, "离校时自动回收至少 1 条资格");
  assert(afterLeft === 0, "离校后无任何 ACTIVE 资格");
  const isActive = await isUserActiveStatus(gradStudent.id, prisma);
  assert(isActive === false, "离校后用户状态非 ACTIVE");
  const okLeft = await checkRequisitionEligibility({ applicantId: gradStudent.id, bottles: [{ bottleId: bottle1.id }] }, prisma);
  assert(okLeft.ok === false && okLeft.message?.includes("毕业/离校"), "离校用户领用被拒");

  // ====================== 阶段六：项目结题后无法发起新领用 ======================
  header("阶段六：项目结题后无法发起新领用");
  // 把高危项目结题
  await prisma.project.update({ where: { id: highRiskProject.id }, data: { status: "COMPLETED" } });
  // 重新激活小张状态与资格以便测试
  await prisma.user.update({ where: { id: gradStudent.id }, data: { userStatus: "ACTIVE", active: true } });
  await prisma.accessQualification.create({
    data: { userId: gradStudent.id, qualificationType: "HIGH_RISK", source: "TRAINING", issuedById: security.id, status: "ACTIVE" },
  });
  const okClosed = await checkRequisitionEligibility({
    applicantId: gradStudent.id,
    bottles: [{ bottleId: bottle2.id }],
    projectId: highRiskProject.id,
  }, prisma);
  assert(okClosed.ok === false && okClosed.message?.includes("结题"), "已结题项目无法发起新领用");

  // ====================== 阶段七：化学品可领用列表（按项目 + 资格联动） ======================
  header("阶段七：化学品可领用列表（联动过滤）");
  // 普品项目下 + 普品资格 → 仅看到 FLAMMABLE/GENERAL
  const allowedGeneral = parseHazardCategories(generalProject.hazardCategories);
  assert(allowedGeneral.includes("FLAMMABLE") && !allowedGeneral.includes("PRECURSOR_DRUG"), "普品项目允许品类仅含 FLAMMABLE/GENERAL");
  // 资格维度：仅基础资格 → 看不到任何高危品
  const highRiskChems = [precursor, highlyToxic, explosive];
  for (const ch of highRiskChems) {
    const u = await prisma.user.create({
      data: { username: `only_basic_${ch.casNo}`, passwordHash: "x", fullName: `仅基础_${ch.name}`, role: "RESEARCHER", orgId: chemDept.id, active: true, userStatus: "ACTIVE" },
    });
    await prisma.accessQualification.create({
      data: { userId: u.id, qualificationType: "BASIC", source: "TRAINING", issuedById: security.id, status: "ACTIVE" },
    });
    const can = await userCanAccessHazardClass(u.id, ch.hazardClass, undefined, undefined, prisma);
    assert(can === false, `仅基础资格 → 不可领 ${ch.hazardClass} (${ch.name})`);
  }

  header("通过：实验项目—准入资格—化学品授权 联动 全部 OK");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
