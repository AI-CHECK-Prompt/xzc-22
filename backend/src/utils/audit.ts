import { prisma } from "../db/prisma";

export async function writeAudit(opts: {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  traceCode?: string | null;
  payload?: any;
}) {
  try {
    await prisma.auditEvent.create({
      data: {
        actorId: opts.actorId ?? null,
        action: opts.action,
        entityType: opts.entityType,
        entityId: opts.entityId,
        traceCode: opts.traceCode ?? null,
        payload: opts.payload ?? undefined,
      },
    });
  } catch (e) {
    console.error("【审计】写入失败", e);
  }
}
