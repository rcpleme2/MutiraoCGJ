import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import XLSX from 'xlsx';
import crypto from 'crypto';
import fs from 'fs';
import { Firestore } from '@google-cloud/firestore';
import QRCode from 'qrcode';
import { AsyncLocalStorage } from 'async_hooks';

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
  /** Quantos magistrados serão alocados nesta unidade (padrão 1; definido pela administração) */
  slots: number;
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
  /** Legado: motivo informado em vinculações adicionais antes de existir o número de vagas; não é mais exigido */
  exceptionReason?: string;
  status: 'Vinculado' | 'Concluído';
  createdAt: string;
}

type LogCategory = 'Edição' | 'Magistrado' | 'Unidade' | 'Vinculação' | 'Exportação' | 'Acesso' | 'Conteúdo';

/** Pergunta frequente, mantida pela administração (conteúdo geral, não vinculado a uma edição) */
interface FaqItem {
  id: string;
  question: string;
  answer: string;
  order: number;
  published: boolean;
  updatedAt: string;
}

interface LogEntry {
  id: string;
  editionId: string | null;
  timestamp: string;
  actor: 'Administração' | 'Público' | 'Sistema';
  category: LogCategory;
  description: string;
  /** IP de quem originou a ação (preenchido automaticamente nas requisições) */
  ip?: string;
}

// Senha administrativa: defina ADMIN_PASSWORD nos Secrets do AI Studio.
// Sem ela, uma senha aleatória é gerada e exibida no console do servidor a cada inicialização.
let adminPassword = process.env.ADMIN_PASSWORD || '';
if (!adminPassword) {
  adminPassword = crypto.randomBytes(9).toString('base64url');
  console.warn(`[SEGURANÇA] ADMIN_PASSWORD não definida. Senha temporária gerada: ${adminPassword}`);
}

// ---------- Autenticação em dois fatores (TOTP, RFC 6238) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32Encode = (buf: Buffer) => {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};
const base32Decode = (s: string) => {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
};
const totpAt = (secret: string, step: number) => {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000;
  return String(code).padStart(6, '0');
};
let lastTotpStep = 0; // impede reutilizar um código já aceito (replay)
function verifyTotp(secret: string, code: unknown): boolean {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  const now = Math.floor(Date.now() / 30_000);
  for (const step of [now - 1, now, now + 1]) { // tolera pequena diferença de relógio
    if (step <= lastTotpStep) continue;
    const expected = Buffer.from(totpAt(secret, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(code))) { lastTotpStep = step; return true; }
  }
  return false;
}
/** Desafios do login: a senha já foi validada; falta o código do segundo fator (ou o cadastro do aplicativo). */
const challenges = new Map<string, { exp: number; tries: number; pendingSecret?: string }>();

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

// Limite de inscrições públicas por IP a cada 10 minutos. Vários servidores do tribunal podem sair pelo
// mesmo IP, então o valor é ajustável sem alterar o código: defina SIGNUP_MAX_PER_IP no Cloud Run.
const SIGNUP_MAX_PER_IP = Math.max(1, Number(process.env.SIGNUP_MAX_PER_IP) || 30);
// Inscrições com erro (validação, duplicidade etc.) têm limite próprio, mais folgado, para frear sondagem de e-mails.
const SIGNUP_MAX_ERRORS_PER_IP = Math.max(1, Number(process.env.SIGNUP_MAX_ERRORS_PER_IP) || 120);
const SIGNUP_MAX_GLOBAL_PER_HOUR = Math.max(1, Number(process.env.SIGNUP_MAX_GLOBAL_PER_HOUR) || 600);

// Limitador simples por IP (tentativas de login e consultas por e-mail)
const hits = new Map<string, number[]>();
const rateLimited = (key: string, max: number, windowMs: number) => {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
};
/** Devolve a "vaga" reservada por rateLimited (usado quando a requisição não resultou em inscrição). */
const refund = (key: string) => { hits.get(key)?.pop(); };

// Limpeza periódica: sessões expiradas e janelas do limitador, para a memória não crescer indefinidamente
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
  for (const [t, c] of challenges) if (c.exp < now) challenges.delete(t);
  for (const [k, list] of hits) if (!list.some((t) => now - t < 60 * 60_000)) hits.delete(k);
}, 10 * 60_000).unref();

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
    slots: 1,
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
    slots: 1,
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
    slots: 1,
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

let faq: FaqItem[] = [];

/** Autenticação em dois fatores (TOTP) do administrador; o segredo é gravado junto do estado. */
let adminTotpSecret: string | null = null;

