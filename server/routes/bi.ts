// Rota da integração com o Qlik Sense (somente leitura, chave própria em BI_TOKEN).
import express from 'express';
import crypto from 'crypto';
import { canonicalComarca } from '../../src/catalogo-tjpr';
import { comarcaInText } from '../../src/catalogo-match';
import { actingPeriods, periodDays } from '../links.ts';
import { saveState } from '../persistence.ts';
import { log } from '../state.ts';
import { brDate, clientIp, csvCell } from '../util.ts';

// Tabela única com as designações: ativas, desistentes e excluídas. Sem e-mail, IP ou motivos.
export const BI_TOKEN = process.env.BI_TOKEN || '';
export let lastBiLog = 0;
/** Confere a chave do Qlik; responde 503/401 e devolve false quando não confere */
export const biAuthorized = (req: express.Request, res: express.Response) => {
  if (!BI_TOKEN) { res.status(503).json({ error: 'Integração não configurada (BI_TOKEN).' }); return false; }
  const given = Buffer.from(String(req.header('x-bi-token') ?? ''));
  const expected = Buffer.from(BI_TOKEN);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) { res.status(401).json({ error: 'Não autorizado.' }); return false; }
  return true;
};
export const sendBi = (req: express.Request, res: express.Response, rows: Record<string, string>[], cols: string[]) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.query.formato === 'csv') {
    const csv = '\ufeff' + [cols.join(';'), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(';'))].join('\r\n') + '\r\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(csv);
  }
  res.json(rows);
};

export function register(app: express.Express) {
  // Designações com o histórico de atuação: um período por magistrado e unidade (início, fim e situação)
  app.get('/api/bi/designacoes', (req, res) => {
    if (!biAuthorized(req, res)) return;
    const situation = { '': 'Ativo', 'Alteração de vinculação': 'Alterado', 'Desistência': 'Desistente', 'Exclusão': 'Excluído' } as const;
    const rows = actingPeriods().map((p) => ({
      edicao: p.editionTitle, magistrado: p.name, area: p.area, unidade: p.unit,
      comarca: p.comarca ?? (p.unit ? canonicalComarca(comarcaInText(p.unit)) ?? comarcaInText(p.unit) ?? '' : ''), atuacao: p.workType,
      situacao: situation[p.endReason], inicio: brDate(p.start), fim: brDate(p.end), dias: String(periodDays(p) ?? ''),
    }));
    console.log(JSON.stringify({ severity: 'INFO', message: `Designações lidas pela integração BI (${rows.length} linhas)`, audit: { category: 'Exportação', ip: clientIp(req) } }));
    if (Date.now() - lastBiLog > 6 * 60 * 60_000) {
      lastBiLog = Date.now();
      log(null, 'Sistema', 'Exportação', `Dados das designações lidos pelo Qlik (${rows.length} linha(s)).`);
      saveState().catch(() => {}); // requisição GET: o registro é gravado à parte
    }
    sendBi(req, res, rows, ['edicao', 'magistrado', 'area', 'unidade', 'comarca', 'atuacao', 'situacao', 'inicio', 'fim', 'dias']);
  });
}
