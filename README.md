> [!WARNING]
> ### ⚠️ 本项目完全使用 AI 生成，仅供个人学习，请勿作他用 ⚠️
>
> **代码未经充分审计、无任何担保，作者不承担使用后果。** 使用本项目即视为接受以下风险：
>
> - **封号风险**：项目通过模拟登录调用少女前线2：追放社区的非公开接口，可能违反官方用户协议，导致账号被封禁。**强烈建议使用小号。**
> - **仅供学习**：用于理解接口鉴权、加密与代理转发，**禁止用于商业用途、公开分发、批量爬取或任何违反官方条款的行为**。
> - **凭据自担**：若部署到公网，请自行确认 token 等敏感信息已脱敏、访问控制已配置妥当。
>
> 详细免责与风险说明见文末「免责声明」。

---

# 少前2 社区 API 轻量项目

少女前线2：追放官方社区（`gf2-bbs.exiliumgf.com`）的轻量 API 代理 + 展示项目。
包含 **前端展示页** 与 **后端管理页**，后端负责模拟社区登录、托管 token、代理社区接口。

## 功能

- 模拟社区登录：散爆账号（手机 / 邮箱）+ 密码 → 获取并持久化 token（存服务器本地 `data/token.json`）
- 社区接口代理：前端通过后端转发请求，token 由后端自动附加，规避浏览器 CORS
- 前端：`/` 为管理员登录入口；`/admin` 为管理页（需管理员登录），内含社区账号登录、当前登录账户、**社区每日签到（一键签到）**、社区接口「接口演示」与任意接口 API 测试、退出登录
  - 管理页自身有一套本地管理员账号（与社区 token 登录无关）。初始凭据 `admin` / `123456`，**首次登录成功后强制修改账号与密码**；凭据（scrypt 哈希）存于 `server/data/admin.json`（已被 `.gitignore` 的 `data/` 忽略），建议部署后立即修改
  - 🔒 **默认凭据一次性失效**：完成首次改密后（即已创建管理员账户），`admin` / `123456` **立即永久失效** —— 登录会被直接拒绝（403），且**不允许再改回**该默认组合（防止改回后自己被锁在门外）；登录页也不再显示初始账号密码提示。仅当系统仍处于未初始化状态（全新安装 / `admin.json` 被删除重建）时默认凭据才可用
    - ⚠️ **忘记管理员密码怎么办**：删除或替换服务器上的 `server/data/admin.json`，系统会自动重建初始凭据（回到未初始化状态，重新启用 `admin` / `123456` 并强制改密）。这是唯一的恢复途径，操作前请确认你有服务器文件访问权限
  - 会话（sid）持久化在 `server/data/admin.json` 的 `sessions` 字段（httpOnly Cookie 携带 sid）。进程重启 / 多进程（fork）均读同一份文件，登录态不会丢失、不会被踢；默认 7 天有效期，过期自动清理

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js + TypeScript + Hono（单进程：出 API + 托管前端静态文件） |
| 前端 | Vue 3 + Vite（Login 登录页 + Admin 管理页，CSS 变量深浅色主题，响应式） |
| 持久化 | 服务器本地 JSON 文件（`data/token.json`，已 gitignore） |
| 部署 | PM2（进程守护）+ Cloudflare（代理 / HTTPS 终结，源站直连） |

加密细节：密码先 MD5，账号与密码均用 `aes-128-cbc`（key = iv = `ENCRYPTION_KEY`）加密，
密文 hex → base64 → URL-safe。密钥来自官方社区前端脚本，可能与版本相关。

## 社区接口说明

社区后端**并非** Self Community 风格的 `/api/v2/*` REST（实测：`/api/v2/user`、`/api/v2/me` 在 API 子域返回 404、在主站被回退到 SPA 页面）。真实结构如下（已用真实账号实测确认）：

- **API 域名**：`https://gf2-bbs-api.exiliumgf.com`（注意是 `gf2-bbs-api` 子域，不是主站 `gf2-bbs`）
- **业务接口统一在 `/community/*` 下**
- **获取用户资料 = `POST /community/member/info`**（必须用 POST，请求体可为 `{}`），返回 `data.user`；字段含 `nick_name / avatar / level / exp / score / fans / follows`，以及游戏相关 `game_uid / game_nick_name / game_commander_level / endless_floor / endless_rank` 等
- 其他常用接口：`GET /community/topic/list?sort_type=2`（帖子列表）、`POST /community/task/sign_in`（签到）、`GET /community/task/get_current_sign_in_status`（今日签到状态）、`GET /community/member/score_log`（积分记录）、`GET /community/user_recommend`（推荐用户）

