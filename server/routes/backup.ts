// Rotas de backup: exportação, restauração e backup automático diário.
import express from 'express';
import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CATALOG_SEPARATOR } from '../../src/catalogo-tjpr';
import { applyCatalog } from '../catalog.ts';
import { ensureInitialEdition } from '../editions.ts';
import { refreshUnitStatus } from '../links.ts';
import { log, S } from '../state.ts';
import { normalizeLegacy } from '../validation.ts';

// O arquivo contém dados pessoais (nomes, e-mails, IPs): guarde-o em local seguro. Não inclui senha nem o segredo do 2FA.
export const BACKUP_APP = 'mutirao-cgj';
/** Conteúdo do backup (sem usuários, senhas nem segredos do 2FA). */
export const backupJson = () => JSON.stringify({
  app: BACKUP_APP, version: 1, exportedAt: new Date().toISOString(), activeEditionId: S.activeEditionId,
  editions: S.editions, magistrates: S.magistrates, units: S.units, matches: S.matches, faq: S.faq, withdrawals: S.withdrawals, transfers: S.transfers, requests: S.changeRequests, log: S.activityLog,
  catalog: S.catalogUnits, comarcas: S.catalogComarcas,
});
// O Cloud Scheduler chama POST /api/backup/auto 1x/dia com o cabeçalho x-backup-token (= BACKUP_CRON_TOKEN).
// A cópia vai para o bucket BACKUP_BUCKET (Cloud Storage). Para testes locais, BACKUP_DIR grava numa pasta.
export const BACKUP_BUCKET = process.env.BACKUP_BUCKET || '';
export const BACKUP_DIR = process.env.BACKUP_DIR || '';
export const CRON_TOKEN = process.env.BACKUP_CRON_TOKEN || '';
export const gcs = BACKUP_BUCKET ? new Storage().bucket(BACKUP_BUCKET) : null;
export const autoConfigured = () => !!CRON_TOKEN && !!(gcs || BACKUP_DIR);
export const backupStore = {
  async save(name: string, body: string) {
    if (gcs) return void (await gcs.file(name).save(body, { contentType: 'application/json; charset=utf-8', resumable: false }));
    fs.mkdirSync(path.join(BACKUP_DIR, 'backups'), { recursive: true }); fs.writeFileSync(path.join(BACKUP_DIR, name), body);
  },
  async list(): Promise<{ name: string; size: number; updated: string }[]> {
    if (gcs) {
      const [files] = await gcs.getFiles({ prefix: 'backups/' });
      return files.map((f) => ({ name: f.name, size: Number(f.metadata.size ?? 0), updated: String(f.metadata.updated ?? '') }));
    }
    const dir = path.join(BACKUP_DIR, 'backups');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).map((n) => { const st = fs.statSync(path.join(dir, n)); return { name: `backups/${n}`, size: st.size, updated: st.mtime.toISOString() }; });
  },
  async read(name: string): Promise<string> {
    if (gcs) return (await gcs.file(name).download())[0].toString('utf-8');
    return fs.readFileSync(path.join(BACKUP_DIR, name), 'utf-8');
  },
};
export const validBackupName = (n: unknown): n is string => typeof n === 'string' && /^backups\/backup-[0-9_-]+\.json$/.test(n);