/** Contexto da requisição em andamento (IP), para que todo registro de atividade carregue a origem. */
const reqCtx = new AsyncLocalStorage<{ ip: string }>();

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
  const ip = reqCtx.getStore()?.ip;
  activityLog.unshift({
    id: newId('log'),
    editionId,
    timestamp: new Date().toISOString(),
    actor,
    category,
    description,
    ...(ip ? { ip } : {}),
  });
  if (activityLog.length > 5000) activityLog.length = 5000; // corte só na memória; o Firestore mantém o histórico
  // Cópia estruturada no Cloud Logging (imutável para o aplicativo) das ações administrativas e de acesso
  if (actor === 'Administração' || category === 'Acesso') {
    console.log(JSON.stringify({ severity: 'NOTICE', message: description, audit: { category, actor, ip: ip ?? null, editionId } }));
  }
}

const clientIp = (req: express.Request) => (req.ip || 'desconhecido').replace(/^::ffff:/, '');

/** Modalidade padrão da vinculação, conforme o auxílio pedido pela unidade e a disposição do magistrado */
const defaultWorkType = (unit: Unit, mag: Magistrate): WorkType => {
  if (unit.supportNeeded === 'Audiência' || unit.supportNeeded === 'Sentença') return unit.supportNeeded;
  return mag.acceptsHearings ? 'Audiência e Sentença' : 'Sentença';
};

/** Atendimento da unidade conforme as vinculações existentes e o número de magistrados a alocar (vagas). */
function refreshUnitStatus(unitId: string) {
  const unit = units.find((u) => u.id === unitId);
  if (!unit) return;
  const linked = matches.filter((m) => m.unitId === unitId).length;
  // Pendente: nenhum magistrado; Em Andamento: vagas parcialmente preenchidas; Atendida: todas as vagas preenchidas
  unit.status = linked === 0 ? 'Pendente' : linked >= (unit.slots || 1) ? 'Atendida' : 'Em Andamento';
}
const linkedCount = (unitId: string) => matches.filter((m) => m.unitId === unitId).length;
const MAX_SLOTS = 20;

// ---------- Validação de entrada ----------
// Todo dado vindo de formulários é conferido (tipo, tamanho e valores permitidos) antes de ser gravado.
const PREFERENCE_AREAS = [
  'Cível e Fazenda Pública',
  'Crime',
  'Família e Infância',
  'Juizado Cível, Crime e Fazenda Pública',
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Só e-mails institucionais são aceitos nas inscrições. Ajustável por ALLOWED_EMAIL_DOMAINS (lista separada
// por vírgulas; vazio = sem restrição). Subdomínios do domínio informado também são aceitos.
const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS ?? 'tjpr.jus.br').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
const emailDomainOk = (email: string) => {
  if (ALLOWED_EMAIL_DOMAINS.length === 0) return true;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return ALLOWED_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
};
const EMAIL_DOMAIN_MESSAGE = `Use o e-mail institucional (${ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(' ou ')}).`;

const MAGISTRATE_STATUSES: MagistrateStatus[] = ['Aguardando Conferência', 'Aprovado', 'Lista de Espera', 'Atribuído', 'Rejeitado'];

/** Texto obrigatório: precisa ser string, não vazia e dentro do limite. */
function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
}
/** Texto livre (motivos etc.): sempre devolve string, limitada ao tamanho máximo. */
const freeText = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

type Parsed<T> = { error: string } | { value: T };

function parseMagistrate(b: any, base?: Magistrate): Parsed<Pick<Magistrate, 'name' | 'email' | 'currentLocation' | 'firstPreference' | 'secondPreference' | 'acceptsHearings'>> {
  const pick = (k: keyof Magistrate) => (b?.[k] == null && base ? base[k] : b?.[k]);
  const name = cleanText(pick('name'), 200);
  const email = cleanText(pick('email'), 200);
  const currentLocation = cleanText(pick('currentLocation'), 300);
  if (!name || !email || !currentLocation) {
    return { error: 'Preencha nome, e-mail e lotação com texto válido (nome até 200, lotação até 300 caracteres).' };
  }
  if (!EMAIL_RE.test(email)) return { error: 'Informe um e-mail válido.' };
  if ((!base || email.toLowerCase() !== base.email.toLowerCase()) && !emailDomainOk(email)) return { error: EMAIL_DOMAIN_MESSAGE };
  const first = pick('firstPreference');
  if (typeof first !== 'string' || !PREFERENCE_AREAS.includes(first)) return { error: 'Escolha uma área válida na 1ª escolha.' };
  const second = pick('secondPreference') ?? '';
  if (typeof second !== 'string' || (second !== '' && !PREFERENCE_AREAS.includes(second))) return { error: 'Escolha uma área válida na 2ª escolha.' };
  if (second && second === first) return { error: 'A 2ª escolha não pode ser igual à 1ª escolha.' };
  const hearings = pick('acceptsHearings');
  return { value: { name, email, currentLocation, firstPreference: first, secondPreference: second, acceptsHearings: hearings === true } };
}

