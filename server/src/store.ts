import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config';

export interface TokenRecord {
  token: string;
  account: unknown;
  loggedInAt: string;
}

const file = resolve(config.dataDir, 'token.json');

export async function saveToken(rec: TokenRecord): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(rec, null, 2), 'utf8');
}

export async function loadToken(): Promise<TokenRecord | null> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as TokenRecord;
  } catch {
    return null;
  }
}

export async function clearToken(): Promise<void> {
  try {
    await fs.unlink(file);
  } catch {
    /* 文件不存在时忽略 */
  }
}
