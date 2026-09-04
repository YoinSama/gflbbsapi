import { Hono } from 'hono';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config';
import { createKey, listKeys, removeKey } from './apikeys';

/**
 * 本地管理员鉴权（用于网关「管理页」）。
 * 与社区 token 登录无关：这是访问管理页自身的账号体系。
 * - 初始账号 admin / 密码 123456，首次登录强制修改账号与密码（mustChange）。
 * - 🔒 默认凭据一次性失效：一旦已创建管理员账户（isInitialized），admin/123456
 *   立即永久失效（拒绝登录，提示与普通密码错误完全一致、不可区分），且不允许
 *   改回该组合；仅未初始化状态可用。
 * - 会话（sid）持久化在 server/data/admin.json 的 sessions 字段中：
 *   进程重启 / 多进程（fork）均读同一份文件，登录态不会丢失，避免被踢。
 * - 凭据（scrypt 哈希）同样存于 admin.json（已被 .gitignore 的 data/ 忽略）。
 * - 传输用 httpOnly cookie(admin_sid)；Hono 核心不含 cookie 解析，此处手动处理，保持零额外依赖。
 */

const serverSrc = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(serverSrc, '..');
const dataDir = config.dataDir;
const adminFile = resolve(dataDir, 'admin.json');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 与 cookie Max-Age 一致（7 天）

/** 出厂默认凭据：仅在「尚未创建管理员账户」时可用，一旦初始化即永久失效 */
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = '123456';

/**
 * 是否已「创建过」管理员账户（即不再是出厂默认状态）。
 * 判定依据：完成首次改密（mustChange=false），或账号名已不再是默认的 admin。
 */
function isInitialized(rec: AdminRecord): boolean {
  return rec.mustChange === false || rec.username !== DEFAULT_USERNAME;
}

interface AdminSession {
  createdAt: string;
}

interface AdminRecord {
  username: string;
  salt: string;
  hash: string;
  mustChange: boolean;
  sessions: Record<string, AdminSession>;
}

function ensureDataDir(): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}

function normalize(raw: Partial<AdminRecord> & { username: string; salt: string; hash: string; mustChange: boolean }): AdminRecord {
  const sessions: Record<string, AdminSession> =
    raw.sessions && typeof raw.sessions === 'object' ? (raw.sessions as Record<string, AdminSession>) : {};
  // 清理过期会话（仅从内存对象移除；下次写入时落盘）
  const now = Date.now();
  for (const [sid, s] of Object.entries(sessions)) {
    if (!s?.createdAt || now - new Date(s.createdAt).getTime() > SESSION_TTL_MS) {
      delete sessions[sid];
    }
  }
  return { username: raw.username, salt: raw.salt, hash: raw.hash, mustChange: raw.mustChange, sessions };
}

function loadAdmin(): AdminRecord {
  ensureDataDir();
  if (!existsSync(adminFile)) {
    const rec = createAdmin(DEFAULT_USERNAME, DEFAULT_PASSWORD, true);
    writeFileSync(adminFile, JSON.stringify(rec, null, 2));
    return rec;
  }
  const raw = JSON.parse(readFileSync(adminFile, 'utf8')) as AdminRecord;
  return normalize(raw);
}

function saveAdmin(rec: AdminRecord): void {
  ensureDataDir();
  writeFileSync(adminFile, JSON.stringify(rec, null, 2));
}

function createAdmin(username: string, password: string, mustChange: boolean): AdminRecord {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { username, salt, hash, mustChange, sessions: {} };
}