function parseUnit(b: any, base?: Unit): Parsed<Pick<Unit, 'unitName' | 'judgeName' | 'email' | 'comarca' | 'areas' | 'supportNeeded' | 'description' | 'slots'>> {
  const pick = (k: keyof Unit) => (b?.[k] == null && base ? base[k] : b?.[k]);
  const unitName = cleanText(pick('unitName'), 300);
  const judgeName = cleanText(pick('judgeName'), 200);
  const email = cleanText(pick('email'), 200);
  const comarca = cleanText(pick('comarca'), 150);
  if (!unitName || !judgeName || !email || !comarca) {
    return { error: 'Preencha comarca, unidade, responsável e e-mail com texto válido.' };
  }
  if (!EMAIL_RE.test(email)) return { error: 'Informe um e-mail válido.' };
  if ((!base || email.toLowerCase() !== base.email.toLowerCase()) && !emailDomainOk(email)) return { error: EMAIL_DOMAIN_MESSAGE };
  const areas = pick('areas');
  if (!Array.isArray(areas) || areas.length < 1 || areas.length > PREFERENCE_AREAS.length
    || !areas.every((a) => typeof a === 'string' && PREFERENCE_AREAS.includes(a))) {
    return { error: 'Selecione ao menos uma área válida.' };
  }
  const support = pick('supportNeeded') ?? 'Sentença';
  if (!WORK_TYPES.includes(support as WorkType)) return { error: 'Auxílio necessário inválido.' };
  const slots = pick('slots') ?? 1;
  if (typeof slots !== 'number' || !Number.isInteger(slots) || slots < 1 || slots > MAX_SLOTS) return { error: `O número de magistrados a alocar deve ser um inteiro de 1 a ${MAX_SLOTS}.` };
  const description = pick('description') ?? '';
  if (typeof description !== 'string' || description.length > 2000) return { error: 'A justificativa pode ter no máximo 2000 caracteres.' };
  return { value: { unitName, judgeName, email, comarca, areas: [...new Set(areas as string[])], supportNeeded: support as WorkType, description: description.trim(), slots } };
}

/** Dados antigos ou corrompidos (ex.: gravados antes da validação) são convertidos para tipos seguros. */
const asText = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
function sanitizeStoredRecords() {
  magistrates.forEach((m) => {
    m.name = asText(m.name); m.email = asText(m.email); m.currentLocation = asText(m.currentLocation);
    m.firstPreference = asText(m.firstPreference); m.secondPreference = asText(m.secondPreference);
    m.acceptsHearings = m.acceptsHearings === true;
  });
  units.forEach((u) => {
    u.unitName = asText(u.unitName); u.judgeName = asText(u.judgeName); u.email = asText(u.email);
    u.comarca = asText(u.comarca); u.description = asText(u.description);
    u.areas = Array.isArray(u.areas) ? u.areas.map(asText) : u.areas ? [asText(u.areas)] : [];
  });
}

