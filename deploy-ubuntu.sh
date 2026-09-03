#!/usr/bin/env bash
#
# 少前2 社区 API —— Ubuntu 一键部署脚本
#
# 用法：
#   chmod +x deploy-ubuntu.sh
#   ./deploy-ubuntu.sh [--dir /path/to/project]
#
# 参数：
#   --dir <目录>   项目代码所在目录（默认：当前目录）。代码需已在本机
#                  （git clone，或 scp/rsync 上传）。
#   -h, --help     显示本帮助。
#
# 说明：
#   - 以「有 sudo 权限的普通用户」运行；脚本内部用 sudo 装系统包、配开机自启。
#   - 自动完成：装 Node 20 LTS + pnpm + pm2 → 装依赖 → 重建 esbuild → 构建
#     → pm2 守护 → 保存进程列表 → 配开机自启。
#   - 幂等：重复运行不会破坏已有服务（pm2 以 --update-env 重启）。
#   - 生产架构 = Cloudflare 代理 → 源站直连：源站只跑 Node 应用（应用实际
#     监听端口见 server/ecosystem.config.cjs 的 PORT，可用环境变量覆盖），
#     不装 nginx、不跑 certbot、不开 80/443。
#
set -euo pipefail

# ---------- 参数解析 ----------
PROJECT_DIR="$(pwd)"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)   PROJECT_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "未知参数: $1（用 -h 看帮助）"; exit 1 ;;
  esac
done

echo "==> 项目目录: $PROJECT_DIR"
cd "$PROJECT_DIR"

# ---------- 0. 基础检查 ----------
if ! command -v sudo >/dev/null 2>&1; then
  echo "[错误] 需要 sudo 权限，请用有 sudo 的普通用户运行"
  exit 1
fi
if [[ ! -f server/ecosystem.config.cjs ]]; then
  echo "[错误] 未在 $PROJECT_DIR 找到 server/ecosystem.config.cjs，请确认 --dir 指向项目根"
  exit 1
fi

# ---------- 1. Node.js 18+ ----------
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v//;s/\..*//' || echo 0)
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "==> 安装 Node.js 20 LTS (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "==> node $(node -v), npm $(npm -v)"

# ---------- 2. pnpm + pm2 ----------
if ! command -v pnpm >/dev/null 2>&1; then
  echo "==> 安装 pnpm (corepack)"
  sudo corepack enable
  sudo corepack prepare pnpm@latest --activate
fi
command -v pnpm >/dev/null 2>&1 || sudo npm i -g pnpm
echo "==> pnpm $(pnpm -v)"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> 安装 pm2 (全局，供 pm2 startup 写入 systemd)"
  sudo npm i -g pm2
fi
echo "==> pm2 $(pm2 -v)"

# ---------- 3. 安装依赖 + 构建 ----------
echo "==> pnpm install"
pnpm install
echo "==> 重建 esbuild 原生二进制（pnpm 11 默认拦截 postinstall，需手动）"
pnpm rebuild esbuild || true
echo "==> 构建前端 + 后端"
pnpm build

# ---------- 4. PM2 守护 + 开机自启 ----------
echo "==> 启动服务 (经 start.mjs，优先 pm2 守护)"
node start.mjs
echo "==> pm2 save（保存进程列表）"
pm2 save
echo "==> pm2 startup（开机自启，写入 systemd，以当前用户 $USER 运行）"
sudo pm2 startup systemd -u "$USER" --hp "$HOME"
pm2 save

# ---------- 完成 ----------
echo
echo "===== 部署完成 ====="
echo "  进程列表："
pm2 list
echo "  公网访问：经 Cloudflare 代理访问域名（HTTPS），源站无需对外开 80/443"
echo "  管理页： /admin   （社区账号登录在 / 管理员登录后进入）"
echo "  停止： node stop.mjs    启动： node start.mjs"
