// Rotas de usuários administrativos (perfil Administrador).
import express from 'express';
import { activeAdmins, endSessionsOf, hashPassword, publicUser, ROLE_LABEL, sessions } from '../auth.ts';
import { log, newId, S } from '../state.ts';
import { ADMIN_ROLES, type AdminRole, type AdminUser } from '../types.ts';
import { cleanText } from '../util.ts';
import { EMAIL_RE } from '../validation.ts';

export function register(app: express.Express) {
  app.get('/api/admin/users', (_req, res) => res.json(S.admins.map(publicUser)));
  app.post('/api/admin/users', (req, res) => {
    const name = cleanText(req.body?.name, 120);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const role = req.body?.role as AdminRole;
    const password = String(req.body?.password ?? '');
    if (!name || !EMAIL_RE.test(email) || !ADMIN_ROLES.includes(role)) return res.status(400).json({ error: 'Informe nome, e-mail válido e perfil.' });
    if (password.length < 10) return res.status(400).json({ error: 'A senha inicial precisa ter ao menos 10 caracteres.' });
    if (S.admins.some((a) => a.email === email)) return res.status(409).json({ error: 'Já existe um usuário com este e-mail.' });
    const u: AdminUser = { id: newId('adm'), name, email, role, passwordHash: hashPassword(password), active: true, createdAt: new Date().toISOString() };
    S.admins.push(u);
    log(null, 'Administração', 'Acesso', `Usuário administrativo criado: ${name} (${email}), perfil ${ROLE_LABEL[role]}.`);
    res.status(201).json({ success: true, user: publicUser(u) });
  });
  app.put('/api/admin/users/:id', (req, res) => {
    const u = S.admins.find((a) => a.id === req.params.id);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const b = req.body || {};
    const changes: string[] = [];
    const wouldLoseLastAdmin = (nextRole: AdminRole, nextActive: boolean) =>
      u.role === 'admin' && u.active && (nextRole !== 'admin' || !nextActive) && activeAdmins().length <= 1;
    const nextRole: AdminRole = ADMIN_ROLES.includes(b.role) ? b.role : u.role;
    const nextActive = typeof b.active === 'boolean' ? b.active : u.active;
    if (wouldLoseLastAdmin(nextRole, nextActive)) return res.status(409).json({ error: 'É preciso manter ao menos um Administrador ativo.' });
    const name = b.name != null ? cleanText(b.name, 120) : u.name;
    if (!name) return res.status(400).json({ error: 'Nome inválido.' });
    if (name !== u.name) { changes.push(`nome para "${name}"`); u.name = name; }
    if (nextRole !== u.role) { changes.push(`perfil ${ROLE_LABEL[u.role]} → ${ROLE_LABEL[nextRole]}`); u.role = nextRole; }
    if (nextActive !== u.active) { changes.push(nextActive ? 'reativado' : 'desativado'); u.active = nextActive; }
    if (b.resetTotp === true && u.totpSecret) { u.totpSecret = undefined; changes.push('autenticador redefinido (novo cadastro no próximo acesso)'); }
    if (typeof b.password === 'string' && b.password) {
      if (b.password.length < 10) return res.status(400).json({ error: 'A senha precisa ter ao menos 10 caracteres.' });
      u.passwordHash = hashPassword(b.password); changes.push('senha redefinida');
    }
    // Senha ou autenticador redefinidos, ou usuário desativado: as sessões abertas (inclusive as de 30 dias) são encerradas
    if (changes.some((c) => c === 'senha redefinida' || c === 'desativado' || c.startsWith('autenticador'))) {
      const n = endSessionsOf(u.id);
      if (n) changes.push(`${n} sessão(ões) aberta(s) encerrada(s)`);
    }
    if (changes.length) log(null, 'Administração', 'Acesso', `Usuário ${u.email} alterado: ${changes.join(', ')}.`);
    // Mudança de perfil ou desativação vale para as sessões abertas
    for (const s of sessions.values()) if (s.userId === u.id) { s.role = u.role; s.name = u.name; }
    res.json({ success: true, user: publicUser(u) });
  });
}
