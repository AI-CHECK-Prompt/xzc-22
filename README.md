# 高校化学品全生命周期监管平台

一套面向高校化学与生物类实验室的化学品全生命周期数字化监管平台，覆盖采购、暂存、领用、双人核验、使用登记、废液归集、空瓶回收、统计与审计追溯全流程。

## 一键启动

```bash
# 1. 启动全栈（首次启动会自动构建 + 迁移 + 灌入种子数据）
docker compose up -d --build

# 2. 等待约 30 秒后执行自检
bash self-check.sh
```

- 前端门户：http://localhost:8080
- 后端 API：http://localhost:4000
- 默认账号：`admin / admin123`（其他角色同密码：`secretary / mentor / project_lead / hazmat / researcher / security / research_dept / dept_lead / auditor`）

## 核心能力

| 模块 | 关键能力 |
| --- | --- |
| 采购计划 | 月度申购、库存建议、高危品类上限、设备秘书 → 科研处 → 保卫处三级审批 |
| 暂存台账 | 唯一追溯码（QR + RFID）、扫码即查、检验报告附件 |
| 领用审批 | 导师 → 项目负责人 → 危化品管理员三级电子审批，高危品类自动加入复核 |
| 双人核验 | 移动端身份认证 + 现场定位 + 录像存证 + 电子锁联动 |
| 使用登记 | 扫码登记用量、剩余量低值告警、离线缓存 + 自动同步 |
| 废液归集 | 相容性矩阵、跨学院电子交接、扫码确认 |
| 空瓶回收 | 清洗 / 销毁 / 厂家回收全流程跟踪 |
| 统计报表 | 采购金额、领用频次、库存周转、废液分类 |
| 审计追溯 | 追溯码主键全链路回溯 + 数据补录 |
| 合规对接 | 公安易制毒 / 生态危废 / 教育主管部门 / 保卫门禁（适配器实现，可对接真实环境） |

## 技术栈

- 前端：Vue 3 + Vite + TypeScript + Element Plus + Pinia + ECharts + qrcode
- 后端：Node.js + Express + TypeScript + Prisma + Zod
- 数据库：PostgreSQL 15
- 缓存：Redis 7
- 部署：Docker Compose + Nginx

## 目录结构

```
.
├── backend/                后端服务（Express + Prisma）
│   ├── prisma/             数据库 Schema + 种子数据
│   └── src/                业务代码（routes / utils / middleware）
├── frontend/               前端门户（Vue3 + Vite）
│   └── src/views/          业务页面
├── nginx/                  前端 Nginx 配置
├── .trae/documents/        PRD 与技术架构
├── docker-compose.yml      一键启动
├── self-check.sh           自检脚本
└── .gitignore
```

## 离线能力

- 使用登记页面将网络异常的数据写入 `localStorage`，恢复网络（`online` 事件）后调用 `/api/v1/usage/sync` 批量重放。
- 双人核验的定位信息同样支持本地暂存。

## 审计追溯

所有写操作同步追加 `audit_events` 不可变流水。补录历史事件请使用"审计追溯"页面的"数据补录"表单，确保追溯链路完整。

## 二次开发指引

- 化学品字典：`backend/src/routes/chemical.ts`
- 追溯码生成：`backend/src/utils/code.ts`
- 相容性矩阵：`backend/src/routes/waste.ts`
- 合规对接适配器：`backend/src/routes/compliance.ts`
- 前端菜单：`frontend/src/views/Shell.vue`