/** Dados gravados antes de existirem a triagem de unidades e a modalidade recebem valores coerentes */
function normalizeLegacy() {
  sanitizeStoredRecords();
  units.forEach((u) => {
    if (!u.selection) u.selection = 'Escolhida';
    const linked = matches.filter((m) => m.unitId === u.id).length;
    u.slots = Math.max(1, Number.isInteger(u.slots) ? u.slots : 1, linked);
  });
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

// ---------- Janela de inscrições ----------
// As datas das edições são horário de Brasília (sem horário de verão desde 2019); o servidor roda em UTC.
const BRT = '-03:00';
type RegistrationState = 'open' | 'not_yet' | 'ended' | 'paused' | 'closed';
function registrationState(e: Edition): RegistrationState {
  if (e.status === 'Encerrada') return 'closed';
  if (!e.isRegistrationOpen) return 'paused';
  const opens = Date.parse(`${e.openingDate}${BRT}`);
  const closes = Date.parse(`${e.closingDate}${BRT}`) + 60_000; // inclui o minuto final inteiro (até hh:mm:59)
  if (Number.isNaN(opens) || Number.isNaN(closes)) return 'paused'; // datas inválidas: fecha por segurança
  const now = Date.now();
  if (now < opens) return 'not_yet';
  if (now >= closes) return 'ended';
  return 'open';
}
const fmtLocal = (local: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  return m ? `${m[3]}/${m[2]}/${m[1]} às ${m[4]}:${m[5]}` : local;
};
function registrationMessage(e: Edition, state: RegistrationState) {
  if (state === 'not_yet') return `As inscrições ainda não foram abertas. Abertura em ${fmtLocal(e.openingDate)} (horário de Brasília).`;
  if (state === 'ended') return `O prazo de inscrições foi encerrado em ${fmtLocal(e.closingDate)} (horário de Brasília).`;
  return 'As inscrições desta edição estão encerradas ou temporariamente suspensas pela coordenação.';
}

const publicEdition = (e: Edition) => {
  const state = registrationState(e);
  return { ...e, isActive: e.id === activeEditionId, registration: { state, message: state === 'open' ? '' : registrationMessage(e, state) } };
};

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
/** Entradas do registro já gravadas: o log é imutável, só se acrescenta e nunca se apaga do banco. */
let persistedLogIds = new Set<string>();
let lastMeta = '';

const collectionsNow = (): Record<string, { id: string }[]> => ({
  editions, magistrates, units, matches, log: activityLog, faq,
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
      faq = raw.faq ?? faq;
      adminTotpSecret = raw.adminTotpSecret ?? null;
    } catch { /* primeira execução: usa os dados iniciais */ }
    return;
  }

  const loaded: Record<string, any[]> = {};
  for (const name of Object.keys(collectionsNow())) {
    // O registro de atividades é carregado apenas nas 5.000 entradas mais recentes (o restante permanece no banco)
    const snap = name === 'log'
      ? await db.collection(PREFIX + name).orderBy('timestamp', 'desc').limit(5000).get()
      : await db.collection(PREFIX + name).get();
    loaded[name] = snap.docs.map((d) => d.data());
    if (name === 'log') persistedLogIds = new Set(loaded[name].map((i) => i.id));
    else lastSaved.set(name, new Map(loaded[name].map((i) => [i.id, JSON.stringify(i)])));
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
  faq = loaded.faq as FaqItem[];
  activeEditionId = meta?.activeEditionId ?? editions[0].id;
  adminTotpSecret = meta?.adminTotpSecret ?? null;
  lastMeta = JSON.stringify({ activeEditionId, adminTotpSecret });
}

async function persist() {
  if (!db) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ editions, activeEditionId, magistrates, units, matches, activityLog, faq, adminTotpSecret }),
    );
    return;
  }

  // Grava apenas o que mudou desde a última gravação (diff por registro).
  type Op = { kind: 'set' | 'del'; ref: FirebaseFirestore.DocumentReference; data?: any };
  const ops: Op[] = [];
  const nextSaved = new Map<string, Map<string, string>>();

  const newLogIds: string[] = [];
  for (const [name, items] of Object.entries(collectionsNow())) {
    if (name === 'log') {
      const col = db.collection(PREFIX + 'log');
      for (const item of items) if (!persistedLogIds.has(item.id)) { ops.push({ kind: 'set', ref: col.doc(item.id), data: JSON.parse(JSON.stringify(item)) }); newLogIds.push(item.id); }
      continue;
    }
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
  const meta = JSON.stringify({ activeEditionId, adminTotpSecret });
  if (meta !== lastMeta) ops.push({ kind: 'set', ref: db.collection(PREFIX + 'meta').doc('state'), data: JSON.parse(meta) });

  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + 400)) {
      if (op.kind === 'set') batch.set(op.ref, op.data); else batch.delete(op.ref);
    }
    await batch.commit();
  }
  nextSaved.forEach((v, k) => lastSaved.set(k, v));
  newLogIds.forEach((id) => persistedLogIds.add(id));
  // mantém só os ids ainda presentes na memória, para o conjunto não crescer indefinidamente
  { const inMemory = new Set(activityLog.map((l) => l.id)); persistedLogIds = new Set([...persistedLogIds].filter((id) => inMemory.has(id))); }
  lastMeta = meta;
}

// Gravações são serializadas; a resposta HTTP só sai depois de gravar
// (no Cloud Run a CPU pode ser reduzida logo após a resposta).
// Se a gravação falhar, a requisição recebe erro (em vez de "sucesso") e novas tentativas
// automáticas regravam o que ficou pendente (persist grava apenas a diferença).
let saving: Promise<boolean> = Promise.resolve(true);
let retryTimer: NodeJS.Timeout | null = null;
let retries = 0;
function saveState(): Promise<boolean> {
  saving = saving.then(async () => {
    try {
      await persist();
      retries = 0;
      return true;
    } catch (err) {
      console.error('Falha ao persistir estado:', err);
      if (!retryTimer && retries < 12) {
        retries++;
        retryTimer = setTimeout(() => { retryTimer = null; void saveState(); }, 5000);
      }
      return false;
    }
  });
  return saving;
}

