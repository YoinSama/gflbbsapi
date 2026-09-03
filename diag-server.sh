#!/usr/bin/env bash
# 诊断「Cloudflare 返回 521 / 域名打不开」的一键自检脚本
# 用法（在部署服务器的项目根目录执行）：
#   git pull && bash diag-server.sh
# 脚本只读，不修改任何配置、不重启服务。

PORT=8787
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
  sudo ufw status 2>/dev/null | sed 's/^/  /' || ufw status 2>/dev/null | sed 's/^/  /'
  if (sudo ufw status 2>/dev/null || ufw status 2>/dev/null) | grep -qE "^${PORT}\b|${PORT}/tcp.*ALLOW"; then
    say "  >>> 结论：ufw 已放行 ${PORT}"
  else
    say "  >>> 结论：ufw 【未放行】 ${PORT} —— 需执行：sudo ufw allow ${PORT}"
  fi
else
  say "  ufw 未安装（若未装则不受此限制）"
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
say "  请核对 Cloudflare 上 gflbbsapi.example.com 的 A 记录 == 上面这个 IP"
say "  另核对：该记录必须是【橙色云朵 Proxied】，灰色(DNS only)会使 Origin Rule 失效"
say "  本地 DNS 解析:"
if command -v dig >/dev/null 2>&1; then
  dig +short gflbbsapi.example.com 2>/dev/null | sed 's/^/    /' || say "    (解析失败)"
else
  getent hosts gflbbsapi.example.com 2>/dev/null | sed 's/^/    /' || say "    (无 dig/getent 结果)"
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
say "附：521 最常见的三个原因（按概率排序）"
say "  1. 应用没跑起来（pm2 里没有 gfl2-community-api）→ node start.mjs"
say "  2. 阿里云安全组未放行 TCP ${PORT} → 控制台安全组入方向加规则"
say "  3. Cloudflare Origin Rule 未生效（回源仍走默认 80/443，而源站 80/443 无监听）"
say "     → 检查规则已启用、匹配 Hostname=gflbbsapi.example.com、覆盖目标端口=${PORT}"
