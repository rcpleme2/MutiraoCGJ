// Mutirão da Turma Recursal: envio de processos, voluntários e distribuição aos relatores.
import express from 'express';
import XLSX from 'xlsx';
import { saveState } from '../persistence.ts';
import { log, newId, reqCtx, S } from '../state.ts';
import { type RecursalProcess, type RecursalVolunteer } from '../types.ts';
import { cleanText, csvCell, freeText } from '../util.ts';
import { confirmedWipe, EMAIL_DOMAIN_MESSAGE, EMAIL_RE, emailDomainOk } from '../validation.ts';
import { TURMAS, cnjCheckDigits, formatCnj, normalizeTurma, turmaLabel } from '../recursal/cnj.ts';
import { readSheet } from '../recursal/parse.ts';
import { checkRows } from '../recursal/rows.ts';
import { blockReason, canAssign, hasRoom, loadOf, suggestDistribution } from '../recursal/rules.ts';

const MAX_MANUAL_ROWS = 5000;
const volView = (v: RecursalVolunteer) => ({ ...v, load: loadOf(v.id) });
const procView = (p: RecursalProcess) => {
  const v = p.assignedVolunteerId ? S.recursalVolunteers.find((x) => x.id === p.assignedVolunteerId) : undefined;
  return { ...p, formatted: formatCnj(p.cnj), volunteerName: v?.name ?? null, volunteerTurmas: v?.turmas ?? [] };
};

/** Lê identificação + linhas (digitadas ou de arquivo) do corpo da requisição. */
function readSubmission(body: any): { name: string; email: string; rows: string[][]; source: 'manual' | 'csv' | 'xlsx'; fileName?: string } | { error: string } {
  const name = cleanText(body?.submitterName, 120);
  const email = cleanText(body?.submitterEmail, 160)?.toLowerCase() ?? '';
  if (!name) return { error: 'Informe seu nome.' };
  if (!EMAIL_RE.test(email)) return { error: 'Informe um e-mail válido.' };
  if (!emailDomainOk(email)) return { error: EMAIL_DOMAIN_MESSAGE };
  try {
    if (body?.file && typeof body.file.base64 === 'string') {
      const fileName = String(body.file.name ?? 'arquivo').slice(0, 120);
      const { rows, source } = readSheet(body.file.base64, fileName);
      if (!rows.length) return { error: 'O arquivo não tem nenhuma linha de processo.' };
      return { name, email, rows, source, fileName };
    }
  } catch (e: any) { return { error: e.message }; }
  if (!Array.isArray(body?.rows) || body.rows.length === 0) return { error: 'Informe ao menos um processo.' };
  if (body.rows.length > MAX_MANUAL_ROWS) return { error: `Limite de ${MAX_MANUAL_ROWS} processos por envio.` };
  const rows = body.rows.map((r: any) => (Array.isArray(r) ? [String(r[0] ?? '').slice(0, 60), String(r[1] ?? '').slice(0, 60)] : ['', '']));
  return { name, email, rows, source: 'manual' };
}
const summarize = (checked: ReturnType<typeof checkRows>) => ({
  total: checked.length,
  valid: checked.filter((r) => r.state === 'valida').length,
  invalid: checked.filter((r) => r.state === 'invalida').length,
  duplicates: checked.filter((r) => r.state === 'duplicada').length,
});

export const existingCnj = () => new Set(S.recursalProcesses.map((p) => p.cnj));

/** Planilha/CSV de saída: número, Turma em que tramita, relator designado. */
function exportRows(req: express.Request) {
  const turma = req.query.turma ? Number(req.query.turma) : 0;
  const only = String(req.query.situacao ?? '');
  return S.recursalProcesses
    .filter((p) => (!turma || p.turma === turma) && (!only || p.status === only))
    .sort((a, b) => a.turma - b.turma || a.cnj.localeCompare(b.cnj))
    .map((p) => { const v = procView(p); return { 'Número do processo': v.formatted, 'Turma em que tramita': turmaLabel(p.turma), 'Relator designado': v.volunteerName ?? '', 'Turma(s) de atuação do relator': v.volunteerTurmas.map(turmaLabel).join(' | '), 'Situação': p.status }; });
}

