// Persistência: Firestore em produção (gravação por diferença) ou data/state.json em desenvolvimento.
import path from 'path';
import { Firestore } from '@google-cloud/firestore';
import fs from 'fs';
import { type CatalogRecord } from '../src/catalogo-tjpr';
import { liveSessions, loadSessions } from './auth.ts';
import { applyCatalog } from './catalog.ts';
import { S } from './state.ts';
import { type AdminUser, type Edition, type FaqItem, type LogEntry, type Magistrate, type Match, type PanelEntry, type Transfer, type Unit, type Withdrawal } from './types.ts';

// Persistência em arquivo (desenvolvimento local)
export const DATA_FILE = path.join(process.cwd(), 'data', 'state.json');
// No Cloud Run (K_SERVICE definido) ou com USE_FIRESTORE=true, o estado é gravado no Firestore,
// um documento por registro. Em desenvolvimento local, usa o arquivo data/state.json.
export const db = process.env.K_SERVICE || process.env.USE_FIRESTORE === 'true'
  ? new Firestore({ ignoreUndefinedProperties: true })
  : null;
export const PREFIX = 'mutirao_';
export const lastSaved = new Map<string, Map<string, string>>();
/** Entradas do registro já gravadas: o log é imutável, só se acrescenta e nunca se apaga do banco. */
export let persistedLogIds = new Set<string>();
export let lastMeta = '';
export const metaJson = () => JSON.stringify({ activeEditionId: S.activeEditionId, adminTotpSecret: S.adminTotpSecret, dupDismissed: S.dupDismissed, lastAutoBackup: S.lastAutoBackup, sharedHiddenTabs: S.sharedHiddenTabs });
export const collectionsNow = (): Record<string, { id: string }[]> => ({
  editions: S.editions, magistrates: S.magistrates, units: S.units, matches: S.matches, log: S.activityLog, faq: S.faq, panel: S.panelEntries, withdrawals: S.withdrawals, transfers: S.transfers, admins: S.admins,
  catalog: S.catalogUnits, comarcas: S.catalogComarcas, sessions: liveSessions(),
});
export async function loadState() {
  if (!db) {
    try {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      S.editions = raw.editions ?? S.editions;
      S.activeEditionId = raw.activeEditionId ?? S.activeEditionId;
      S.magistrates = raw.magistrates ?? S.magistrates;
      S.units = raw.units ?? S.units;
      S.matches = raw.matches ?? S.matches;
      S.activityLog = raw.activityLog ?? S.activityLog;
      S.faq = raw.faq ?? S.faq;
      S.adminTotpSecret = raw.adminTotpSecret ?? null;
      S.dupDismissed = Array.isArray(raw.dupDismissed) ? raw.dupDismissed : [];
      S.lastAutoBackup = raw.lastAutoBackup ?? null;
      S.sharedHiddenTabs = Array.isArray(raw.sharedHiddenTabs) ? raw.sharedHiddenTabs : [];
      S.panelEntries = raw.panel ?? [];
      S.withdrawals = raw.withdrawals ?? [];
      S.transfers = raw.transfers ?? [];
      S.admins = raw.admins ?? [];
      S.catalogUnits = raw.catalog ?? [];
      S.catalogComarcas = raw.comarcas ?? [];
      loadSessions(raw.sessions);
    } catch { /* primeira execução: usa os dados iniciais */ }
    applyCatalog();
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
      S.magistrates = []; S.units = []; S.matches = [];
    }
    console.log('[Firestore] Base vazia: iniciando com a edição padrão.');
    return;
  }
  S.editions = loaded.editions as Edition[];
  S.magistrates = loaded.magistrates as Magistrate[];
  S.units = loaded.units as Unit[];
  S.matches = loaded.matches as Match[];
  S.activityLog = (loaded.log as LogEntry[]).sort((x, y) => y.timestamp.localeCompare(x.timestamp));
  S.faq = loaded.faq as FaqItem[];
  S.activeEditionId = meta?.activeEditionId ?? S.editions[0].id;
  S.adminTotpSecret = meta?.adminTotpSecret ?? null;
  S.dupDismissed = Array.isArray(meta?.dupDismissed) ? meta.dupDismissed : [];
  S.lastAutoBackup = meta?.lastAutoBackup ?? null;
  S.sharedHiddenTabs = Array.isArray(meta?.sharedHiddenTabs) ? meta.sharedHiddenTabs : [];
  S.panelEntries = loaded.panel as PanelEntry[];
  S.withdrawals = loaded.withdrawals as Withdrawal[];
  S.transfers = loaded.transfers as Transfer[];
  S.admins = loaded.admins as AdminUser[];
  S.catalogUnits = loaded.catalog as CatalogRecord[];
  S.catalogComarcas = loaded.comarcas as { id: string; name: string }[];
  loadSessions(loaded.sessions);
  applyCatalog();
  lastMeta = metaJson();
}
export async function persist() {
  if (!db) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ editions: S.editions, activeEditionId: S.activeEditionId, magistrates: S.magistrates, units: S.units, matches: S.matches, activityLog: S.activityLog, faq: S.faq, adminTotpSecret: S.adminTotpSecret, panel: S.panelEntries, withdrawals: S.withdrawals, transfers: S.transfers, dupDismissed: S.dupDismissed, admins: S.admins, lastAutoBackup: S.lastAutoBackup, sharedHiddenTabs: S.sharedHiddenTabs, catalog: S.catalogUnits, comarcas: S.catalogComarcas, sessions: liveSessions() }),
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
  const meta = metaJson();
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
  { const inMemory = new Set(S.activityLog.map((l) => l.id)); persistedLogIds = new Set([...persistedLogIds].filter((id) => inMemory.has(id))); }
  lastMeta = meta;
}
// Gravações são serializadas; a resposta HTTP só sai depois de gravar
// (no Cloud Run a CPU pode ser reduzida logo após a resposta).
// Se a gravação falhar, a requisição recebe erro (em vez de "sucesso") e novas tentativas
// automáticas regravam o que ficou pendente (persist grava apenas a diferença).
export let saving: Promise<boolean> = Promise.resolve(true);
export let retryTimer: NodeJS.Timeout | null = null;
export let retries = 0;
export function saveState(): Promise<boolean> {
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
