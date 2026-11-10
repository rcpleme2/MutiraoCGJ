// Rotas do painel de vinculações: designações vigentes, importação, desistências, histórico, planilhas e relatório em PDF.
import express from 'express';
import { fullUnitName } from '../../src/catalogo-tjpr';
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import { sameUnit, unitResolver } from '../catalog.ts';
import { editionById, ensureInitialEdition, INITIAL_EDITION_TITLE } from '../editions.ts';
import { actingPeriods, createInitialLink, describeMatch, isHeaderRow, panelKey, panelRows, periodDays, personOf, preferenceText, samePerson, undoMatch, unitLabel } from '../links.ts';
import { saveState } from '../persistence.ts';
import { log, newId, S } from '../state.ts';
import { type Withdrawal } from '../types.ts';
import { cleanCell, dmyOf, norm, parseSheetText, personKey, validYmd, ymdMonthEnd } from '../util.ts';

// Arte da capa e da contracapa do modelo de relatório do TJPR (assets/relatorio); sem o arquivo, usa fundo azul-marinho.
export const reportArtCache = new Map<string, Buffer | null>();
export const reportArt = (name: 'capa' | 'contracapa') => {
  if (!reportArtCache.has(name)) {
    const file = path.join(process.cwd(), 'assets', 'relatorio', `${name}.jpg`);
    reportArtCache.set(name, fs.existsSync(file) ? fs.readFileSync(file) : null);
  }
  return reportArtCache.get(name)!;
};

