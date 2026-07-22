import { PrismaClient, HazardClass, OrgType, UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

const prisma = new PrismaClient();

async function main() {
  console.log("【种子】开始写入演示数据…");

  // 1. 组织
  const university = await prisma.organization.upsert({
    where: { name: "示范大学" },
    update: {},
    create: { name: "示范大学", shortName: "示范大学", type: OrgType.UNIVERSITY, contact: "校办 010-00000000", address: "北京市海淀区" },
  });

  const chemDept = await prisma.organization.upsert({
    where: { name: "化学与化工学院" },
    update: {},
    create: { name: "化学与化工学院", shortName: "化工学院", type: OrgType.DEPARTMENT, parentId: university.id, contact: "010-62000001" },
  });

  const bioDept = await prisma.organization.upsert({
    where: { name: "生命科学学院" },
    update: {},
    create: { name: "生命科学学院", shortName: "生科院", type: OrgType.DEPARTMENT, parentId: university.id, contact: "010-62000002" },
  });

  const storage = await prisma.organization.upsert({
    where: { name: "校级危化品暂存库" },
    update: {},
    create: { name: "校级危化品暂存库", shortName: "暂存库", type: OrgType.STORAGE, parentId: university.id, contact: "010-62000010" },
  });

  const labA = await prisma.organization.upsert({
    where: { name: "化工学院-有机合成实验室-A101" },
    update: {},
    create: { name: "化工学院-有机合成实验室-A101", shortName: "A101", type: OrgType.LABORATORY, parentId: chemDept.id },
  });

  const labB = await prisma.organization.upsert({
    where: { name: "生科院-分子生物学实验室-B203" },
    update: {},
    create: { name: "生科院-分子生物学实验室-B203", shortName: "B203", type: OrgType.LABORATORY, parentId: bioDept.id },
  });

  // 2. 用户
  const pwd = await bcrypt.hash("admin123", 8);
  const users = [
    { username: "admin", fullName: "系统管理员", role: UserRole.ADMIN, org: university },
    { username: "secretary", fullName: "张秘书", role: UserRole.EQUIPMENT_SECRETARY, org: chemDept },
    { username: "mentor", fullName: "王导师", role: UserRole.MENTOR, org: chemDept },
    { username: "project_lead", fullName: "李项目", role: UserRole.PROJECT_LEAD, org: chemDept },
    { username: "hazmat", fullName: "赵危化员", role: UserRole.HAZMAT_ADMIN, org: storage, idCardNo: "110101199001010001" },
    { username: "researcher", fullName: "孙实验员", role: UserRole.RESEARCHER, org: labA, idCardNo: "110101199501010002" },
    { username: "security", fullName: "周保卫", role: UserRole.SECURITY_OFFICER, org: university },
    { username: "research_dept", fullName: "吴科研处", role: UserRole.RESEARCH_DEPT, org: university },
    { username: "dept_lead", fullName: "郑院长", role: UserRole.DEPT_LEAD, org: chemDept },
    { username: "auditor", fullName: "审计局陈主任", role: UserRole.EXTERNAL_AUDITOR, org: university },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: {
        username: u.username,
        passwordHash: pwd,
        fullName: u.fullName,
        role: u.role,
        orgId: u.org.id,
        idCardNo: (u as any).idCardNo,
        email: `${u.username}@chem-platform.local`,
        phone: "13800000000",
      },
    });
  }

  // 3. 化学品种类
  const chemData = [
    { casNo: "67-56-1", name: "甲醇", nameEn: "Methanol", formula: "CH3OH", hazardClass: HazardClass.FLAMMABLE, storageClass: "易燃液体", monthlyLimit: 50000, unit: "mL" },
    { casNo: "7647-01-0", name: "盐酸", nameEn: "Hydrochloric acid", formula: "HCl", hazardClass: HazardClass.CORROSIVE, storageClass: "酸性腐蚀品", monthlyLimit: 30000, unit: "mL" },
    { casNo: "1310-73-2", name: "氢氧化钠", nameEn: "Sodium hydroxide", formula: "NaOH", hazardClass: HazardClass.CORROSIVE, storageClass: "碱性腐蚀品", monthlyLimit: 20000, unit: "g" },
    { casNo: "108-95-2", name: "苯酚", nameEn: "Phenol", formula: "C6H6O", hazardClass: HazardClass.HIGHLY_TOXIC, storageClass: "剧毒", purchaseLimit: 500, monthlyLimit: 2000, unit: "g" },
    { casNo: "100-41-4", name: "乙苯", nameEn: "Ethylbenzene", formula: "C8H10", hazardClass: HazardClass.PRECURSOR_DRUG, storageClass: "易制毒", purchaseLimit: 1000, monthlyLimit: 5000, unit: "mL" },
    { casNo: "7722-84-1", name: "过氧化氢 30%", nameEn: "Hydrogen peroxide", formula: "H2O2", hazardClass: HazardClass.EXPLOSIVE_PRECURSOR, storageClass: "易制爆", purchaseLimit: 2000, monthlyLimit: 5000, unit: "mL" },
    { casNo: "64-17-5", name: "乙醇", nameEn: "Ethanol", formula: "C2H6O", hazardClass: HazardClass.FLAMMABLE, storageClass: "易燃液体", monthlyLimit: 100000, unit: "mL" },
    { casNo: "75-09-2", name: "二氯甲烷", nameEn: "Dichloromethane", formula: "CH2Cl2", hazardClass: HazardClass.PRECURSOR_DRUG, storageClass: "易制毒", purchaseLimit: 2000, monthlyLimit: 8000, unit: "mL" },
    { casNo: "7697-37-2", name: "硝酸", nameEn: "Nitric acid", formula: "HNO3", hazardClass: HazardClass.CORROSIVE, storageClass: "酸性腐蚀品", monthlyLimit: 10000, unit: "mL" },
    { casNo: "110-54-3", name: "正己烷", nameEn: "n-Hexane", formula: "C6H14", hazardClass: HazardClass.FLAMMABLE, storageClass: "易燃液体", monthlyLimit: 20000, unit: "mL" },
  ];
  const chemicals = [] as any[];
  for (const c of chemData) {
    const ch = await prisma.chemical.upsert({
      where: { casNo: c.casNo },
      update: {},
      create: c,
    });
    chemicals.push(ch);
  }

  // 4. 试剂瓶（追溯码）
  const bottles = [] as any[];
  for (const ch of chemicals) {
    for (let i = 0; i < 3; i++) {
      const uuid = uuidv4().replace(/-/g, "").slice(0, 12);
      const crc = crc16(uuid);
      const code = `CHEM:${uuid}:${crc}`;
      const bot = await prisma.reagentBottle.upsert({
        where: { traceCode: code },
        update: {},
        create: {
          traceCode: code,
          rfidTag: `RFID-${uuid}`,
          chemicalId: ch.id,
          batchNo: `B${ch.casNo.replace(/-/g, "")}-${i + 1}`,
          supplier: ["西陇科学", "国药试剂", "阿拉丁"][i % 3],
          manufactureDate: new Date("2026-01-15"),
          expireDate: new Date("2028-01-15"),
          initialQty: ch.unit === "g" ? 1000 : 5000,
          remainingQty: ch.unit === "g" ? 800 - i * 100 : 4000 - i * 500,
          unit: ch.unit,
          locationOrgId: storage.id,
          cabinet: `C-${(i % 3) + 1}`,
          status: "IN_STORAGE",
        },
      });
      bottles.push(bot);
    }
  }

  // 5. 废液桶
  const buckets = [
    { bucketNo: "WB-ORG-001", ownerOrgId: labA.id, category: "ORGANIC", capacity: 50, currentVolume: 12, locatedAt: "A101 通风橱旁" },
    { bucketNo: "WB-ACID-001", ownerOrgId: labA.id, category: "ACID", capacity: 50, currentVolume: 8, locatedAt: "A101 酸柜" },
    { bucketNo: "WB-HM-001", ownerOrgId: labB.id, category: "HEAVY_METAL", capacity: 30, currentVolume: 5, locatedAt: "B203 重金属区" },
    { bucketNo: "WB-ALK-001", ownerOrgId: chemDept.id, category: "ALKALI", capacity: 50, currentVolume: 15, locatedAt: "化工学院危废暂存间" },
  ];
  for (const b of buckets) {
    await prisma.wasteBucket.upsert({
      where: { bucketNo: b.bucketNo },
      update: {},
      create: b,
    });
  }

  // 6. 一条审计流水示例
  await prisma.auditEvent.create({
    data: {
      action: "SYSTEM_SEED",
      entityType: "system",
      entityId: "init",
      payload: { note: "种子数据初始化完成" },
    },
  });

  console.log("【种子】完成。默认账号: admin / admin123");
}

function crc16(s: string) {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
