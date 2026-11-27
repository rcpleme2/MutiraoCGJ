// Relatório da distribuição: processos distribuídos e não distribuídos (com o motivo), carga por relator e totais por Turma.
import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import { S } from '../state.ts';
import { TURMAS, formatCnj, turmaLabel } from './cnj.ts';
import { explainPending, loadOf } from './rules.ts';

const dmy = (ymd?: string) => (ymd ? ymd.split('-').reverse().join('/') : '');

export function distributionReport() {
  const procs = [...S.recursalProcesses].sort((a, b) => a.turma - b.turma || a.cnj.localeCompare(b.cnj));
  const volName = (id?: string) => S.recursalVolunteers.find((v) => v.id === id);
  const distributed = procs.filter((p) => p.status === 'Distribuído').map((p) => ({ processo: formatCnj(p.cnj), turma: p.turma, relator: volName(p.assignedVolunteerId)?.name ?? '—', relatorTurmas: volName(p.assignedVolunteerId)?.turmas ?? [] }));
  const notDistributed = procs.filter((p) => p.status !== 'Distribuído').map((p) => ({ processo: formatCnj(p.cnj), turma: p.turma, motivo: explainPending(p) }));
  const loads = S.recursalVolunteers.filter((v) => v.status === 'Aprovado').map((v) => ({ name: v.name, turmas: v.turmas, inicio: v.startDate ?? '', limite: v.capacity ?? null, recebidos: loadOf(v.id), disponivel: v.capacity == null ? null : Math.max(0, v.capacity - loadOf(v.id)) }))
    .sort((a, b) => b.recebidos - a.recebidos || a.name.localeCompare(b.name, 'pt-BR'));
  const byTurma = TURMAS.map((t) => ({ turma: t, total: procs.filter((p) => p.turma === t).length, distribuidos: distributed.filter((d) => d.turma === t).length, pendentes: notDistributed.filter((d) => d.turma === t).length }));
  return { at: new Date().toISOString(), total: procs.length, distributed, notDistributed, loads, byTurma };
}
export type DistributionReport = ReturnType<typeof distributionReport>;

export function reportXlsx(r: DistributionReport): Buffer {
  const wb = XLSX.utils.book_new();
  const safe = (v: unknown) => (typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v);
  const add = (name: string, rows: Record<string, unknown>[], header: string[], widths: number[]) => {
    const sh = XLSX.utils.json_to_sheet(rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, safe(v)]))), { header });
    sh['!cols'] = widths.map((wch) => ({ wch })); XLSX.utils.book_append_sheet(wb, sh, name);
  };
  add('Resumo', [
    { 'Indicador': 'Processos', 'Quantidade': r.total }, { 'Indicador': 'Distribuídos', 'Quantidade': r.distributed.length }, { 'Indicador': 'Não distribuídos', 'Quantidade': r.notDistributed.length },
    ...r.byTurma.map((t) => ({ 'Indicador': `${turmaLabel(t.turma)}: distribuídos / pendentes`, 'Quantidade': `${t.distribuidos} / ${t.pendentes}` })),
  ], ['Indicador', 'Quantidade'], [48, 16]);
  add('Distribuídos', r.distributed.map((d) => ({ 'Número do processo': d.processo, 'Turma em que tramita': turmaLabel(d.turma), 'Relator designado': d.relator, 'Turma(s) de atuação do relator': d.relatorTurmas.map(turmaLabel).join(' | ') })), ['Número do processo', 'Turma em que tramita', 'Relator designado', 'Turma(s) de atuação do relator'], [30, 22, 40, 34]);
  add('Não distribuídos', r.notDistributed.map((d) => ({ 'Número do processo': d.processo, 'Turma em que tramita': turmaLabel(d.turma), 'Motivo': d.motivo })), ['Número do processo', 'Turma em que tramita', 'Motivo'], [30, 22, 70]);
  add('Carga por relator', r.loads.map((l) => ({ 'Relator': l.name, 'Turma(s) de atuação': l.turmas.map(turmaLabel).join(' | '), 'Início na Turma Recursal': dmy(l.inicio), 'Limite de processos': l.limite ?? 'Sem limite', 'Recebidos': l.recebidos, 'Vagas restantes': l.disponivel ?? '' })), ['Relator', 'Turma(s) de atuação', 'Início na Turma Recursal', 'Limite de processos', 'Recebidos', 'Vagas restantes'], [40, 30, 22, 20, 12, 16]);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** PDF retrato com resumo, distribuídos, não distribuídos (com motivo) e carga por relator. */
