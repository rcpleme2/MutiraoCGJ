// Cruzamento (mutirão normal): magistrados voluntários que representam uma unidade inscrita.
// A unidade que o magistrado representa é identificada primeiro pelo campo Lotação da inscrição (aba Magistrados);
// se a lotação estiver em branco, pelo campo Responsável pela unidade no cadastro das unidades.
// Só entram unidades com pedido escolhido e com magistrado vinculado atualmente; inscrições rejeitadas ou excluídas ficam de fora.
import express from 'express';
import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import { canonicalComarca } from '../../src/catalogo-tjpr';
import { resolveCatalog } from '../../src/catalogo-match';
import { unitResolver, sameUnit } from '../catalog.ts';
import { scopeOf } from '../editions.ts';
import { panelRows, unitLabel } from '../links.ts';
import { log } from '../state.ts';
import { saveState } from '../persistence.ts';
import { S } from '../state.ts';
import { magistrateStatusLabel, norm, personKey } from '../util.ts';

type Scope = NonNullable<ReturnType<typeof scopeOf>>;
export function titularesData(scope: Scope) {
    const linkedUnits = new Set(S.matches.map((m) => m.unitId));
    const units = S.units.filter((u) => scope.has(u) && u.selection === 'Escolhida' && linkedUnits.has(u.id));
    const resolve = unitResolver();
    const rows = panelRows();
    const out = new Map<string, any>();
    // Magistrados designados (vinculados) a cada unidade
    const designatedTo = (unitId: string) => S.matches.filter((mt) => mt.unitId === unitId).map((mt) => {
      const mag = S.magistrates.find((x) => x.id === mt.magistrateId);
      const since = mt.startDate ?? S.editions.find((x) => x.id === mt.editionId)?.startDate ?? null;
      return { name: mag?.name ?? 'Magistrado removido', area: mt.assignedArea, workType: mt.workType ?? '', since };
    });
    for (const m of S.magistrates) {
      if (!scope.has(m) || m.status === 'Excluído' || m.status === 'Rejeitado') continue;
      const key = personKey(m.name);
      if (!key) continue;
      const lotacao = m.currentLocation?.trim() ?? '';
      let found: { unit: typeof units[number]; by: 'lotação' | 'responsável' }[] = [];
      if (lotacao) {
        // Lotação preenchida: compara com a unidade (pelo catálogo oficial; sem ele, pelo nome completo)
        const id = m.locationCatalogId ?? resolveCatalog(lotacao, canonicalComarca(m.locationComarca))?.id;
        const mine = { id, full: norm(lotacao) };
        found = units.filter((u) => sameUnit(mine, resolve(u))).map((unit) => ({ unit, by: 'lotação' as const }));
      } else {
        // Lotação em branco: responsável pela unidade no cadastro
        found = units.filter((u) => u.judgeName?.trim() && personKey(u.judgeName) === key).map((unit) => ({ unit, by: 'responsável' as const }));
      }
      if (found.length === 0) continue;
      const e = out.get(key) ?? {
        name: m.name, email: m.email, status: magistrateStatusLabel(m.status), represents: [] as any[],
        designated: rows.filter((r) => personKey(r.name) === key).map((r) => ({ unit: unitLabel(r), area: r.area, workType: r.workType ?? '', since: r.since ?? null, edition: r.editionTitle })),
      };
      for (const { unit: u, by } of found) {
        e.represents.push({ unit: unitLabel({ unit: u.unitName, comarca: u.comarca, separator: u.separator }), edition: S.editions.find((x) => x.id === u.editionId)?.title ?? '', selection: u.selection, status: u.status, by, designatedHere: designatedTo(u.id) });
      }
      out.set(key, e);
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) as TitularRow[];
}

export interface TitularRow {
  name: string; email: string; status: string;
  represents: { unit: string; edition: string; selection: string; status: string; by: 'lotação' | 'responsável'; designatedHere: { name: string; area: string; workType: string; since: string | null }[] }[];
  designated: { unit: string; area: string; workType: string; since: string | null; edition: string }[];
}
const dmy = (ymd: string | null) => (ymd ? ymd.split('-').reverse().join('/') : '');
/** Uma linha por unidade representada (e por magistrado designado a ela) */
function flat(rows: TitularRow[]) {
  const out: Record<string, string>[] = [];
  for (const r of rows) {
    const own = r.designated.map((d) => `${d.unit}${d.since ? ` (desde ${dmy(d.since)})` : ''}`).join(' | ') || 'Aguardando vinculação';
    for (const u of r.represents) {
      const des = u.designatedHere.length ? u.designatedHere : [null];
      for (const d of des) {
        out.push({
          'Magistrado(a) voluntário(a)': r.name, 'E-mail': r.email, 'Inscrição': r.status,
          'Unidade que representa': u.unit, 'Janela': u.edition, 'Situação da unidade': u.selection === 'Escolhida' ? `Escolhida · ${u.status}` : u.selection, 'Identificada pela': u.by,
          'Magistrado designado para a unidade': d ? d.name : '', 'Área': d?.area ?? '', 'Atuação': d?.workType ?? '', 'Desde': d ? dmy(d.since) : '',
          'Unidade em que o voluntário está designado': own,
        });
      }
    }
  }
  return out;
}

