import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/response";

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ code: err.status, message: err.message });
  }
  console.error("【错误】", err);
  res.status(500).json({ code: 500, message: err?.message || "服务器内部错误" });
}
