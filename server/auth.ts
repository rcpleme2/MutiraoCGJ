// Autenticação administrativa: senha, 2FA (TOTP), usuários, sessões e dispositivos lembrados.
import crypto from 'crypto';
import express from 'express';
import { hits, rateLimited } from './ratelimit.ts';
import { log, reqCtx, S } from './state.ts';
import { type AdminRole, type AdminUser, type Session } from './types.ts';
import { clientIp } from './util.ts';

// Senha administrativa: defina ADMIN_PASSWORD (em produção, pelo Secret Manager).
// Sem ela, uma senha aleatória é gerada e exibida no console do servidor a cada inicialização.
export let adminPassword = process.env.ADMIN_PASSWORD || '';
if (!adminPassword) {
  adminPassword = crypto.randomBytes(9).toString('base64url');
  console.warn(`[SEGURANÇA] ADMIN_PASSWORD não definida. Senha temporária gerada: ${adminPassword}`);
}
export const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const base32Encode = (buf: Buffer) => {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};
export const base32Decode = (s: string) => {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
};
export const totpAt = (secret: string, step: number) => {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000;
  return String(code).padStart(6, '0');
};
/** Último passo aceito por segredo: impede reutilizar um código já usado (replay). */
export const lastTotpStep = new Map<string, number>();
export function verifyTotp(secret: string, code: unknown): boolean {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  const now = Math.floor(Date.now() / 30_000);
  for (const step of [now - 1, now, now + 1]) { // tolera pequena diferença de relógio
    if (step <= (lastTotpStep.get(secret) ?? 0)) continue;
    const expected = Buffer.from(totpAt(secret, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(code))) { lastTotpStep.set(secret, step); return true; }
  }
  return false;
}
export const hashPassword = (pw: string) => { const salt = crypto.randomBytes(16); return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
export function checkPassword(pw: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
/** Senha compartilhada (ADMIN_PASSWORD) só vale enquanto não há usuários, ou como recuperação com ALLOW_SHARED_PASSWORD=true. */
export const sharedPasswordAllowed = () => !S.admins.some((a) => a.active && a.role === 'admin') || process.env.ALLOW_SHARED_PASSWORD === 'true';
/** Desafios do login: a senha já foi validada; falta o código do segundo fator (ou o cadastro do aplicativo). */
export const challenges = new Map<string, { exp: number; tries: number; pendingSecret?: string; userId: string | null; keep?: boolean }>();
// Sessões administrativas (token opaco). Duram 8h, ou 30 dias com "Manter conectado".
// São gravadas junto com o estado (sobrevivem a reinícios do servidor) apenas pelo hash SHA-256 do token:
// quem ler o banco não consegue reaproveitar uma sessão.
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const KEEP_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const sessions = new Map<string, Session>();
export const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
export function sessionOf(req: express.Request): Session | undefined {
  const token = req.header('x-admin-token');
  if (!token || token.length > 200) return undefined;
  const id = tokenHash(token);
  const s = sessions.get(id);
  if (!s) return undefined;
  if (s.exp < Date.now()) { sessions.delete(id); return undefined; }
  // Usuário desativado perde o acesso na hora; sessão da senha compartilhada cai quando ela é desativada
  if (s.userId && !S.admins.some((a) => a.id === s.userId && a.active)) { sessions.delete(id); return undefined; }
  if (!s.userId && !sharedPasswordAllowed()) { sessions.delete(id); return undefined; }
  return s;
}
/** Encerra as sessões de um usuário (ou da senha compartilhada), exceto a informada. Devolve quantas foram encerradas. */
export function endSessionsOf(userId: string | null, exceptId?: string) {
  let n = 0;
  for (const [id, s] of sessions) if (s.userId === userId && id !== exceptId) { sessions.delete(id); n++; }
  return n;
}
export const hasValidToken = (req: express.Request) => !!sessionOf(req);
/** Sessões ainda válidas (as expiradas não são gravadas) */
export const liveSessions = () => { const now = Date.now(); return [...sessions.values()].filter((x) => x.exp > now); };
export const loadSessions = (list: unknown) => {
  sessions.clear();
  if (Array.isArray(list)) for (const x of list as Session[]) if (x && typeof x.id === 'string' && typeof x.exp === 'number' && x.exp > Date.now()) sessions.set(x.id, x);
};
/** Registro de tentativa malsucedida: sempre no Cloud Logging; no registro interno com limite para não inundá-lo. */
export const failedLogin = (req: express.Request, res: express.Response, what: string) => {
  const ip = clientIp(req);
  console.log(JSON.stringify({ severity: 'WARNING', message: `Falha de autenticação do administrador: ${what}`, audit: { category: 'Acesso', ip } }));
  if (!rateLimited(`faillog:${ip}`, 5, 10 * 60_000)) log(null, 'Sistema', 'Acesso', `Falha de autenticação do administrador: ${what}.`);
  res.locals.persist = true; // esta resposta é 4xx, mas o registro precisa ser gravado
};
// "Lembrar este dispositivo": dispensa o código do autenticador por 30 dias (a senha continua sendo pedida).
// O comprovante é assinado com o segredo do autenticador, então redefinir o 2FA invalida todos os dispositivos lembrados.
export const DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const deviceSig = (secret: string, userId: string | null, exp: number) =>
  crypto.createHmac('sha256', secret).update(`device|${userId ?? 'shared'}|${exp}`).digest('hex');
export const issueDeviceToken = (secret: string, userId: string | null) => {
  const exp = Date.now() + DEVICE_TTL_MS;
  return `${exp}.${deviceSig(secret, userId, exp)}`;
};
export const deviceTrusted = (token: unknown, secret: string, userId: string | null) => {
  if (typeof token !== 'string') return false;
  const m = /^(\d{13})\.([0-9a-f]{64})$/.exec(token);
  if (!m || Number(m[1]) < Date.now()) return false;
  const expected = Buffer.from(deviceSig(secret, userId, Number(m[1])));
  return crypto.timingSafeEqual(expected, Buffer.from(m[2]));
};
export const openSession = (res: express.Response, how: string, user: AdminUser | null, keep: boolean, extra: Record<string, unknown> = {}) => {
  const token = crypto.randomBytes(32).toString('hex');
  const name = user ? user.name : 'Senha compartilhada';
  const exp = Date.now() + (keep ? KEEP_SESSION_TTL_MS : SESSION_TTL_MS);
  const id = tokenHash(token);
  sessions.set(id, { id, exp, userId: user?.id ?? null, name, role: user?.role ?? 'admin', createdAt: new Date().toISOString(), ...(keep ? { keep: true } : {}) });
  const store = reqCtx.getStore(); if (store) store.user = name;
  if (user) user.lastLoginAt = new Date().toISOString();
  log(null, 'Administração', 'Acesso', `Acesso ao painel administrativo (${how}${keep ? '; conectado por 30 dias' : ''}).`);
  res.locals.persist = true; // a sessão precisa ser gravada mesmo quando aberta na etapa 1 (dispositivo lembrado)
  res.json({ success: true, token, keep, expiresAt: new Date(exp).toISOString(), ...extra });
};
export const publicUser = (a: AdminUser) => ({ id: a.id, name: a.name, email: a.email, role: a.role, active: a.active, hasTotp: !!a.totpSecret, createdAt: a.createdAt, lastLoginAt: a.lastLoginAt });
export const ROLE_LABEL: Record<AdminRole, string> = { admin: 'Administrador', gestor: 'Gestor', consulta: 'Consulta' };
export const activeAdmins = () => S.admins.filter((a) => a.active && a.role === 'admin');

// Limpeza periódica: sessões e desafios expirados e janelas do limitador, para a memória não crescer indefinidamente
setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (s.exp < now) sessions.delete(t);
  for (const [t, c] of challenges) if (c.exp < now) challenges.delete(t);
  for (const [k, list] of hits) if (!list.some((t) => now - t < 60 * 60_000)) hits.delete(k);
}, 10 * 60_000).unref();
