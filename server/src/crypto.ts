import crypto from 'node:crypto';

const ALGO = 'aes-128-cbc';

/** 标准 MD5，返回 32 位十六进制 */
export function md5(text: string): string {
  return crypto.createHash('md5').update(text).digest('hex');
}

/**
 * 与官方社区前端一致的加密：
 * 1) aes-128-cbc 加密（key = iv = ENCRYPTION_KEY）
 * 2) 密文以 hex 输出，再转 base64，最后做 URL-safe（+/= 替换/去除）
 */
export function encryptData(text: string, key: string): string {
  const iv = key;
  const cipher = crypto.createCipheriv(ALGO, Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'));
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const base64 = Buffer.from(encrypted, 'hex').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** encryptData 的逆操作，仅用于自测 */
export function decryptData(text: string, key: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const buf = Buffer.from(padded, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, Buffer.from(key, 'utf8'), Buffer.from(key, 'utf8'));
  const decrypted = Buffer.concat([decipher.update(buf), decipher.final()]);
  return decrypted.toString('utf8');
}

/** 组装登录请求体（密码先 MD5 再加密；账号直接加密） */
export function buildLoginPayload(account: string, password: string, key: string) {
  return {
    account_name: encryptData(account, key),
    passwd: encryptData(md5(password), key),
    source: account.includes('@') ? 'mail' : 'phone',
  };
}

async function runSelfTest() {
  const key = 'a86a86^oH$04r6A1';
  const samples = ['13800001111', 'user@example.com', 'p@ssw0rd!', '中文账号测试'];
  let ok = true;
  for (const s of samples) {
    const e = encryptData(s, key);
    const d = decryptData(e, key);
    if (d !== s) {
      ok = false;
      console.error('FAIL roundtrip:', s, '->', e, '->', d);
    }
    if (!/^[A-Za-z0-9_-]+$/.test(e)) {
      ok = false;
      console.error('FAIL urlsafe charset:', e);
    }
  }
  if (md5('abc') !== '900150983cd24fb0d6963f7d28e17f72') {
    ok = false;
    console.error('FAIL md5 vector');
  }
  console.log(ok ? 'SELFTEST PASS - aes-128-cbc + md5 + urlsafe base64 加解密一致' : 'SELFTEST FAIL');
  process.exit(ok ? 0 : 1);
}

if (process.argv.includes('--selftest')) {
  runSelfTest();
}
