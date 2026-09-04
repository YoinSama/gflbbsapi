#!/usr/bin/env bash
#
# 少前2 社区 API —— Ubuntu 一键更新脚本（已部署之后的日常更新）
#
# 用法（在服务器的项目根目录执行）：
#   chmod +x update-ubuntu.sh
#   ./update-ubuntu.sh [--dir /path/to/project]
#
# 参数：
#   --dir <目录>   项目代码所在目录（默认：当前目录）
#   -h, --help     显示本帮助。
#
# 流程：git fetch+reset → pnpm install → 重建 esbuild → pnpm build → 重启服务 → 健康检查
#
# 说明：
#   - 仅更新代码与构建产物。**不会触碰 server/data/ 下的运行时数据**
#     （admin.json / token.json 均被 .gitignore 忽略，git pull 不会覆盖它们）。
#   - 幂等：可重复执行，无更新时也能安全跑完。
#   - 首次部署请用 deploy-ubuntu.sh；本脚本用于「已经部署过」之后的更新。
#
set -euo pipefail

# ---------- 参数解析 ----------
PROJECT_DIR="$(pwd)"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)   PROJECT_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "未知参数: $1（用 -h 看帮助）"; exit 1 ;;
  esac
done

echo "==> 项目目录: $PROJECT_DIR"
cd "$PROJECT_DIR"

# ---------- 0. 基础检查 ----------
if [[ ! -f server/ecosystem.config.cjs ]]; then
  echo "[错误] 未在 $PROJECT_DIR 找到 server/ecosystem.config.cjs，请确认 --dir 指向项目根"
  exit 1
fi

# ---------- 1. 拉取代码 ----------
# 用 fetch + reset --hard 而非 git pull：
#   仓库历史曾被 filter-repo 重写并 force push，服务器旧 clone 与新 origin/main 会分叉，
#   git pull 会因 non-fast-forward 直接失败；reset --hard origin/main 能稳定拉到最新。
#   server/data/（admin.json / token.json）已被 .gitignore 忽略，不受 git 操作影响。
echo "==> git fetch + reset --hard origin/main"
git fetch origin
git reset --hard origin/main

# ---------- 2. 安装依赖（覆盖依赖变更的情况） ----------
echo "==> pnpm install"
pnpm install
echo "==> 重建 esbuild 原生二进制（pnpm 11 默认拦截 postinstall，需手动）"
pnpm rebuild esbuild || true

# ---------- 3. 构建 ----------
echo "==> 构建前端 + 后端"
pnpm build

# ---------- 4. 重启服务 ----------
# 优先 pm2 restart（保留进程与监控数据、并刷新环境变量）；未纳入 pm2 管理时退回 stop/start
PM2_BIN=""
if [ -x "node_modules/.bin/pm2" ]; then
  PM2_BIN="node_modules/.bin/pm2"
elif command -v pm2 >/dev/null 2>&1; then
  PM2_BIN="pm2"
fi

if [ -n "$PM2_BIN" ] && "$PM2_BIN" list 2>/dev/null | grep -q "gfl2-community-api"; then
  echo "==> 重启服务（pm2 restart --update-env）"
  "$PM2_BIN" restart gfl2-community-api --update-env
  "$PM2_BIN" save
else
  echo "==> 重启服务（node stop.mjs / node start.mjs）"
  node stop.mjs || true
  node start.mjs
fi

# ---------- 5. 健康检查 ----------
# 端口从 ecosystem.config.cjs 读取，避免脚本里硬编码
PORT=$(sed -nE 's/.*PORT:[[:space:]]*([0-9]+).*/\1/p' server/ecosystem.config.cjs 2>/dev/null | head -n 1)
if [ -n "${PORT:-}" ]; then
  echo "==> 健康检查（应用端口 ${PORT}）"
  sleep 2
  # 注意：Git Bash 下 `curl -o /dev/null` 会返回 exit 23（写入错误的假失败），
  # 若用 `|| echo 000` 会把真实状态码和 000 拼成「200000」。故用 || true 忽略退出码，
  # 真正的连接失败表现为输出为空，再兜底为 000。
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --noproxy '*' --max-time 8 "http://127.0.0.1:${PORT}/" 2>/dev/null || true)
  [ -z "${CODE:-}" ] && CODE="000"
  echo "  本地访问 http://127.0.0.1:${PORT}/ -> HTTP ${CODE}"
  if [ "$CODE" = "200" ]; then
    echo "  ✅ 服务正常"
  else
    echo "  ⚠️ 非 200，请查看日志：pm2 logs gfl2-community-api"
  fi
fi

echo
echo "===== 更新完成 ====="
echo "  停止： node stop.mjs"
echo "  日志： pm2 logs gfl2-community-api"
