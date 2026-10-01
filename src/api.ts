const TOKEN_KEY = 'mutirao-admin-token';

let memoryToken = '';

export const getToken = () => {
  try { return sessionStorage.getItem(TOKEN_KEY) || memoryToken; } catch { return memoryToken; }
};
export const setToken = (t: string) => {
  memoryToken = t;
  try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage indisponível */ }
};

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers['x-admin-token'] = token;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) setToken('');
    throw new Error(data.error || data.message || 'Erro na requisição.');
  }
  return data;
}

/** Baixa um arquivo autenticado (links <a href> não enviam o token). */
export async function download(path: string, fallbackName: string) {
  const token = getToken();
  const res = await fetch(`/api${path}`, { headers: token ? { 'x-admin-token': token } : {} });
  if (!res.ok) throw new Error('Não foi possível gerar o arquivo.');
  const disposition = res.headers.get('Content-Disposition') || '';
  const name = /filename=([^;]+)/.exec(disposition)?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