export function register(app: express.Express) {
  /* ------------ públicas ------------ */
  // Modelo para preenchimento: 1ª coluna = número do processo, 2ª = Turma
  const sample = (seq: number) => { const n = String(seq).padStart(7, '0'), rest = '202481600' + '01'; return n + cnjCheckDigits(n + '00' + rest) + rest; };
  const templateRows = [[formatCnj(sample(1234)), '1ª'], [sample(5678), '3ª']];
  app.get('/api/recursal/template.csv', (_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=modelo-mutirao-turma-recursal.csv');
    res.send('﻿' + ['Número do processo;Turma Recursal', ...templateRows.map((r) => r.join(';'))].join('\r\n') + '\r\n');
  });
  app.get('/api/recursal/template.xlsx', (_req, res) => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Número do processo', 'Turma Recursal'], ...templateRows]);
    // Texto puro: o Excel não pode transformar o número CNJ em notação científica
    for (const ref of Object.keys(sheet)) if (!ref.startsWith('!')) { (sheet[ref] as XLSX.CellObject).t = 's'; (sheet[ref] as XLSX.CellObject).z = '@'; }
    sheet['!cols'] = [{ wch: 32 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, sheet, 'Processos');
    const help = XLSX.utils.aoa_to_sheet([
      ['Como preencher'],
      ['1ª coluna: número do processo no padrão CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO), com ou sem pontos e traço.'],
      ['2ª coluna: Turma Recursal em que o processo tramita: 1ª, 2ª, 3ª, 4ª, 5ª ou 6ª.'],
      ['Mantenha as colunas em formato TEXTO para que o Excel não altere os números.'],
      ['Apague as linhas de exemplo antes de enviar. Números repetidos ou fora do padrão serão apontados na conferência.'],
    ]);
    help['!cols'] = [{ wch: 110 }];
    XLSX.utils.book_append_sheet(wb, help, 'Instruções');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=modelo-mutirao-turma-recursal.xlsx');
    res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  });

  // Conferência (não grava nada): aponta números fora do padrão CNJ, Turma ausente e duplicidades
  app.post('/api/recursal/validate', (req, res) => {
    const sub = readSubmission(req.body);
    if ('error' in sub) return res.status(400).json({ error: sub.error });
    const checked = checkRows(sub.rows, existingCnj());
    res.json({ summary: summarize(checked), rows: checked });
  });
  // Envio: grava somente as linhas válidas e não duplicadas
  app.post('/api/recursal/processes', (req, res) => {
    const sub = readSubmission(req.body);
    if ('error' in sub) return res.status(400).json({ error: sub.error });
    const checked = checkRows(sub.rows, existingCnj());
    const s = summarize(checked);
    if (s.valid === 0) return res.status(422).json({ error: 'Nenhum processo válido para enviar. Corrija os apontamentos e tente novamente.', summary: s, rows: checked });
    const now = new Date().toISOString();
    const batchId = newId('rbatch');
    for (const r of checked) {
      if (r.state !== 'valida' || !r.turma) continue;
      S.recursalProcesses.push({ id: newId('rproc'), cnj: r.cnj, turma: r.turma, batchId, submitterName: sub.name, submitterEmail: sub.email, createdAt: now, status: 'Pendente' });
    }
    S.recursalBatches.push({ id: batchId, source: sub.source, ...(sub.fileName ? { fileName: sub.fileName } : {}), submitterName: sub.name, submitterEmail: sub.email, total: s.total, accepted: s.valid, rejected: s.invalid, duplicates: s.duplicates, createdAt: now });
    log(null, 'Público', 'Recursal', `Mutirão Recursal: ${sub.name} enviou ${s.valid} processo(s) (${s.invalid} fora do padrão, ${s.duplicates} duplicado(s)).`);
    res.status(201).json({ success: true, summary: s, rows: checked.filter((r) => r.state !== 'valida') });
  });
  // Inscrição de voluntário
  app.post('/api/recursal/volunteers', (req, res) => {
    const name = cleanText(req.body?.name, 120);
    const email = cleanText(req.body?.email, 160)?.toLowerCase() ?? '';
    if (!name) return res.status(400).json({ error: 'Informe seu nome.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
    if (!emailDomainOk(email)) return res.status(400).json({ error: EMAIL_DOMAIN_MESSAGE });
    const turmas = [...new Set((Array.isArray(req.body?.turmas) ? req.body.turmas : []).map((t: unknown) => normalizeTurma(t)).filter((t: number | null): t is number => t !== null))].sort() as number[];
    if (turmas.length === 0) return res.status(400).json({ error: 'Indique em qual(is) Turma(s) Recursal você já atua.' });
    if (req.body?.declaration !== true) return res.status(400).json({ error: 'Confirme a declaração.' });
    const capRaw = req.body?.capacity;
    const capacity = capRaw === undefined || capRaw === null || capRaw === '' ? undefined : Number(capRaw);
    if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000)) return res.status(400).json({ error: 'A quantidade máxima de processos deve ser um número inteiro de 1 a 1000.' });
    const note = freeText(req.body?.note, 500);
    const prev = S.recursalVolunteers.find((v) => v.email === email);
    if (prev) {
      if (prev.status !== 'Aguardando') return res.status(409).json({ error: 'Este e-mail já está inscrito como voluntário. Para alterar os dados, fale com a administração.' });
      Object.assign(prev, { name, turmas, capacity, note });
      log(null, 'Público', 'Recursal', `Mutirão Recursal: inscrição de voluntário atualizada (${name}).`);
      return res.json({ success: true, updated: true });
    }
    S.recursalVolunteers.push({ id: newId('rvol'), name, email, turmas, ...(capacity ? { capacity } : {}), status: 'Aguardando', ...(note ? { note } : {}), createdAt: new Date().toISOString() });
    log(null, 'Público', 'Recursal', `Mutirão Recursal: novo voluntário ${name} (atua em ${turmas.map(turmaLabel).join(', ')}).`);
    res.status(201).json({ success: true });
  });

  /* ------------ administração ------------ */
  app.get('/api/recursal/overview', (_req, res) => {
    const vols = S.recursalVolunteers.map(volView);
    const matrix = TURMAS.map((t) => ({ turma: t, pending: S.recursalProcesses.filter((p) => p.turma === t && p.status === 'Pendente').length, distributed: S.recursalProcesses.filter((p) => p.turma === t && p.status === 'Distribuído').length, apt: S.recursalVolunteers.filter((v) => v.status === 'Aprovado' && !v.turmas.includes(t)).length }));
    res.json({
      counts: { processes: S.recursalProcesses.length, pending: S.recursalProcesses.filter((p) => p.status === 'Pendente').length, distributed: S.recursalProcesses.filter((p) => p.status === 'Distribuído').length, volunteers: vols.length, approved: vols.filter((v) => v.status === 'Aprovado').length },
      matrix, volunteers: vols, processes: S.recursalProcesses.map(procView), batches: [...S.recursalBatches].reverse().slice(0, 100),
    });
  });
  app.patch('/api/recursal/volunteers/:id', (req, res) => {
    const v = S.recursalVolunteers.find((x) => x.id === req.params.id);
    if (!v) return res.status(404).json({ error: 'Voluntário não encontrado.' });
    const next = { ...v };
    if (req.body?.status !== undefined) { if (!['Aguardando', 'Aprovado', 'Inativo'].includes(req.body.status)) return res.status(400).json({ error: 'Situação inválida.' }); next.status = req.body.status; }
    if (req.body?.turmas !== undefined) {
      const t = [...new Set((Array.isArray(req.body.turmas) ? req.body.turmas : []).map((x: unknown) => normalizeTurma(x)).filter((x: number | null): x is number => x !== null))].sort() as number[];
      if (!t.length) return res.status(400).json({ error: 'Informe ao menos uma Turma.' });
      next.turmas = t;
    }
    if (req.body?.capacity !== undefined) {
      const c = req.body.capacity === null || req.body.capacity === '' ? undefined : Number(req.body.capacity);
      if (c !== undefined && (!Number.isInteger(c) || c < 1 || c > 1000)) return res.status(400).json({ error: 'Capacidade inválida.' });
      if (c === undefined) delete next.capacity; else next.capacity = c;
    }
    // Regra de ouro também na edição: não pode ficar com processo da própria Turma nem ser desativado com processos
    const mine = S.recursalProcesses.filter((p) => p.assignedVolunteerId === v.id);
    const bad = mine.find((p) => next.turmas.includes(p.turma));
    if (bad) return res.status(422).json({ error: `Já há processo da ${turmaLabel(bad.turma)} designado a este relator. Desfaça a designação antes.` });
    if (next.status !== 'Aprovado' && mine.length) return res.status(422).json({ error: 'Este relator tem processos designados. Desfaça as designações antes de mudar a situação.' });
    Object.assign(v, next);
    log(null, 'Administração', 'Recursal', `Voluntário do Mutirão Recursal atualizado: ${v.name} (${v.status}; atua em ${v.turmas.map(turmaLabel).join(', ')}).`);
    res.json(volView(v));
  });
  app.delete('/api/recursal/volunteers/:id', (req, res) => {
    const v = S.recursalVolunteers.find((x) => x.id === req.params.id);
    if (!v) return res.status(404).json({ error: 'Voluntário não encontrado.' });
    if (loadOf(v.id)) return res.status(422).json({ error: 'Este relator tem processos designados. Desfaça as designações antes de excluir.' });
    S.recursalVolunteers = S.recursalVolunteers.filter((x) => x.id !== v.id);
    log(null, 'Administração', 'Recursal', `Voluntário do Mutirão Recursal excluído: ${v.name}.`);
    res.json({ success: true });
  });
  app.delete('/api/recursal/processes/:id', (req, res) => {
    const p = S.recursalProcesses.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Processo não encontrado.' });
    S.recursalProcesses = S.recursalProcesses.filter((x) => x.id !== p.id);
    log(null, 'Administração', 'Recursal', `Processo do Mutirão Recursal excluído: ${formatCnj(p.cnj)}.`);
    res.json({ success: true });
  });
  app.post('/api/recursal/processes/delete-all', (req, res) => {
    if (!confirmedWipe(req)) return res.status(400).json({ error: 'Confirmação ausente.' });
    const n = S.recursalProcesses.length;
    S.recursalProcesses = []; S.recursalBatches = [];
    log(null, 'Administração', 'Recursal', `Todos os processos do Mutirão Recursal foram excluídos (${n}).`);
    res.json({ success: true, deleted: n });
  });

  // Designação manual (1..n processos a um relator): a regra de ouro é conferida aqui, no servidor
  app.post('/api/recursal/assign', (req, res) => {
    const ids: unknown = req.body?.processIds;
    const v = S.recursalVolunteers.find((x) => x.id === req.body?.volunteerId);
    if (!v) return res.status(404).json({ error: 'Voluntário não encontrado.' });
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 5000) return res.status(400).json({ error: 'Selecione os processos.' });
    const procs = ids.map((id) => S.recursalProcesses.find((p) => p.id === id));
    if (procs.some((p) => !p)) return res.status(404).json({ error: 'Processo não encontrado.' });
    const list = procs as RecursalProcess[];
    for (const p of list) {
      const why = blockReason(p, v);
      if (why) return res.status(422).json({ error: `${formatCnj(p.cnj)}: ${why}`, processId: p.id });
    }
    // Capacidade: conta só os que ainda não são deste relator
    const newOnes = list.filter((p) => p.assignedVolunteerId !== v.id).length;
    if (v.capacity != null && loadOf(v.id) + newOnes > v.capacity) return res.status(422).json({ error: `A capacidade informada por ${v.name} (${v.capacity}) seria ultrapassada.` });
    const now = new Date().toISOString(); const by = reqCtx.getStore()?.user;
    for (const p of list) { p.status = 'Distribuído'; p.assignedVolunteerId = v.id; p.assignedAt = now; if (by) p.assignedBy = by; }
    log(null, 'Administração', 'Recursal', `${list.length} processo(s) do Mutirão Recursal designado(s) a ${v.name}.`);
    res.json({ success: true, assigned: list.length });
  });
  app.post('/api/recursal/unassign', (req, res) => {
    const ids: unknown = req.body?.processIds;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Selecione os processos.' });
    let n = 0;
    for (const p of S.recursalProcesses) if (ids.includes(p.id) && p.assignedVolunteerId) { p.status = 'Pendente'; delete p.assignedVolunteerId; delete p.assignedAt; delete p.assignedBy; n++; }
    log(null, 'Administração', 'Recursal', `Designação desfeita em ${n} processo(s) do Mutirão Recursal.`);
    res.json({ success: true, unassigned: n });
  });
  app.post('/api/recursal/auto-preview', (_req, res) => {
    const r = suggestDistribution();
    const vol = (id: string) => S.recursalVolunteers.find((v) => v.id === id);
    res.json({
      pairs: r.pairs.map((x) => { const p = S.recursalProcesses.find((q) => q.id === x.processId)!; return { ...x, formatted: formatCnj(p.cnj), turma: p.turma, volunteerName: vol(x.volunteerId)?.name ?? '' }; }),
      unassignable: r.unassignable.map((x) => { const p = S.recursalProcesses.find((q) => q.id === x.processId)!; return { ...x, formatted: formatCnj(p.cnj), turma: p.turma }; }),
      // Carga aproximada por relator após a distribuição (inclui quem não recebe nada)
      loads: S.recursalVolunteers.filter((v) => v.status === 'Aprovado').map((v) => {
        const add = r.loads[v.id] ?? 0, current = loadOf(v.id), total = current + add;
        return { volunteerId: v.id, name: v.name, turmas: v.turmas, current, add, total, ...(v.capacity ? { capacity: v.capacity } : {}) };
      }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'pt-BR')),
    });
  });
  app.post('/api/recursal/auto-apply', (req, res) => {
    const r = suggestDistribution();
    const now = new Date().toISOString(); const by = reqCtx.getStore()?.user;
    let n = 0;
    for (const x of r.pairs) {
      const p = S.recursalProcesses.find((q) => q.id === x.processId); const v = S.recursalVolunteers.find((q) => q.id === x.volunteerId);
      if (!p || !v || !canAssign(p, v) || !hasRoom(v)) continue; // reconfere a regra de ouro e a capacidade
      p.status = 'Distribuído'; p.assignedVolunteerId = v.id; p.assignedAt = now; if (by) p.assignedBy = by; n++;
    }
    log(null, 'Administração', 'Recursal', `Distribuição automática do Mutirão Recursal: ${n} processo(s) designado(s); ${r.unassignable.length} sem relator possível.`);
    res.json({ success: true, assigned: n, unassignable: r.unassignable.length });
  });

  // Exportação em tabela: número do processo, Turma em que tramita e relator designado
  app.get('/api/recursal/export.csv', async (req, res) => {
    const rows = exportRows(req);
    const cols = Object.keys(rows[0] ?? { 'Número do processo': 1, 'Turma em que tramita': 1, 'Relator designado': 1, 'Turma(s) de atuação do relator': 1, 'Situação': 1 });
    log(null, 'Administração', 'Exportação', `Tabela do Mutirão Recursal (CSV) exportada: ${rows.length} processo(s).`);
    if (!(await saveState())) return res.status(503).json({ error: 'Não foi possível registrar a exportação. Tente novamente.' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=mutirao-turma-recursal-${Date.now()}.csv`);
    res.send('﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => csvCell((r as any)[c])).join(';'))].join('\r\n') + '\r\n');
  });
  app.get('/api/recursal/export.xlsx', async (req, res) => {
    const rows = exportRows(req);
    const header = ['Número do processo', 'Turma em que tramita', 'Relator designado', 'Turma(s) de atuação do relator', 'Situação'];
    const sheet = XLSX.utils.json_to_sheet(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v]))), { header });
    sheet['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 40 }, { wch: 32 }, { wch: 14 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, sheet, 'Processos');
    log(null, 'Administração', 'Exportação', `Tabela do Mutirão Recursal (XLSX) exportada: ${rows.length} processo(s).`);
    if (!(await saveState())) return res.status(503).json({ error: 'Não foi possível registrar a exportação. Tente novamente.' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=mutirao-turma-recursal-${Date.now()}.xlsx`);
    res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  });
}
