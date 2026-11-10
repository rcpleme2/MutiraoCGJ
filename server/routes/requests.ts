// Rotas dos pedidos de alteração (portal) e da análise pela administração.
import express from 'express';
import { fullUnitName } from '../../src/catalogo-tjpr';
import { editionById } from '../editions.ts';
import { fullUnitOf, linkedCount, panelRows, refreshUnitStatus, unitLabel, updateMatch } from '../links.ts';
import { log, newId, reqCtx, S } from '../state.ts';
import { type ChangeRequest, MATCH_WORK_TYPES, type WorkType } from '../types.ts';
import { cleanText, clientIp, freeText, isYmd, norm, personKey, workLabel } from '../util.ts';
import { PREFERENCE_AREAS } from '../validation.ts';

/** O que foi pedido, em uma linha */
export const requestSummary = (r: ChangeRequest) => r.kind === 'magistrado'
  ? [r.requested.area && `área: ${r.requested.area}`, r.requested.workType && `tipo: ${workLabel(r.requested.workType)}`].filter(Boolean).join('; ')
  : [r.requested.areas && `áreas: ${r.requested.areas.join(', ')}`, r.requested.extraSlots && `mais ${r.requested.extraSlots} magistrado(s)`].filter(Boolean).join('; ');
/** Visão pública do pedido (sem IP nem quem decidiu) */
export const publicRequest = (r: ChangeRequest) => ({
  protocol: r.protocol, kind: r.kind, name: r.name, unit: r.current.unit, createdAt: r.createdAt, status: r.status, summary: requestSummary(r),
  ...(r.status !== 'Pendente' ? { decidedAt: r.decidedAt, decisionReason: r.decisionReason ?? '', outcome: r.outcome ?? '' } : {}),
});
export const pendingFor = (key: { matchId?: string; unitId?: string }) =>
  S.changeRequests.find((r) => r.status === 'Pendente' && (key.matchId ? r.matchId === key.matchId : r.unitId === key.unitId));
/** Unidades com magistrado vinculado no painel (designação vigente) */
export const linkedUnits = () => { const ids = new Set(panelRows().map((r) => r.unitId)); return S.units.filter((u) => ids.has(u.id)); };

