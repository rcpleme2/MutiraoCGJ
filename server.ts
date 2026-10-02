import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import XLSX from 'xlsx';
import crypto from 'crypto';
import fs from 'fs';
import { Firestore } from '@google-cloud/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize Gemini SDK if API key is present
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    })
  : null;

type MagistrateStatus = 'Aguardando Conferência' | 'Aprovado' | 'Lista de Espera' | 'Atribuído' | 'Rejeitado';

interface Edition {
  id: string;
  title: string;
  description: string;
  openingDate: string;
  closingDate: string;
  isRegistrationOpen: boolean;
  status: 'Em andamento' | 'Encerrada';
  createdAt: string;
}

interface Magistrate {
  id: string;
  editionId: string;
  name: string;
  email: string;
  currentLocation: string;
  firstPreference: string;
  secondPreference: string;
  acceptsHearings: boolean;
  registeredIp?: string;
  /** Declaração de regularidade (120 dias / sanção / processo administrativo) aceita na inscrição pública */
  declaration?: boolean;
  rejectionReason?: string;
  rejectedAt?: string;
  createdAt: string;
  status: MagistrateStatus;
}

type UnitSelection = 'Em análise' | 'Escolhida' | 'Rejeitada';
type WorkType = 'Audiência' | 'Sentença' | 'Audiência e Sentença';
const WORK_TYPES: WorkType[] = ['Audiência', 'Sentença', 'Audiência e Sentença'];

interface Unit {
  id: string;
  editionId: string;
  unitName: string;
  judgeName: string;
  email: string;
  comarca: string;
  areas: string[];
  supportNeeded: 'Audiência' | 'Sentença' | 'Audiência e Sentença';
  description: string;
  registeredIp?: string;
  createdAt: string;
  /** Atendimento: Pendente (sem magistrado), Atendida (vinculada) ou Em Andamento */
  status: 'Pendente' | 'Atendida' | 'Em Andamento';
  /** Triagem da administração: só unidades "Escolhida" entram na vinculação */
  selection: UnitSelection;
  rejectionReason?: string;
  rejectedAt?: string;
}

interface Match {
  id: string;
  editionId: string;
  magistrateId: string;
  unitId: string;
  assignedArea: string;
  /** O que o magistrado fará na unidade: audiências, sentenças ou ambos */
  workType: WorkType;
  /** Preenchido quando a unidade já tinha outro magistrado: vinculação adicional, em caráter excepcional */
  exceptionReason?: string;
  status: 'Vinculado' | 'Concluído';
  createdAt: string;
}

type LogCategory = 'Edição' | 'Magistrado' | 'Unidade' | 'Vinculação' | 'Exportação' | 'Acesso';

interface LogEntry {
  id: string;
  editionId: string | null;
  timestamp: string;
  actor: 'Administração' | 'Público' | 'Sistema';
  category: LogCategory;
  description: string;
}

// Senha administrativa: defina ADMIN_PASSWORD nos Secrets do AI Studio.
// Sem ela, uma senha aleatória é gerada e exibida no console do servidor a cada inicialização.
let adminPassword = process.env.ADMIN_PASSWORD || '';
if (!adminPassword) {
  adminPassword = crypto.randomBytes(9).toString('base64url');
  console.warn(`[SEGURANÇA] ADMIN_PASSWORD não definida. Senha temporária gerada: ${adminPassword}`);
}

// Sessões administrativas (token opaco, expira em 8h)
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map<string, number>();
const hasValidToken = (req: express.Request) => {
  const token = req.header('x-admin-token');
  const exp = token ? sessions.get(token) : undefined;
  if (!token || !exp) return false;
  if (exp < Date.now()) { sessions.delete(token); return false; }
  return true;
};

// Limitador simples por IP (tentativas de login e consultas por e-mail)
const hits = new Map<string, number[]>();
const rateLimited = (key: string, max: number, windowMs: number) => {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
};

// Persistência em arquivo (o container do AI Studio pode reiniciar)
const DATA_FILE = path.join(process.cwd(), 'data', 'state.json');

let editions: Edition[] = [
  {
    id: 'ed-1',
    title: 'Mutirão de Julgamento TJPR - 2026',
    description: 'Mutirão focado na redução do acervo processual e cumprimento das metas do CNJ em unidades de todo o estado.',
    openingDate: '2026-04-01T08:00',
    closingDate: '2026-05-15T23:59',
    isRegistrationOpen: true,
    status: 'Em andamento',
    createdAt: '2026-03-20T09:00:00Z',
  },
];
let activeEditionId = 'ed-1';

let magistrates: Magistrate[] = [
  {
    id: 'mag-1',
    editionId: 'ed-1',
    name: 'Dra. Ana Paula Silveira',
    email: 'ana.silveira@tjp.jus.br',
    currentLocation: '1ª Vara Cível da Comarca de Curitiba',
    firstPreference: 'Cível e Fazenda Pública',
    secondPreference: 'Família e Infância',
    acceptsHearings: true,
    createdAt: '2026-04-02T10:15:00Z',
    status: 'Aprovado',
  },
  {
    id: 'mag-2',
    editionId: 'ed-1',
    name: 'Dr. Carlos Eduardo Mendes',
    email: 'carlos.mendes@tjp.jus.br',
    currentLocation: '3ª Vara Criminal da Comarca de Londrina',
    firstPreference: 'Crime',
    secondPreference: 'Juizado Cível, Crime e Fazenda Pública',
    acceptsHearings: false,
    createdAt: '2026-04-03T14:20:00Z',
    status: 'Aguardando Conferência',
  },
  {
    id: 'mag-3',
    editionId: 'ed-1',
    name: 'Dra. Beatriz de Souza Lima',
    email: 'beatriz.lima@tjp.jus.br',
    currentLocation: '2ª Vara de Família e Sucessões de Maringá',
    firstPreference: 'Família e Infância',
    secondPreference: 'Cível e Fazenda Pública',
    acceptsHearings: true,
    createdAt: '2026-04-04T09:30:00Z',
    status: 'Atribuído',
  },
];

let units: Unit[] = [
  {
    id: 'unit-1',
    editionId: 'ed-1',
    unitName: 'Vara do Juizado Especial Cível e Criminal - Comarca de Cascavel',
    judgeName: 'Dr. Roberto Sampaio',
    email: 'cascavel.jecc@tjp.jus.br',
    comarca: 'Cascavel',
    areas: ['Juizado Cível, Crime e Fazenda Pública', 'Crime'],
    supportNeeded: 'Audiência e Sentença',
    description: 'Acervo elevado de processos conclusos para sentença há mais de 100 dias.',
    createdAt: '2026-04-02T11:00:00Z',
    status: 'Pendente',
    selection: 'Escolhida',
  },
  {
    id: 'unit-2',
    editionId: 'ed-1',
    unitName: '2ª Vara Cível da Comarca de Ponta Grossa',
    judgeName: 'Dra. Fernanda Vasconcelos',
    email: 'pg.2civel@tjp.jus.br',
    comarca: 'Ponta Grossa',
    areas: ['Cível e Fazenda Pública'],
    supportNeeded: 'Sentença',
    description: 'Demanda reprimida em execuções fiscais e ações de cobrança.',
    createdAt: '2026-04-03T16:45:00Z',
    status: 'Pendente',
    selection: 'Escolhida',
  },
  {
    id: 'unit-3',
    editionId: 'ed-1',
    unitName: 'Vara da Infância e da Juventude - Comarca de Maringá',
    judgeName: 'Dr. Lucas Ribeiro',
    email: 'beatriz.lima@tjp.jus.br',
    comarca: 'Maringá',
    areas: ['Família e Infância'],
    supportNeeded: 'Audiência',
    description: 'Necessidade de mutirão em audiências concentradas e medidas protetivas.',
    createdAt: '2026-04-04T11:10:00Z',
    status: 'Atendida',
    selection: 'Escolhida',
  },
];