export function register(app: express.Express) {
  app.get('/api/titulares-voluntarios', (req, res) => {
    const scope = scopeOf(req);
    if (!scope) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    res.json(titularesData(scope));
  });
  app.get('/api/titulares-voluntarios/export.xlsx', async (req, res) => {
    const scope = scopeOf(req);
    if (!scope) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    const data = flat(titularesData(scope));
    const header = ['Magistrado(a) voluntário(a)', 'E-mail', 'Inscrição', 'Unidade que representa', 'Janela', 'Situação da unidade', 'Identificada pela', 'Magistrado designado para a unidade', 'Área', 'Atuação', 'Desde', 'Unidade em que o voluntário está designado'];
    const sheet = XLSX.utils.json_to_sheet(data.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, /^[=+\-@]/.test(v) ? `'${v}` : v]))), { header });
    sheet['!cols'] = [{ wch: 34 }, { wch: 28 }, { wch: 18 }, { wch: 50 }, { wch: 24 }, { wch: 20 }, { wch: 14 }, { wch: 34 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 50 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, sheet, 'Titulares voluntários');
    log(null, 'Administração', 'Exportação', `Relatório de titulares voluntários (XLSX) exportado: ${data.length} linha(s).`);
    if (!(await saveState())) return res.status(503).json({ error: 'Não foi possível registrar a exportação. Tente novamente.' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=titulares-voluntarios-${Date.now()}.xlsx`);
    res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  });
  app.get('/api/titulares-voluntarios/export.pdf', async (req, res) => {
    const scope = scopeOf(req);
    if (!scope) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    const rows = titularesData(scope);
    log(null, 'Administração', 'Exportação', `Relatório de titulares voluntários (PDF) exportado: ${rows.length} magistrado(s).`);
    if (!(await saveState())) return res.status(503).json({ error: 'Não foi possível registrar a exportação. Tente novamente.' });
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 40, bottom: 40, left: 36, right: 36 }, bufferPages: true, info: { Title: 'Titulares voluntários' } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=titulares-voluntarios-${Date.now()}.pdf`);
    doc.pipe(res);
    const L = 36, W = doc.page.width - 72;
    const cols = [{ t: 'Magistrado(a) voluntário(a)', w: 0.19 }, { t: 'Unidade que representa', w: 0.27 }, { t: 'Magistrado designado para a unidade', w: 0.27 }, { t: 'Unidade em que o voluntário está designado', w: 0.27 }].map((c) => ({ ...c, w: c.w * W }));
    const head = () => {
      let x = L; const y = doc.y;
      doc.rect(L, y, W, 18).fill('#1b2b43');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
      for (const c of cols) { doc.text(c.t, x + 4, y + 5, { width: c.w - 8, lineBreak: false }); x += c.w; }
      doc.fillColor('#000000'); doc.y = y + 22;
    };
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#1b2b43').text('Responsáveis por unidade que também são voluntários', L, 40, { width: W });
    doc.font('Helvetica').fontSize(9).fillColor('#5f6b7a').text(`${scope.title} · ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · ${rows.length} magistrado(s). Unidades escolhidas com magistrado vinculado; inscrições rejeitadas ou excluídas não entram.`, L, doc.y + 2, { width: W });
    doc.moveDown(0.8); doc.fillColor('#000000'); head();
    for (const r of rows) {
      const c1 = `${r.name}\n${r.email}\nInscrição: ${r.status}`;
      const c2 = r.represents.map((u) => `${u.unit}\n${u.edition} · ${u.selection}${u.selection === 'Escolhida' ? ` · ${u.status}` : ''} · pela ${u.by}`).join('\n\n');
      const c3 = r.represents.map((u) => (u.designatedHere.length ? u.designatedHere.map((d) => `${d.name}\n${d.area}${d.workType ? ` · ${d.workType}` : ''}${d.since ? ` · desde ${dmy(d.since)}` : ''}`).join('\n') : 'Sem magistrado designado')).join('\n\n');
      const c4 = r.designated.length ? r.designated.map((d) => `${d.unit}\n${d.area}${d.workType ? ` · ${d.workType}` : ''}${d.since ? ` · desde ${dmy(d.since)}` : ''}`).join('\n\n') : 'Aguardando vinculação (sem designação)';
      doc.font('Helvetica').fontSize(8);
      const texts = [c1, c2, c3, c4];
      const h = Math.max(...texts.map((t, i) => doc.heightOfString(t, { width: cols[i].w - 8 }))) + 8;
      if (doc.y + h > doc.page.height - 40) { doc.addPage(); head(); }
      const y = doc.y; let x = L;
      texts.forEach((t, i) => { doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#1c2530').text(t, x + 4, y + 3, { width: cols[i].w - 8 }); x += cols[i].w; });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).strokeColor('#e2ded4').lineWidth(0.5).stroke();
      doc.y = y + h + 2;
    }
    if (rows.length === 0) doc.font('Helvetica').fontSize(10).fillColor('#5f6b7a').text('Nenhum responsável por unidade consta também como voluntário.', L, doc.y + 6);
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) { doc.switchToPage(range.start + i); doc.font('Helvetica').fontSize(7).fillColor('#5f6b7a').text(`Página ${i + 1} de ${range.count}`, L, doc.page.height - 28, { width: W, align: 'right', lineBreak: false }); }
    doc.end();
  });
}
