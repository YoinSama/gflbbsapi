type ApiResult<T = any> = {
  ok: boolean;
  status: number;
  data: T;
};

async function request<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => null);
  }
  return { ok: res.ok, status: res.status, data };
}

export const api = {
  login: (account: string, password: string) =>
    request('POST', '/api/auth/login', { account, password }),
  status: () => request('GET', '/api/auth/status'),
  logout: () => request('POST', '/api/auth/logout'),
  // 管理员网关（访问管理页自身）
  adminLogin: (username: string, password: string) =>
    request('POST', '/api/admin/login', { username, password }),
  adminStatus: () => request('GET', '/api/admin/status'),
  adminChange: (oldPassword: string, newUsername: string, newPassword: string) =>
    request('POST', '/api/admin/change', { oldPassword, newUsername, newPassword }),
  adminLogout: () => request('POST', '/api/admin/logout'),
  // 通过后端代理调用社区接口，token 由后端自动附加
  proxy: (method: string, path: string, body?: unknown) =>
    request(method, '/api/community' + (path.startsWith('/') ? path : '/' + path), body),
};
