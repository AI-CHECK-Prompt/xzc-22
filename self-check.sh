#!/usr/bin/env bash
# 平台自检脚本：等待服务就绪后验证关键能力
set -e

BACKEND="${BACKEND:-http://localhost:4000}"
FRONTEND="${FRONTEND:-http://localhost:8080}"

color() { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
ok()    { color "0;32" "✔ $1"; }
fail()  { color "0;31" "✘ $1"; exit 1; }
step()  { color "0;36" "▶ $1"; }

step "等待后端就绪…"
for i in {1..30}; do
  if curl -fsS "$BACKEND/api/v1/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "$BACKEND/api/v1/health" >/dev/null || fail "后端未响应"
ok "后端健康"

step "登录测试"
TOKEN=$(curl -fsS -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}' "$BACKEND/api/v1/auth/login" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || fail "登录失败"
ok "管理员登录"

H="Authorization: Bearer $TOKEN"

step "组织机构列表"
curl -fsS -H "$H" "$BACKEND/api/v1/orgs" >/dev/null || fail "组织查询失败"
ok "组织查询"

step "化学品列表"
curl -fsS -H "$H" "$BACKEND/api/v1/chemicals" >/dev/null || fail "化学品查询失败"
ok "化学品查询"

step "试剂瓶追溯码查询"
CODE=$(curl -fsS -H "$H" "$BACKEND/api/v1/bottles" | sed -n 's/.*"traceCode":"\([^"]*\)".*/\1/p' | head -1)
[ -n "$CODE" ] || fail "未找到试剂瓶"
curl -fsS -H "$H" "$BACKEND/api/v1/bottles/scan/$CODE" >/dev/null || fail "扫码查询失败"
ok "扫码：$CODE"

step "采购计划智能建议"
CID=$(curl -fsS -H "$H" "$BACKEND/api/v1/chemicals" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
curl -fsS -H "$H" -H "Content-Type: application/json" -d "{\"chemicalIds\":[\"$CID\"]}" "$BACKEND/api/v1/procurement/suggest" >/dev/null || fail "采购建议失败"
ok "采购建议"

step "统计报表"
curl -fsS -H "$H" "$BACKEND/api/v1/reports/dashboard" >/dev/null || fail "报表失败"
ok "报表"

step "审计追溯"
curl -fsS -H "$H" "$BACKEND/api/v1/audit/trace/$CODE" >/dev/null || fail "追溯失败"
ok "追溯链路"

step "合规对接目标"
curl -fsS -H "$H" "$BACKEND/api/v1/compliance/targets" >/dev/null || fail "合规目标失败"
ok "合规目标"

step "前端门户"
curl -fsS -o /dev/null -w "%{http_code}" "$FRONTEND" | grep -q "200" || fail "前端不可达"
ok "前端门户 200"

color "0;32" ""
color "0;32" "【自检】全部通过 ✅"
color "0;32" "前端：$FRONTEND"
color "0;32" "后端：$BACKEND"
color "0;32" "账号：admin / admin123"