export function register(app: express.Express) {
  app.get('/api/backup', (_req, res) => {
    const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', '_').replace(/:/g, '-').slice(0, 16);
    log(null, 'Administração', 'Exportação', 'Backup completo dos dados exportado.');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=backup-mutirao-${stamp}.json`);
    res.send(backupJson());
  });
  app.post('/api/backup/auto', async (req, res) => {
    const given = Buffer.from(String(req.header('x-backup-token') ?? ''));
    const expected = Buffer.from(CRON_TOKEN);
    if (!CRON_TOKEN || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }
    if (!autoConfigured()) return res.status(503).json({ error: 'Backup automático não configurado (BACKUP_BUCKET).' });
    const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', '_').replace(/:/g, '-').slice(0, 16);
    const name = `backups/backup-${stamp}.json`;
    try {
      const body = backupJson();
      await backupStore.save(name, body);
      S.lastAutoBackup = { at: new Date().toISOString(), ok: true, name, size: Buffer.byteLength(body) };
      log(null, 'Sistema', 'Exportação', `Backup automático gravado (${name}, ${Math.round(Buffer.byteLength(body) / 1024)} KB).`);
      res.json({ success: true, name });
    } catch (err: any) {
      S.lastAutoBackup = { at: new Date().toISOString(), ok: false, error: String(err?.message ?? err).slice(0, 300) };
      log(null, 'Sistema', 'Exportação', `FALHA no backup automático: ${S.lastAutoBackup.error}`);
      res.locals.persist = true;
      res.status(500).json({ error: 'Falha ao gravar o backup.' });
    }
  });
  app.get('/api/backup/auto/status', (_req, res) => res.json({ configured: autoConfigured(), destination: BACKUP_BUCKET ? `gs://${BACKUP_BUCKET}` : BACKUP_DIR || null, last: S.lastAutoBackup }));
  app.get('/api/backup/auto/list', async (_req, res) => {
    if (!autoConfigured()) return res.json([]);
    try {
      const list = (await backupStore.list()).filter((f) => validBackupName(f.name)).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 90);
      res.json(list);
    } catch (err: any) { res.status(502).json({ error: `Não foi possível listar os backups: ${String(err?.message ?? err).slice(0, 200)}` }); }
  });
  app.get('/api/backup/auto/file', async (req, res) => {
    const name = req.query.name;
    if (!validBackupName(name)) return res.status(400).json({ error: 'Arquivo inválido.' });
    try {
      const body = await backupStore.read(name);
      log(null, 'Administração', 'Exportação', `Backup automático baixado (${name}).`);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=${name.slice('backups/'.length)}`);
      res.send(body);
    } catch { res.status(404).json({ error: 'Backup não encontrado.' }); }
  });
  // Restaura um backup: SUBSTITUI edições, magistrados, unidades, vinculações, desistências e perguntas frequentes pelos do arquivo.
  // O registro de atividades é preservado (nunca se apaga) e recebe as entradas do arquivo que ainda não existirem.
  app.post('/api/backup/restore', (req, res) => {
    if (req.body?.confirm !== 'RESTAURAR') return res.status(400).json({ error: 'Confirmação ausente.' });
    const d = req.body?.data;
    if (!d || typeof d !== 'object' || d.app !== BACKUP_APP || d.version !== 1) return res.status(400).json({ error: 'Arquivo de backup inválido ou de outra versão.' });
    const arr = (k: string, required = false): any[] | null => {
      const v = d[k];
      if (v === undefined && !required) return [];
      return Array.isArray(v) && v.every((x) => x && typeof x === 'object' && typeof x.id === 'string' && x.id) ? v : null;
    };
    const [eds, mags, uns, mts, fq, wds, lg, trs, rqs] = [arr('editions', true), arr('magistrates', true), arr('units', true), arr('matches', true), arr('faq'), arr('withdrawals'), arr('log'), arr('transfers'), arr('requests')];
    if (!eds || !mags || !uns || !mts || !fq || !wds || !lg || !trs || !rqs) return res.status(400).json({ error: 'O arquivo está incompleto ou com registros inválidos.' });
    if (eds.length === 0 || !eds.every((e) => typeof e.title === 'string')) return res.status(400).json({ error: 'O backup precisa conter ao menos uma edição.' });
    const unique = (xs: any[]) => new Set(xs.map((x) => x.id)).size === xs.length;
    if (![eds, mags, uns, mts, fq, wds].every(unique)) return res.status(400).json({ error: 'O arquivo contém registros duplicados.' });
    const edIds = new Set(eds.map((e) => e.id)), magIds = new Set(mags.map((m) => m.id)), unitIds = new Set(uns.map((u) => u.id));
    if (!mags.every((m) => edIds.has(m.editionId)) || !uns.every((u) => edIds.has(u.editionId))
      || !mts.every((m) => edIds.has(m.editionId) && magIds.has(m.magistrateId) && unitIds.has(m.unitId))) {
      return res.status(400).json({ error: 'O arquivo tem vínculos entre registros que não existem (edição, magistrado ou unidade).' });
    }

    const before = { editions: S.editions.length, magistrates: S.magistrates.length, units: S.units.length, matches: S.matches.length };
    S.editions = eds; S.magistrates = mags; S.units = uns; S.matches = mts; S.faq = fq; S.withdrawals = wds; S.transfers = trs; S.changeRequests = rqs ?? []; S.panelEntries = [];
    S.activeEditionId = edIds.has(d.activeEditionId) ? d.activeEditionId : eds[0].id;
    // Lista de comarcas e unidades: só é trocada se o backup a trouxer (backups antigos mantêm a atual)
    const cat = arr('catalog'), cms = arr('comarcas');
    if (cat && cms && (cat.length || cms.length) && cat.every((u) => typeof u.comarca === 'string' && typeof u.unitName === 'string') && cms.every((c) => typeof c.name === 'string')) {
      S.catalogUnits = cat.map((u) => ({ id: u.id, comarca: u.comarca, unitName: u.unitName, separator: typeof u.separator === 'string' ? u.separator : CATALOG_SEPARATOR }));
      S.catalogComarcas = cms.map((c) => ({ id: c.id, name: c.name }));
      applyCatalog();
    }
    const have = new Set(S.activityLog.map((l) => l.id));
    S.activityLog = [...S.activityLog, ...lg.filter((l) => !have.has(l.id) && typeof l.timestamp === 'string')].sort((x, y) => y.timestamp.localeCompare(x.timestamp));
    normalizeLegacy();
    ensureInitialEdition();
    S.units.forEach((u) => refreshUnitStatus(u.id));
    log(null, 'Administração', 'Exportação',
      `BACKUP RESTAURADO (arquivo de ${typeof d.exportedAt === 'string' ? d.exportedAt : 'data desconhecida'}): ${eds.length} edição(ões), ${mags.length} magistrado(s), ${uns.length} unidade(s), ${mts.length} vinculação(ões). Antes: ${before.editions}/${before.magistrates}/${before.units}/${before.matches}.`);
    res.json({ success: true, editions: eds.length, magistrates: mags.length, units: uns.length, matches: mts.length });
  });
}