后端 `server/src/endpoints.ts` 内置了一份**已验证的接口预设**，管理页 `/admin` 的 API 测试可直接一键填充（带 `*` 的才是待验证接口，目前无）。

### 代理路径约定（必读）

所有社区接口都经过后端代理 `proxy.ts`（`/api/community/*`），token 由后端自动附加。请求链路如下：

```
前端 api.proxy(method, path)
  → fetch('/api/community' + path)          // 例如 path='/community/topic/list' 时，
                                            // 实际请求 URL = /api/community/community/topic/list
  → 后端 proxy.ts 剥掉前缀 /api/community/  → /community/topic/list
  → 转发到 https://gf2-bbs-api.exiliumgf.com/community/topic/list
```

要点（容易踩坑，务必照做）：

- **API 测试框里只填真实业务路径**：直接写 `/community/...`（以 `/community/` 开头），别写 `/api/community/...`。`api.proxy()` 会自动补 `/api/community` 前缀，所以前端 URL 里会出现**两段 `/community`（`/api/community/community/...`）**——这是设计如此，正常，不是 bug。
- **预设接口已带正确前缀**：`endpoints.ts` 里的 path 都是 `/community/...` 形式，可直接用。
- **切勿手动去掉或再加 `/community`**：如果写成 `/topic/list`（少了 `/community`），代理剥前缀后变成 `/topic/list`，上游返回 404；如果写成 `/api/community/community/topic/list`，则会变成 `/api/community/community/topic/list`（三重），同样 404。
- **`get_month_sign_in_status` 的 `list`** 是「当月每天的签到奖励」数组（索引 `i` 对应第 `i+1` 天），元素含 `item_name / item_pic / item_count`；`sign_in_days` 为当月已签天数，`start_date / end_date` 为当月区间。注意：该接口**不返回每天是否已签的状态**，只有 `sign_in_days` 总数，因此日历里只有「今天」可结合 `get_current_sign_in_status` 的 `has_sign_in` 标记。

## 目录结构

```
GFL2bbsAPI/               # 项目根目录（原 gfl2-community-api）
├─ server/                 # Hono 后端（TypeScript）
│  ├─ src/
│  │  ├─ index.ts          # 入口：API 路由 + 托管前端 dist
│  │  ├─ config.ts         # 环境变量配置
│  │  ├─ crypto.ts         # md5 + aes-128-cbc + urlsafe base64（含自测）
│  │  ├─ store.ts          # token 持久化
│  │  ├─ auth.ts           # /api/auth/* 登录/状态/退出
│  │  └─ proxy.ts          # /api/community/* 社区接口代理
│  ├─ data/                # token.json（运行时生成，gitignore）
│  └─ ecosystem.config.cjs # PM2 配置
├─ web/                    # Vue 3 + Vite 前端
│  └─ src/views/Login.vue, Admin.vue
└─ .env.example
```

## 本地开发

```bash
pnpm install
cp .env.example .env        # 可选，默认配置即可用
pnpm build                 # 构建前端 + 后端
pnpm start                 # 启动（默认 http://localhost:8787）
# 或开发模式（前后端热更新）：
pnpm dev                   # 前端 5173，后端 8787，已配代理
# 或一键启动（跨平台，优先用 pm2 守护，无 pm2 则退回裸 node）：
#   Windows / Linux / macOS 通用：node start.mjs（或 ./start.mjs）
node start.mjs
```

### 停止服务（跨平台，与 start 成对）

```bash
# 跨平台一键停止：优先 pm2 delete + pm2 save（清空 dump，避免开机/复活时回来）；无 pm2 则按命令行特征杀 node 进程
node stop.mjs
```

**停止**
```bash
cd /path/to/GFL2bbsAPI
node stop.mjs          # 或 Linux/macOS： ./stop.mjs
# 验证已停：pm2 list 应看不到 gfl2-community-api；下面端口检查应「连接被拒」
```

**启动**
```bash
cd /path/to/GFL2bbsAPI
node start.mjs         # 或 Linux/macOS： ./start.mjs
# 验证已起：下面端口检查应返回 HTTP 200
```

**Windows 一行走法**（Win+R → 输入 cmd 回车 → 依次敲）：
```
D:
cd \GFL2bbsAPI
node stop.mjs      :: 停
node start.mjs     :: 起
```

#### 端口自检（务必绕开系统代理）

本机若装了 Clash / 同类代理（设了 `HTTP_PROXY` 环境变量），裸 `curl http://localhost:8787` 会被代理拦截返回**假 502**，别被骗。自检一律用：

