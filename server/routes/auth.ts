// Rotas de acesso administrativo: login com 2FA, sessão, preferências do usuário e senha.
import express from 'express';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { adminPassword, base32Encode, challenges, checkPassword, deviceTrusted, endSessionsOf, failedLogin, hashPassword, issueDeviceToken, openSession, sessionOf, sessions, sharedPasswordAllowed, tokenHash, verifyTotp } from '../auth.ts';
import { rateLimited } from '../ratelimit.ts';
import { log, reqCtx, S } from '../state.ts';
import { type AdminUser } from '../types.ts';

export function register(app: express.Express) {
  // Tela de login: indica se já existem usuários individuais (pede e-mail) ou se vale a senha compartilhada
  app.get('/api/admin/login-mode', (_req, res) => res.json({ users: S.admins.some((a) => a.active), shared: sharedPasswordAllowed() }));
  // Etapa 1: e-mail + senha do usuário (ou a senha compartilhada ADMIN_PASSWORD, enquanto não houver usuários)
  app.post('/api/admin/login', async (req, res) => {
    if (rateLimited(`login:${req.ip}`, 8, 10 * 60_000)) {
      return res.status(429).json({ success: false, message: 'Muitas tentativas. Tente novamente em alguns minutos.' });
    }
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = String(req.body?.password ?? '');
    let user: AdminUser | null = null;
    if (email) {
      const u = S.admins.find((a) => a.active && a.email === email);
      if (!u || !checkPassword(password, u.passwordHash)) {
        failedLogin(req, res, `e-mail ou senha incorretos (${email.slice(0, 80)})`);
        return res.status(401).json({ success: false, message: 'E-mail ou senha incorretos.' });
      }
      user = u;
    } else {
      const given = Buffer.from(password);
      const expected = Buffer.from(adminPassword);
      const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
      if (!ok || !sharedPasswordAllowed()) {
        failedLogin(req, res, ok ? 'senha compartilhada desativada' : 'senha incorreta');
        return res.status(401).json({ success: false, message: ok ? 'A senha compartilhada foi desativada. Entre com seu e-mail e senha.' : 'Senha administrativa incorreta.' });
      }
    }
    const challenge = crypto.randomBytes(24).toString('hex');
    const secret = user ? user.totpSecret : S.adminTotpSecret;
    if (secret && deviceTrusted(req.body?.deviceToken, secret, user?.id ?? null)) {
      return openSession(res, `${user ? 'e-mail e senha' : 'senha compartilhada'} em dispositivo lembrado`, user, req.body?.keep === true);
    }
    if (secret) {
      challenges.set(challenge, { exp: Date.now() + 5 * 60_000, tries: 0, userId: user?.id ?? null, keep: req.body?.keep === true });
      return res.json({ success: true, step: 'totp', challenge });
    }
    // Primeiro acesso: cadastro do aplicativo autenticador (segredo + QR code)
    const pendingSecret = base32Encode(crypto.randomBytes(20));
    challenges.set(challenge, { exp: Date.now() + 10 * 60_000, tries: 0, pendingSecret, userId: user?.id ?? null, keep: req.body?.keep === true });
    const account = user ? user.email : 'Administração';
    const otpauth = `otpauth://totp/${encodeURIComponent('Mutirão CGJ')}:${encodeURIComponent(account)}?secret=${pendingSecret}&issuer=${encodeURIComponent('Mutirão CGJ')}`;
    const qrSvg = await QRCode.toString(otpauth, { type: 'svg', margin: 1, width: 200 });
    res.json({ success: true, step: 'enroll', challenge, secret: pendingSecret, otpauth, qrSvg });
  });
  // Etapa 2: código de 6 dígitos (ou confirmação do cadastro do autenticador, no primeiro acesso)
  app.post('/api/admin/login/verify', (req, res) => {
    if (rateLimited(`totp:${req.ip}`, 10, 10 * 60_000)) {
      return res.status(429).json({ success: false, message: 'Muitas tentativas. Tente novamente em alguns minutos.' });
    }
    const ch = challenges.get(String(req.body?.challenge ?? ''));
    if (!ch || ch.exp < Date.now()) return res.status(401).json({ success: false, message: 'Sessão de login expirada. Informe a senha novamente.' });
    if (++ch.tries > 5) { challenges.delete(String(req.body.challenge)); return res.status(401).json({ success: false, message: 'Tentativas esgotadas. Informe a senha novamente.' }); }

    const user = ch.userId ? S.admins.find((a) => a.id === ch.userId && a.active) ?? null : null;
    if (ch.userId && !user) return res.status(401).json({ success: false, message: 'Usuário desativado.' });
    const secret = ch.pendingSecret ?? (user ? user.totpSecret : S.adminTotpSecret);
    if (!secret || !verifyTotp(secret, req.body?.code)) {
      failedLogin(req, res, 'código de verificação incorreto');
      return res.status(401).json({ success: false, message: 'Código incorreto.' });
    }
    challenges.delete(String(req.body.challenge));
    const extra = req.body?.remember === true ? { deviceToken: issueDeviceToken(secret, user?.id ?? null) } : {};
    const remembered = extra.deviceToken ? '; dispositivo lembrado por 30 dias' : '';
    const keep = req.body?.keep === true || ch.keep === true;
    if (ch.pendingSecret) {
      if (user) user.totpSecret = ch.pendingSecret; else S.adminTotpSecret = ch.pendingSecret;
      const store = reqCtx.getStore(); if (store && user) store.user = user.name;
      log(null, 'Administração', 'Acesso', `Autenticação em dois fatores configurada${user ? ` para ${user.name}` : ''}.`);
      return openSession(res, `primeiro acesso com cadastro do autenticador${remembered}`, user, keep, extra);
    }
    openSession(res, `${user ? 'e-mail, senha e código de verificação' : 'senha compartilhada e código de verificação'}${remembered}`, user, keep, extra);
  });
  app.post('/api/admin/logout', (req, res) => {
    const token = req.header('x-admin-token');
    if (token && sessions.delete(tokenHash(token))) res.locals.persist = true;
    res.json({ success: true });
  });
  // Encerra as demais sessões abertas do próprio usuário (outros computadores e navegadores)
  app.post('/api/admin/me/sessions/end-others', (req, res) => {
    const s = sessionOf(req)!;
    const n = endSessionsOf(s.userId, s.id);
    log(null, 'Administração', 'Acesso', `${s.name} encerrou ${n} outra(s) sessão(ões) aberta(s).`);
    res.json({ success: true, ended: n });
  });
  app.get('/api/admin/me', (req, res) => {
    const s = sessionOf(req)!;
    const others = [...sessions.values()].filter((x) => x.userId === s.userId && x.id !== s.id && x.exp > Date.now()).length;
    const hiddenTabs = s.userId ? S.admins.find((a) => a.id === s.userId)?.hiddenTabs ?? [] : S.sharedHiddenTabs;
    res.json({ name: s.name, role: s.role, shared: s.userId === null, users: S.admins.some((a) => a.active), sessionExpiresAt: new Date(s.exp).toISOString(), keep: s.keep === true, otherSessions: others, hiddenTabs });
  });
  // Abas que o próprio usuário quer esconder na tela da administração (preferência pessoal, não restringe acesso)
  app.put('/api/admin/me/tabs', (req, res) => {
    const s = sessionOf(req)!;
    const raw = req.body?.hidden;
    if (!Array.isArray(raw) || raw.length > 40 || !raw.every((t) => typeof t === 'string' && /^[a-z]{1,30}$/.test(t))) return res.status(400).json({ error: 'Lista de abas inválida.' });
    const hidden = [...new Set(raw as string[])];
    if (s.userId) { const u = S.admins.find((a) => a.id === s.userId); if (u) u.hiddenTabs = hidden.length ? hidden : undefined; }
    else S.sharedHiddenTabs = hidden;
    res.json({ success: true, hiddenTabs: hidden });
  });
  // Troca da própria senha
  app.post('/api/admin/me/password', (req, res) => {
    const s = sessionOf(req)!;
    const u = s.userId ? S.admins.find((a) => a.id === s.userId) : undefined;
    if (!u) return res.status(400).json({ error: 'A senha compartilhada é definida pela variável ADMIN_PASSWORD no Cloud Run.' });
    if (!checkPassword(String(req.body?.current ?? ''), u.passwordHash)) return res.status(401).json({ error: 'Senha atual incorreta.' });
    const next = String(req.body?.next ?? '');
    if (next.length < 10) return res.status(400).json({ error: 'A nova senha precisa ter ao menos 10 caracteres.' });
    u.passwordHash = hashPassword(next);
    const n = endSessionsOf(u.id, s.id); // a troca de senha encerra as sessões abertas em outros dispositivos
    log(null, 'Administração', 'Acesso', `${u.name} alterou a própria senha${n ? ` (${n} outra(s) sessão(ões) encerrada(s))` : ''}.`);
    res.json({ success: true });
  });
}
