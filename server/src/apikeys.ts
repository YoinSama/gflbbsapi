import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config';

/**
 * 多 API Key 系统（替代旧的单一 .env API_KEY）。
 * - key 明文存于 server/data/apikeys.json（与 token.json 同目录，data/ 已被 .gitignore 忽略）。
 * - 管理页（已登录管理员）可查询 / 创建 / 删除；删除即时生效（守卫每次实时读文件，无需重启）。
 * - 校验：命中「启用」且 key 完全一致即放行，并刷新 lastUsedAt。
 */

export interface ApiKeyRecord {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  note?: string;
}

interface ApiKeyStore {
  keys: ApiKeyRecord[];
}

const apikeysFile = resolve(config.dataDir, 'apikeys.json');

function ensureFile(): void {
  if (!existsSync(apikeysFile)) {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(apikeysFile, JSON.stringify({ keys: [] }, null, 2));
  }
}

function loadStore(): ApiKeyStore {
  ensureFile();
  try {
    const raw = JSON.parse(readFileSync(apikeysFile, 'utf8')) as ApiKeyStore;
    return { keys: Array.isArray(raw.keys) ? raw.keys : [] };
  } catch {
    return { keys: [] };
  }
}

function saveStore(store: ApiKeyStore): void {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(apikeysFile, JSON.stringify(store, null, 2));
}

/** 生成 key：gf2_ + 32 位随机十六进制（128bit 熵） */
export function generateKey(): string {
  return 'gf2_' + randomBytes(16).toString('hex');
}

/** 管理页列表（含明文 key，供复制到博客配置） */
export function listKeys(): ApiKeyRecord[] {
  return loadStore().keys;
}

export function createKey(input: { name: string; note?: string }): ApiKeyRecord {
  const store = loadStore();
  const rec: ApiKeyRecord = {
    id: randomBytes(8).toString('hex'),
    name: input.name.trim(),
    key: generateKey(),
    enabled: true,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    note: input.note?.trim() || undefined,
  };
  store.keys.push(rec);
  saveStore(store);
  return rec;
}

/** 删除：返回是否真的删掉了某条 */
export function removeKey(id: string): boolean {
  const store = loadStore();
  const before = store.keys.length;
  store.keys = store.keys.filter((k) => k.id !== id);
  if (store.keys.length === before) return false;
  saveStore(store);
  return true;
}

/** 守卫校验：命中「启用」key 返回记录并刷新 lastUsedAt；否则 null */
export function findValidKey(provided: string): ApiKeyRecord | null {
  if (!provided) return null;
  const store = loadStore();
  const hit = store.keys.find((k) => k.enabled && k.key === provided) || null;
  if (hit) {
    hit.lastUsedAt = new Date().toISOString();
    saveStore(store);
  }
  return hit;
}