function verifyPassword(password: string, rec: AdminRecord): boolean {
  const hash = scryptSync(password, rec.salt, 64);
  const expected = Buffer.from(rec.hash, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

function getCookie(c: any, name: string): string | undefined {
  const header = c.req.header('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

function setCookie(c: any, name: string, value: string, maxAge: number): void {
  c.header(
    'Set-Cookie',
    `${name}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`,
  );
}

export function getSession(c: any): string | undefined {
  const sid = getCookie(c, 'admin_sid');
  if (!sid) return undefined;
  const rec = loadAdmin();
  return rec.sessions[sid] ? sid : undefined;
}

export const admin = new Hono();

admin.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = body.username?.trim();
  const password = body.password;
  if (!username || !password) {
    return c.json({ ok: false, message: '缺少用户名或密码' }, 400);
  }
  const rec = loadAdmin();
  // 安全：一旦创建过管理员账户，出厂默认凭据即永久失效（历史/畸形 admin.json 的兜底），
  // 避免「改了密却仍能拿 admin/123456 登录」。响应刻意与普通密码错误完全一致
  // （401 + 同一文案）——不泄露「默认凭据已被禁用」或「默认密码命中」给探测者
  if (isInitialized(rec) && username === DEFAULT_USERNAME && password === DEFAULT_PASSWORD) {
    return c.json({ ok: false, message: '用户名或密码错误' }, 401);
  }
  if (username !== rec.username || !verifyPassword(password, rec)) {
    return c.json({ ok: false, message: '用户名或密码错误' }, 401);
  }
  const sid = randomBytes(32).toString('hex');
  rec.sessions[sid] = { createdAt: new Date().toISOString() };
  saveAdmin(rec);
  setCookie(c, 'admin_sid', sid, 60 * 60 * 24 * 7);
  return c.json({ ok: true, mustChange: rec.mustChange, username: rec.username });
});

admin.get('/status', (c) => {
  const rec = loadAdmin();
  const loggedIn = !!getSession(c);
  return c.json({
    loggedIn,
    // 未登录时不泄露账号名
    mustChange: loggedIn ? rec.mustChange : false,
    username: loggedIn ? rec.username : '',
    // 未登录时同样返回：前端据此决定是否展示默认凭据提示
    initialized: isInitialized(rec),
  });
});

admin.post('/change', async (c) => {
  if (!getSession(c)) {
    return c.json({ ok: false, message: '未登录' }, 401);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    oldPassword?: string;
    newUsername?: string;
    newPassword?: string;
  };
  const oldPassword = body.oldPassword;
  const newUsername = body.newUsername?.trim();
  const newPassword = body.newPassword;
  if (!oldPassword || !newUsername || !newPassword) {
    return c.json({ ok: false, message: '缺少必填项' }, 400);
  }
  if (newPassword.length < 6) {
    return c.json({ ok: false, message: '新密码至少 6 位' }, 400);
  }
  const rec = loadAdmin();
  if (!verifyPassword(oldPassword, rec)) {
    return c.json({ ok: false, message: '当前密码错误' }, 401);
  }
  // 安全：不允许改回出厂默认凭据——否则改完就变成「默认凭据已失效」而登录不进去，等于把自己锁在门外
  if (newUsername === DEFAULT_USERNAME && newPassword === DEFAULT_PASSWORD) {
    return c.json({ ok: false, message: '不能改回默认账号密码（admin / 123456）' }, 400);
  }
  const updated = createAdmin(newUsername, newPassword, false);
  updated.sessions = rec.sessions; // 改密后保留当前登录会话，不被踢
  saveAdmin(updated);
  return c.json({ ok: true, message: '已更新管理员账号密码' });
});

admin.post('/logout', (c) => {
  const sid = getCookie(c, 'admin_sid');
  if (sid) {
    const rec = loadAdmin();
    if (rec.sessions[sid]) {
      delete rec.sessions[sid];
      saveAdmin(rec);
    }
  }
  setCookie(c, 'admin_sid', '', 0);
  return c.json({ ok: true, message: '已退出' });
});

// ---------- API Key 管理（仅已登录管理员可操作）----------

function requireAdmin(c: any): { ok: boolean; rec?: AdminRecord } {
  if (!getSession(c)) return { ok: false };
  return { ok: true, rec: loadAdmin() };
}

admin.get('/apikeys', (c) => {
  if (!requireAdmin(c).ok) return c.json({ ok: false, message: '未登录' }, 401);
  return c.json({ ok: true, keys: listKeys() });
});

admin.post('/apikeys', async (c) => {
  if (!requireAdmin(c).ok) return c.json({ ok: false, message: '未登录' }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; note?: string };
  const name = body.name?.trim();
  if (!name) return c.json({ ok: false, message: '缺少名称' }, 400);
  const rec = createKey({ name, note: body.note });
  return c.json({ ok: true, key: rec });
});

admin.delete('/apikeys/:id', (c) => {
  if (!requireAdmin(c).ok) return c.json({ ok: false, message: '未登录' }, 401);
  const id = c.req.param('id');
  const removed = removeKey(id);
  if (!removed) return c.json({ ok: false, message: '未找到该 Key' }, 404);
  return c.json({ ok: true, message: '已删除' });
});
