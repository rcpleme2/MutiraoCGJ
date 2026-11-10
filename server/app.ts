// Servidor HTTP: cabeçalhos de segurança, leitura do corpo, carga dos dados, controle de acesso e registro das rotas.
import express from 'express';
import path from 'path';
import { hasValidToken, sessionOf } from './auth.ts';
import { ensureInitialEdition } from './editions.ts';
import { migratePanelEntries, reconcileWithdrawals } from './links.ts';
import { loadState, saveState } from './persistence.ts';
import { hits, rateLimited, refund, SIGNUP_MAX_ERRORS_PER_IP, SIGNUP_MAX_GLOBAL_PER_HOUR, SIGNUP_MAX_PER_IP } from './ratelimit.ts';
import { log, reqCtx, S } from './state.ts';
import { clientIp } from './util.ts';
import { normalizeLegacy } from './validation.ts';
import { register as registerAuth } from './routes/auth.ts';
import { register as registerUsers } from './routes/users.ts';
import { register as registerEditions } from './routes/editions.ts';
import { register as registerFaq } from './routes/faq.ts';
import { register as registerPanel } from './routes/panel.ts';
import { register as registerStandardize } from './routes/standardize.ts';
import { register as registerDuplicates } from './routes/duplicates.ts';
import { register as registerUnits } from './routes/units.ts';
import { register as registerDashboard } from './routes/dashboard.ts';
import { register as registerCatalog } from './routes/catalog.ts';
import { register as registerBi } from './routes/bi.ts';
import { register as registerBackup } from './routes/backup.ts';
import { register as registerLog } from './routes/log.ts';
import { register as registerMagistrates } from './routes/magistrates.ts';
import { register as registerMatches } from './routes/matches.ts';
import { register as registerExports } from './routes/exports.ts';

