> [!WARNING]
> ### ⚠️ 本项目完全使用 AI 生成，仅供个人学习，请勿作他用 ⚠️
>
> **代码未经充分审计、无任何担保，作者不承担使用后果。** 使用本项目即视为接受以下风险：
>
> - **封号风险**：项目通过模拟登录调用 gf2 社区的非公开接口，可能违反官方用户协议，导致账号被封禁。**强烈建议使用小号。**
> - **仅供学习**：用于理解接口鉴权、加密与代理转发，**禁止用于商业用途、公开分发、批量爬取或任何违反官方条款的行为**。
> - **凭据自担**：若部署到公网，请自行确认 token 等敏感信息已脱敏、访问控制已配置妥当。
>
> 详细免责与风险说明见文末「免责声明」。

---

# gf2 社区 API 轻量项目

gf2 官方社区的轻量 API 代理 + 展示项目。
包含 **前端展示页** 与 **后端管理页**，后端负责模拟社区登录、托管 token、代理社区接口。

## 功能

通过模拟登录调用官方社区接口，获取**社区个人游戏信息**并在前端展示，仅供个人查看。

- 后端：模拟社区登录、托管并持久化登录态、代理转发社区接口（token 由后端自动附加，规避浏览器跨域）
- 前端：管理页提供社区账号登录与登录态下的社区个人游戏信息展示，以及接口调试入口
- 管理页自身有一套独立的管理员账号（与社区账号无关），用于保护管理页访问

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js + TypeScript + Hono（单进程：出 API + 托管前端静态文件） |
| 前端 | Vue 3 + Vite（Login 登录页 + Admin 管理页，CSS 变量深浅色主题，响应式） |
| 持久化 | 服务器本地 JSON 文件（`data/token.json`，已 gitignore） |
| 部署 | PM2（进程守护）+ 直接 IP:端口 访问（源站直连，无 CDN / 代理） |

加密细节：密码先 MD5，账号与密码均用 `aes-128-cbc`（key = iv = `ENCRYPTION_KEY`）加密，
密文 hex → base64 → URL-safe。密钥来自官方社区前端脚本，可能与版本相关。

## 社区接口说明

后端 `server/src/endpoints.ts` 内置了一份**已验证的接口预设**，管理页 `/admin` 的 API 测试可直接一键填充（带 `*` 的才是待验证接口，目前无）。所有社区接口都经后端代理（`/api/community/*`），token 由后端自动附加，规避浏览器跨域问题。

### 代理路径约定（必读）

请求链路如下：

```
前端 api.proxy(method, path)
  → fetch('/api/community' + path)
  → 后端 proxy.ts 剥掉前缀 /api/community/ → 转发到社区接口域名
```

要点（容易踩坑，务必照做）：

- **API 测试框里只填真实业务路径**：直接写 `/community/...`（以 `/community/` 开头），别写 `/api/community/...`。`api.proxy()` 会自动补 `/api/community` 前缀，所以前端 URL 里会出现**两段 `/community`（`/api/community/community/...`）**——这是设计如此，正常，不是 bug。
- **预设接口已带正确前缀**：`endpoints.ts` 里的 path 都是 `/community/...` 形式，可直接用。
- **切勿手动去掉或再加 `/community`**：路径写错（少写或多写 `/community`）会导致代理剥前缀后不匹配上游，返回 404。

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

### 部署架构：直接 IP:端口 访问（源站直连，不接 CDN / 代理）

> 本项目不依赖域名或反向代理，源站 Node 应用直接在公网 IP 的某个端口监听，客户端用 `http://<服务器公网IP>:<端口>/` 访问即可。

```
客户端 -- HTTP --> 阿里云源站 · Node 应用（PM2 守护，监听应用端口）
                   仅监听应用端口，不装 nginx、不跑 certbot、不接 Cloudflare
```

- **服务器侧**：只把源站应用跑起来即可（一键脚本 / 手动步骤见上），**不装 nginx、不跑 certbot、不接任何 CDN**。应用监听端口见 `server/ecosystem.config.cjs` 的 `PORT`（可用环境变量覆盖）。
- **安全组 / 防火墙**：在阿里云控制台将**应用端口**的入方向来源设为你的客户端 IP（或 `0.0.0.0/0` 开放给所有人，需注意暴露风险），**而非之前「仅允许 Cloudflare IP」的规则** —— 若仍残留该规则，直连会被拦截。
  - 如启用了实例 `ufw`，放行应用端口的入方向流量；其余端口均关闭。
- **（可选）HTTPS**：直接 IP:端口走的是明文 HTTP。若调用方页面本身是 HTTPS，浏览器会因混合内容（mixed content）拦截 HTTP 请求；此类场景需自行在源站配置证书或改用服务端代发请求。个人工具 / 服务端调用可忽略。
- **验证**：`curl -s -o /dev/null -w "%{http_code}\n" --noproxy '*' http://<服务器公网IP>:<端口>/`，返回 200 即通。

