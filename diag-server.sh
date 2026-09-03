#!/usr/bin/env bash
# 诊断「Cloudflare 返回 521 / 域名打不开」的一键自检脚本
# 用法（在部署服务器的项目根目录执行）：
#   git pull && bash diag-server.sh
#
# 域名（用于 [6/7] 核对 DNS A 记录）按以下优先级读取：
#   1) 环境变量：DOMAIN=你的域名 bash diag-server.sh
#   2) 本地配置：server/data/diag.env（内容一行 DOMAIN=你的域名）
#      —— server/data/ 已被 .gitignore 忽略，域名写这里不会进 git，
#         推荐方式：echo 'DOMAIN=你的域名' > server/data/diag.env 设置一次即可
# 两者都不提供时跳过 DNS 核对，其余诊断不受影响。
# 脚本只读，不修改任何配置、不重启服务。

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=8787
DOMAIN="${DOMAIN:-}"
if [ -z "$DOMAIN" ] && [ -f "$SCRIPT_DIR/server/data/diag.env" ]; then
  # shellcheck disable=SC1090
  . "$SCRIPT_DIR/server/data/diag.env"
fi
say() { printf '%s\n' "$*"; }
hr()  { printf '%s\n' "------------------------------------------------------------"; }

say "============================================================"
say " Cloudflare 521 诊断 · $(date '+%Y-%m-%d %H:%M:%S')"
say "============================================================"

say ""
say "[1/7] 应用进程是否在运行（pm2）"
hr
if command -v pm2 >/dev/null 2>&1; then
  pm2 list 2>&1 | sed 's/^/  /'
  if pm2 list 2>/dev/null | grep -q "gfl2-community-api"; then
    say "  >>> 结论：pm2 中存在 gfl2-community-api"
  else
    say "  >>> 结论：pm2 中【没有】 gfl2-community-api —— 应用没起来！"
    say "  >>> 修复：pnpm install && node start.mjs"
  fi
else
  say "  pm2 未安装（若用裸 node 启动则属正常）"
fi

say ""
say "[2/7] ${PORT} 端口是否在监听、监听地址是什么"
hr
if command -v ss >/dev/null 2>&1; then
  ss -lntp 2>/dev/null | grep -E ":${PORT}\b|LISTEN" | grep ":${PORT}" | sed 's/^/  /' || say "  >>> 结论：${PORT} 端口【没有任何监听】"
elif command -v netstat >/dev/null 2>&1; then
  netstat -lntp 2>/dev/null | grep ":${PORT}" | sed 's/^/  /' || say "  >>> 结论：${PORT} 端口【没有任何监听】"
else
  say "  (无 ss / netstat，跳过)"
fi
say "  提示：监听地址必须是 0.0.0.0:${PORT} 或 :::${PORT}；"
say "        若是 127.0.0.1:${PORT}，则外部（含 Cloudflare）连不进来 → 必 521"

say ""
say "[3/7] 服务器本地能否访问（验证应用本身健康）"
hr
CODE=$(curl -s -o /dev/null -w "%{http_code}" --noproxy '*' --max-time 5 "http://127.0.0.1:${PORT}/" 2>/dev/null)
say "  curl http://127.0.0.1:${PORT}/  ->  HTTP ${CODE:-000}"
case "${CODE:-000}" in
  200) say "  >>> 结论：应用本身正常（问题在端口可达性或 Cloudflare 侧）" ;;
  000) say "  >>> 结论：本地都连不上 —— 应用没启动或崩了，看日志：pm2 logs gfl2-community-api" ;;
  *)   say "  >>> 结论：应用有响应但非 200，检查应用日志" ;;
esac

say ""
say "[4/7] 防火墙（ufw）是否放行 ${PORT}"
hr
if command -v ufw >/dev/null 2>&1; then
  UFWOUT=$(sudo ufw status 2>/dev/null || ufw status 2>/dev/null)
  printf '%s\n' "$UFWOUT" | sed 's/^/  /'
  if printf '%s' "$UFWOUT" | grep -qi "^Status: active"; then
    if printf '%s' "$UFWOUT" | grep -qE "^${PORT}\b|${PORT}/tcp.*ALLOW"; then
      say "  >>> 结论：ufw 已启用且已放行 ${PORT}"
    else
      say "  >>> 结论：ufw 已启用但【未放行】 ${PORT} —— 需执行：sudo ufw allow ${PORT}"
    fi
  elif printf '%s' "$UFWOUT" | grep -qi "inactive"; then
    say "  >>> 结论：ufw 未启用（inactive）—— 不拦截任何端口，【无需】放行，此项不是 521 的原因"
  else
    say "  >>> 结论：无法判断 ufw 状态，请人工确认上面输出"
  fi
else
  say "  ufw 未安装（不受此限制，不是 521 的原因）"
fi

