import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";
import { writeAudit } from "../utils/audit";

export const complianceRouter = Router();
complianceRouter.use(authRequired);

interface Adapter {
  name: string;
  push(payload: any): Promise<{ status: string; response: string }>;
}

const adapters: Record<string, Adapter> = {
  public_security: {
    name: "公安机关易制毒化学品管理平台",
    async push(payload) {
      // mock 对接：本地保存并返回成功回执
      return { status: "SUCCESS", response: `公安备案回执 ${Date.now()}` };
    },
  },
  ecology: {
    name: "生态环境部门危废管理计划备案系统",
    async push(payload) {
      return { status: "SUCCESS", response: `危废备案 ${Date.now()}` };
    },
  },
  education: {
    name: "教育主管部门实验室安全年度报表",
    async push(payload) {
      return { status: "SUCCESS", response: `教育部汇总回执 ${Date.now()}` };
    },
  },
  security: {
    name: "保卫部门门禁系统",
    async push(payload) {
      return { status: "SUCCESS", response: `门禁同步回执 ${Date.now()}` };
    },
  },
};

complianceRouter.get("/targets", (_req, res) => {
  res.json(ok(Object.entries(adapters).map(([key, a]) => ({ key, name: a.name }))));
});

complianceRouter.post("/push/:target", async (req, res, next) => {
  try {
    const target = req.params.target;
    const a = adapters[target];
    if (!a) return res.status(404).json({ code: 404, message: "目标不存在" });
    const period = (req.body as any).period || new Date().toISOString().slice(0, 7);
    let payload: any = {};
    if (target === "public_security") {
      const bottles = await prisma.reagentBottle.findMany({
        where: { chemical: { hazardClass: "PRECURSOR_DRUG" } },
        include: { chemical: true },
      });
      payload = { period, count: bottles.length, items: bottles.map((b) => ({ cas: b.chemical.casNo, name: b.chemical.name, code: b.traceCode })) };
    } else if (target === "ecology") {
      const h = await prisma.wasteHandoff.findMany();
      payload = { period, total: h.reduce((s, x) => s + x.weight, 0), count: h.length, byCategory: h };
    } else if (target === "education") {
      payload = {
        period,
        labs: await prisma.organization.count({ where: { type: "LABORATORY" } }),
        bottles: await prisma.reagentBottle.count(),
        incidents: 0,
      };
    } else if (target === "security") {
      const v = await prisma.dualVerification.findMany({ take: 50 });
      payload = { period, records: v };
    }
    const r = await a.push(payload);
    const report = await prisma.complianceReport.create({
      data: { target, period, payload, status: r.status, response: r.response },
    });
    await writeAudit({ actorId: req.user!.id, action: "COMPLIANCE_PUSH", entityType: "compliance", entityId: report.id, payload: { target } });
    res.json(ok(report));
  } catch (e) {
    next(e);
  }
});

complianceRouter.get("/reports", async (_req, res, next) => {
  try {
    const list = await prisma.complianceReport.findMany({ orderBy: { submittedAt: "desc" }, take: 200 });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});
