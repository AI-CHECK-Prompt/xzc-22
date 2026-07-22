import { Router } from "express";
import { prisma } from "../db/prisma";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";
import { writeAudit } from "../utils/audit";
import { z } from "zod";
import { EmptyOpType } from "@prisma/client";

export const emptyBottleRouter = Router();
emptyBottleRouter.use(authRequired);

const opSchema = z.object({
  bottleId: z.string(),
  opType: z.nativeEnum(EmptyOpType),
  weight: z.number().optional(),
  photoUrl: z.string().optional(),
  note: z.string().optional(),
});

emptyBottleRouter.post("/", async (req, res, next) => {
  try {
    const data = opSchema.parse(req.body);
    const op = await prisma.emptyBottleOp.create({
      data: {
        bottleId: data.bottleId,
        operatorId: req.user!.id,
        opType: data.opType,
        weight: data.weight,
        photoUrl: data.photoUrl,
        note: data.note,
      },
    });
    const newStatus = data.opType === "WASHED" ? "IN_STORAGE" : data.opType === "DESTROYED" ? "DESTROYED" : "RECYCLING";
    await prisma.reagentBottle.update({ where: { id: data.bottleId }, data: { status: newStatus as any } });
    await writeAudit({
      actorId: req.user!.id,
      action: "EMPTY_BOTTLE_OP",
      entityType: "bottle",
      entityId: data.bottleId,
      payload: data,
    });
    res.json(ok(op));
  } catch (e) {
    next(e);
  }
});

emptyBottleRouter.get("/bottle/:id", async (req, res, next) => {
  try {
    const list = await prisma.emptyBottleOp.findMany({
      where: { bottleId: req.params.id },
      include: { operator: true },
      orderBy: { operatedAt: "desc" },
    });
    res.json(ok(list));
  } catch (e) {
    next(e);
  }
});