let matches: Match[] = [
  {
    id: 'match-1',
    editionId: 'ed-1',
    magistrateId: 'mag-3',
    unitId: 'unit-3',
    assignedArea: 'Família e Infância',
    workType: 'Audiência',
    status: 'Vinculado',
    createdAt: '2026-04-04T14:00:00Z',
  },
];

let activityLog: LogEntry[] = [
  {
    id: 'log-seed-1',
    editionId: 'ed-1',
    timestamp: '2026-03-20T09:00:00Z',
    actor: 'Sistema',
    category: 'Edição',
    description: 'Edição "Mutirão de Julgamento TJPR - 2026" criada.',
  },
];

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now()}-${(idCounter++).toString(36)}`;

function log(
  editionId: string | null,
  actor: LogEntry['actor'],
  category: LogCategory,
  description: string,
) {
  activityLog.unshift({
    id: newId('log'),
    editionId,
    timestamp: new Date().toISOString(),
    actor,
    category,
    description,
  });
  if (activityLog.length > 5000) activityLog.length = 5000;
}

const clientIp = (req: express.Request) => (req.ip || 'desconhecido').replace(/^::ffff:/, '');

/** Modalidade padrão da vinculação, conforme o auxílio pedido pela unidade e a disposição do magistrado */
const defaultWorkType = (unit: Unit, mag: Magistrate): WorkType => {
  if (unit.supportNeeded === 'Audiência' || unit.supportNeeded === 'Sentença') return unit.supportNeeded;
  return mag.acceptsHearings ? 'Audiência e Sentença' : 'Sentença';
};

/** Atendimento da unidade conforme as vinculações existentes (regra: 1 magistrado; exceção: mais de um). */
function refreshUnitStatus(unitId: string) {
  const unit = units.find((u) => u.id === unitId);
  if (!unit) return;
  if (matches.some((m) => m.unitId === unitId)) unit.status = 'Atendida';
  else if (unit.status === 'Atendida') unit.status = 'Pendente';
}

/** Dados gravados antes de existirem a triagem de unidades e a modalidade recebem valores coerentes */
function normalizeLegacy() {
  units.forEach((u) => { if (!u.selection) u.selection = 'Escolhida'; });
  matches.forEach((m) => {
    if (!m.workType) {
      const u = units.find((x) => x.id === m.unitId);
      const g = magistrates.find((x) => x.id === m.magistrateId);
      m.workType = u && g ? defaultWorkType(u, g) : 'Sentença';
    }
  });
}

/** Exclusões em lote exigem confirmação explícita no corpo da requisição (proteção contra chamadas acidentais). */
const confirmedWipe = (req: express.Request) => req.body?.confirm === 'EXCLUIR';

const actorOf = (source: unknown): LogEntry['actor'] => (source === 'admin' ? 'Administração' : 'Público');

const editionById = (id: string | undefined) => editions.find((e) => e.id === id);

/** Resolves the edition targeted by a request (?edition=, body.editionId) or falls back to the active one. */
function resolveEdition(req: express.Request): Edition | undefined {
  const id = (req.query.edition as string) || req.body?.editionId || activeEditionId;
  return editionById(id);
}

const publicEdition = (e: Edition) => ({ ...e, isActive: e.id === activeEditionId });

function editionStats(e: Edition) {
  const mags = magistrates.filter((m) => m.editionId === e.id);
  const us = units.filter((u) => u.editionId === e.id);
  const ms = matches.filter((m) => m.editionId === e.id);
  return {
    magistrates: mags.length,
    units: us.length,
    matches: ms.length,
    waiting: mags.filter((m) => m.status !== 'Atribuído' && m.status !== 'Rejeitado').length,
    pendingUnits: us.filter((u) => u.selection === 'Escolhida' && u.status === 'Pendente').length,
  };
}

// Neutraliza injeção de fórmulas em planilhas (=, +, -, @) e escapa aspas
const csvCell = (v: unknown) => {
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
};

// ---------- Persistência ----------
// No Cloud Run (K_SERVICE definido) ou com USE_FIRESTORE=true, o estado é gravado no Firestore,
// um documento por registro. Em desenvolvimento local, usa o arquivo data/state.json.
const db = process.env.K_SERVICE || process.env.USE_FIRESTORE === 'true'
  ? new Firestore({ ignoreUndefinedProperties: true })
  : null;
const PREFIX = 'mutirao_';
const lastSaved = new Map<string, Map<string, string>>();
let lastMeta = '';

const collectionsNow = (): Record<string, { id: string }[]> => ({
  editions, magistrates, units, matches, log: activityLog,
});

async function loadState() {
  if (!db) {
    try {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      editions = raw.editions ?? editions;
      activeEditionId = raw.activeEditionId ?? activeEditionId;
      magistrates = raw.magistrates ?? magistrates;
      units = raw.units ?? units;
      matches = raw.matches ?? matches;
      activityLog = raw.activityLog ?? activityLog;
    } catch { /* primeira execução: usa os dados iniciais */ }
    return;
  }

  const loaded: Record<string, any[]> = {};
  for (const name of Object.keys(collectionsNow())) {
    const snap = await db.collection(PREFIX + name).get();
    loaded[name] = snap.docs.map((d) => d.data());
    lastSaved.set(name, new Map(loaded[name].map((i) => [i.id, JSON.stringify(i)])));
  }
  const meta = (await db.collection(PREFIX + 'meta').doc('state').get()).data();

  if (loaded.editions.length === 0) {
    // Primeira execução em produção: mantém só a edição inicial, sem os dados fictícios de demonstração.
    if (process.env.SEED_DEMO !== 'true') {
      magistrates = []; units = []; matches = [];
    }
    console.log('[Firestore] Base vazia: iniciando com a edição padrão.');
    return;
  }
  editions = loaded.editions as Edition[];
  magistrates = loaded.magistrates as Magistrate[];
  units = loaded.units as Unit[];
  matches = loaded.matches as Match[];
  activityLog = (loaded.log as LogEntry[]).sort((x, y) => y.timestamp.localeCompare(x.timestamp));
  activeEditionId = meta?.activeEditionId ?? editions[0].id;
  lastMeta = JSON.stringify({ activeEditionId });
}

async function persist() {
  if (!db) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ editions, activeEditionId, magistrates, units, matches, activityLog }),
    );
    return;
  }

  // Grava apenas o que mudou desde a última gravação (diff por registro).
  type Op = { kind: 'set' | 'del'; ref: FirebaseFirestore.DocumentReference; data?: any };
  const ops: Op[] = [];
  const nextSaved = new Map<string, Map<string, string>>();

  for (const [name, items] of Object.entries(collectionsNow())) {
    const prev = lastSaved.get(name) ?? new Map<string, string>();
    const next = new Map<string, string>();
    const col = db.collection(PREFIX + name);
    for (const item of items) {
      const json = JSON.stringify(item);
      next.set(item.id, json);
      if (prev.get(item.id) !== json) ops.push({ kind: 'set', ref: col.doc(item.id), data: JSON.parse(json) });
    }
    for (const id of prev.keys()) if (!next.has(id)) ops.push({ kind: 'del', ref: col.doc(id) });
    nextSaved.set(name, next);
  }
  const meta = JSON.stringify({ activeEditionId });
  if (meta !== lastMeta) ops.push({ kind: 'set', ref: db.collection(PREFIX + 'meta').doc('state'), data: JSON.parse(meta) });

  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + 400)) {
      if (op.kind === 'set') batch.set(op.ref, op.data); else batch.delete(op.ref);
    }
    await batch.commit();
  }
  nextSaved.forEach((v, k) => lastSaved.set(k, v));
  lastMeta = meta;
}

// Gravações são serializadas; a resposta HTTP só sai depois de gravar
// (no Cloud Run a CPU pode ser reduzida logo após a resposta).
let saving: Promise<void> = Promise.resolve();
function saveState(): Promise<void> {
  saving = saving.then(persist).catch((err) => console.error('Falha ao persistir estado:', err));
  return saving;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  await loadState();
  normalizeLegacy();
  app.set('trust proxy', 1); // Cloud Run: IP real do cliente para o limitador

  // Proteção das rotas: somente o necessário é público; o resto exige sessão administrativa.
  app.use('/api', (req, res, next) => {
    const ip = req.ip || 'unknown';
    const admin = hasValidToken(req);
    const publicRead = req.method === 'GET' && ['/settings', '/status', '/whoami'].includes(req.path);
    const publicSignup = req.method === 'POST' && (req.path === '/magistrates' || req.path === '/units');
    const login = req.method === 'POST' && req.path === '/admin/login';

    if (req.path === '/status' && rateLimited(`status:${ip}`, 30, 60_000)) {
      return res.status(429).json({ error: 'Muitas consultas. Aguarde um instante.' });
    }
    if (publicSignup && !admin) {
      // Inscrição pública: sempre na edição vigente, sem poder de definir status/origem.
      req.body = { ...req.body, source: 'public', editionId: activeEditionId };
      req.query = {};
      return next();
    }
    if (publicRead || login || admin) {
      return next();
    }
    return res.status(401).json({ error: 'Acesso restrito à administração.' });
  });
  // Em requisições que alteram dados, grava antes de responder.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET') {
      const json = res.json.bind(res);
      res.json = (body: any) => { saveState().finally(() => json(body)); return res; };
    }
    next();
  });

  // ---------- Admin auth ----------
  app.post('/api/admin/login', (req, res) => {
    if (rateLimited(`login:${req.ip}`, 8, 10 * 60_000)) {
      return res.status(429).json({ success: false, message: 'Muitas tentativas. Tente novamente em alguns minutos.' });
    }
    const given = Buffer.from(String(req.body?.password ?? ''));
    const expected = Buffer.from(adminPassword);
    const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
    if (ok) {
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, Date.now() + SESSION_TTL_MS);
      log(null, 'Administração', 'Acesso', 'Acesso ao painel administrativo.');
      res.json({ success: true, token });
    } else {
      res.status(401).json({ success: false, message: 'Senha administrativa incorreta.' });
    }
  });

  app.post('/api/admin/password', (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (currentPassword !== adminPassword) {
      return res.status(401).json({ error: 'Senha atual incorreta.' });
    }
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'A nova senha deve ter ao menos 6 caracteres.' });
    }
    adminPassword = String(newPassword);
    log(null, 'Administração', 'Acesso', 'Senha administrativa alterada.');
    res.json({ success: true });
  });

  // ---------- Editions ----------
  // IP do solicitante (exibido no formulário público e registrado na inscrição)
  app.get('/api/whoami', (req, res) => res.json({ ip: clientIp(req) }));

  // Public settings: the active edition (kept shape-compatible with the former /api/settings).
  app.get('/api/settings', (_req, res) => {
    const active = editionById(activeEditionId) || editions[0];
    res.json(active ? publicEdition(active) : null);
  });

  app.get('/api/editions', (_req, res) => {
    const list = [...editions]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((e) => ({ ...publicEdition(e), stats: editionStats(e) }));
    res.json({ activeEditionId, editions: list });
  });

  app.post('/api/editions', (req, res) => {
    const { title, description, openingDate, closingDate, activate } = req.body || {};
    if (!title || !openingDate || !closingDate) {
      return res.status(400).json({ error: 'Informe título, abertura e encerramento da edição.' });
    }
    const edition: Edition = {
      id: newId('ed'),
      title,
      description: description || '',
      openingDate,
      closingDate,
      isRegistrationOpen: true,
      status: 'Em andamento',
      createdAt: new Date().toISOString(),
    };
    editions.push(edition);
    log(edition.id, 'Administração', 'Edição', `Edição "${edition.title}" criada.`);
    if (activate) {
      activeEditionId = edition.id;
      log(edition.id, 'Administração', 'Edição', 'Edição definida como a vigente para inscrições públicas.');
    }
    res.status(201).json({ success: true, edition: publicEdition(edition) });
  });

  app.put('/api/editions/:id', (req, res) => {
    const edition = editionById(req.params.id);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });

    const { title, description, openingDate, closingDate, isRegistrationOpen } = req.body || {};
    const changes: string[] = [];
    if (title && title !== edition.title) { changes.push(`título para "${title}"`); edition.title = title; }
    if (description !== undefined && description !== edition.description) { changes.push('descrição'); edition.description = description; }
    if (openingDate && openingDate !== edition.openingDate) { changes.push('data de abertura'); edition.openingDate = openingDate; }
    if (closingDate && closingDate !== edition.closingDate) { changes.push('data de encerramento'); edition.closingDate = closingDate; }
    if (typeof isRegistrationOpen === 'boolean' && isRegistrationOpen !== edition.isRegistrationOpen) {
      edition.isRegistrationOpen = isRegistrationOpen;
      changes.push(isRegistrationOpen ? 'inscrições reabertas' : 'inscrições encerradas');
    }
    if (changes.length) {
      log(edition.id, 'Administração', 'Edição', `Edição atualizada: ${changes.join(', ')}.`);
    }
    res.json({ success: true, edition: publicEdition(edition) });
  });

  app.post('/api/editions/:id/activate', (req, res) => {
    const edition = editionById(req.params.id);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });
    activeEditionId = edition.id;
    log(edition.id, 'Administração', 'Edição', 'Edição definida como a vigente para inscrições públicas.');
    res.json({ success: true });
  });

  app.post('/api/editions/:id/close', (req, res) => {
    const edition = editionById(req.params.id);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });
    edition.status = 'Encerrada';
    edition.isRegistrationOpen = false;
    log(edition.id, 'Administração', 'Edição', 'Edição encerrada. Inscrições fechadas.');
    res.json({ success: true, edition: publicEdition(edition) });
  });

  app.post('/api/editions/:id/reopen', (req, res) => {
    const edition = editionById(req.params.id);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });
    edition.status = 'Em andamento';
    log(edition.id, 'Administração', 'Edição', 'Edição reaberta (em andamento).');
    res.json({ success: true, edition: publicEdition(edition) });
  });

  // ---------- Activity log ----------
  app.get('/api/log', (req, res) => {
    const edition = (req.query.edition as string) || '';
    const list = edition
      ? activityLog.filter((l) => l.editionId === edition || l.editionId === null)
      : activityLog;
    res.json(list.slice(0, 500));
  });

  // ---------- Magistrates ----------
  app.get('/api/magistrates', (req, res) => {
    const edition = resolveEdition(req);
    res.json(edition ? magistrates.filter((m) => m.editionId === edition.id) : []);
  });

  // Public consultation across all editions
  app.get('/api/status', (req, res) => {
    const emailQuery = ((req.query.email as string) || '').trim().toLowerCase();
    if (!emailQuery) {
      return res.status(400).json({ error: 'Informe o e-mail cadastrado.' });
    }

    const matchedMagistrates = magistrates.filter((m) => m.email.toLowerCase() === emailQuery);
    const matchedUnits = units.filter((u) => u.email.toLowerCase() === emailQuery);

    if (matchedMagistrates.length === 0 && matchedUnits.length === 0) {
      return res.status(404).json({ error: 'Nenhum cadastro encontrado com este e-mail.' });
    }

    const titleOf = (id: string) => editionById(id)?.title || '';

    res.json({
      magistrates: matchedMagistrates.map((mag) => {
        const match = matches.find((m) => m.magistrateId === mag.id);
        const assignedUnit = match ? units.find((u) => u.id === match.unitId) || null : null;
        // O motivo da rejeição é de uso interno e não é exposto na consulta pública
        const { rejectionReason: _reason, rejectedAt: _rejectedAt, ...publicMag } = mag;
        return {
          ...publicMag,
          editionTitle: titleOf(mag.editionId),
          match: match ? { ...match, unit: assignedUnit } : null,
        };
      }),
      units: matchedUnits.map((u) => {
        const { rejectionReason: _r, rejectedAt: _a, ...publicUnit } = u;
        return { ...publicUnit, editionTitle: titleOf(u.editionId) };
      }),
    });
  });

  app.post('/api/magistrates', (req, res) => {
    const { name, email, currentLocation, firstPreference, secondPreference, acceptsHearings, declaration, status, source } = req.body;
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });
    if (!name || !email || !currentLocation || !firstPreference) {
      return res.status(400).json({ error: 'Preencha todos os campos obrigatórios do magistrado.' });
    }
    if (source !== 'admin' && (!edition.isRegistrationOpen || edition.status === 'Encerrada')) {
      return res.status(403).json({ error: 'As inscrições desta edição estão encerradas.' });
    }
    if (secondPreference && secondPreference === firstPreference) {
      return res.status(400).json({ error: 'A 2ª escolha não pode ser igual à 1ª escolha.' });
    }
    if (source !== 'admin' && declaration !== true) {
      return res.status(400).json({ error: 'É necessário aceitar a declaração de regularidade para concluir a inscrição.' });
    }
    if (magistrates.some((m) => m.editionId === edition.id && m.email.toLowerCase() === String(email).trim().toLowerCase())) {
      return res.status(409).json({ error: 'Já existe uma inscrição de magistrado com este e-mail nesta edição.' });
    }

    const newMag: Magistrate = {
      id: newId('mag'),
      editionId: edition.id,
      name,
      email: String(email).trim(),
      currentLocation,
      firstPreference,
      secondPreference: secondPreference || '',
      acceptsHearings: acceptsHearings === true,
      registeredIp: source === 'admin' ? undefined : clientIp(req),
      declaration: source === 'admin' ? undefined : true,
      createdAt: new Date().toISOString(),
      status: source === 'admin' && status && status !== 'Rejeitado' && status !== 'Atribuído' ? status : 'Aguardando Conferência',
    };

    magistrates.unshift(newMag);
    log(edition.id, actorOf(source), 'Magistrado', `Inscrição de ${newMag.name} (${newMag.currentLocation}) registrada${newMag.registeredIp ? ` (IP ${newMag.registeredIp})` : ''}${newMag.declaration ? ' com declaração de regularidade' : ''}.`);
    res.status(201).json({ success: true, magistrate: newMag });
  });

  app.put('/api/magistrates/:id', (req, res) => {
    const mag = magistrates.find((m) => m.id === req.params.id);
    if (!mag) return res.status(404).json({ error: 'Magistrado não encontrado.' });

    const b = req.body || {};
    const next = {
      name: String(b.name ?? mag.name).trim(),
      email: String(b.email ?? mag.email).trim(),
      currentLocation: String(b.currentLocation ?? mag.currentLocation).trim(),
      firstPreference: String(b.firstPreference ?? mag.firstPreference),
      secondPreference: String(b.secondPreference ?? mag.secondPreference),
      acceptsHearings: typeof b.acceptsHearings === 'boolean' ? b.acceptsHearings : mag.acceptsHearings,
    };
    if (!next.name || !next.email || !next.currentLocation || !next.firstPreference) {
      return res.status(400).json({ error: 'Preencha todos os campos obrigatórios do magistrado.' });
    }
    if (next.secondPreference && next.secondPreference === next.firstPreference) {
      return res.status(400).json({ error: 'A 2ª escolha não pode ser igual à 1ª escolha.' });
    }
    if (magistrates.some((m) => m.id !== mag.id && m.editionId === mag.editionId && m.email.toLowerCase() === next.email.toLowerCase())) {
      return res.status(409).json({ error: 'Já existe outra inscrição de magistrado com este e-mail nesta edição.' });
    }

    const labels: Record<string, string> = {
      name: 'nome', email: 'e-mail', currentLocation: 'lotação', firstPreference: '1ª preferência',
      secondPreference: '2ª preferência', acceptsHearings: 'aceita audiências',
    };
    const changed = (Object.keys(next) as (keyof typeof next)[])
      .filter((k) => next[k] !== mag[k])
      .map((k) => labels[k]);
    Object.assign(mag, next);

    // Status: coerente com a existência de vinculação
    const isMatched = matches.some((m) => m.magistrateId === mag.id);
    const wanted: MagistrateStatus | undefined = b.status;
    const before = mag.status;
    if (isMatched) mag.status = 'Atribuído';
    else if (mag.status === 'Rejeitado' && (!wanted || wanted === 'Rejeitado')) { /* mantém rejeitado */ }
    else if (wanted && wanted !== 'Atribuído' && wanted !== 'Rejeitado') mag.status = wanted;
    else if (mag.status === 'Atribuído') mag.status = 'Lista de Espera';
    if (before === 'Rejeitado' && mag.status !== 'Rejeitado') { mag.rejectionReason = undefined; mag.rejectedAt = undefined; }
    if (mag.status !== before) changed.push(`status (${before} → ${mag.status})`);

    if (changed.length) {
      log(mag.editionId, 'Administração', 'Magistrado', `Inscrição de ${mag.name} editada: ${changed.join(', ')}.`);
    }
    res.json({ success: true, magistrate: mag });
  });

  // ---------- Exclusão em lote (somente a edição indicada; exige confirm: "EXCLUIR") ----------
  app.post('/api/magistrates/delete-all', (req, res) => {
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });
    if (!confirmedWipe(req)) return res.status(400).json({ error: 'Confirmação ausente.' });

    const ids = new Set(magistrates.filter((m) => m.editionId === edition.id).map((m) => m.id));
    const freedUnits = matches.filter((m) => ids.has(m.magistrateId)).map((m) => m.unitId);
    const removedMatches = freedUnits.length;
    magistrates = magistrates.filter((m) => !ids.has(m.id));
    matches = matches.filter((m) => !ids.has(m.magistrateId));
    freedUnits.forEach(refreshUnitStatus);
    log(edition.id, 'Administração', 'Magistrado',
      `EXCLUSÃO EM LOTE: ${ids.size} inscrição(ões) de magistrado(s) excluída(s)${removedMatches ? `, com ${removedMatches} vinculação(ões)` : ''}.`);
    res.json({ success: true, count: ids.size, removedMatches });
  });

  app.post('/api/units/delete-all', (req, res) => {
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });
    if (!confirmedWipe(req)) return res.status(400).json({ error: 'Confirmação ausente.' });

    const ids = new Set(units.filter((u) => u.editionId === edition.id).map((u) => u.id));
    const removed = matches.filter((m) => ids.has(m.unitId));
    removed.forEach((m) => {
      const g = magistrates.find((x) => x.id === m.magistrateId);
      if (g) g.status = 'Lista de Espera';
    });
    units = units.filter((u) => !ids.has(u.id));
    matches = matches.filter((m) => !ids.has(m.unitId));
    log(edition.id, 'Administração', 'Unidade',
      `EXCLUSÃO EM LOTE: ${ids.size} unidade(s) excluída(s)${removed.length ? `, com ${removed.length} vinculação(ões)` : ''}.`);
    res.json({ success: true, count: ids.size, removedMatches: removed.length });
  });

  app.post('/api/matches/delete-all', (req, res) => {
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });
    if (!confirmedWipe(req)) return res.status(400).json({ error: 'Confirmação ausente.' });

    const removed = matches.filter((m) => m.editionId === edition.id);
    removed.forEach((m) => {
      const g = magistrates.find((x) => x.id === m.magistrateId);
      if (g && g.status === 'Atribuído') g.status = 'Lista de Espera';
    });
    matches = matches.filter((m) => m.editionId !== edition.id);
    units.filter((u) => u.editionId === edition.id).forEach((u) => refreshUnitStatus(u.id));
    log(edition.id, 'Administração', 'Vinculação', `EXCLUSÃO EM LOTE: ${removed.length} vinculação(ões) desfeita(s).`);
    res.json({ success: true, count: removed.length });
  });

  // Aprova em lote todas as inscrições pendentes (Aguardando Conferência) da edição. Rejeitadas não são alteradas.
  app.post('/api/magistrates/approve-all', (req, res) => {
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });
    const pending = magistrates.filter((m) => m.editionId === edition.id && m.status === 'Aguardando Conferência');
    pending.forEach((m) => {
      m.status = matches.some((x) => x.magistrateId === m.id) ? 'Atribuído' : 'Lista de Espera';
    });
    if (pending.length) {
      log(edition.id, 'Administração', 'Magistrado', `Aprovação em lote: ${pending.length} inscrição(ões) de magistrado(s) aprovada(s).`);
    }
    res.json({ success: true, count: pending.length });
  });

  app.post('/api/magistrates/:id/approve', (req, res) => {
    const mag = magistrates.find((m) => m.id === req.params.id);
    if (!mag) return res.status(404).json({ error: 'Magistrado não encontrado.' });

    const isMatched = matches.some((m) => m.magistrateId === mag.id);
    const wasRejected = mag.status === 'Rejeitado';
    mag.status = isMatched ? 'Atribuído' : 'Lista de Espera';
    mag.rejectionReason = undefined;
    mag.rejectedAt = undefined;
    log(mag.editionId, 'Administração', 'Magistrado', `Inscrição de ${mag.name} ${wasRejected ? 'reconsiderada e aprovada' : 'aprovada'}.`);
    res.json({ success: true, magistrate: mag });
  });

  app.post('/api/magistrates/:id/reject', (req, res) => {
    const mag = magistrates.find((m) => m.id === req.params.id);
    if (!mag) return res.status(404).json({ error: 'Magistrado não encontrado.' });
    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) return res.status(400).json({ error: 'Informe o motivo da rejeição.' });

    // Se havia vinculação, ela é desfeita (a unidade só volta a ficar pendente se não restar outro magistrado)
    const hadMatch = matches.some((m) => m.magistrateId === mag.id);
    const freedUnits = matches.filter((m) => m.magistrateId === mag.id).map((m) => m.unitId);
    matches = matches.filter((m) => m.magistrateId !== mag.id);
    freedUnits.forEach(refreshUnitStatus);

    mag.status = 'Rejeitado';
    mag.rejectionReason = reason;
    mag.rejectedAt = new Date().toISOString();
    log(mag.editionId, 'Administração', 'Magistrado',
      `Inscrição de ${mag.name} rejeitada${hadMatch ? ' (vinculação desfeita)' : ''}. Motivo: ${reason}`);
    res.json({ success: true, magistrate: mag });
  });

  app.delete('/api/magistrates/:id', (req, res) => {
    const { id } = req.params;
    const mag = magistrates.find((m) => m.id === id);
    if (mag) {
      log(mag.editionId, 'Administração', 'Magistrado', `Inscrição de ${mag.name} excluída.`);
    }
    const freedUnits = matches.filter((m) => m.magistrateId === id).map((m) => m.unitId);
    magistrates = magistrates.filter((m) => m.id !== id);
    matches = matches.filter((m) => m.magistrateId !== id);
    freedUnits.forEach(refreshUnitStatus);
    res.json({ success: true, id });
  });

  // ---------- Units ----------
  app.get('/api/units', (req, res) => {
    const edition = resolveEdition(req);
    res.json(edition ? units.filter((u) => u.editionId === edition.id) : []);
  });

  app.post('/api/units', (req, res) => {
    const { unitName, judgeName, email, comarca, areas, supportNeeded, description, source } = req.body;
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });
    if (!unitName || !judgeName || !email || !comarca || !areas || !areas.length) {
      return res.status(400).json({ error: 'Preencha todos os campos obrigatórios da unidade judicial.' });
    }
    if (source !== 'admin' && (!edition.isRegistrationOpen || edition.status === 'Encerrada')) {
      return res.status(403).json({ error: 'As inscrições desta edição estão encerradas.' });
    }

    const newUnit: Unit = {
      id: newId('unit'),
      editionId: edition.id,
      unitName,
      judgeName,
      email: String(email).trim(),
      comarca,
      areas,
      supportNeeded: ['Audiência', 'Sentença', 'Audiência e Sentença'].includes(supportNeeded) ? supportNeeded : 'Sentença',
      description: description || '',
      registeredIp: source === 'admin' ? undefined : clientIp(req),
      createdAt: new Date().toISOString(),
      status: 'Pendente',
      selection: source === 'admin' ? 'Escolhida' : 'Em análise',
    };

    units.unshift(newUnit);
    log(edition.id, actorOf(source), 'Unidade', `Inscrição da unidade "${newUnit.unitName}" (${newUnit.comarca}) registrada${newUnit.registeredIp ? ` (IP ${newUnit.registeredIp})` : ''}.`);
    res.status(201).json({ success: true, unit: newUnit });
  });

  // Escolhe em lote todas as unidades em análise da edição. Rejeitadas não são alteradas.
  app.post('/api/units/choose-all', (req, res) => {
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });
    const pending = units.filter((u) => u.editionId === edition.id && u.selection === 'Em análise');
    pending.forEach((u) => { u.selection = 'Escolhida'; });
    if (pending.length) {
      log(edition.id, 'Administração', 'Unidade', `Escolha em lote: ${pending.length} unidade(s) escolhida(s) para o mutirão.`);
    }
    res.json({ success: true, count: pending.length });
  });

  app.post('/api/units/:id/choose', (req, res) => {
    const unit = units.find((u) => u.id === req.params.id);
    if (!unit) return res.status(404).json({ error: 'Unidade não encontrada.' });
    const was = unit.selection;
    unit.selection = 'Escolhida';
    unit.rejectionReason = undefined;
    unit.rejectedAt = undefined;
    log(unit.editionId, 'Administração', 'Unidade',
      `Unidade "${unit.unitName}" ${was === 'Rejeitada' ? 'reconsiderada e escolhida' : 'escolhida'} para o mutirão.`);
    res.json({ success: true, unit });
  });

  app.post('/api/units/:id/reject', (req, res) => {
    const unit = units.find((u) => u.id === req.params.id);
    if (!unit) return res.status(404).json({ error: 'Unidade não encontrada.' });
    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) return res.status(400).json({ error: 'Informe o motivo da rejeição.' });

    // Se havia magistrado vinculado, a vinculação é desfeita e ele volta à lista de espera
    const linked = matches.filter((m) => m.unitId === unit.id);
    linked.forEach((m) => {
      const g = magistrates.find((x) => x.id === m.magistrateId);
      if (g) g.status = 'Lista de Espera';
    });
    matches = matches.filter((m) => m.unitId !== unit.id);

    unit.selection = 'Rejeitada';
    unit.status = 'Pendente';
    unit.rejectionReason = reason;
    unit.rejectedAt = new Date().toISOString();
    log(unit.editionId, 'Administração', 'Unidade',
      `Unidade "${unit.unitName}" rejeitada${linked.length ? ' (vinculação desfeita)' : ''}. Motivo: ${reason}`);
    res.json({ success: true, unit });
  });

  app.put('/api/units/:id', (req, res) => {
    const unit = units.find((u) => u.id === req.params.id);
    if (!unit) return res.status(404).json({ error: 'Unidade não encontrada.' });

    const b = req.body || {};
    const next = {
      unitName: String(b.unitName ?? unit.unitName).trim(),
      judgeName: String(b.judgeName ?? unit.judgeName).trim(),
      email: String(b.email ?? unit.email).trim(),
      comarca: String(b.comarca ?? unit.comarca).trim(),
      areas: Array.isArray(b.areas) && b.areas.length ? b.areas.map(String) : unit.areas,
      supportNeeded: ['Audiência', 'Sentença', 'Audiência e Sentença'].includes(b.supportNeeded) ? b.supportNeeded : unit.supportNeeded,
      description: String(b.description ?? unit.description),
    };
    if (!next.unitName || !next.judgeName || !next.email || !next.comarca) {
      return res.status(400).json({ error: 'Preencha todos os campos obrigatórios da unidade judicial.' });
    }

    const labels: Record<string, string> = {
      unitName: 'unidade', judgeName: 'responsável', email: 'e-mail', comarca: 'comarca',
      areas: 'áreas', supportNeeded: 'auxílio necessário', description: 'justificativa',
    };
    const changed = (Object.keys(next) as (keyof typeof next)[])
      .filter((k) => JSON.stringify(next[k]) !== JSON.stringify(unit[k]))
      .map((k) => labels[k]);
    Object.assign(unit, next);

    const isMatched = matches.some((m) => m.unitId === unit.id);
    const wanted = b.status as Unit['status'] | undefined;
    const before = unit.status;
    if (isMatched) unit.status = 'Atendida';
    else if (wanted && wanted !== 'Atendida') unit.status = wanted;
    else if (unit.status === 'Atendida') unit.status = 'Pendente';
    if (unit.status !== before) changed.push(`status (${before} → ${unit.status})`);

    if (changed.length) {
      log(unit.editionId, 'Administração', 'Unidade', `Unidade "${unit.unitName}" editada: ${changed.join(', ')}.`);
    }
    res.json({ success: true, unit });
  });

  app.delete('/api/units/:id', (req, res) => {
    const { id } = req.params;
    const unit = units.find((u) => u.id === id);
    if (unit) {
      matches.filter((m) => m.unitId === id).forEach((m) => {
        const mag = magistrates.find((x) => x.id === m.magistrateId);
        if (mag) mag.status = 'Lista de Espera';
      });
      log(unit.editionId, 'Administração', 'Unidade', `Inscrição da unidade "${unit.unitName}" excluída.`);
    }
    units = units.filter((u) => u.id !== id);
    matches = matches.filter((m) => m.unitId !== id);
    res.json({ success: true, id });
  });

  // ---------- Matches ----------
  app.get('/api/matches', (req, res) => {
    const edition = resolveEdition(req);
    res.json(edition ? matches.filter((m) => m.editionId === edition.id) : []);
  });

  const describeMatch = (mt: Match) => {
    const mag = magistrates.find((m) => m.id === mt.magistrateId);
    const un = units.find((u) => u.id === mt.unitId);
    return `${mag?.name || 'Magistrado'} → ${un?.unitName || 'Unidade'} (${mt.assignedArea}; ${mt.workType})`;
  };

  app.post('/api/matches', (req, res) => {
    const { magistrateId, unitId, assignedArea, workType, source } = req.body;
    if (!magistrateId || !unitId || !assignedArea) {
      return res.status(400).json({ error: 'Magistrado, Unidade e Área são obrigatórios para a vinculação.' });
    }
    const mag = magistrates.find((m) => m.id === magistrateId);
    const unit = units.find((u) => u.id === unitId);
    if (!mag || !unit) return res.status(404).json({ error: 'Magistrado ou unidade não encontrados.' });
    if (mag.editionId !== unit.editionId) {
      return res.status(400).json({ error: 'Magistrado e unidade pertencem a edições diferentes.' });
    }
    if (mag.status === 'Rejeitado') {
      return res.status(400).json({ error: 'A inscrição deste magistrado foi rejeitada. Reconsidere-a antes de vincular.' });
    }
    if (unit.selection !== 'Escolhida') {
      return res.status(400).json({ error: 'Só é possível vincular unidades escolhidas para o mutirão.' });
    }
    if (workType && !WORK_TYPES.includes(workType)) {
      return res.status(400).json({ error: 'Modalidade inválida. Use Audiência, Sentença ou Audiência e Sentença.' });
    }

    // Regra: um magistrado por unidade. Um segundo (ou mais) só em caráter de exceção, com motivo.
    const hasOthers = matches.some((m) => m.unitId === unitId && m.magistrateId !== magistrateId);
    const exceptionReason = String(req.body.exceptionReason ?? '').trim();
    if (hasOthers && !exceptionReason) {
      return res.status(409).json({ error: 'Esta unidade já tem magistrado vinculado. Para incluir outro, informe o motivo da exceção.' });
    }

    const existingMatch = matches.find((m) => m.magistrateId === magistrateId);
    if (existingMatch) {
      matches = matches.filter((m) => m.id !== existingMatch.id);
      refreshUnitStatus(existingMatch.unitId);
    }

    mag.status = 'Atribuído';
    const newMatch: Match = {
      id: newId('match'),
      editionId: mag.editionId,
      magistrateId,
      unitId,
      assignedArea,
      workType: workType || defaultWorkType(unit, mag),
      exceptionReason: hasOthers ? exceptionReason : undefined,
      status: 'Vinculado',
      createdAt: new Date().toISOString(),
    };
    matches.unshift(newMatch);
    refreshUnitStatus(unit.id);

    log(mag.editionId, source === 'ai' ? 'Sistema' : 'Administração', 'Vinculação',
      `Vinculação ${hasOthers ? 'EXCEPCIONAL (mais de um magistrado na unidade)' : source === 'ai' ? 'sugerida por IA e efetivada' : 'manual'}: ${describeMatch(newMatch)}.${hasOthers ? ` Motivo da exceção: ${exceptionReason}` : ''}`);
    res.status(201).json({ success: true, match: newMatch });
  });

  app.put('/api/matches/:id', (req, res) => {
    const match = matches.find((m) => m.id === req.params.id);
    if (!match) return res.status(404).json({ error: 'Vinculação não encontrada.' });

    const before = describeMatch(match);
    const { magistrateId, unitId, assignedArea, workType } = req.body;
    if (workType && !WORK_TYPES.includes(workType)) {
      return res.status(400).json({ error: 'Modalidade inválida. Use Audiência, Sentença ou Audiência e Sentença.' });
    }

    const nextMag = magistrates.find((m) => m.id === (magistrateId || match.magistrateId));
    const nextUnit = units.find((u) => u.id === (unitId || match.unitId));
    if (!nextMag || !nextUnit || nextMag.editionId !== match.editionId || nextUnit.editionId !== match.editionId) {
      return res.status(400).json({ error: 'Magistrado e unidade devem pertencer à mesma edição da vinculação.' });
    }
    if (nextMag.status === 'Rejeitado') {
      return res.status(400).json({ error: 'A inscrição deste magistrado foi rejeitada. Reconsidere-a antes de vincular.' });
    }

    if (nextUnit.selection !== 'Escolhida') {
      return res.status(400).json({ error: 'Só é possível vincular unidades escolhidas para o mutirão.' });
    }

    // O magistrado escolhido não pode estar vinculado em outra unidade, e mover para unidade que já tem magistrado exige exceção
    if (matches.some((m) => m.id !== match.id && m.magistrateId === nextMag.id)) {
      return res.status(409).json({ error: 'Este magistrado já está vinculado a outra unidade. Desfaça essa vinculação antes.' });
    }
    const movingUnit = nextUnit.id !== match.unitId;
    const othersInTarget = matches.some((m) => m.id !== match.id && m.unitId === nextUnit.id);
    const newReason = String(req.body.exceptionReason ?? '').trim();
    if (movingUnit && othersInTarget && !newReason) {
      return res.status(409).json({ error: 'A unidade de destino já tem magistrado vinculado. Informe o motivo da exceção.' });
    }

    const oldUnitId = match.unitId;
    const oldMag = magistrates.find((m) => m.id === match.magistrateId);
    const changedMag = nextMag.id !== oldMag?.id;
    if (oldMag && changedMag) oldMag.status = 'Lista de Espera';

    match.magistrateId = nextMag.id;
    match.unitId = nextUnit.id;
    match.assignedArea = assignedArea || match.assignedArea;
    match.workType = workType || (movingUnit || changedMag ? defaultWorkType(nextUnit, nextMag) : match.workType);
    if (movingUnit) match.exceptionReason = othersInTarget ? newReason : undefined;
    else if (req.body.exceptionReason !== undefined && match.exceptionReason) match.exceptionReason = newReason || match.exceptionReason;
    nextMag.status = 'Atribuído';
    refreshUnitStatus(oldUnitId);
    refreshUnitStatus(nextUnit.id);

    log(match.editionId, 'Administração', 'Vinculação', `Vinculação alterada: de ${before} para ${describeMatch(match)}.`);
    res.json({ success: true, match });
  });

  app.delete('/api/matches/:id', (req, res) => {
    const { id } = req.params;
    const match = matches.find((m) => m.id === id);
    if (match) {
      const mag = magistrates.find((m) => m.id === match.magistrateId);
      if (mag) mag.status = 'Lista de Espera';
      log(match.editionId, 'Administração', 'Vinculação', `Vinculação desfeita: ${describeMatch(match)}.`);
    }
    matches = matches.filter((m) => m.id !== id);
    if (match) refreshUnitStatus(match.unitId);
    res.json({ success: true, id });
  });

  // Auto-matching, scoped to one edition
  app.post('/api/matches/auto', (req, res) => {
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });

    const eMags = magistrates.filter((m) => m.editionId === edition.id);
    const eUnits = units.filter((u) => u.editionId === edition.id && u.selection === 'Escolhida');
    const assignedMagIds = new Set(matches.filter((m) => m.editionId === edition.id).map((m) => m.magistrateId));
    const assignedUnitIds = new Set(matches.filter((m) => m.editionId === edition.id).map((m) => m.unitId));
    let newMatchesCount = 0;

    const pass = (pick: (m: Magistrate) => string) => {
      for (const mag of eMags) {
        const area = pick(mag);
        if (!area || mag.status === 'Aguardando Conferência' || mag.status === 'Rejeitado' || assignedMagIds.has(mag.id)) continue;
        const target = eUnits.find((u) => !assignedUnitIds.has(u.id) && u.areas.includes(area));
        if (!target) continue;
        matches.push({
          id: newId('match'),
          editionId: edition.id,
          magistrateId: mag.id,
          unitId: target.id,
          assignedArea: area,
          workType: defaultWorkType(target, mag),
          status: 'Vinculado',
          createdAt: new Date().toISOString(),
        });
        assignedMagIds.add(mag.id);
        assignedUnitIds.add(target.id);
        target.status = 'Atendida';
        mag.status = 'Atribuído';
        newMatchesCount++;
      }
    };
    pass((m) => m.firstPreference);
    pass((m) => m.secondPreference);

    log(edition.id, 'Administração', 'Vinculação',
      `Vinculação automática executada: ${newMatchesCount} nova(s) vinculação(ões).`);
    res.json({ success: true, newMatchesCount });
  });

  app.get('/api/waiting-list', (req, res) => {
    const edition = resolveEdition(req);
    if (!edition) return res.json([]);
    const assigned = new Set(matches.filter((m) => m.editionId === edition.id).map((m) => m.magistrateId));
    res.json(magistrates.filter((m) => m.editionId === edition.id && m.status !== 'Atribuído' && m.status !== 'Rejeitado' && !assigned.has(m.id)));
  });

  // ---------- AI recommendations ----------
  app.post('/api/ai/match-recommendations', async (req, res) => {
    if (!ai) {
      return res.status(500).json({ error: 'Chave da API Gemini não configurada.' });
    }
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });

    try {
      const assigned = new Set(matches.filter((m) => m.editionId === edition.id).map((m) => m.magistrateId));
      const unassignedMags = magistrates.filter(
        (m) => m.editionId === edition.id && m.status !== 'Atribuído' && m.status !== 'Rejeitado' && !assigned.has(m.id),
      );
      const pendingUnits = units.filter((u) => u.editionId === edition.id && u.selection === 'Escolhida' && u.status === 'Pendente');

      const prompt = `
        Você é o assistente de inteligência artificial de coordenação de um Mutirão de Julgamento do Tribunal de Justiça.
        Analise os magistrados voluntários aprovados e não alocados e as unidades judiciais pendentes abaixo e sugira as melhores alocações estratégicas.

        Magistrados Disponíveis:
        ${JSON.stringify(unassignedMags, null, 2)}

        Unidades Judiciais Pendentes:
        ${JSON.stringify(pendingUnits, null, 2)}

        Responda em JSON contendo um array de recomendações com a estrutura:
        [
          {
            "magistrateId": "...",
            "unitId": "...",
            "assignedArea": "...",
            "justification": "..."
          }
        ]
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });

      const result = JSON.parse(response.text || '[]');
      log(edition.id, 'Sistema', 'Vinculação', `Recomendações de IA geradas (${Array.isArray(result) ? result.length : 0}).`);
      res.json({ success: true, recommendations: result });
    } catch (err: any) {
      console.error('Gemini AI error:', err);
      res.status(500).json({ error: err.message || 'Erro ao gerar recomendações com IA.' });
    }
  });

  // ---------- Exports ----------
  app.get('/api/export/xlsx/matches', (req, res) => {
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });

    const data = matches
      .filter((m) => m.editionId === edition.id)
      .map((mt) => ({
        'Nome': magistrates.find((m) => m.id === mt.magistrateId)?.name || 'Magistrado Removido',
        'Área': mt.assignedArea,
        'Modalidade': mt.workType,
        'Comarca': units.find((u) => u.id === mt.unitId)?.comarca || '',
        'Unidade': units.find((u) => u.id === mt.unitId)?.unitName || 'Unidade Removida',
      }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), 'Vinculacoes');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    log(edition.id, 'Administração', 'Exportação', 'Planilha de vinculações (XLSX) exportada.');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=vinculacoes-${edition.id}-${Date.now()}.xlsx`);
    res.send(buffer);
  });

  app.get('/api/export/csv', (req, res) => {
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });

    const type = (req.query.type as string) || 'all';
    let csv = `﻿Edição: ${edition.title}\n\n`;

    if (type === 'magistrates' || type === 'all') {
      csv += '=== MAGISTRADOS VOLUNTARIOS ===\n';
      csv += 'ID,Nome,Email,Lotacao Atual,1ª Preferencia,2ª Preferencia,Aceita Audiencia,IP,Declaracao,Status,Motivo Rejeicao,Data Inscr.\n';
      magistrates.filter((m) => m.editionId === edition.id).forEach((m) => {
        csv += [m.id, m.name, m.email, m.currentLocation, m.firstPreference, m.secondPreference, m.acceptsHearings ? 'Sim' : 'Nao', m.registeredIp ?? '', m.declaration ? 'Sim' : '', m.status, m.rejectionReason ?? '', m.createdAt].map(csvCell).join(',') + '\n';
      });
      csv += '\n\n';
    }

    if (type === 'units' || type === 'all') {
      csv += '=== UNIDADES JUDICIAIS ===\n';
      csv += 'ID,Unidade,Juiz(a) Responsavel,Email,Comarca,Areas,Auxilio Necessario,IP,Triagem,Status,Motivo Rejeicao,Data Inscr.\n';
      units.filter((u) => u.editionId === edition.id).forEach((u) => {
        csv += [u.id, u.unitName, u.judgeName, u.email, u.comarca, u.areas.join(' | '), u.supportNeeded, u.registeredIp ?? '', u.selection, u.status, u.rejectionReason ?? '', u.createdAt].map(csvCell).join(',') + '\n';
      });
      csv += '\n\n';
    }

    if (type === 'matches' || type === 'all') {
      csv += '=== VINCULACOES REALIZADAS ===\n';
      csv += 'ID Vinculo,Magistrado,Unidade,Area Atribuida,Modalidade,Excecao (motivo),Status,Data\n';
      matches.filter((m) => m.editionId === edition.id).forEach((mt) => {
        const mag = magistrates.find((m) => m.id === mt.magistrateId);
        const un = units.find((u) => u.id === mt.unitId);
        csv += [mt.id, mag?.name || mt.magistrateId, un?.unitName || mt.unitId, mt.assignedArea, mt.workType, mt.exceptionReason ?? '', mt.status, mt.createdAt].map(csvCell).join(',') + '\n';
      });
      csv += '\n\n';
    }

    if (type === 'log' || type === 'all') {
      csv += '=== REGISTRO DE ATIVIDADES ===\n';
      csv += 'Data/Hora,Responsavel,Categoria,Descricao\n';
      activityLog.filter((l) => l.editionId === edition.id || l.editionId === null).forEach((l) => {
        csv += [l.timestamp, l.actor, l.category, l.description].map(csvCell).join(',') + '\n';
      });
    }

    log(edition.id, 'Administração', 'Exportação', `Exportação CSV (${type}).`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=mutirao-${edition.id}-${type}-${Date.now()}.csv`);
    res.send(csv);
  });

  if (process.env.NODE_ENV !== 'production') {
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

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer();
