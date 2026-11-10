// Rotas dos magistrados (inscrição, conferência, exclusão) e da consulta pública de status.
import { fullUnitName } from '../../src/catalogo-tjpr';
import express from 'express';
import { sameUnit, unitResolver } from '../catalog.ts';
import { editionById, registrationMessage, registrationState, resolveEdition, scopeOf } from '../editions.ts';
import { panelRows, personOf, refreshUnitStatus, samePerson, undoMatch, unitLabel } from '../links.ts';
import { log, newId, reqCtx, S } from '../state.ts';
import { type Magistrate, type MagistrateStatus } from '../types.ts';
import { cleanCell, clientIp, freeText, personKey } from '../util.ts';
import { actorOf, confirmedWipe, MAGISTRATE_STATUSES, parseMagistrate } from '../validation.ts';

// Exclusão do magistrado: exige justificativa; é lógica (status "Excluído") e reversível. Vinculações são desfeitas.
export const excludeMagistrate = (req: express.Request, res: express.Response) => {
  const mag = S.magistrates.find((m) => m.id === req.params.id);
  if (!mag) return res.status(404).json({ error: 'Magistrado não encontrado.' });
  if (mag.status === 'Excluído') return res.status(409).json({ error: 'Este magistrado já está excluído.' });
  const reason = freeText(req.body?.reason, 1000);
  const sei = typeof req.body?.sei === 'string' ? cleanCell(req.body.sei).slice(0, 100) : '';
  if (reason.length < 5) return res.status(400).json({ error: 'Informe o motivo da exclusão.' });
  const held = S.matches.filter((m) => m.magistrateId === mag.id).map((m) => {
    const un = S.units.find((u) => u.id === m.unitId);
    return { editionId: m.editionId, area: m.assignedArea, unit: un ? fullUnitName(un) : '', workType: m.workType, ...(m.startDate ? { startDate: m.startDate } : {}) };
  });
  mag.excludedFrom = held.length ? held : undefined;
  S.matches.filter((m) => m.magistrateId === mag.id).forEach((m) => undoMatch(m.id, 'Vinculação desfeita por exclusão do magistrado'));
  mag.statusBeforeExclusion = mag.status === 'Atribuído' ? 'Lista de Espera' : mag.status;
  mag.status = 'Excluído';
  mag.exclusionReason = reason;
  mag.exclusionSei = sei || undefined;
  mag.excludedAt = new Date().toISOString();
  mag.excludedBy = reqCtx.getStore()?.user;
  log(mag.editionId, 'Administração', 'Magistrado', `Magistrado ${mag.name} EXCLUÍDO${sei ? ` (SEI ${sei})` : ''}. Motivo: ${reason}`);
  res.json({ success: true, magistrate: mag });
};