export function reportPdf(r: DistributionReport, out: NodeJS.WritableStream) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 40, right: 40 }, bufferPages: true, info: { Title: 'Relatório de distribuição — Mutirão da Turma Recursal' } });
  doc.pipe(out as any);
  const L = 40, W = doc.page.width - 80, NAVY = '#1b2b43', MUTED = '#5f6b7a';
  const stamp = new Date(r.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'long', timeStyle: 'short' });
  const ensure = (h: number) => { if (doc.y + h > doc.page.height - 50) doc.addPage(); };
  const h2 = (t: string) => { ensure(40); doc.moveDown(0.8); doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(t, L, doc.y, { width: W }); doc.moveDown(0.3); };
  const table = (cols: { t: string; w: number }[], rows: string[][]) => {
    const ws = cols.map((c) => c.w * W);
    const head = () => { let x = L; const y = doc.y; doc.rect(L, y, W, 16).fill(NAVY); doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8); cols.forEach((c, i) => { doc.text(c.t, x + 4, y + 4, { width: ws[i] - 8, lineBreak: false }); x += ws[i]; }); doc.fillColor('#000000'); doc.y = y + 19; };
    ensure(60); head();
    if (rows.length === 0) { doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Nenhum.', L + 4, doc.y, { width: W }); doc.moveDown(0.4); return; }
    for (const row of rows) {
      doc.font('Helvetica').fontSize(8);
      const h = Math.max(...row.map((t, i) => doc.heightOfString(t, { width: ws[i] - 8 }))) + 6;
      if (doc.y + h > doc.page.height - 50) { doc.addPage(); head(); }
      const y = doc.y; let x = L;
      row.forEach((t, i) => { doc.fillColor('#1c2530').text(t, x + 4, y + 3, { width: ws[i] - 8 }); x += ws[i]; });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).strokeColor('#e2ded4').lineWidth(0.5).stroke(); doc.y = y + h + 1;
    }
  };
  doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY).text('Relatório de distribuição', L, 50, { width: W });
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`Mutirão da Turma Recursal · ${stamp}`, L, doc.y + 2, { width: W });
  doc.moveDown(0.6).fillColor('#1c2530').fontSize(10).text(`Total de processos: ${r.total}   ·   Distribuídos: ${r.distributed.length}   ·   Não distribuídos: ${r.notDistributed.length}`, L, doc.y, { width: W });
  h2('Situação por Turma');
  table([{ t: 'Turma em que tramita', w: 0.4 }, { t: 'Total', w: 0.2 }, { t: 'Distribuídos', w: 0.2 }, { t: 'Não distribuídos', w: 0.2 }], r.byTurma.filter((t) => t.total).map((t) => [turmaLabel(t.turma), String(t.total), String(t.distribuidos), String(t.pendentes)]));
  h2(`Não distribuídos (${r.notDistributed.length})`);
  table([{ t: 'Número do processo', w: 0.3 }, { t: 'Turma', w: 0.2 }, { t: 'Motivo', w: 0.5 }], r.notDistributed.map((d) => [d.processo, turmaLabel(d.turma), d.motivo]));
  h2(`Distribuídos (${r.distributed.length})`);
  table([{ t: 'Número do processo', w: 0.3 }, { t: 'Turma', w: 0.2 }, { t: 'Relator designado', w: 0.5 }], r.distributed.map((d) => [d.processo, turmaLabel(d.turma), d.relator]));
  h2('Carga por relator');
  table([{ t: 'Relator', w: 0.36 }, { t: 'Atua em', w: 0.24 }, { t: 'Limite', w: 0.14 }, { t: 'Recebidos', w: 0.12 }, { t: 'Restam', w: 0.14 }], r.loads.map((l) => [l.name, l.turmas.map((t) => `${t}ª`).join(', '), l.limite == null ? 'Sem limite' : String(l.limite), String(l.recebidos), l.disponivel == null ? '—' : String(l.disponivel)]));
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) { doc.switchToPage(range.start + i); doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(`Página ${i + 1} de ${range.count}`, L, doc.page.height - 32, { width: W, align: 'right', lineBreak: false }); }
  doc.end();
}