```bash
# 绕开代理直连 localhost
curl --noproxy localhost -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/
# PowerShell：
(Invoke-WebRequest -Uri http://localhost:8787/ -NoProxy -UseBasicParsing -TimeoutSec 3).StatusCode
```
- **HTTP 200** = 服务在跑；**连接被拒 / 超时** = 已停止；**502** = 多半是代理在瞎指路，按上面加 `--noproxy` 复测。


加密逻辑自测（无需安装依赖，仅用 Node 内置 crypto）：

```bash
pnpm selftest
```

## 部署到阿里云 Ubuntu

> 前置：服务器已装 Node.js 18+ 与 pnpm（`npm i -g pnpm` 或官方脚本）。本项目路径解析跨平台，无需任何 Windows 专用改动。

**一键部署脚本**（推荐，自动装 Node/pnpm/pm2 + 构建 + 守护 + 开机自启；纯源站侧，不含任何 nginx / 证书逻辑）：
```bash
chmod +x deploy-ubuntu.sh
./deploy-ubuntu.sh                       # 仅 pm2 守护源站应用
```
脚本需以「有 sudo 权限的普通用户」运行，代码需已上传到目标目录（默认当前目录，可用 `--dir` 指定）。详见脚本头注释。

```bash
# 1. 上传代码 / git clone 到服务器，进入项目根
pnpm install                # esbuild 放行已在本项目 pnpm-workspace.yaml 配好，安装时会自动装原生二进制
pnpm rebuild esbuild        # 保险：确保 esbuild 原生二进制就位（可省略）
pnpm build                  # 构建前端 + 后端

# 2. 用 PM2 守护进程（推荐）
pm2 start server/ecosystem.config.cjs
pm2 save                    # 保存当前进程列表
pm2 startup                 # 生成开机自启（按提示执行它打印的 sudo 命令）
```

### 更新已部署的服务

代码有更新（`dist/` 构建产物不入 git，服务器上必须重新构建才生效）时，在项目根目录执行：

```bash
./update-ubuntu.sh                       # git pull → pnpm install → build → 重启 → 健康检查
./update-ubuntu.sh --dir /path/to/project  # 指定项目目录
```

或手动执行等价步骤：

```bash
git pull && pnpm install && pnpm rebuild esbuild && pnpm build
node stop.mjs && node start.mjs          # 或已纳入 pm2 管理时：pm2 restart gfl2-community-api --update-env && pm2 save
```

> 更新脚本**只动代码与构建产物**，不会覆盖 `server/data/` 下的运行时数据（`admin.json` / `token.json` 均被 `.gitignore` 忽略，git pull 不会碰它们）。脚本末尾会自动从 `server/ecosystem.config.cjs` 读取应用端口做一次本地健康检查，输出 `✅ 服务正常` 即表示更新完成。

> ⚠️ **pnpm 11 构建脚本放行（重要，踩过坑）**
> pnpm 11 起**不再读取** `package.json` 里的 `pnpm` 字段（`onlyBuiltDependencies` / `neverBuiltDependencies` 等已全部移除），构建脚本放行统一改为 `pnpm-workspace.yaml` 的 **`allowBuilds`**（包名 → `true`/`false` 映射）。同时 `strictDepBuilds` 默认为 **`true`**，未放行的依赖构建脚本会让 `pnpm install` **直接以退出码 1 失败**：
> ```
> [ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.21.5, esbuild@0.24.2, esbuild@0.28.2
> Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
> ```
> 而 `esbuild` 必须靠 postinstall 装原生二进制，不放行则 `esbuild`/`vite` 都跑不起来 → 构建、`node start.mjs` 全线失败。
> **本项目已配置** `allowBuilds: { esbuild: true }`（见 `pnpm-workspace.yaml`）。⚠️ 注意该值**必须是布尔值**——pnpm 自动生成的占位文字 `set this to true or false` 会被判为「未放行」并触发上述报错；且不要把配置同时写在 `package.json`（v11 已忽略，会造成两份冲突来源）。

### 部署架构：Cloudflare 代理 → 源站直连（本项目采用）

> 下文中 `gflbbsapi.example.com` 为**示例域名**，部署时请替换为你自己的域名。

```
访客 -- HTTPS --> Cloudflare（终结 TLS / 代理 / 边缘缓存）
                        |
                        | 回源（明文 HTTP）
                        v
         阿里云源站 · Node 应用（PM2 守护）
         仅监听应用端口，不装 nginx、不开 80/443
```