export function register(app: express.Express) {
  app.get('/api/magistrates', (req, res) => {
    // edition=all: magistrados de todas as edições (com o título da edição)
    const edition = req.query.edition === 'all' ? undefined : resolveEdition(req);
    // Inscrições de quem já desistiu antes (mesmo nome, sem acento/caixa) recebem a indicação, para análise do pedido de nova inscrição
    const list = req.query.edition === 'all' ? S.magistrates : edition ? S.magistrates.filter((m) => m.editionId === edition.id) : [];
    // Quem já está vinculado e ativo em outra edição (painel de vinculações): a nova inscrição é indicada como duplicidade
    const rows = panelRows();
    const people = rows.map((r) => personOf(r.magistrateId, r.name));
    res.json(list.map((m0) => {
      const m = req.query.edition === 'all' ? { ...m0, editionTitle: editionById(m0.editionId)?.title ?? '' } : m0;
      const w = S.withdrawals.find((x) => !x.endedAt && personKey(x.name) === personKey(m.name) && !(x.magistrateIds ?? []).includes(m.id) && m.createdAt > x.createdAt);
      // Mesma pessoa (mesmo nome) com mais de uma inscrição em aberto no mutirão — fora as vinculações iniciais (cada designação é um registro)
      // e as inscrições encerradas (rejeitada, desistente ou excluída), que ficam no histórico
      const closed = (x: Magistrate) => x.status === 'Rejeitado' || x.status === 'Desistente' || x.status === 'Excluído';
      const twins = editionById(m.editionId)?.isInitial || closed(m) ? 0 : S.magistrates.filter((x) => x.id !== m.id && !closed(x) && !editionById(x.editionId)?.isInitial && personKey(x.name) === personKey(m.name)).length;
      const me = personOf(m.id, m.name);
      const elsewhere = rows.filter((r, i) => r.magistrateId !== m.id && samePerson(me, people[i]))
        .map((r) => ({ editionTitle: r.editionTitle, unit: unitLabel(r), area: r.area }));
      return { ...m, ...(w ? { priorWithdrawal: { sei: w.sei, requestDate: w.requestDate } } : {}), ...(twins ? { duplicateCount: twins + 1 } : {}), ...(elsewhere.length ? { linkedElsewhere: elsewhere } : {}) };
    }));
  });
  // Consulta pública (todas as edições). O e-mail vai no corpo da requisição (POST), não na URL, para não
  // aparecer em registros de acesso. Só devolve o que a tela exibe: nada de IP, e-mail de terceiros ou dados internos.
  app.post('/api/status', (req, res) => {
    // Consulta pelo nome completo: só informa a situação no painel de vinculações (nada além disso).
    if (typeof req.body?.name === 'string') {
      const q = req.body.name.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200);
      const fold = personKey; // ignora acentos, caixa, pontuação e tratamentos (Dr., Dra., Juiz...)
      const wanted = fold(q);
      if (wanted.split(' ').length < 2 || wanted.length < 6) return res.status(400).json({ error: 'Informe o nome completo do magistrado.' });
      const mine = panelRows().filter((r) => fold(r.name) === wanted);
      const active = mine.length > 0;
      const revoked = S.withdrawals.some((w) => !w.endedAt && fold(w.name) === wanted);
      const situation = active ? 'ativa' : revoked ? 'revogada' : 'nao_consta';
      // Vinculação ativa: informa também o eixo de atuação (área) e a unidade de designação — nada além disso
      const designations = mine.map((r) => ({ area: r.area, unit: fullUnitName({ unitName: r.unit, comarca: r.comarca, separator: r.separator }) }));
      return res.json({ situation, ...(active ? { designations } : {}) });
    }
    const raw = req.body?.email;
    const emailQuery = typeof raw === 'string' ? raw.trim().toLowerCase().slice(0, 200) : '';
    if (!emailQuery) {
      return res.status(400).json({ error: 'Informe o e-mail cadastrado.' });
    }

    const matchedMagistrates = S.magistrates.filter((m) => m.email.toLowerCase() === emailQuery);
    const matchedUnits = S.units.filter((u) => u.email.toLowerCase() === emailQuery);

    if (matchedMagistrates.length === 0 && matchedUnits.length === 0) {
      return res.status(404).json({ error: 'Nenhum cadastro encontrado com este e-mail.' });
    }

    const titleOf = (id: string) => editionById(id)?.title || '';
    // Pedido rejeitado numa edição não apaga a designação que a mesma unidade tenha em outra edição: ela é informada à parte.
    const rejected = matchedUnits.filter((u) => u.selection === 'Rejeitada');
    const linksElsewhere = new Map<string, { editionTitle: string; area: string; startDate?: string }[]>();
    if (rejected.length) {
      const rows = panelRows();
      const unitOf = new Map(S.units.map((u) => [u.id, u]));
      const resolve = unitResolver();
      for (const u of rejected) {
        const me = resolve(u);
        const list = rows.filter((r) => r.editionId !== u.editionId && unitOf.has(r.unitId) && sameUnit(me, resolve(unitOf.get(r.unitId)!)))
          .map((r) => ({ editionTitle: r.editionTitle, area: r.area, ...(r.startDate ? { startDate: r.startDate } : {}) }));
        if (list.length) linksElsewhere.set(u.id, list);
      }
    }

    res.json({
      magistrates: matchedMagistrates.map((mag) => {
        const match = S.matches.find((m) => m.magistrateId === mag.id);
        const assigned = match ? S.units.find((u) => u.id === match.unitId) : undefined;
        return {
          id: mag.id,
          name: mag.name,
          currentLocation: mag.currentLocation,
          firstPreference: mag.firstPreference,
          secondPreference: mag.secondPreference,
          acceptsHearings: mag.acceptsHearings,
          hearingPeriod: mag.hearingPeriod,
          status: mag.status,
          // Motivo da rejeição é informado a quem se inscreveu (o da exclusão, não)
          ...(mag.status === 'Rejeitado' && mag.rejectionReason ? { rejectionReason: mag.rejectionReason } : {}),
          createdAt: mag.createdAt,
          editionTitle: titleOf(mag.editionId),
          match: match
            ? { assignedArea: match.assignedArea, workType: match.workType, unit: assigned ? { unitName: assigned.unitName, comarca: assigned.comarca } : null }
            : null,
        };
      }),
      units: matchedUnits.map((u) => ({
        id: u.id,
        unitName: u.unitName,
        comarca: u.comarca,
        judgeName: u.judgeName,
        areas: u.areas,
        supportNeeded: u.supportNeeded,
        hearingPeriod: u.hearingPeriod,
        status: u.status,
        selection: u.selection,
        ...(u.selection === 'Rejeitada' && u.rejectionReason ? { rejectionReason: u.rejectionReason } : {}),
        createdAt: u.createdAt,
        editionTitle: titleOf(u.editionId),
        ...(linksElsewhere.has(u.id) ? { linksElsewhere: linksElsewhere.get(u.id) } : {}),
      })),
    });
  });
  app.post('/api/magistrates', (req, res) => {
    const { declaration, status, source } = req.body;
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    const parsed = parseMagistrate(req.body, undefined, req.body?.source !== 'admin', source === 'admin' && edition.isInitial === true);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const { name, email } = parsed.value;
    if (source !== 'admin') {
      const reg = registrationState(edition);
      if (reg !== 'open') return res.status(403).json({ error: registrationMessage(edition, reg) });
    }
    if (source !== 'admin' && declaration !== true) {
      return res.status(400).json({ error: 'É necessário aceitar a declaração de regularidade para concluir a inscrição.' });
    }
    // Uma inscrição em aberto por e-mail no mutirão; quem foi rejeitado, desistiu ou foi excluído pode se inscrever de novo
    if (email && S.magistrates.some((m) => m.email.toLowerCase() === email.toLowerCase() && m.status !== 'Rejeitado' && m.status !== 'Desistente' && m.status !== 'Excluído')) {
      return res.status(409).json({ error: 'Já existe uma inscrição de magistrado em aberto com este e-mail.' });
    }

    const newMag: Magistrate = {
      id: newId('mag'),
      editionId: edition.id,
      ...parsed.value,
      registeredIp: source === 'admin' ? undefined : clientIp(req),
      declaration: source === 'admin' ? undefined : true,
      createdAt: new Date().toISOString(),
      status: source === 'admin' && (status === 'Aprovado' || status === 'Lista de Espera') ? status : 'Aguardando Conferência',
    };

    S.magistrates.unshift(newMag);
    log(edition.id, actorOf(source), 'Magistrado', `Inscrição de ${newMag.name} (${newMag.currentLocation}) registrada${newMag.registeredIp ? ` (IP ${newMag.registeredIp})` : ''}${newMag.declaration ? ' com declaração de regularidade' : ''}.`);
    res.status(201).json({ success: true, magistrate: newMag });
  });
  app.put('/api/magistrates/:id', (req, res) => {
    const mag = S.magistrates.find((m) => m.id === req.params.id);
    if (!mag) return res.status(404).json({ error: 'Magistrado não encontrado.' });

    const b = req.body || {};
    const parsed = parseMagistrate(b, mag, false, editionById(mag.editionId)?.isInitial === true);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const next = parsed.value;
    if (next.email && S.magistrates.some((m) => m.id !== mag.id && m.status !== 'Rejeitado' && m.status !== 'Desistente' && m.status !== 'Excluído' && m.email.toLowerCase() === next.email.toLowerCase())) {
      return res.status(409).json({ error: 'Já existe outra inscrição de magistrado em aberto com este e-mail.' });
    }

    const labels: Record<string, string> = {
      name: 'nome', email: 'e-mail', currentLocation: 'lotação', locationCatalogId: 'lotação (catálogo)', locationComarca: 'comarca da lotação', firstPreference: '1ª preferência',
      secondPreference: '2ª preferência', acceptsHearings: 'aceita audiências', hearingPeriod: 'período para audiências',
    };
    const changed = (Object.keys(next) as (keyof typeof next)[])
      .filter((k) => labels[k] && next[k] !== mag[k])
      .map((k) => labels[k]);
    Object.assign(mag, next);

    // Status: coerente com a existência de vinculação
    const isMatched = S.matches.some((m) => m.magistrateId === mag.id);
    const wanted: MagistrateStatus | undefined = MAGISTRATE_STATUSES.includes(b.status) ? b.status : undefined;
    const before = mag.status;
    if (isMatched) mag.status = 'Atribuído';
    else if ((mag.status === 'Rejeitado' || mag.status === 'Desistente' || mag.status === 'Excluído') && (!wanted || wanted === mag.status)) { /* mantém */ }
    else if (wanted && wanted !== 'Atribuído' && wanted !== 'Rejeitado' && wanted !== 'Desistente' && wanted !== 'Excluído') mag.status = wanted;
    else if (mag.status === 'Atribuído') mag.status = 'Lista de Espera';
    if (before === 'Rejeitado' && mag.status !== 'Rejeitado') { mag.rejectionReason = undefined; mag.rejectedAt = undefined; }
    if (mag.status !== before) changed.push(`status (${before} → ${mag.status})`);

    if (changed.length) {
      log(mag.editionId, 'Administração', 'Magistrado', `Inscrição de ${mag.name} editada: ${changed.join(', ')}.`);
    }
    res.json({ success: true, magistrate: mag });
  });
  app.post('/api/magistrates/delete-all', (req, res) => {
    const edition = resolveEdition(req);
    if (!edition) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    if (!confirmedWipe(req)) return res.status(400).json({ error: 'Confirmação ausente.' });

    const ids = new Set(S.magistrates.filter((m) => m.editionId === edition.id).map((m) => m.id));
    const freedUnits = S.matches.filter((m) => ids.has(m.magistrateId)).map((m) => m.unitId);
    const removedMatches = freedUnits.length;
    S.magistrates = S.magistrates.filter((m) => !ids.has(m.id));
    S.matches = S.matches.filter((m) => !ids.has(m.magistrateId));
    freedUnits.forEach(refreshUnitStatus);
    log(edition.id, 'Administração', 'Magistrado',
      `EXCLUSÃO EM LOTE: ${ids.size} inscrição(ões) de magistrado(s) excluída(s)${removedMatches ? `, com ${removedMatches} vinculação(ões)` : ''}.`);
    res.json({ success: true, count: ids.size, removedMatches });
  });
  // Aprova em lote todas as inscrições pendentes (Aguardando Conferência) da edição. Rejeitadas não são alteradas.
  app.post('/api/magistrates/approve-all', (req, res) => {
    const scope = scopeOf(req);
    if (!scope) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    const pending = S.magistrates.filter((m) => scope.has(m) && m.status === 'Aguardando Conferência');
    pending.forEach((m) => {
      m.status = S.matches.some((x) => x.magistrateId === m.id) ? 'Atribuído' : 'Lista de Espera';
    });
    if (pending.length) {
      log(scope.edition?.id ?? null, 'Administração', 'Magistrado', `Aprovação em lote: ${pending.length} inscrição(ões) de magistrado(s) aprovada(s).`);
    }
    res.json({ success: true, count: pending.length });
  });
  app.post('/api/magistrates/:id/approve', (req, res) => {
    const mag = S.magistrates.find((m) => m.id === req.params.id);
    if (!mag) return res.status(404).json({ error: 'Magistrado não encontrado.' });

    const isMatched = S.matches.some((m) => m.magistrateId === mag.id);
    const wasRejected = mag.status === 'Rejeitado';
    mag.status = isMatched ? 'Atribuído' : 'Lista de Espera';
    mag.rejectionReason = undefined;
    mag.rejectedAt = undefined;
    log(mag.editionId, 'Administração', 'Magistrado', `Inscrição de ${mag.name} ${wasRejected ? 'reconsiderada e aprovada' : 'aprovada'}.`);
    res.json({ success: true, magistrate: mag });
  });
  app.post('/api/magistrates/:id/reject', (req, res) => {
    const mag = S.magistrates.find((m) => m.id === req.params.id);
    if (!mag) return res.status(404).json({ error: 'Magistrado não encontrado.' });
    const reason = freeText(req.body?.reason, 1000);
    if (!reason) return res.status(400).json({ error: 'Informe o motivo da rejeição.' });

    // Se havia vinculação, ela é desfeita (a unidade só volta a ficar pendente se não restar outro magistrado)
    const hadMatch = S.matches.some((m) => m.magistrateId === mag.id);
    const freedUnits = S.matches.filter((m) => m.magistrateId === mag.id).map((m) => m.unitId);
    S.matches = S.matches.filter((m) => m.magistrateId !== mag.id);
    freedUnits.forEach(refreshUnitStatus);

    mag.status = 'Rejeitado';
    mag.rejectionReason = reason;
    mag.rejectedAt = new Date().toISOString();
    log(mag.editionId, 'Administração', 'Magistrado',
      `Inscrição de ${mag.name} rejeitada${hadMatch ? ' (vinculação desfeita)' : ''}. Motivo: ${reason}`);
    res.json({ success: true, magistrate: mag });
  });
  app.post('/api/magistrates/:id/exclude', excludeMagistrate);
  app.delete('/api/magistrates/:id', excludeMagistrate);
 // compatibilidade: a exclusão individual também exige motivo

  app.post('/api/magistrates/:id/restore', (req, res) => {
    const mag = S.magistrates.find((m) => m.id === req.params.id);
    if (!mag || mag.status !== 'Excluído') return res.status(404).json({ error: 'Magistrado excluído não encontrado.' });
    mag.status = mag.statusBeforeExclusion && mag.statusBeforeExclusion !== 'Excluído' ? mag.statusBeforeExclusion : 'Lista de Espera';
    log(mag.editionId, 'Administração', 'Magistrado', `Exclusão de ${mag.name} desfeita (motivo registrado: ${mag.exclusionReason ?? '—'}). Status: ${mag.status}.`);
    mag.exclusionReason = undefined; mag.exclusionSei = undefined; mag.excludedAt = undefined; mag.excludedBy = undefined; mag.statusBeforeExclusion = undefined; mag.excludedFrom = undefined;
    res.json({ success: true, magistrate: mag });
  });
}
