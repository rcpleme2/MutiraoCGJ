// Rotas das unidades judiciais: inscrição, triagem, edição e fusão.
import express from 'express';
import { mergeCatalogDuplicates } from '../catalog.ts';
import { carryUnitTo, editionById, nextEditionAfter, registrationMessage, registrationState, resolveEdition, scopeOf } from '../editions.ts';
import { linkedCount, refreshUnitStatus } from '../links.ts';
import { log, newId, S } from '../state.ts';
import { type Unit } from '../types.ts';
import { clientIp, freeText } from '../util.ts';
import { actorOf, confirmedWipe, parseUnit } from '../validation.ts';

export function register(app: express.Express) {
  /** Funde inscrições repetidas da mesma unidade oficial numa edição. */
  app.post('/api/units/merge', (req, res) => {
    const unit = S.units.find((u) => u.id === req.body?.id);
    if (!unit || !unit.catalogId) return res.status(400).json({ error: 'Unidade não encontrada ou fora da lista oficial.' });
    const n = mergeCatalogDuplicates(unit.editionId, unit.catalogId);
    res.json({ success: true, merged: n });
  });
  app.post('/api/units/delete-all', (req, res) => {
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    if (!confirmedWipe(req)) return res.status(400).json({ error: 'Confirmação ausente.' });

    const ids = new Set(S.units.filter((u) => u.editionId === edition.id).map((u) => u.id));
    const removed = S.matches.filter((m) => ids.has(m.unitId));
    removed.forEach((m) => {
      const g = S.magistrates.find((x) => x.id === m.magistrateId);
      if (g) g.status = 'Lista de Espera';
    });
    S.units = S.units.filter((u) => !ids.has(u.id));
    S.matches = S.matches.filter((m) => !ids.has(m.unitId));
    log(edition.id, 'Administração', 'Unidade',
      `EXCLUSÃO EM LOTE: ${ids.size} unidade(s) excluída(s)${removed.length ? `, com ${removed.length} vinculação(ões)` : ''}.`);
    res.json({ success: true, count: ids.size, removedMatches: removed.length });
  });
  app.get('/api/units', (req, res) => {
    // edition=all: unidades de todas as edições (com o título da edição)
    if (req.query.edition === 'all') return res.json(S.units.map((u) => ({ ...u, editionTitle: editionById(u.editionId)?.title ?? '' })));
    const edition = resolveEdition(req);
    const list = edition ? S.units.filter((u) => u.editionId === edition.id) : [];
    // Mesma unidade oficial inscrita mais de uma vez na edição
    const count = new Map<string, number>();
    list.forEach((u) => { if (u.catalogId) count.set(u.catalogId, (count.get(u.catalogId) ?? 0) + 1); });
    res.json(list.map((u) => (u.catalogId && (count.get(u.catalogId) ?? 0) > 1 ? { ...u, duplicateCount: count.get(u.catalogId) } : u)));
  });
  app.post('/api/units', (req, res) => {
    const { source } = req.body;
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    const parsed = parseUnit(req.body, undefined, source === 'admin' && edition.isInitial === true, source !== 'admin');
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    if (source !== 'admin') {
      const reg = registrationState(edition);
      if (reg !== 'open') return res.status(403).json({ error: registrationMessage(edition, reg) });
    }

    const newUnit: Unit = {
      id: newId('unit'),
      editionId: edition.id,
      ...parsed.value,
      registeredIp: source === 'admin' ? undefined : clientIp(req),
      createdAt: new Date().toISOString(),
      status: 'Pendente',
      selection: source === 'admin' ? 'Escolhida' : 'Em análise',
    };

    S.units.unshift(newUnit);
    log(edition.id, actorOf(source), 'Unidade', `Inscrição da unidade "${newUnit.unitName}" (${newUnit.comarca}) registrada${newUnit.registeredIp ? ` (IP ${newUnit.registeredIp})` : ''}.`);
    res.status(201).json({ success: true, unit: newUnit });
  });
  // Escolhe em lote todas as unidades em análise da edição. Rejeitadas não são alteradas.
  app.post('/api/units/choose-all', (req, res) => {
    const scope = scopeOf(req);
    if (!scope) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    const pending = S.units.filter((u) => scope.has(u) && u.selection === 'Em análise');
    pending.forEach((u) => { u.selection = 'Escolhida'; });
    if (pending.length) {
      log(scope.edition?.id ?? null, 'Administração', 'Unidade', `Escolha em lote: ${pending.length} unidade(s) escolhida(s) para o mutirão.`);
    }
    res.json({ success: true, count: pending.length });
  });
  app.post('/api/units/:id/choose', (req, res) => {
    const unit = S.units.find((u) => u.id === req.params.id);
    if (!unit) return res.status(404).json({ error: 'Unidade não encontrada.' });
    const was = unit.selection;
    unit.selection = 'Escolhida';
    unit.rejectionReason = undefined;
    unit.rejectedAt = undefined;
    unit.carryOver = false;
    log(unit.editionId, 'Administração', 'Unidade',
      `Unidade "${unit.unitName}" ${was === 'Rejeitada' ? 'reconsiderada e escolhida' : 'escolhida'} para o mutirão.`);
    res.json({ success: true, unit });
  });
  app.post('/api/units/:id/reject', (req, res) => {
    const unit = S.units.find((u) => u.id === req.params.id);
    if (!unit) return res.status(404).json({ error: 'Unidade não encontrada.' });
    const reason = freeText(req.body?.reason, 1000);
    if (!reason) return res.status(400).json({ error: 'Informe o motivo da rejeição.' });

    // Se havia magistrado vinculado, a vinculação é desfeita e ele volta à lista de espera
    const linked = S.matches.filter((m) => m.unitId === unit.id);
    linked.forEach((m) => {
      const g = S.magistrates.find((x) => x.id === m.magistrateId);
      if (g) g.status = 'Lista de Espera';
    });
    S.matches = S.matches.filter((m) => m.unitId !== unit.id);

    unit.selection = 'Rejeitada';
    unit.status = 'Pendente';
    unit.rejectionReason = reason;
    unit.rejectedAt = new Date().toISOString();
    // Opcional: o pedido segue para a próxima edição (agora, se já existir; senão, assim que ela for criada)
    let carryNote = '';
    if (req.body?.carryOver === true && !unit.carriedToEditionId) {
      const next = nextEditionAfter(unit.editionId);
      if (next && carryUnitTo(unit, next)) carryNote = ` Pedido mantido: voltou para análise na janela "${next.title}".`;
      else if (!next) { unit.carryOver = true; carryNote = ' Pedido mantido: volta para análise quando a próxima janela de inscrição for criada.'; }
    }
    log(unit.editionId, 'Administração', 'Unidade',
      `Unidade "${unit.unitName}" rejeitada${linked.length ? ' (vinculação desfeita)' : ''}. Motivo: ${reason}${carryNote}`);
    res.json({ success: true, unit });
  });
  app.put('/api/units/:id', (req, res) => {
    const unit = S.units.find((u) => u.id === req.params.id);
    if (!unit) return res.status(404).json({ error: 'Unidade não encontrada.' });

    const b = req.body || {};
    const parsed = parseUnit(b, unit, editionById(unit.editionId)?.isInitial === true);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const next = parsed.value;

    const labels: Record<string, string> = {
      unitName: 'unidade', judgeName: 'responsável', email: 'e-mail', comarca: 'comarca', separator: 'separador', catalogId: 'unidade do catálogo',
      areas: 'áreas', supportNeeded: 'auxílio necessário', hearingPeriod: 'período das audiências', description: 'justificativa', slots: 'magistrados a alocar',
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
    const unit = S.units.find((u) => u.id === id);
    if (unit) {
      S.matches.filter((m) => m.unitId === id).forEach((m) => {
        const mag = S.magistrates.find((x) => x.id === m.magistrateId);
        if (mag) mag.status = 'Lista de Espera';
      });
      log(unit.editionId, 'Administração', 'Unidade', `Inscrição da unidade "${unit.unitName}" excluída.`);
    }
    S.units = S.units.filter((u) => u.id !== id);
    S.matches = S.matches.filter((m) => m.unitId !== id);
    res.json({ success: true, id });
  });
}