export function register(app: express.Express) {
  app.get('/api/panel/presence', (_req, res) => {
    const rows = panelRows();
    const unitOf = new Map(S.units.map((u) => [u.id, u]));
    const resolve = unitResolver();
    const out: Record<string, { comarca: string; inComarca: { name: string; unit: string }[]; inUnit: { name: string; unit: string }[] }> = {};
    for (const u of S.units) {
      if (editionById(u.editionId)?.isInitial) continue;
      const me = resolve(u);
      const inComarca: { name: string; unit: string }[] = [], inUnit: { name: string; unit: string }[] = [];
      for (const r of rows) {
        if (r.unitId === u.id) continue;
        const ru = unitOf.get(r.unitId);
        if (!ru) continue;
        const other = resolve(ru);
        const item = { name: r.name, unit: fullUnitName(ru) };
        if (sameUnit(me, other)) inUnit.push(item);
        else if (me.comarca && norm(other.comarca) === norm(me.comarca)) inComarca.push(item);
      }
      if (inComarca.length || inUnit.length) out[u.id] = { comarca: me.comarca, inComarca, inUnit };
    }
    res.json(out);
  });
  app.get('/api/panel/admin', (_req, res) => {
    // Duplicidade: a mesma pessoa com mais de uma designação vigente (na mesma edição ou em edições diferentes)
    const rows = panelRows();
    const people = rows.map((r) => personOf(r.magistrateId, r.name));
    res.json({
      rows: rows.map((r, i) => {
        const others = rows.filter((_, j) => j !== i && samePerson(people[i], people[j]));
        return others.length ? { ...r, duplicates: others.map((o) => ({ editionTitle: o.editionTitle, unit: unitLabel(o), area: o.area })) } : r;
      }),
      withdrawals: [...S.withdrawals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      transfers: [...S.transfers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      periods: actingPeriods(),
      initialEdition: { id: ensureInitialEdition().id, title: INITIAL_EDITION_TITLE },
    });
  });
  // Importa linhas coladas de planilha: Nome / Área / Designado Para (com ou sem linha de cabeçalho).
  // Cada linha vira uma vinculação real na edição "Vinculações iniciais" (campos desconhecidos em branco), que pode ser ajustada depois.
  // dryRun = apenas confere e mostra o que seria importado.
  app.post('/api/panel/import', (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Cole as linhas da planilha (colunas Nome, Área e Designado Para).' });
    if (text.length > 900_000) return res.status(400).json({ error: 'Texto grande demais. Divida a planilha em partes.' });

    const MAX_ROWS = 3000;
    const raw = parseSheetText(text).filter((r) => r.some((c) => c.trim() !== ''));
    const errors: { line: number; message: string }[] = [];
    const valid: { name: string; area: string; unit: string }[] = [];
    let start = 0;
    if (raw[0] && isHeaderRow(raw[0][0] ?? '', raw[0][1] ?? '', raw[0][2] ?? '')) start = 1;
    if (raw.length - start > MAX_ROWS) return res.status(400).json({ error: `Máximo de ${MAX_ROWS} linhas por importação.` });

    const inBatch = new Set<string>();
    let duplicates = 0;
    const existing = new Set(panelRows().map(panelKey)); // já consta no painel
    for (let i = start; i < raw.length; i++) {
      const [name, area, unit] = [cleanCell(raw[i][0] ?? ''), cleanCell(raw[i][1] ?? ''), cleanCell(raw[i][2] ?? '')];
      const line = i + 1;
      if (!name || !area || !unit) { errors.push({ line, message: 'a linha precisa ter Nome, Área e Designado Para preenchidos (colunas separadas por tabulação).' }); continue; }
      if (name.length > 200 || area.length > 150 || unit.length > 300) { errors.push({ line, message: 'texto longo demais em uma das colunas.' }); continue; }
      if (isHeaderRow(name, area, unit)) continue; // cabeçalho colado fora da 1ª linha
      const key = panelKey({ name, area, unit });
      if (inBatch.has(key) || existing.has(key)) { duplicates++; continue; }
      inBatch.add(key); valid.push({ name, area, unit });
    }

    if (req.body?.dryRun === true) {
      return res.json({ success: true, dryRun: true, total: valid.length, duplicates, errorCount: errors.length, errors: errors.slice(0, 50), preview: valid.slice(0, 10) });
    }
    if (errors.length && req.body?.ignoreErrors !== true) {
      return res.status(400).json({ error: `${errors.length} linha(s) com problema. Corrija a planilha ou confirme a importação ignorando essas linhas.`, errorCount: errors.length, errors: errors.slice(0, 50) });
    }
    if (valid.length === 0 && duplicates > 0) return res.json({ success: true, imported: 0, duplicates, ignored: errors.length }); // tudo já constava no painel
    if (valid.length === 0) return res.status(400).json({ error: 'Nenhuma linha válida para importar.' });

    valid.forEach(createInitialLink);
    log(ensureInitialEdition().id, 'Administração', 'Vinculação', `Painel de vinculações: ${valid.length} designação(ões) importada(s) de planilha para a edição "${INITIAL_EDITION_TITLE}"${errors.length ? `; ${errors.length} linha(s) ignorada(s)` : ''}.`);
    res.json({ success: true, imported: valid.length, duplicates, ignored: errors.length });
  });
  // Exclui uma designação do painel = desfaz a vinculação.
  app.delete('/api/panel/rows/:id', (req, res) => {
    if (!S.matches.some((m) => m.id === req.params.id)) return res.status(404).json({ error: 'Vinculação não encontrada.' });
    undoMatch(req.params.id, 'Vinculação desfeita pelo painel');
    res.json({ success: true });
  });
  // Observação (post-it) de uma designação do painel; texto vazio apaga.
  app.put('/api/panel/rows/:id/postit', (req, res) => {
    const match = S.matches.find((m) => m.id === req.params.id);
    if (!match) return res.status(404).json({ error: 'Vinculação não encontrada.' });
    const text = typeof req.body?.text === 'string' ? req.body.text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim() : '';
    if (text.length > 1000) return res.status(400).json({ error: 'A observação pode ter no máximo 1.000 caracteres.' });
    if ((match.postit ?? '') === text) return res.json({ success: true });
    if (text) { match.postit = text; match.postitUpdatedAt = new Date().toISOString(); }
    else { delete match.postit; delete match.postitUpdatedAt; }
    log(match.editionId, 'Administração', 'Vinculação', `Observação ${text ? 'registrada' : 'apagada'} no painel: ${describeMatch(match)}.`);
    res.json({ success: true });
  });
  app.post('/api/panel/withdrawals', (req, res) => {
    const name = typeof req.body?.name === 'string' ? cleanCell(req.body.name) : '';
    const sei = typeof req.body?.sei === 'string' ? cleanCell(req.body.sei) : '';
    const requestDate = typeof req.body?.requestDate === 'string' ? req.body.requestDate.trim() : '';
    if (!name) return res.status(400).json({ error: 'Magistrado não informado.' });
    // SEI e data do pedido podem ser informados depois (editar a desistência); se vierem, precisam ser válidos
    if (sei && (sei.length < 3 || sei.length > 100)) return res.status(400).json({ error: 'Número do processo SEI inválido.' });
    if (requestDate && !validYmd(requestDate)) return res.status(400).json({ error: 'Data do pedido de desistência inválida.' });

    const rows = panelRows().filter((r) => personKey(r.name) === personKey(name)); // mesma pessoa = mesmo nome
    if (rows.length === 0) return res.status(404).json({ error: 'Este magistrado não consta no painel de vinculações.' });
    const uniq = (xs: string[]) => [...new Set(xs)].join(' / ');
    const record: Withdrawal = {
      id: newId('wd'), editionId: rows[0].editionId, name: rows[0].name, sei, requestDate, createdAt: new Date().toISOString(),
      area: uniq(rows.map((r) => r.area)), unit: uniq(rows.map((r) => unitLabel(r))), magistrateIds: [...new Set(rows.map((r) => r.magistrateId))],
      designations: rows.map((r) => ({ editionId: r.editionId, area: r.area, unit: unitLabel(r), workType: r.workType ?? '', ...(r.startDate ? { startDate: r.startDate } : {}) })),
    };
    rows.forEach((r) => undoMatch(r.id, 'Vinculação desfeita por desistência'));
    record.magistrateIds!.forEach((id) => { const m = S.magistrates.find((x) => x.id === id); if (m) m.status = 'Desistente'; });
    S.withdrawals.push(record);
    log(rows[0].editionId, 'Administração', 'Magistrado', `Desistência registrada: ${record.name} (SEI ${sei || 'não informado'}, pedido em ${dmyOf(requestDate)}${requestDate ? `; atuação até ${dmyOf(ymdMonthEnd(requestDate))}` : ''}). Designações retiradas: ${record.unit}.`);
    res.status(201).json({ success: true, withdrawal: record });
  });
  // Edita a desistência: inclui ou altera depois o número do SEI e a data do pedido.
  app.put('/api/panel/withdrawals/:id', (req, res) => {
    const w = S.withdrawals.find((x) => x.id === req.params.id);
    if (!w) return res.status(404).json({ error: 'Registro não encontrado.' });
    const sei = typeof req.body?.sei === 'string' ? cleanCell(req.body.sei) : w.sei;
    const requestDate = typeof req.body?.requestDate === 'string' ? req.body.requestDate.trim() : (w.requestDate ?? '');
    if (sei && (sei.length < 3 || sei.length > 100)) return res.status(400).json({ error: 'Número do processo SEI inválido.' });
    if (requestDate && !validYmd(requestDate)) return res.status(400).json({ error: 'Data do pedido de desistência inválida.' });
    const changes: string[] = [];
    if (sei !== w.sei) { changes.push(`SEI de "${w.sei || 'não informado'}" para "${sei || 'não informado'}"`); w.sei = sei; }
    if (requestDate !== (w.requestDate ?? '')) { changes.push(`data do pedido de ${dmyOf(w.requestDate)} para ${dmyOf(requestDate)}`); w.requestDate = requestDate || undefined; }
    if (changes.length) log(w.editionId, 'Administração', 'Magistrado', `Desistência de ${w.name} editada: ${changes.join('; ')}.`);
    res.json({ success: true, withdrawal: w });
  });
  // Desfaz o registro de desistência (ex.: erro de lançamento). O magistrado volta à lista de espera; as designações precisam ser refeitas.
  app.delete('/api/panel/withdrawals/:id', (req, res) => {
    const w = S.withdrawals.find((x) => x.id === req.params.id);
    if (!w) return res.status(404).json({ error: 'Registro não encontrado.' });
    S.withdrawals = S.withdrawals.filter((x) => x.id !== w.id);
    const ids = new Set(w.magistrateIds ?? S.magistrates.filter((m) => norm(m.name) === norm(w.name) && m.editionId === w.editionId).map((m) => m.id));
    S.magistrates.filter((m) => ids.has(m.id) && m.status === 'Desistente').forEach((m) => { m.status = 'Lista de Espera'; });
    log(w.editionId, 'Administração', 'Magistrado', `Registro de desistência desfeito: ${w.name} (SEI ${w.sei || 'não informado'}).`);
    res.json({ success: true });
  });
  // Planilha do painel geral (designações vigentes de todas as edições; ?areas= e ?edition= restringem)
  app.get('/api/panel/export.xlsx', async (req, res) => {
    const ed = typeof req.query.edition === 'string' && req.query.edition ? editionById(req.query.edition) : undefined;
    const onlyAreas = typeof req.query.areas === 'string' && req.query.areas ? new Set(req.query.areas.split('|').map((a) => norm(a))) : null;
    const data = panelRows()
      .filter((r) => (!ed || r.editionId === ed.id) && (!onlyAreas || onlyAreas.has(norm(r.area))))
      .sort((a, b) => a.area.localeCompare(b.area, 'pt-BR') || a.name.localeCompare(b.name, 'pt-BR'))
      .map((r) => ({
        'Magistrado(a)': r.name, 'Área de atuação': r.area, 'Unidade': unitLabel(r), 'Comarca': r.comarca ?? '',
        'Preferência atendida': preferenceText(r), '1ª preferência': r.firstPreference ?? '', '2ª preferência': r.secondPreference ?? '', 'Atuação': r.workType ?? '', 'A partir de': r.since ? r.since.split('-').reverse().join('/') : '', 'Edição': r.editionTitle, 'Observação': r.note ?? '',
      }));
    const sheet = XLSX.utils.json_to_sheet(data, { header: ['Magistrado(a)', 'Área de atuação', 'Preferência atendida', '1ª preferência', '2ª preferência', 'Unidade', 'Comarca', 'Atuação', 'A partir de', 'Edição', 'Observação'] });
    sheet['!cols'] = [{ wch: 34 }, { wch: 26 }, { wch: 20 }, { wch: 24 }, { wch: 24 }, { wch: 56 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 30 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Designações');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    log(ed?.id ?? null, 'Administração', 'Exportação', `Planilha das designações vigentes (XLSX) exportada: ${data.length} linha(s).`);
    if (!(await saveState())) return res.status(503).json({ error: 'Não foi possível registrar a exportação. Tente novamente.' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=designacoes-${new Date().toISOString().slice(0, 10)}.xlsx`);
    res.send(buffer);
  });
  // Planilha do histórico de atuação (períodos por magistrado e unidade)
  app.get('/api/panel/periods.xlsx', async (_req, res) => {
    const dmy = (d?: string) => (d ? d.split('-').reverse().join('/') : '');
    const data = actingPeriods().map((p) => ({
      'Magistrado(a)': p.name, 'Unidade': p.unit, 'Área de atuação': p.area, 'Atuação': p.workType, 'Edição': p.editionTitle,
      'Início': dmy(p.start), 'Fim': p.end ? dmy(p.end) : p.endReason ? 'A informar' : 'Em curso', 'Dias': periodDays(p) ?? '', 'Encerramento': p.endReason, 'SEI': p.sei ?? '',
    }));
    const sheet = XLSX.utils.json_to_sheet(data, { header: ['Magistrado(a)', 'Unidade', 'Área de atuação', 'Atuação', 'Edição', 'Início', 'Fim', 'Dias', 'Encerramento', 'SEI'] });
    sheet['!cols'] = [{ wch: 34 }, { wch: 56 }, { wch: 26 }, { wch: 12 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 7 }, { wch: 22 }, { wch: 26 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Histórico de atuação');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    log(null, 'Administração', 'Exportação', `Planilha do histórico de atuação (XLSX) exportada: ${data.length} período(s).`);
    if (!(await saveState())) return res.status(503).json({ error: 'Não foi possível registrar a exportação. Tente novamente.' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=historico-atuacao-${new Date().toISOString().slice(0, 10)}.xlsx`);
    res.send(buffer);
  });
  // Relatório em PDF: designações vigentes (total e por área), alterações de vinculação, desistentes e excluídos.
  app.get('/api/panel/report.pdf', (req, res) => {
    const byArea = req.query.por === 'area'; // versão só com as designações, uma área por bloco
    const onlyAreas = typeof req.query.areas === 'string' && req.query.areas ? new Set(req.query.areas.split('|').map((a) => norm(a))) : null;
    const ed = typeof req.query.edition === 'string' && req.query.edition ? editionById(req.query.edition) : undefined; // relatório de uma só edição
    if (req.query.edition && !ed) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    const rows = panelRows().filter((r) => (!ed || r.editionId === ed.id) && (!byArea || !onlyAreas || onlyAreas.has(norm(r.area))));
    const drops = S.withdrawals.filter((w) => !ed || w.editionId === ed.id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    // Excluídos pela administração (de qualquer situação), com as designações que tinham na data da exclusão
    const excluded = S.magistrates.filter((m) => m.status === 'Excluído' && (!ed || m.editionId === ed.id || m.excludedFrom?.some((h) => h.editionId === ed.id)))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const moves = S.transfers.filter((x) => !ed || x.editionId === ed.id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.effectiveDate.localeCompare(b.effectiveDate));
    const areas = [...new Set(rows.map((r) => r.area.trim()))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const tz = 'America/Sao_Paulo';
    const stamp = new Date().toLocaleString('pt-BR', { timeZone: tz, dateStyle: 'long', timeStyle: 'short' });
    const dmy = (ymd?: string) => (ymd ? ymd.split('-').reverse().join('/') : '—');
    const dayBefore = (ymd: string) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
    const day = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: tz });
    const acting = (w?: string) => (w === 'Audiência' ? 'Audiências' : w === 'Sentença' ? 'Sentença' : w === 'Audiência e Sentença' ? 'Audiência e sentença' : '—');
    const unitCell = (r: { unit: string; comarca?: string; separator?: string; startDate?: string; note?: string }) => unitLabel(r) + (r.note ? `\nObs.: ${r.note}` : '') + (r.startDate ? `\na partir de ${dmy(r.startDate)}` : '');
    // A fonte padrão do PDF cobre o alfabeto latino; troca o que estiver fora dele para não gerar lixo.
    const t = (x: string) => x.replace(/[^\n -~ -ÿ–—‘’“”…•]/g, '?');

    // Diagramação do modelo de relatório do TJPR: capa e contracapa institucionais, margens do modelo,
    // títulos em verde-azulado, tabelas com cabeçalho azul-marinho e células cinza separadas por filetes brancos.
    const doc = new PDFDocument({ size: 'A4', margins: { top: 85, bottom: 85, left: 85, right: 85 }, bufferPages: true,
      info: { Title: 'Relatório de Designações — Mutirão de Julgamento', Author: 'Tribunal de Justiça do Estado do Paraná' } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${byArea ? 'designacoes-por-area-' : 'relatorio-designacoes-'}${new Date().toISOString().slice(0, 10)}.pdf`);
    doc.pipe(res);

    // Cores e tamanhos dos estilos do modelo (Título 1/2/3, Parágrafo normal, Tabela, Rodapé TJPR)
    const NAVY = '#123040', TEAL = '#128588', GREEN = '#4aad99', GRAY = '#5f615f', CELL = '#e9e9e9', FOOT = '#123141', INK = '#000000';
    const reportTitle = byArea ? 'Designações por área de atuação' : 'Relatório de designações';
    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const limit = () => doc.page.height - doc.page.margins.bottom;
    const need = (h: number) => { if (doc.y + h > limit()) doc.addPage(); };
    const fullPage = (img: Buffer | null) => {
      if (img) doc.image(img, 0, 0, { width: doc.page.width, height: doc.page.height });
      else doc.rect(0, 0, doc.page.width, doc.page.height).fill(NAVY);
    };
    fullPage(reportArt('capa'));
    {
      const bx = L + 238, bw = 215, mid = 409 + 51;
      const sub = t(`Mutirão de Julgamento${ed ? `\n${ed.title}` : ''}`);
      doc.font('Helvetica-Bold').fontSize(24);
      const th = doc.heightOfString(t(reportTitle), { width: bw });
      doc.font('Helvetica').fontSize(15);
      const sh = doc.heightOfString(sub, { width: bw });
      const y0 = mid - (th + 8 + sh) / 2;
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(24).text(t(reportTitle), bx, y0, { width: bw });
      doc.font('Helvetica').fontSize(15).text(sub, bx, y0 + th + 8, { width: bw });
    }
    doc.addPage();

    type Col = { label: string; w: number; align?: 'left' | 'right' | 'center' };
    const PAD = 5.6, GAP = 1; // margem interna das células e meio filete branco entre elas
    const cellBox = (x: number, y: number, w: number, h: number, fill: string) => doc.rect(x + GAP, y + GAP, w - 2 * GAP, h - 2 * GAP).fill(fill);
    // Texto da célula: a 1ª linha em negrito (Tabela texto TJPR), as complementares em regular
    const cellParts = (c: string) => { const [head, ...rest] = t(c).split('\n'); return { head, rest: rest.join('\n') }; };
    const cellHeight = (c: string, w: number) => {
      const { head, rest } = cellParts(c);
      let h = doc.font('Helvetica-Bold').fontSize(9).heightOfString(head || ' ', { width: w - 2 * PAD, lineGap: 1.5 });
      if (rest) h += 1 + doc.font('Helvetica').fontSize(8.2).heightOfString(rest, { width: w - 2 * PAD, lineGap: 1.5 });
      return h;
    };
    const drawHead = (cols: Col[]) => {
      const y = doc.y, h = 24;
      let x = L;
      cols.forEach((c) => {
        cellBox(x, y, c.w, h, NAVY);
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8).text(t(c.label).toUpperCase(), x + PAD, y + 8.5, { width: c.w - 2 * PAD, align: c.align ?? 'center', lineBreak: false });
        x += c.w;
      });
      doc.y = y + h;
    };
    type Row = string[] | { sep: string; count: string };
    const rowHeight = (cols: Col[], r: string[]) => Math.max(...r.map((c, k) => cellHeight(c, cols[k].w))) + 2 * PAD + 2;
    const table = (cols: Col[], data: Row[]) => {
      // o cabeçalho não fica sozinho no pé da página: vai junto com a 1ª linha (ou com a faixa e a linha seguinte)
      const first = data[0], second = data[1];
      need(24 + (!first ? 0 : Array.isArray(first) ? rowHeight(cols, first) : 24 + (Array.isArray(second) ? rowHeight(cols, second) : 0)));
      drawHead(cols);
      data.forEach((r, idx) => {
        if (!Array.isArray(r)) { // faixa da área de atuação, de ponta a ponta, com a quantidade de magistrados
          const next = data[idx + 1];
          if (doc.y + 24 + (Array.isArray(next) ? rowHeight(cols, next) : 0) > limit()) { doc.addPage(); drawHead(cols); }
          const y = doc.y;
          cellBox(L, y, W, 24, TEAL);
          doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text(t(r.sep).toUpperCase(), L + PAD + 2, y + 8, { width: W - 130, lineBreak: false });
          doc.font('Helvetica').fontSize(8).text(t(r.count), L + W - 120, y + 8.5, { width: 120 - PAD - 2, align: 'right', lineBreak: false });
          doc.y = y + 24;
          return;
        }
        const h = rowHeight(cols, r);
        if (doc.y + h > limit()) { doc.addPage(); drawHead(cols); }
        const y = doc.y;
        let x = L;
        r.forEach((c, k) => {
          cellBox(x, y, cols[k].w, h, CELL);
          const { head, rest } = cellParts(c);
          const opts = { width: cols[k].w - 2 * PAD, align: cols[k].align ?? 'left', lineGap: 1.5 } as const;
          doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(head, x + PAD, y + PAD + 1, opts);
          if (rest) doc.fillColor(GRAY).font('Helvetica').fontSize(8.2).text(rest, x + PAD, doc.y + 1, opts);
          x += cols[k].w;
        });
        doc.y = y + h;
      });
      doc.y += 18;
    };
    const paragraph = (text: string) => {
      doc.fillColor(INK).font('Helvetica').fontSize(10.5).text(t(text), L, doc.y, { width: W, align: 'justify', indent: 20, lineGap: 4 });
      doc.y += 8;
    };
    const section = (title: string, note?: string) => {
      need(110);
      doc.y += 10;
      doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(14).text(t(title), L, doc.y, { width: W });
      doc.y += 6;
      if (note) paragraph(note);
      doc.y += 4;
    };
    const empty = (msg: string) => { doc.fillColor(GRAY).font('Helvetica-Oblique').fontSize(10).text(msg, L, doc.y, { width: W }); doc.y += 18; };
    const countOf = (list: { name: string }[]) => { const n = new Set(list.map((r) => r.name.toLowerCase())).size; return `${n} ${n === 1 ? 'magistrado' : 'magistrados'}`; };
    doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(18).text(t(reportTitle).toUpperCase(), L, doc.y, { width: W });
    doc.y += 4;
    doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(12).text(t(`Mutirão de Julgamento${ed ? ` — ${ed.title}` : ''}`), L, doc.y, { width: W });
    doc.y += 12;
    paragraph(`Corregedoria-Geral da Justiça do Tribunal de Justiça do Estado do Paraná. Documento de uso restrito da administração, emitido em ${stamp} (horário de Brasília).`);

    // Resumo em números, no padrão das tabelas do modelo
    if (!byArea) {
      const stats = [['Designações vigentes', rows.length], ['Áreas de atuação', areas.length], ['Alterações de vinculação', moves.length], ['Desistentes', drops.length], ['Excluídos', excluded.length]] as const;
      doc.y += 8;
      need(90);
      const cw = W / stats.length, sy = doc.y;
      cellBox(L, sy, W, 24, NAVY);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8).text('RESUMO', L, sy + 8.5, { width: W, align: 'center', lineBreak: false });
      stats.forEach(([label, n], i) => {
        const x = L + i * cw;
        cellBox(x, sy + 24, cw, 62, CELL);
        doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(18).text(String(n), x, sy + 32, { width: cw, align: 'center', lineBreak: false });
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.6).text(t(label), x + PAD, sy + 56, { width: cw - 2 * PAD, align: 'center', lineGap: 1 });
      });
      doc.y = sy + 86 + 12;
    }
    const desigCols: Col[] = [{ label: 'Nº', w: 30, align: 'center' }, { label: 'Magistrado(a)', w: 135 }, { label: 'Unidade designada', w: W - 225 }, { label: 'Atuação', w: 60 }];
    if (byArea) {
      section('Designações vigentes', 'Classificadas por área de atuação e, dentro de cada área, em ordem alfabética.');
      if (rows.length === 0) empty('Nenhuma designação vigente.');
      areas.forEach((area) => {
        const list = rows.filter((r) => r.area.trim() === area).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.unit.localeCompare(b.unit, 'pt-BR'));
        table(desigCols, [{ sep: area, count: countOf(list) }, ...list.map((r, k): Row => [String(k + 1), r.name, unitCell(r), acting(r.workType)])]);
      });
    } else {
      section('1. Designações vigentes', 'Classificadas por área de atuação e, dentro de cada área, em ordem alfabética. Permanecem válidas até o registro da desistência.');
      if (rows.length === 0) empty('Nenhuma designação vigente.');
      else {
        const data: Row[] = [];
        let n = 0;
        areas.forEach((area) => {
          const list = rows.filter((r) => r.area.trim() === area).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.unit.localeCompare(b.unit, 'pt-BR'));
          data.push({ sep: area, count: countOf(list) });
          list.forEach((r) => data.push([String(++n), r.name, unitCell(r), acting(r.workType)]));
        });
        table(desigCols, data);
      }
      section('2. Alterações de vinculação', 'Alterações de vara e/ou de área de atuação. A vinculação anterior vale até o dia anterior à data informada; a nova vale a partir dela.');
      if (moves.length === 0) empty('Nenhuma alteração de vinculação registrada.');
      else table([{ label: 'Magistrado(a)', w: 105 }, { label: 'Vinculação anterior', w: (W - 105) / 2 }, { label: 'Nova vinculação', w: (W - 105) / 2 }],
        moves.map((m) => [m.name,
          `${m.fromUnit}\nÁrea: ${m.area || '—'} · ${acting(m.fromWorkType)} · até ${dmy(dayBefore(m.effectiveDate))}`,
          `${m.toUnit}\nÁrea: ${m.toArea || m.area || '—'}${m.toArea && m.toArea.trim() !== m.area.trim() ? ' (alterada)' : ''} · ${acting(m.toWorkType)} · a partir de ${dmy(m.effectiveDate)}${m.sei ? `\nSEI: ${m.sei}` : ''}`]));
      section('3. Desistentes', 'Magistrados que desistiram da participação, com o processo SEI e a data do pedido. Havendo nova inscrição deferida, a desistência vale apenas para o período anterior.');
      if (drops.length === 0) empty('Nenhuma desistência registrada.');
      else table([{ label: 'Magistrado(a)', w: 95 }, { label: 'Área e unidade', w: 100 }, { label: 'Processo SEI', w: 100 }, { label: 'Pedido', w: 62 }, { label: 'Situação', w: W - 357 }],
        drops.map((w) => [w.name, `${w.area}\n${w.unit}`, w.sei || 'A informar', w.requestDate ? dmy(w.requestDate) : 'A informar',
          w.endedAt ? `Apenas no período, até ${day(w.endedAt)}` : 'Em vigor']));
      section('4. Excluídos', 'Magistrados excluídos pela administração, com as designações que tinham na data da exclusão (desfeitas com ela), o processo SEI e o motivo registrado.');
      if (excluded.length === 0) empty('Nenhuma exclusão registrada.');
      else table([{ label: 'Magistrado(a)', w: 100 }, { label: 'Designação na exclusão', w: 130 }, { label: 'Processo SEI', w: 95 }, { label: 'Motivo', w: W - 325 }],
        excluded.map((m) => {
          const held = (m.excludedFrom ?? []).filter((h) => !ed || h.editionId === ed.id);
          return [m.name,
            held.length ? held.map((h) => `${h.unit}${h.area ? `\nÁrea: ${h.area}` : ''}`).join('\n') : 'Sem designação vigente',
            `${m.exclusionSei || 'A informar'}${m.excludedAt ? `\nExcluído em ${day(m.excludedAt)}` : ''}`,
            m.exclusionReason || '—'];
        }));
    }
    const range = doc.bufferedPageRange();
    for (let i = 1; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const m = doc.page.margins; doc.page.margins = { top: 0, bottom: 0, left: m.left, right: m.right }; // permite escrever nas margens
      const fy = doc.page.height - 50;
      doc.fillColor(FOOT).font('Helvetica-Bold').fontSize(9)
        .text(t(`${reportTitle}  |  Mutirão de Julgamento — CGJ/TJPR`), L, fy, { width: W - 40, lineBreak: false })
        .text(String(i + 1), L + W - 40, fy, { width: 40, align: 'right', lineBreak: false });
      doc.page.margins = m;
    }
    doc.addPage();
    fullPage(reportArt('contracapa'));
    doc.end();
  });
}