export function register(app: express.Express) {
  // Consulta: o magistrado informa o e-mail cadastrado ou o nome completo; a unidade, o e-mail ou parte do nome da vara.
  app.post('/api/requests/lookup', (req, res) => {
    const kind = req.body?.kind;
    const q = typeof req.body?.query === 'string' ? req.body.query.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : '';
    const byEmail = q.includes('@');
    if (kind === 'magistrado') {
      const wanted = personKey(q);
      if (!byEmail && (wanted.split(' ').length < 2 || wanted.length < 6)) return res.status(400).json({ error: 'Informe o e-mail cadastrado ou o nome completo.' });
      const emailIds = new Set(byEmail ? S.magistrates.filter((m) => m.email && m.email.toLowerCase() === q.toLowerCase()).map((m) => m.id) : []);
      const rows = panelRows().filter((r) => (byEmail ? emailIds.has(r.magistrateId) : personKey(r.name) === wanted));
      const matchIds = new Set(rows.map((r) => r.id));
      return res.json({
        items: rows.map((r) => ({ id: r.id, name: r.name, unit: unitLabel(r), area: r.area, workType: r.workType ?? '', editionTitle: r.editionTitle, pending: !!pendingFor({ matchId: r.id }) })),
        requests: S.changeRequests.filter((r) => r.kind === 'magistrado' && (matchIds.has(r.matchId ?? '') || (!byEmail && personKey(r.name) === wanted)))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicRequest),
      });
    }
    if (kind === 'unidade') {
      const words = norm(q).split(/[^a-z0-9ºª]+/).filter((w) => w.length >= 2);
      if (!byEmail && norm(q).replace(/\s/g, '').length < 4) return res.status(400).json({ error: 'Informe o e-mail cadastrado ou o nome da vara.' });
      const found = linkedUnits().filter((u) => (byEmail ? !!u.email && u.email.toLowerCase() === q.toLowerCase() : words.every((w) => norm(fullUnitName(u)).includes(w)))).slice(0, 15);
      const ids = new Set(found.map((u) => u.id));
      return res.json({
        items: found.map((u) => ({ id: u.id, unit: fullUnitName(u), areas: u.areas, slots: u.slots || 1, linked: linkedCount(u.id), editionTitle: editionById(u.editionId)?.title ?? '', pending: !!pendingFor({ unitId: u.id }) })),
        requests: S.changeRequests.filter((r) => r.kind === 'unidade' && ids.has(r.unitId ?? '')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicRequest),
      });
    }
    res.status(400).json({ error: 'Tipo de pedido inválido.' });
  });
  // Envio do pedido pelo portal
  app.post('/api/requests', (req, res) => {
    const b = req.body ?? {};
    const justification = cleanText(b.justification, 4000);
    if (!justification) return res.status(400).json({ error: 'Informe a justificativa do pedido.' });
    const notes = freeText(b.notes, 4000);
    const year = new Date().getFullYear();
    const seq = 1 + S.changeRequests.filter((r) => r.protocol.startsWith(`ALT-${year}-`)).reduce((n, r) => Math.max(n, Number(r.protocol.split('-')[2]) || 0), 0);
    const base = { id: newId('req'), protocol: `ALT-${year}-${String(seq).padStart(4, '0')}`, justification, ...(notes ? { notes } : {}), status: 'Pendente' as const, ip: clientIp(req), createdAt: new Date().toISOString() };
    let record: ChangeRequest;
    if (b.kind === 'magistrado') {
      const row = panelRows().find((r) => r.id === b.id);
      if (!row) return res.status(404).json({ error: 'Designação vigente não encontrada. Só quem está vinculado pode pedir alteração.' });
      const area = typeof b.area === 'string' && b.area ? b.area : '';
      const workType = typeof b.workType === 'string' && b.workType ? b.workType : '';
      if (area && !PREFERENCE_AREAS.includes(area)) return res.status(400).json({ error: 'Área de atuação inválida.' });
      if (workType && !MATCH_WORK_TYPES.includes(workType as WorkType)) return res.status(400).json({ error: 'Tipo de atuação inválido.' });
      const newArea = area && norm(area) !== norm(row.area) ? area : '';
      const newWork = workType && workType !== row.workType ? workType : '';
      if (!newArea && !newWork) return res.status(400).json({ error: 'Escolha uma área ou um tipo de atuação diferente do atual.' });
      if (pendingFor({ matchId: row.id })) return res.status(409).json({ error: 'Já existe um pedido pendente para esta designação. Aguarde a análise.' });
      record = { ...base, kind: 'magistrado', editionId: row.editionId, matchId: row.id, magistrateId: row.magistrateId, name: row.name,
        current: { unit: unitLabel(row), area: row.area, workType: row.workType ?? '' }, requested: { ...(newArea ? { area: newArea } : {}), ...(newWork ? { workType: newWork } : {}) } };
      log(row.editionId, 'Público', 'Vinculação', `Pedido de alteração ${record.protocol} recebido de ${row.name} (${record.current.unit}): ${requestSummary(record)}.`);
    } else if (b.kind === 'unidade') {
      const unit = linkedUnits().find((u) => u.id === b.id);
      if (!unit) return res.status(404).json({ error: 'Unidade com magistrado vinculado não encontrada. Só unidades atendidas podem pedir alteração.' });
      const areas = Array.isArray(b.areas) ? [...new Set(b.areas.filter((a: unknown) => typeof a === 'string' && PREFERENCE_AREAS.includes(a)))] as string[] : [];
      const extraSlots = Number.isInteger(b.extraSlots) ? b.extraSlots : 0;
      if (extraSlots < 0 || extraSlots > 20) return res.status(400).json({ error: 'Número de magistrados a mais inválido (até 20).' });
      const sameAreas = areas.length === 0 || (areas.length === unit.areas.length && areas.every((a) => unit.areas.some((x) => norm(x) === norm(a))));
      if (sameAreas && extraSlots === 0) return res.status(400).json({ error: 'Escolha áreas diferentes das atuais e/ou peça mais magistrados.' });
      if (pendingFor({ unitId: unit.id })) return res.status(409).json({ error: 'Já existe um pedido pendente para esta unidade. Aguarde a análise.' });
      record = { ...base, kind: 'unidade', editionId: unit.editionId, unitId: unit.id, name: fullUnitName(unit),
        current: { unit: fullUnitName(unit), areas: [...unit.areas], slots: unit.slots || 1 }, requested: { ...(!sameAreas ? { areas } : {}), ...(extraSlots ? { extraSlots } : {}) } };
      log(unit.editionId, 'Público', 'Unidade', `Pedido de alteração ${record.protocol} recebido da unidade ${record.name}: ${requestSummary(record)}.`);
    } else return res.status(400).json({ error: 'Tipo de pedido inválido.' });
    S.changeRequests.push(record);
    res.status(201).json({ success: true, protocol: record.protocol });
  });
  // Administração: pedidos com a situação atual da designação/unidade, para a análise
  app.get('/api/requests', (_req, res) => {
    const rows = panelRows();
    res.json([...S.changeRequests].sort((a, b) => (a.status === 'Pendente' ? 0 : 1) - (b.status === 'Pendente' ? 0 : 1) || b.createdAt.localeCompare(a.createdAt)).map((r) => {
      const row = r.matchId ? rows.find((x) => x.id === r.matchId) : undefined;
      const unit = r.unitId ? S.units.find((u) => u.id === r.unitId) : undefined;
      return { ...r, summary: requestSummary(r), editionTitle: editionById(r.editionId)?.title ?? '', isInitial: editionById(r.editionId)?.isInitial === true,
        live: r.kind === 'magistrado'
          ? (row ? { unitId: row.unitId, unit: unitLabel(row), area: row.area, workType: row.workType ?? '', comarca: row.comarca ?? '' } : null)
          : (unit ? { unitId: unit.id, unit: fullUnitName(unit), areas: unit.areas, slots: unit.slots || 1, linked: linkedCount(unit.id) } : null) };
    }));
  });
  // Administração: deferir (aplicando a alteração) ou indeferir (com motivo)
  app.post('/api/requests/:id/decide', (req, res) => {
    const r = S.changeRequests.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'Pedido não encontrado.' });
    if (r.status !== 'Pendente') return res.status(409).json({ error: 'Este pedido já foi analisado.' });
    const b = req.body ?? {};
    const reason = freeText(b.reason, 2000);
    if (b.decision === 'Indeferido') {
      if (!reason) return res.status(400).json({ error: 'Informe o motivo do indeferimento.' });
      Object.assign(r, { status: 'Indeferido', decisionReason: reason, decidedAt: new Date().toISOString(), decidedBy: reqCtx.getStore()?.user });
      log(r.editionId, 'Administração', r.kind === 'magistrado' ? 'Vinculação' : 'Unidade', `Pedido de alteração ${r.protocol} (${r.name}) INDEFERIDO. Motivo: ${reason}`);
      return res.json({ success: true, request: r });
    }
    if (b.decision !== 'Deferido') return res.status(400).json({ error: 'Decisão inválida.' });
    let outcome = '';
    if (r.kind === 'magistrado') {
      const match = S.matches.find((m) => m.id === r.matchId);
      if (!match || !panelRows().some((x) => x.id === match.id)) return res.status(409).json({ error: 'A designação deste pedido não está mais vigente. Indefira o pedido informando o motivo.' });
      if (!isYmd(b.effectiveDate)) return res.status(400).json({ error: 'Informe a partir de quando valerá a alteração.' });
      const area = typeof b.area === 'string' ? b.area.trim() : '';
      const workType = typeof b.workType === 'string' ? b.workType : '';
      if (!area || area.length > 150) return res.status(400).json({ error: 'Informe a área de atuação.' });
      if (!MATCH_WORK_TYPES.includes(workType as WorkType)) return res.status(400).json({ error: 'Informe o tipo de atuação (Audiências ou Sentença).' });
      const newUnitName = typeof b.newUnitName === 'string' ? b.newUnitName.trim() : '';
      const unitId = typeof b.unitId === 'string' && b.unitId ? b.unitId : match.unitId;
      if (!newUnitName && unitId === match.unitId && norm(area) === norm(match.assignedArea) && workType === match.workType) {
        return res.status(400).json({ error: 'Nada foi alterado. Mude a área, o tipo ou a vara, ou indefira o pedido.' });
      }
      const body: Record<string, string> = { assignedArea: area, workType, effectiveDate: b.effectiveDate, ...(newUnitName ? { newUnitName } : { unitId }) };
      if (typeof b.sei === 'string' && b.sei.trim()) body.sei = b.sei.trim();
      const done = updateMatch(match, body, ` por deferimento do pedido ${r.protocol}`);
      if ('error' in done) return res.status(done.status).json({ error: done.error });
      const un = S.units.find((u) => u.id === done.match.unitId);
      outcome = `${fullUnitOf(un)} · área: ${done.match.assignedArea} · tipo: ${workLabel(done.match.workType)} · a partir de ${b.effectiveDate.split('-').reverse().join('/')}`;
    } else {
      const unit = S.units.find((u) => u.id === r.unitId);
      if (!unit) return res.status(409).json({ error: 'A unidade deste pedido não existe mais. Indefira o pedido informando o motivo.' });
      const areas = Array.isArray(b.areas) ? [...new Set(b.areas.filter((a: unknown) => typeof a === 'string' && a.trim() && a.length <= 150).map((a: string) => a.trim()))] as string[] : [];
      const slots = Number(b.slots);
      if (areas.length === 0) return res.status(400).json({ error: 'A unidade precisa de ao menos uma área.' });
      if (!Number.isInteger(slots) || slots < 1 || slots > 50) return res.status(400).json({ error: 'Número de magistrados inválido.' });
      if (slots < linkedCount(unit.id)) return res.status(400).json({ error: `A unidade já tem ${linkedCount(unit.id)} magistrado(s) vinculado(s); o número não pode ser menor.` });
      const before = `áreas: ${unit.areas.join(', ')}; ${unit.slots || 1} magistrado(s)`;
      unit.areas = areas; unit.slots = slots;
      refreshUnitStatus(unit.id);
      outcome = `áreas: ${areas.join(', ')} · ${slots} magistrado(s)`;
      log(unit.editionId, 'Administração', 'Unidade', `Unidade ${fullUnitName(unit)} alterada por deferimento do pedido ${r.protocol}: de ${before} para ${outcome.replace(' · ', '; ')}.`);
    }
    Object.assign(r, { status: 'Deferido', outcome, decidedAt: new Date().toISOString(), decidedBy: reqCtx.getStore()?.user, ...(reason ? { decisionReason: reason } : {}) });
    log(r.editionId, 'Administração', r.kind === 'magistrado' ? 'Vinculação' : 'Unidade', `Pedido de alteração ${r.protocol} (${r.name}) DEFERIDO: ${outcome}.`);
    res.json({ success: true, request: r });
  });
}
