import { Hono } from 'hono';
import { config } from './config';
import { buildLoginPayload } from './crypto';
import { saveToken, loadToken, clearToken, type TokenRecord } from './store';

export const auth = new Hono();

auth.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { account?: string; password?: string };
  const account = body.account?.trim();
  const password = body.password;
  if (!account || !password) {
    return c.json({ ok: false, message: '缺少 account 或 password' }, 400);
  }
  try {
    const payload = buildLoginPayload(account, password, config.encryptionKey);
    const resp = await fetch(`${config.bbsApiBase}/login/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await resp.json()) as any;
    if (data?.Code === 0 && data?.data?.account?.token) {
      const token = data.data.account.token as string;
      // 响应中绝不带回完整 token：剥离 account.token，仅下发脱敏串
      const accountSafe = { ...data.data.account };
      delete (accountSafe as any).token;
      const rec: TokenRecord = {
        token,
        account: data.data.account,
        loggedInAt: new Date().toISOString(),
      };
      await saveToken(rec);
      return c.json({
        ok: true,
        message: '登录成功',
        account: accountSafe,
        tokenMasked: mask(token),
      });
    }
    return c.json({ ok: false, message: data?.Message || '登录失败', raw: data }, 401);
  } catch (e: any) {
    return c.json({ ok: false, message: '请求社区登录接口出错: ' + (e?.message || e) }, 502);
  }
});

auth.get('/status', async (c) => {
  const rec = await loadToken();
  if (!rec) return c.json({ loggedIn: false });
  // 响应中绝不带回完整 token：剥离 account.token，仅下发脱敏串
  const accountSafe = rec.account ? { ...rec.account } : null;
  if (accountSafe) delete (accountSafe as any).token;
  return c.json({
    loggedIn: true,
    account: accountSafe,
    tokenMasked: mask(rec.token),
    loggedInAt: rec.loggedInAt,
  });
});

auth.get('/token', async (c) => {
  const rec = await loadToken();
  // 安全：只返回脱敏 token，绝不回显完整 JWT（完整令牌由服务端代理内部使用）
  return c.json({ loggedIn: !!rec, tokenMasked: rec ? mask(rec.token) : null });
});

auth.post('/logout', async (c) => {
  await clearToken();
  return c.json({ ok: true, message: '已退出登录' });
});

function mask(t: string): string {
  if (t.length <= 12) return '***';
  return t.slice(0, 6) + '…' + t.slice(-6);
}