say ""
say "[5/7] 80 / 443 端口监听情况（判断能否绕开 Origin Rule）"
hr
for p in 80 443; do
  if command -v ss >/dev/null 2>&1; then
    R=$(ss -lntp 2>/dev/null | grep ":$p ")
    [ -n "$R" ] && say "  端口 $p: 有监听 -> $R" || say "  端口 $p: 【无监听】"
  fi
done
say "  提示：Cloudflare 默认回源 HTTP=80、HTTPS=443。"
say "        若 80/443 无监听，则 Origin Rule 的端口覆盖【必须】生效，否则必 521。"

say ""
say "[6/7] 本机公网 IP（核对 DNS 的 A 记录是否指向这台机器）"
hr
PUBIP=$(curl -s --max-time 8 https://api.ipify.org 2>/dev/null || curl -s --max-time 8 https://ifconfig.me 2>/dev/null)
say "  本机出口公网 IP: ${PUBIP:-（获取失败）}"
if [ -n "$DOMAIN" ]; then
  say "  请核对 Cloudflare 上 ${DOMAIN} 的 A 记录 == 上面这个 IP"
  say "  另核对：该记录必须是【橙色云朵 Proxied】，灰色(DNS only)会使 Origin Rule 失效"
  say "  本地 DNS 解析:"
  if command -v dig >/dev/null 2>&1; then
    dig +short "$DOMAIN" 2>/dev/null | sed 's/^/    /' || say "    (解析失败)"
  else
    getent hosts "$DOMAIN" 2>/dev/null | sed 's/^/    /' || say "    (无 dig/getent 结果)"
  fi
else
  say "  未传入 DOMAIN，跳过 DNS 核对。"
  say "  如需核对：DOMAIN=你的域名 bash diag-server.sh"
fi

say ""
say "[7/7] 从本机模拟外部访问（验证安全组是否放行）"
hr
if [ -n "$PUBIP" ]; then
  C2=$(curl -s -o /dev/null -w "%{http_code}" --noproxy '*' --max-time 8 "http://${PUBIP}:${PORT}/" 2>/dev/null)
  say "  curl http://${PUBIP}:${PORT}/  ->  HTTP ${C2:-000}"
  case "${C2:-000}" in
    200) say "  >>> 结论：安全组已放行 ${PORT}，公网可达" ;;
    000) say "  >>> 结论：公网访问 ${PORT} 【不通】—— 阿里云安全组未放行，或云厂商限制自回环访问（部分机器不支持用公网IP访问自己，此结果仅供参考）" ;;
    *)   say "  >>> 结论：返回 ${C2}，请人工判断" ;;
  esac
else
  say "  (未能获取公网 IP，跳过。请从你本机浏览器访问 http://<公网IP>:${PORT}/ 测试)"
fi

say ""
say "============================================================"
say " 诊断结束 —— 请把以上输出贴给助手，即可精确定位 521 原因"
say "============================================================"

say ""
say "附 A：源站是否支持 TLS（用于判断 Cloudflare SSL 模式是否设错）"
hr
TLSC=$(curl -sk -o /dev/null -w "%{http_code}" --noproxy '*' --max-time 5 "https://127.0.0.1:${PORT}/" 2>/dev/null)
say "  https://127.0.0.1:${PORT}/  ->  HTTP ${TLSC:-000}"
if [ "${TLSC:-000}" = "000" ]; then
  say "  >>> 源站【不支持 HTTPS】（明文 HTTP 服务）"
  say "  >>> 因此 Cloudflare 的 SSL 模式【必须】是 Flexible。"
  say "  >>> 若设成 Full / Full (strict)，Cloudflare 会用 HTTPS 回源到明文端口，"
  say "       TLS 握手失败 → 报 521 或 525。这是 521 极常见的隐蔽原因！"
else
  say "  >>> 源站支持 HTTPS，SSL 模式可用 Full / Full (strict)"
fi

say ""
say "附 B：521 原因速查（按概率排序，服务器侧已健康时只看 2、3）"
say "  1. 应用没跑起来（pm2 里没有 gfl2-community-api）→ node start.mjs"
say "  2. Cloudflare SSL 模式不是 Flexible，而是 Full / Full(strict)"
say "     → 用 HTTPS 回源到明文 ${PORT} 端口 → 握手失败 → 521"
say "     → 修复：SSL/TLS → Overview → 设为 Flexible"
say "  3. Cloudflare Origin Rule 未生效（回源仍走默认 80/443，而源站 80/443 无监听）"
say "     → 检查：规则状态为 Active/已部署、匹配 Hostname 正确、覆盖目标端口=${PORT}"
say "     → 免费版支持端口覆盖（1-65535），前提是 DNS 记录为橙云 Proxied"
say "  4. 阿里云安全组未放行 TCP ${PORT}（本项目实测已放行，通常不是这个）"