export async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  const production = process.env.NODE_ENV === 'production';

  // Cabeçalhos de segurança. CSP e proteção contra incorporação só em produção (o ambiente de
  // desenvolvimento/prévia usa recursos inline e pode rodar dentro de um iframe).
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (production) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self'",
        "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
      ].join('; '));
    }
    next();
  });

  const smallJson = express.json({ limit: '50kb' });
  const bigJson = express.json({ limit: '1mb' }); // colagem de planilhas inteiras no painel de vinculações
  const hugeJson = express.json({ limit: '40mb' }); // restauração de backup (só com sessão administrativa válida)
  app.use((req, res, next) => (req.path === '/api/panel/import' ? bigJson : req.path === '/api/backup/restore' && hasValidToken(req) ? hugeJson : smallJson)(req, res, next));
  await loadState();
  normalizeLegacy();
  migratePanelEntries();
  ensureInitialEdition();
  await saveState();
  // Perdeu o celular do autenticador? Defina RESET_ADMIN_2FA=true, publique, entre (será pedido novo cadastro) e remova a variável.
  if (process.env.RESET_ADMIN_2FA === 'true' && S.adminTotpSecret) {
    S.adminTotpSecret = null;
    log(null, 'Sistema', 'Acesso', 'Autenticação em dois fatores redefinida por variável de ambiente (RESET_ADMIN_2FA).');
    await saveState();
  }
  app.set('trust proxy', 1); // Cloud Run: IP real do cliente para o limitador
  app.set('etag', false);
  // Todas as respostas da API proíbem cache (painel e consultas contêm dados pessoais)
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  // IP da origem disponível em todo registro de atividade gerado durante a requisição
  app.use((req, _res, next) => reqCtx.run({ ip: clientIp(req) }, next));

  // Proteção das rotas: somente o necessário é público; o resto exige sessão administrativa.
  app.use('/api', (req, res, next) => {
    const ip = req.ip || 'unknown';
    const session = sessionOf(req);
    const admin = !!session;
    if (session) { const store = reqCtx.getStore(); if (store) store.user = session.name; }
    const publicRead = (req.method === 'GET' && ['/settings', '/faq', '/admin/login-mode', '/catalog'].includes(req.path)) || (req.method === 'POST' && req.path === '/status');
    const publicSignup = req.method === 'POST' && (req.path === '/magistrates' || req.path === '/units');
    const login = req.method === 'POST' && (req.path === '/admin/login' || req.path === '/admin/login/verify');

    if (req.method === 'POST' && req.path === '/status' && rateLimited(`status:${ip}`, 30, 60_000)) {
      return res.status(429).json({ error: 'Muitas consultas. Aguarde um instante.' });
    }
    if (publicSignup && !admin) {
      // Anti-spam: campo-isca preenchido só por robôs (finge sucesso e descarta) e limites por IP e globais.
      if (typeof req.body?.website === 'string' && req.body.website.trim() !== '') {
        return res.status(201).json({ success: true });
      }
      // A vaga é reservada já (protege contra rajadas simultâneas) e devolvida se a requisição não
      // gerar uma inscrição: erros de preenchimento, e-mail duplicado etc. não consomem o limite.
      const ipKey = `signup:${ip}`;
      const limited = rateLimited(ipKey, SIGNUP_MAX_PER_IP, 10 * 60_000);
      const globalLimited = rateLimited('signup:global', SIGNUP_MAX_GLOBAL_PER_HOUR, 60 * 60_000);
      // Inscrições com erro (validação, duplicidade, fora do prazo) não gastam o limite principal, mas contam em um
      // limite próprio mais folgado: impede sondar e-mails já inscritos por tentativa e erro.
      const errKey = `signuperr:${ip}`;
      const errOver = (hits.get(errKey) ?? []).filter((t) => Date.now() - t < 10 * 60_000).length >= SIGNUP_MAX_ERRORS_PER_IP;
      res.on('finish', () => {
        if (res.statusCode !== 201 || limited || globalLimited) { refund(ipKey); refund('signup:global'); }
        if (res.statusCode >= 400 && res.statusCode !== 429) { const l = hits.get(errKey) ?? []; l.push(Date.now()); hits.set(errKey, l); }
      });
      if (errOver) return res.status(429).json({ error: 'Muitas tentativas com erro. Aguarde alguns minutos e tente novamente.' });
      if (limited || globalLimited) {
        return res.status(429).json({ error: 'Muitas inscrições em pouco tempo. Aguarde alguns minutos e tente novamente.' });
      }
      // Inscrição pública: sempre na edição vigente, sem poder de definir status/origem.
      req.body = { ...req.body, source: 'public', editionId: S.activeEditionId };
      req.query = {};
      return next();
    }
    if (publicRead || login) return next();
    // Chamada do Cloud Scheduler: autenticada pelo token próprio, conferido na rota
    // Leitura pelo Qlik Sense (REST Connector): autenticada pela chave BI_TOKEN, conferida na rota
    if (req.method === 'GET' && req.path === '/bi/designacoes') {
      if (rateLimited(`bi:${ip}`, 60, 60 * 60_000)) return res.status(429).json({ error: 'Muitas chamadas.' });
      return next();
    }
    if (req.method === 'POST' && req.path === '/backup/auto') {
      if (rateLimited(`autobackup:${ip}`, 10, 60 * 60_000)) return res.status(429).json({ error: 'Muitas chamadas.' });
      return next();
    }
    if (session) {
      // Perfis: Consulta só lê; Gestor opera o mutirão; Administrador também gere usuários, backup e exclusões em lote
      const adminOnly = /^\/(admin\/users|backup)/.test(req.path) || /\/delete-all$/.test(req.path) || /^\/editions\/[^/]+\/delete$/.test(req.path);
      const selfService = req.path === '/admin/me/password' || req.path === '/admin/me/tabs' || req.path === '/admin/logout' || req.path === '/admin/me' || req.path === '/admin/me/sessions/end-others';
      if (adminOnly && session.role !== 'admin') return res.status(403).json({ error: 'Ação restrita ao perfil Administrador.' });
      if (session.role === 'consulta' && req.method !== 'GET' && !selfService) return res.status(403).json({ error: 'Seu perfil é somente consulta.' });
      return next();
    }
    return res.status(401).json({ error: 'Acesso restrito à administração.' });
  });
  // Em requisições que alteram dados, grava antes de responder.
  app.use('/api', (req, res, next) => {
    // Consultas e a etapa 1 do login não alteram dados: só gravam se gerarem registro de segurança (res.locals.persist)
    const readOnlyPost = ['/status', '/admin/login', '/admin/logout'].includes(req.path);
    if (req.method !== 'GET') {
      const json = res.json.bind(res);
      res.json = (body: any) => {
        // Respostas de erro (4xx/5xx) não alteraram o estado: não há o que gravar (salvo registros de segurança)
        if ((res.statusCode >= 400 || readOnlyPost) && !res.locals.persist) return json(body);
        reconcileWithdrawals();
        saveState().then((ok) => {
          if (ok) return json(body);
          res.status(500);
          return json({ error: 'Falha ao gravar os dados. A operação será regravada automaticamente; confira o resultado em instantes.' });
        });
        return res;
      };
    }
    next();
  });

  // Rotas da API, na ordem de registro original
  registerAuth(app);
  registerUsers(app);
  registerEditions(app);
  registerFaq(app);
  registerPanel(app);
  registerStandardize(app);
  registerDuplicates(app);
  registerUnits(app);
  registerDashboard(app);
  registerCatalog(app);
  registerBi(app);
  registerBackup(app);
  registerLog(app);
  registerMagistrates(app);
  registerMatches(app);
  registerExports(app);

  if (process.env.NODE_ENV !== 'production') {
    // O Vite só existe como dependência de desenvolvimento: carregado sob demanda, nunca em produção.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  // No desligamento (ex.: publicação de nova versão) grava o que ainda estiver pendente
  process.on('SIGTERM', async () => {
    try { await Promise.race([saveState(), new Promise((r) => setTimeout(r, 8000))]); } finally { process.exit(0); }
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}
