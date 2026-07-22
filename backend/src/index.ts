import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import fs from "fs";
import { errorHandler } from "./middleware/error";
import { authRouter } from "./routes/auth";
import { orgRouter } from "./routes/organization";
import { chemicalRouter } from "./routes/chemical";
import { bottleRouter } from "./routes/bottle";
import { procurementRouter } from "./routes/procurement";
import { requisitionRouter } from "./routes/requisition";
import { dualVerificationRouter } from "./routes/dualVerification";
import { usageRouter } from "./routes/usage";
import { wasteRouter } from "./routes/waste";
import { emptyBottleRouter } from "./routes/emptyBottle";
import { reportRouter } from "./routes/report";
import { auditRouter } from "./routes/audit";
import { complianceRouter } from "./routes/compliance";
import { userRouter } from "./routes/user";

const app = express();
const PORT = Number(process.env.PORT || 4000);
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*", credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use("/uploads", express.static(path.resolve(UPLOAD_DIR)));

app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/orgs", orgRouter);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/chemicals", chemicalRouter);
app.use("/api/v1/bottles", bottleRouter);
app.use("/api/v1/procurement", procurementRouter);
app.use("/api/v1/requisitions", requisitionRouter);
app.use("/api/v1/dual-verifications", dualVerificationRouter);
app.use("/api/v1/usage", usageRouter);
app.use("/api/v1/waste", wasteRouter);
app.use("/api/v1/empty-bottles", emptyBottleRouter);
app.use("/api/v1/reports", reportRouter);
app.use("/api/v1/audit", auditRouter);
app.use("/api/v1/compliance", complianceRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`【后端】化学品监管平台启动，端口 ${PORT}`);
});
