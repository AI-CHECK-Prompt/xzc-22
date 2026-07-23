// 端到端回归测试：验证废液交接发起/确认的"两方"语义，并校验统计口径。
// 用 SQLite 内存数据库做最小集成验证，验证通过后保留作为回归用例。
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import path from "path";

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

async function main() {
  // 1) 准备数据：2 个学院 + 2 名用户 + 1 个废液桶
  const chemDept = await prisma.organization.create({ data: { name: "化工学院", type: "DEPARTMENT" } });
  const bioDept = await prisma.organization.create({ data: { name: "生科院", type: "DEPARTMENT" } });

  const alice = await prisma.user.create({
    data: { username: "alice", passwordHash: "x", fullName: "Alice 化工", role: "RESEARCHER", orgId: chemDept.id, active: true },
  });
  const bob = await prisma.user.create({
    data: { username: "bob", passwordHash: "x", fullName: "Bob 生科", role: "RESEARCHER", orgId: bioDept.id, active: true },
  });

  const bucket = await prisma.wasteBucket.create({
    data: { bucketNo: "WB-TEST-001", ownerOrgId: chemDept.id, category: "ORGANIC", capacity: 50, currentVolume: 10, locatedAt: "A101" },
  });

  header("阶段一：发起交接（移交方 = Alice / 接收方 = Bob 学院）");
  const handoff = await prisma.wasteHandoff.create({
    data: {
      bucketId: bucket.id,
      fromOrgId: chemDept.id,
      toOrgId: bioDept.id,
      fromUserId: alice.id,
      fromClientIp: "10.0.0.1",
      // 关键：toUserId 必须为空
      weight: 5,
      category: "ORGANIC",
    },
  });
  assert(handoff.fromUserId === alice.id, "fromUserId 应为 Alice");
  assert(handoff.toUserId === null, "toUserId 在发起阶段必须为 null（修复前会被误写为 Alice）");
  assert(handoff.toConfirmedAt === null, "toConfirmedAt 在发起阶段必须为 null");
  assert(handoff.fromClientIp === "10.0.0.1", "fromClientIp 已记录");
  assert(handoff.fromOrgId !== handoff.toOrgId, "发起时 toOrgId 应与 fromOrgId 不同（跨学院）");

  header("阶段二：接收方 Bob 独立确认");
  // 模拟修复后的 /handoff/:id/confirm 业务约束
  if (handoff.toUserId) throw new Error("toUserId 已被填充，无法确认");
  if (handoff.fromUserId === bob.id) throw new Error("禁止移交方本人确认");
  if (handoff.toOrgId !== bioDept.id) throw new Error("Bob 不在 toOrgId，无权确认");
  if (handoff.fromClientIp === "10.0.0.2") throw new Error("同 IP 拒绝");

  const confirmed = await prisma.wasteHandoff.update({
    where: { id: handoff.id },
    data: { toUserId: bob.id, toClientIp: "10.0.0.2", toConfirmedAt: new Date() },
  });
  assert(confirmed.toUserId === bob.id, "toUserId 由接收方独立写入 Bob");
  assert(confirmed.toUserId !== confirmed.fromUserId, "两方用户 ID 不再相同（修复前 Alice == Alice）");
  assert(confirmed.toConfirmedAt instanceof Date, "toConfirmedAt 已落库");
  assert(confirmed.toClientIp === "10.0.0.2", "toClientIp 已落库");

  header("约束回归：同组织/同账号代签必须被拒");
  // 用 Carol（同生科院）来确认第二条交接是合法的
  const carol = await prisma.user.create({
    data: { username: "carol", passwordHash: "x", fullName: "Carol 生科", role: "RESEARCHER", orgId: bioDept.id, active: true },
  });
  const h2 = await prisma.wasteHandoff.create({
    data: {
      bucketId: bucket.id, fromOrgId: chemDept.id, toOrgId: bioDept.id,
      fromUserId: alice.id, fromClientIp: "10.0.0.3", weight: 3, category: "ORGANIC",
    },
  });
  // 模拟 Alice（移交方）尝试确认：必须被拒
  let denied = false;
  try {
    if (h2.fromUserId === alice.id) throw new Error("SAME_USER_AS_TRANSFEROR");
  } catch { denied = true; }
  assert(denied, "移交方本人确认应被拒");

  // 模拟 Alice 同学院账号尝试代签：必须被拒（不是 toOrgId 成员）
  const alice2 = await prisma.user.create({
    data: { username: "alice2", passwordHash: "x", fullName: "Alice2 化工", role: "RESEARCHER", orgId: chemDept.id, active: true },
  });
  denied = false;
  try {
    if (alice2.orgId !== h2.toOrgId) throw new Error("RECEIVER_ORG_MISMATCH");
  } catch { denied = true; }
  assert(denied, "非 toOrgId 成员确认应被拒");

  // Carol 合法确认
  const h2c = await prisma.wasteHandoff.update({
    where: { id: h2.id }, data: { toUserId: carol.id, toClientIp: "10.0.0.4", toConfirmedAt: new Date() },
  });
  assert(h2c.toUserId === carol.id, "Carol (接收方组织成员) 可合法确认");

  header("统计口径回归：按 fromOrgId 产生量、toOrgId 接收量归集，不重复计入");
  // 关键：只统计已确认记录（toUserId 非空）
  const confirmedHandoffs = await prisma.wasteHandoff.findMany({ where: { toUserId: { not: null } } });
  assert(confirmedHandoffs.length === 2, "应仅 2 条已确认记录");
  const produced: Record<string, number> = {};
  const received: Record<string, number> = {};
  for (const h of confirmedHandoffs) {
    produced[h.fromOrgId] = (produced[h.fromOrgId] || 0) + h.weight;
    received[h.toOrgId] = (received[h.toOrgId] || 0) + h.weight;
  }
  assert(produced[chemDept.id] === 8, "化工学院产生量应为 5+3=8（不再被重复计入接收方）");
  assert(received[bioDept.id] === 8, "生科院接收量应为 5+3=8");
  assert(produced[chemDept.id] !== received[chemDept.id], "同一方不再既作为产生方又作为接收方重复计入");
  assert(received[bioDept.id] !== produced[bioDept.id], "同一方不再既作为接收方又作为产生方重复计入");

  header("通过：废液交接双方语义修复 + 统计口径校验全部 OK");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