async function startServer() {
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

  app.use(express.json({ limit: '50kb' }));
  await loadState();
  normalizeLegacy();
  // Perdeu o celular do autenticador? Defina RESET_ADMIN_2FA=true, publique, entre (será pedido novo cadastro) e remova a variável.
  if (process.env.RESET_ADMIN_2FA === 'true' && adminTotpSecret) {
    adminTotpSecret = null;
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
    const admin = hasValidToken(req);
    const publicRead = (req.method === 'GET' && ['/settings', '/faq'].includes(req.path)) || (req.method === 'POST' && req.path === '/status');
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
    // Consultas e a etapa 1 do login não alteram dados: só gravam se gerarem registro de segurança (res.locals.persist)
    const readOnlyPost = ['/status', '/admin/login', '/admin/logout'].includes(req.path);
    if (req.method !== 'GET') {
      const json = res.json.bind(res);
      res.json = (body: any) => {
        // Respostas de erro (4xx/5xx) não alteraram o estado: não há o que gravar (salvo registros de segurança)
        if ((res.statusCode >= 400 || readOnlyPost) && !res.locals.persist) return json(body);
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

  // ---------- Admin auth ----------
  /** Registro de tentativa malsucedida: sempre no Cloud Logging; no registro interno com limite para não inundá-lo. */
  const failedLogin = (req: express.Request, res: express.Response, what: string) => {
    const ip = clientIp(req);
    console.log(JSON.stringify({ severity: 'WARNING', message: `Falha de autenticação do administrador: ${what}`, audit: { category: 'Acesso', ip } }));
    if (!rateLimited(`faillog:${ip}`, 5, 10 * 60_000)) log(null, 'Sistema', 'Acesso', `Falha de autenticação do administrador: ${what}.`);
    res.locals.persist = true; // esta resposta é 4xx, mas o registro precisa ser gravado
  };
  const openSession = (res: express.Response, how: string) => {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    log(null, 'Administração', 'Acesso', `Acesso ao painel administrativo (${how}).`);
    res.json({ success: true, token });
  };

  // Etapa 1: senha (definida apenas pela variável de ambiente ADMIN_PASSWORD)
  app.post('/api/admin/login', async (req, res) => {
    if (rateLimited(`login:${req.ip}`, 8, 10 * 60_000)) {
      return res.status(429).json({ success: false, message: 'Muitas tentativas. Tente novamente em alguns minutos.' });
    }
    const given = Buffer.from(String(req.body?.password ?? ''));
    const expected = Buffer.from(adminPassword);
    const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
    if (!ok) {
      failedLogin(req, res, 'senha incorreta');
      return res.status(401).json({ success: false, message: 'Senha administrativa incorreta.' });
    }
    const challenge = crypto.randomBytes(24).toString('hex');
    if (adminTotpSecret) {
      challenges.set(challenge, { exp: Date.now() + 5 * 60_000, tries: 0 });
      return res.json({ success: true, step: 'totp', challenge });
    }
    // Primeiro acesso: o administrador cadastra o aplicativo autenticador (segredo + QR code)
    const pendingSecret = base32Encode(crypto.randomBytes(20));
    challenges.set(challenge, { exp: Date.now() + 10 * 60_000, tries: 0, pendingSecret });
    const otpauth = `otpauth://totp/${encodeURIComponent('Mutirão CGJ')}:${encodeURIComponent('Administração')}?secret=${pendingSecret}&issuer=${encodeURIComponent('Mutirão CGJ')}`;
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

    const secret = ch.pendingSecret ?? adminTotpSecret;
    if (!secret || !verifyTotp(secret, req.body?.code)) {
      failedLogin(req, res, 'código de verificação incorreto');
      return res.status(401).json({ success: false, message: 'Código incorreto.' });
    }
    challenges.delete(String(req.body.challenge));
    if (ch.pendingSecret) {
      adminTotpSecret = ch.pendingSecret;
      log(null, 'Administração', 'Acesso', 'Autenticação em dois fatores configurada.');
      return openSession(res, 'primeiro acesso com cadastro do autenticador');
    }
    openSession(res, 'senha e código de verificação');
  });

  app.post('/api/admin/logout', (req, res) => {
    const token = req.header('x-admin-token');
    if (token) sessions.delete(token);
    res.json({ success: true });
  });

  // ---------- Editions ----------
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

  // ---------- Perguntas frequentes ----------
  const faqSorted = () => [...faq].sort((a, b) => a.order - b.order);
  const faqInput = (b: any) => ({
    question: String(b?.question ?? '').trim(),
    answer: String(b?.answer ?? '').trim(),
  });
  const faqInvalid = (q: { question: string; answer: string }) =>
    !q.question || !q.answer ? 'Preencha a pergunta e a resposta.'
      : q.question.length > 300 ? 'A pergunta pode ter no máximo 300 caracteres.'
      : q.answer.length > 4000 ? 'A resposta pode ter no máximo 4000 caracteres.' : '';

  // Público: apenas as publicadas
  app.get('/api/faq', (_req, res) => {
    res.json(faqSorted().filter((f) => f.published).map(({ id, question, answer }) => ({ id, question, answer })));
  });
  // Administração: todas, inclusive não publicadas
  app.get('/api/faq/all', (_req, res) => res.json(faqSorted()));

  app.post('/api/faq', (req, res) => {
    const input = faqInput(req.body);
    const err = faqInvalid(input);
    if (err) return res.status(400).json({ error: err });
    const item: FaqItem = {
      id: newId('faq'), ...input,
      order: faq.reduce((mx, f) => Math.max(mx, f.order), 0) + 1,
      published: req.body?.published !== false,
      updatedAt: new Date().toISOString(),
    };
    faq.push(item);
    log(null, 'Administração', 'Conteúdo', `Pergunta frequente criada: "${item.question}".`);
    res.status(201).json({ success: true, item });
  });

  app.put('/api/faq/:id', (req, res) => {
    const item = faq.find((f) => f.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Pergunta não encontrada.' });
    const input = faqInput({ question: req.body?.question ?? item.question, answer: req.body?.answer ?? item.answer });
    const err = faqInvalid(input);
    if (err) return res.status(400).json({ error: err });
    item.question = input.question;
    item.answer = input.answer;
    if (typeof req.body?.published === 'boolean') item.published = req.body.published;
    item.updatedAt = new Date().toISOString();
    log(null, 'Administração', 'Conteúdo', `Pergunta frequente editada: "${item.question}"${item.published ? '' : ' (não publicada)'}.`);
    res.json({ success: true, item });
  });

  app.post('/api/faq/:id/move', (req, res) => {
    const ordered = faqSorted();
    const i = ordered.findIndex((f) => f.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: 'Pergunta não encontrada.' });
    const j = req.body?.direction === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < ordered.length) {
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      ordered.forEach((f, n) => { f.order = n + 1; });
    }
    res.json({ success: true });
  });

  app.delete('/api/faq/:id', (req, res) => {
    const item = faq.find((f) => f.id === req.params.id);
    if (item) log(null, 'Administração', 'Conteúdo', `Pergunta frequente excluída: "${item.question}".`);
    faq = faq.filter((f) => f.id !== req.params.id);
    res.json({ success: true });
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

  // Consulta pública (todas as edições). O e-mail vai no corpo da requisição (POST), não na URL, para não
  // aparecer em registros de acesso. Só devolve o que a tela exibe: nada de IP, e-mail de terceiros ou dados internos.
  app.post('/api/status', (req, res) => {
    const raw = req.body?.email;
    const emailQuery = typeof raw === 'string' ? raw.trim().toLowerCase().slice(0, 200) : '';
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
        const assigned = match ? units.find((u) => u.id === match.unitId) : undefined;
        return {
          id: mag.id,
          name: mag.name,
          currentLocation: mag.currentLocation,
          firstPreference: mag.firstPreference,
          secondPreference: mag.secondPreference,
          acceptsHearings: mag.acceptsHearings,
          status: mag.status,
          createdAt: mag.createdAt,
          editionTitle: titleOf(mag.editionId),
          match: match
            ? { assignedArea: match.assignedArea, workType: match.workType, unit: assigned ? { unitName: assigned.unitName, comarca: assigned.comarca } : null }
            : null,
        };
      }),
      units: matchedUnits.map((u) => ({
        id: u.id,
        unitName: u.unitName,
        comarca: u.comarca,
        judgeName: u.judgeName,
        areas: u.areas,
        supportNeeded: u.supportNeeded,
        status: u.status,
        selection: u.selection,
        createdAt: u.createdAt,
        editionTitle: titleOf(u.editionId),
      })),
    });
  });

  app.post('/api/magistrates', (req, res) => {
    const { declaration, status, source } = req.body;
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });
    const parsed = parseMagistrate(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const { name, email, currentLocation, firstPreference, secondPreference, acceptsHearings } = parsed.value;
    if (source !== 'admin') {
      const reg = registrationState(edition);
      if (reg !== 'open') return res.status(403).json({ error: registrationMessage(edition, reg) });
    }
    if (source !== 'admin' && declaration !== true) {
      return res.status(400).json({ error: 'É necessário aceitar a declaração de regularidade para concluir a inscrição.' });
    }
    if (magistrates.some((m) => m.editionId === edition.id && m.email.toLowerCase() === email.toLowerCase())) {
      return res.status(409).json({ error: 'Já existe uma inscrição de magistrado com este e-mail nesta edição.' });
    }

    const newMag: Magistrate = {
      id: newId('mag'),
      editionId: edition.id,
      name,
      email,
      currentLocation,
      firstPreference,
      secondPreference,
      acceptsHearings,
      registeredIp: source === 'admin' ? undefined : clientIp(req),
      declaration: source === 'admin' ? undefined : true,
      createdAt: new Date().toISOString(),
      status: source === 'admin' && (status === 'Aprovado' || status === 'Lista de Espera') ? status : 'Aguardando Conferência',
    };

    magistrates.unshift(newMag);
    log(edition.id, actorOf(source), 'Magistrado', `Inscrição de ${newMag.name} (${newMag.currentLocation}) registrada${newMag.registeredIp ? ` (IP ${newMag.registeredIp})` : ''}${newMag.declaration ? ' com declaração de regularidade' : ''}.`);
    res.status(201).json({ success: true, magistrate: newMag });
  });

  app.put('/api/magistrates/:id', (req, res) => {
    const mag = magistrates.find((m) => m.id === req.params.id);
    if (!mag) return res.status(404).json({ error: 'Magistrado não encontrado.' });

    const b = req.body || {};
    const parsed = parseMagistrate(b, mag);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const next = parsed.value;
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
    const wanted: MagistrateStatus | undefined = MAGISTRATE_STATUSES.includes(b.status) ? b.status : undefined;
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
    const reason = freeText(req.body?.reason, 1000);
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
    const { source } = req.body;
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });
    const parsed = parseUnit(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const { unitName, judgeName, email, comarca, areas, supportNeeded, description, slots } = parsed.value;
    if (source !== 'admin') {
      const reg = registrationState(edition);
      if (reg !== 'open') return res.status(403).json({ error: registrationMessage(edition, reg) });
    }

    const newUnit: Unit = {
      id: newId('unit'),
      editionId: edition.id,
      unitName,
      judgeName,
      email,
      comarca,
      areas,
      supportNeeded,
      description,
      slots,
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
    const reason = freeText(req.body?.reason, 1000);
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
    const parsed = parseUnit(b, unit);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const next = parsed.value;

    const labels: Record<string, string> = {
      unitName: 'unidade', judgeName: 'responsável', email: 'e-mail', comarca: 'comarca',
      areas: 'áreas', supportNeeded: 'auxílio necessário', description: 'justificativa', slots: 'magistrados a alocar',
    };
    if (next.slots < linkedCount(unit.id)) {
      return res.status(409).json({ error: `Há ${linkedCount(unit.id)} magistrado(s) vinculado(s) a esta unidade. Desfaça vínculos antes de reduzir o número de vagas.` });
    }
    const changed = (Object.keys(next) as (keyof typeof next)[])
      .filter((k) => JSON.stringify(next[k]) !== JSON.stringify(unit[k]))
      .map((k) => labels[k]);
    Object.assign(unit, next);

    // O status é calculado pelas vinculações e pelo número de vagas
    const before = unit.status;
    refreshUnitStatus(unit.id);
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

    // A unidade comporta o número de magistrados definido em "vagas" (padrão 1). Sem motivo a justificar.
    const others = matches.filter((m) => m.unitId === unitId && m.magistrateId !== magistrateId).length;
    if (others >= (unit.slots || 1)) {
      return res.status(409).json({ error: `Todas as ${unit.slots || 1} vaga(s) desta unidade já estão preenchidas. Aumente o número de magistrados da unidade para vincular outro.` });
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
      status: 'Vinculado',
      createdAt: new Date().toISOString(),
    };
    matches.unshift(newMatch);
    refreshUnitStatus(unit.id);

    log(mag.editionId, source === 'ai' ? 'Sistema' : 'Administração', 'Vinculação',
      `Vinculação ${source === 'ai' ? 'sugerida por IA e efetivada' : 'manual'}: ${describeMatch(newMatch)}.`);
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

    // O magistrado escolhido não pode estar vinculado em outra unidade; mover para outra unidade exige vaga livre
    if (matches.some((m) => m.id !== match.id && m.magistrateId === nextMag.id)) {
      return res.status(409).json({ error: 'Este magistrado já está vinculado a outra unidade. Desfaça essa vinculação antes.' });
    }
    const movingUnit = nextUnit.id !== match.unitId;
    if (movingUnit && linkedCount(nextUnit.id) >= (nextUnit.slots || 1)) {
      return res.status(409).json({ error: `Todas as ${nextUnit.slots || 1} vaga(s) da unidade de destino já estão preenchidas.` });
    }

    const oldUnitId = match.unitId;
    const oldMag = magistrates.find((m) => m.id === match.magistrateId);
    const changedMag = nextMag.id !== oldMag?.id;
    if (oldMag && changedMag) oldMag.status = 'Lista de Espera';

    match.magistrateId = nextMag.id;
    match.unitId = nextUnit.id;
    match.assignedArea = assignedArea || match.assignedArea;
    match.workType = workType || (movingUnit || changedMag ? defaultWorkType(nextUnit, nextMag) : match.workType);
    match.exceptionReason = undefined;
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
    let newMatchesCount = 0;

    const pass = (pick: (m: Magistrate) => string) => {
      for (const mag of eMags) {
        const area = pick(mag);
        if (!area || mag.status === 'Aguardando Conferência' || mag.status === 'Rejeitado' || assignedMagIds.has(mag.id)) continue;
        const target = eUnits.find((u) => linkedCount(u.id) < (u.slots || 1) && u.areas.includes(area));
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
        refreshUnitStatus(target.id);
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
      const pendingUnits = units.filter((u) => u.editionId === edition.id && u.selection === 'Escolhida' && u.status !== 'Atendida');

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
  // Planilha das unidades escolhidas para o mutirão que ainda não têm magistrado: Comarca, Unidade, Juiz(a) responsável.
  app.get('/api/export/xlsx/unlinked-units', async (req, res) => {
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Edição não encontrada.' });

    const linked = new Set(matches.filter((m) => m.editionId === edition.id).map((m) => m.unitId));
    const header = ['Comarca', 'Unidade', 'Juiz(a) responsável'];
    const data = units
      .filter((u) => u.editionId === edition.id && u.selection === 'Escolhida' && !linked.has(u.id))
      .sort((x, y) => x.comarca.localeCompare(y.comarca, 'pt-BR') || x.unitName.localeCompare(y.unitName, 'pt-BR'))
      .map((u) => ({ 'Comarca': u.comarca, 'Unidade': u.unitName, 'Juiz(a) responsável': u.judgeName }));

    const sheet = XLSX.utils.json_to_sheet(data, { header });
    sheet['!cols'] = [{ wch: 24 }, { wch: 60 }, { wch: 32 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sem magistrado');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    log(edition.id, 'Administração', 'Exportação', `Planilha de unidades sem magistrado (XLSX) exportada: ${data.length} unidade(s).`);
    if (!(await saveState())) return res.status(503).json({ error: 'Não foi possível registrar a exportação. Tente novamente.' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=unidades-sem-magistrado-${edition.id}-${Date.now()}.xlsx`);
    res.send(buffer);
  });

  app.get('/api/export/xlsx/matches', async (req, res) => {
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
    if (!(await saveState())) return res.status(503).json({ error: 'Não foi possível registrar a exportação. Tente novamente.' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=vinculacoes-${edition.id}-${Date.now()}.xlsx`);
    res.send(buffer);
  });

  app.get('/api/export/csv', async (req, res) => {
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
      csv += 'ID,Unidade,Juiz(a) Responsavel,Email,Comarca,Areas,Auxilio Necessario,Vagas,IP,Triagem,Status,Motivo Rejeicao,Data Inscr.\n';
      units.filter((u) => u.editionId === edition.id).forEach((u) => {
        csv += [u.id, u.unitName, u.judgeName, u.email, u.comarca, u.areas.join(' | '), u.supportNeeded, u.slots, u.registeredIp ?? '', u.selection, u.status, u.rejectionReason ?? '', u.createdAt].map(csvCell).join(',') + '\n';
      });
      csv += '\n\n';
    }

    if (type === 'matches' || type === 'all') {
      csv += '=== VINCULACOES REALIZADAS ===\n';
      csv += 'ID Vinculo,Magistrado,Unidade,Area Atribuida,Modalidade,Status,Data\n';
      matches.filter((m) => m.editionId === edition.id).forEach((mt) => {
        const mag = magistrates.find((m) => m.id === mt.magistrateId);
        const un = units.find((u) => u.id === mt.unitId);
        csv += [mt.id, mag?.name || mt.magistrateId, un?.unitName || mt.unitId, mt.assignedArea, mt.workType, mt.status, mt.createdAt].map(csvCell).join(',') + '\n';
      });
      csv += '\n\n';
    }

    if (type === 'log' || type === 'all') {
      csv += '=== REGISTRO DE ATIVIDADES ===\n';
      csv += 'Data/Hora,Responsavel,Categoria,IP,Descricao\n';
      activityLog.filter((l) => l.editionId === edition.id || l.editionId === null).forEach((l) => {
        csv += [l.timestamp, l.actor, l.category, l.ip ?? '', l.description].map(csvCell).join(',') + '\n';
      });
    }

    log(edition.id, 'Administração', 'Exportação', `Exportação CSV (${type}).`);
    if (!(await saveState())) return res.status(503).json({ error: 'Não foi possível registrar a exportação. Tente novamente.' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=mutirao-${edition.id}-${type}-${Date.now()}.csv`);
    res.send(csv);
  });

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

startServer();