### 从外部（浏览器 / 其他前端）调用本 API

若要从另一个网站（如你的 Firefly 博客）的 JS 里调用本 API，需满足三点：

1. **开 CORS**：设置环境变量 `CORS_ORIGINS` 为调用方来源（逗号分隔，例如 `https://your-blog.pages.dev`）。默认仅允许同源（即管理页），未配置时外部浏览器会被拦截。
2. **加 API Key**：设置 `API_KEY`（任意字符串）。配置后，**跨域**调用 `/api/community/*` 与 `/api/tasks/*` 必须在请求头带 `x-api-key: <KEY>`（或 query `?api_key=...`），否则返回 403；同源（管理页）调用不受影响。这样即便接口暴露，他人没有 Key 也无法用你的社区账号。
3. **上 HTTPS**：浏览器在 HTTPS 页面里调用 `http://` 接口会被判为混合内容（mixed content）而拦截。推荐用 Cloudflare 给源站套一层 HTTPS（域名 A 记录 → 源站 IP:端口，SSL 模式 Full），或用 Caddy / Let's Encrypt 在源站配证书。

外部调用示例（浏览器 `fetch`）：

```js
const API = 'https://你的API域名';   // 必为 HTTPS
const KEY = '你的API_KEY';
// 读取社区个人信息（注意双写 /community 路径）
const r = await fetch(API + '/api/community/community/member/info', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': KEY },
  body: '{}',
});
const data = await r.json();
```

- 路径约定同管理页：**业务路径写 `/community/...`，前端拼接后变成 `/api/community/community/...`**（详见上文「代理路径约定」）。
- 服务器安全组需放行应用端口到调用方出口 IP（若走 Cloudflare，则放行 Cloudflare 的 IP 段）。
- token 由服务器自动附加，调用方无需也不应持有 token；token 有效性依赖服务端登录态，刷新请在管理页操作。

### 部署注意
- **会话已持久化到 admin.json（文件共享）**：`ecosystem.config.cjs` 用 `instances: 1` 单进程，登录态稳；即便改 cluster 多进程（`instances: 'max'`），所有进程也读同一份 `admin.json`，请求轮询到任意进程都能识别登录态（不再被踢）。唯一残留风险是极端并发下多进程同时写 `admin.json` 可能相互覆盖会话，个人工具量级可忽略；高并发场景建议换 Redis。
- **token 已脱敏**：所有接口只回显 `tokenMasked`，公网暴露也安全；但 `server/data/token.json`（磁盘真令牌）仍等同凭证，务必保证该目录仅运行用户可读写、不进 git。
- **数据目录权限**：`server/data/` 被 gitignore，运行时由 `ensureDataDir()` 自动建；运行用户需对其有写权限（勿以无权限用户或只读挂载运行）。


## 注意事项 / 风险

- **账号风控**：使用第三方工具模拟登录可能违反官方用户协议，存在封号风险，请谨慎使用，建议用小号。
- **接口可能变动**：社区登录接口域名曾于 2026-05-31 变更；若登录返回 401，优先检查 `ENCRYPTION_KEY` 是否仍是官方前端脚本里的最新值（抓包官方社区页面 JS 搜索 `Utf8.parse(...)` 即可找到）。
- **token 安全**：`data/token.json` 等同账号凭证，切勿提交到 git 或公开。
- **游戏进度**：社区 API 仅提供社区侧静态档案，不暴露游戏服务器的**实时/完整**进度；其余实时进度走游戏服务器接口，不在本代理范围内。


## 免责声明

**本项目完全使用 AI 生成，仅供个人学习，请勿作他用。**

- **无担保**：代码由 AI 生成，未经充分安全审计与稳定性验证，按「原样」提供，不提供任何明示或暗示的担保。使用者需自行承担全部风险与后果。
- **仅限学习**：本项目用于学习接口鉴权、请求加密与代理转发等技术原理。**禁止**用于商业用途、公开分发、批量爬取、自动化脚本运营或任何违反 gf2 官方用户协议的行为。
- **第三方接口**：本项目调用的社区接口并非官方公开 API，可能随时变更或增加风控。因使用本项目导致的账号封禁、数据丢失或任何其他损失，作者不承担责任。
- **凭据安全**：`server/data/token.json`、`server/data/admin.json` 等同账号凭证，已被 `.gitignore` 排除，请勿提交到任何代码仓库或公开传播。
- **商用与再分发**：本仓库未附加任何开源许可证，默认保留全部权利；如需二次分发或商用，请先自行取得相关方授权。

> 如果你不接受以上条款，请立即停止使用并删除本项目。