0. **安全组收敛（强烈建议优先完成）**：在阿里云控制台将源站端口的入方向来源限制为 [Cloudflare 官方 IP 段](https://www.cloudflare.com/ips/)，而非 `0.0.0.0/0`。这样除 Cloudflare 外无人能直连源站端口 → 后续步骤中回源明文流量不会通过公网暴露给其他访客。**没做这一步前不要执行后续步骤**。
1. **服务器侧**：只把源站应用跑起来即可（一键脚本 / 手动步骤见上），**不装 nginx、不跑 certbot**。
2. **DNS**：`gflbbsapi.example.com` 的 A 记录**直接指向阿里云公网 IP**，且保持**橙云（Proxied）**——只有代理状态，下面的 SSL 与 Origin Rule 设置才会生效。
3. **Cloudflare → SSL/TLS → Overview**：加密模式设为 **Flexible**（Cloudflare 终结访客 HTTPS，回源走明文 HTTP）。
4. **Cloudflare → Rules → Origin Rules**：新建规则，条件 `Hostname = gflbbsapi.example.com`，操作 **Override destination port → 源站应用监听端口**（免费版可用）。Cloudflare 默认只回源 80/443，必须用该规则把回源目标端口覆盖为源站应用实际监听的端口，否则回源连不上。
5. **防火墙（实例 ufw）**：如启用了 ufw，放行源站应用监听端口的入方向流量；其余端口均关闭。
6. **验证**：`curl -s -o /dev/null -w "%{http_code}\n" https://gflbbsapi.example.com/`（本机若走 Clash 等代理需加 `--noproxy`），返回 200 即通。

> ⚠️ 源站应用实际监听端口在 `server/ecosystem.config.cjs` 的 `PORT` 配置（可用环境变量覆盖），此处不展开。**该路线下不要在源站装 nginx 或跑 certbot**：Cloudflare 代理会截胡 Let's Encrypt 的 HTTP-01 校验，且访客 HTTPS 已由 Cloudflare 终结，源站本就无需证书。

### 部署注意
- **会话已持久化到 admin.json（文件共享）**：`ecosystem.config.cjs` 用 `instances: 1` 单进程，登录态稳；即便改 cluster 多进程（`instances: 'max'`），所有进程也读同一份 `admin.json`，请求轮询到任意进程都能识别登录态（不再被踢）。唯一残留风险是极端并发下多进程同时写 `admin.json` 可能相互覆盖会话，个人工具量级可忽略；高并发场景建议换 Redis。
- **token 已脱敏**：所有接口只回显 `tokenMasked`，公网暴露也安全；但 `server/data/token.json`（磁盘真令牌）仍等同凭证，务必保证该目录仅运行用户可读写、不进 git。
- **数据目录权限**：`server/data/` 被 gitignore，运行时由 `ensureDataDir()` 自动建；运行用户需对其有写权限（勿以无权限用户或只读挂载运行）。


## 注意事项 / 风险

- **账号风控**：使用第三方工具模拟登录可能违反官方用户协议，存在封号风险，请谨慎使用，建议用小号。
- **接口可能变动**：社区登录接口域名曾于 2026-05-31 变更；若登录返回 401，优先检查 `ENCRYPTION_KEY` 是否仍是官方前端脚本里的最新值（抓包 `gf2-bbs.exiliumgf.com` 页面 JS 搜索 `Utf8.parse(...)` 即可找到）。
- **token 安全**：`data/token.json` 等同账号凭证，切勿提交到 git 或公开。
- **游戏进度**：社区 API 不暴露游戏服务器的真实进度；但 `POST /community/member/info` 返回的 `user` 对象里带有社区侧游戏信息（`game_commander_level` 指挥等级、`endless_floor / endless_rank` 等），可在展示页查看。其余账号内游戏进度走游戏服务器接口，不在本代理范围内，可用管理页的 API 测试自行探索。


## 免责声明

**本项目完全使用 AI 生成，仅供个人学习，请勿作他用。**

- **无担保**：代码由 AI 生成，未经充分安全审计与稳定性验证，按「原样」提供，不提供任何明示或暗示的担保。使用者需自行承担全部风险与后果。
- **仅限学习**：本项目用于学习接口鉴权、请求加密与代理转发等技术原理。**禁止**用于商业用途、公开分发、批量爬取、自动化脚本运营或任何违反少女前线2：追放官方用户协议的行为。
- **第三方接口**：本项目调用的社区接口并非官方公开 API，可能随时变更或增加风控。因使用本项目导致的账号封禁、数据丢失或任何其他损失，作者不承担责任。
- **凭据安全**：`server/data/token.json`、`server/data/admin.json` 等同账号凭证，已被 `.gitignore` 排除，请勿提交到任何代码仓库或公开传播。
- **商用与再分发**：本仓库未附加任何开源许可证，默认保留全部权利；如需二次分发或商用，请先自行取得相关方授权。

> 如果你不接受以上条款，请立即停止使用并删除本项目。
