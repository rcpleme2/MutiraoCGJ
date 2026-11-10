// Rotas das vinculações e da lista de espera.
import express from 'express';
import { editionById, resolveEdition, scopeOf } from '../editions.ts';
import { defaultWorkType, describeMatch, refreshUnitStatus, undoMatch, updateMatch } from '../links.ts';
import { log, newId, S } from '../state.ts';
import { type Match, MATCH_WORK_TYPES } from '../types.ts';
import { isYmd } from '../util.ts';
import { confirmedWipe } from '../validation.ts';

export function register(app: express.Express) {
  app.post('/api/matches/delete-all', (req, res) => {
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    if (!confirmedWipe(req)) return res.status(400).json({ error: 'Confirmação ausente.' });

    const removed = S.matches.filter((m) => m.editionId === edition.id);
    removed.forEach((m) => {
      const g = S.magistrates.find((x) => x.id === m.magistrateId);
      if (g && g.status === 'Atribuído') g.status = 'Lista de Espera';
    });
    S.matches = S.matches.filter((m) => m.editionId !== edition.id);
    new Set(removed.map((m) => m.unitId)).forEach(refreshUnitStatus); // a unidade pode ser de outra janela
    log(edition.id, 'Administração', 'Vinculação', `EXCLUSÃO EM LOTE: ${removed.length} vinculação(ões) desfeita(s).`);
    res.json({ success: true, count: removed.length });
  });
  app.get('/api/matches', (req, res) => {
    if (req.query.edition === 'all') return res.json(S.matches);
    const edition = resolveEdition(req);
    res.json(edition ? S.matches.filter((m) => m.editionId === edition.id) : []);
  });
  app.post('/api/matches', (req, res) => {
    const { magistrateId, unitId, assignedArea, workType } = req.body;
    if (!magistrateId || !unitId || !assignedArea) {
      return res.status(400).json({ error: 'Magistrado, Unidade e Área são obrigatórios para a vinculação.' });
    }
    const mag = S.magistrates.find((m) => m.id === magistrateId);
    const unit = S.units.find((u) => u.id === unitId);
    if (!mag || !unit) return res.status(404).json({ error: 'Magistrado ou unidade não encontrados.' });
    if (mag.status === 'Rejeitado') {
      return res.status(400).json({ error: 'A inscrição deste magistrado foi rejeitada. Reconsidere-a antes de vincular.' });
    }
    if (mag.status === 'Excluído') {
      return res.status(400).json({ error: 'Este magistrado foi excluído do mutirão. Desfaça a exclusão antes de vincular.' });
    }
    if (mag.status === 'Desistente') {
      return res.status(400).json({ error: 'Este magistrado desistiu da participação. Desfaça o registro de desistência antes de vincular.' });
    }
    if (unit.selection !== 'Escolhida') {
      return res.status(400).json({ error: 'Só é possível vincular unidades escolhidas para o mutirão.' });
    }
    if (workType && !MATCH_WORK_TYPES.includes(workType)) {
      return res.status(400).json({ error: 'Modalidade inválida. Use Para audiências ou Para sentença.' });
    }
    // Início da atuação: sem data própria, vale o início da edição
    const startDate = req.body?.startDate;
    if (startDate && !isYmd(startDate)) return res.status(400).json({ error: 'Data de início da atuação inválida.' });

    // A unidade comporta o número de magistrados definido em "vagas" (padrão 1). Sem motivo a justificar.
    const others = S.matches.filter((m) => m.unitId === unitId && m.magistrateId !== magistrateId).length;
    if (others >= (unit.slots || 1)) {
      return res.status(409).json({ error: `Todas as ${unit.slots || 1} vaga(s) desta unidade já estão preenchidas. Aumente o número de magistrados da unidade para vincular outro.` });
    }

    const existingMatch = S.matches.find((m) => m.magistrateId === magistrateId);
    if (existingMatch) {
      S.matches = S.matches.filter((m) => m.id !== existingMatch.id);
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
      ...(startDate && startDate !== editionById(mag.editionId)?.startDate ? { startDate } : {}),
      status: 'Vinculado',
      createdAt: new Date().toISOString(),
    };
    S.matches.unshift(newMatch);
    refreshUnitStatus(unit.id);

    log(mag.editionId, 'Administração', 'Vinculação', `Vinculação manual: ${describeMatch(newMatch)}.`);
    res.status(201).json({ success: true, match: newMatch });
  });
  app.put('/api/matches/:id', (req, res) => {
    const match = S.matches.find((m) => m.id === req.params.id);
    if (!match) return res.status(404).json({ error: 'Vinculação não encontrada.' });
    const r = updateMatch(match, req.body);
    if ('error' in r) return res.status(r.status).json({ error: r.error });
    res.json({ success: true, match: r.match });
  });
  app.delete('/api/matches/:id', (req, res) => {
    const { id } = req.params;
    undoMatch(id); // a linha correspondente do painel de vinculações deixa de existir automaticamente
    res.json({ success: true, id });
  });
  app.get('/api/waiting-list', (req, res) => {
    const scope = scopeOf(req);
    if (!scope) return res.json([]);
    const assigned = new Set(S.matches.map((m) => m.magistrateId));
    res.json(S.magistrates.filter((m) => scope.has(m) && m.status !== 'Atribuído' && m.status !== 'Rejeitado' && m.status !== 'Desistente' && m.status !== 'Excluído' && !assigned.has(m.id)));
  });
}
