// Rotas das janelas de inscrição (antigas edições) e da configuração pública do portal.
import express from 'express';
import { carryUnitTo, editionById, editionStats, INITIAL_EDITION_TITLE, publicEdition } from '../editions.ts';
import { refreshUnitStatus } from '../links.ts';
import { log, newId, S } from '../state.ts';
import { type Edition } from '../types.ts';
import { isYmd } from '../util.ts';
import { confirmedWipe } from '../validation.ts';

export function register(app: express.Express) {
  // Public settings: the active edition (kept shape-compatible with the former /api/settings).
  app.get('/api/settings', (_req, res) => {
    const active = editionById(S.activeEditionId) || S.editions[0];
    res.json(active ? publicEdition(active) : null);
  });
  app.get('/api/editions', (_req, res) => {
    const list = [...S.editions]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((e) => ({ ...publicEdition(e), stats: editionStats(e) }));
    res.json({ activeEditionId: S.activeEditionId, editions: list });
  });
  app.post('/api/editions', (req, res) => {
    const { title, description, openingDate, closingDate, activate, startDate } = req.body || {};
    if (!title || !openingDate || !closingDate) {
      return res.status(400).json({ error: 'Informe nome, abertura e encerramento da janela de inscrição.' });
    }
    if (startDate && !isYmd(startDate)) return res.status(400).json({ error: 'Data de início da atuação inválida.' });
    const edition: Edition = {
      id: newId('ed'),
      title,
      description: description || '',
      openingDate,
      closingDate,
      isRegistrationOpen: true,
      status: 'Em andamento',
      createdAt: new Date().toISOString(),
      ...(startDate ? { startDate } : {}),
    };
    S.editions.push(edition);
    log(edition.id, 'Administração', 'Edição', `Edição "${edition.title}" criada.`);
    // Pedidos de unidades rejeitadas que ficaram aguardando a próxima edição passam para esta
    const waiting = S.units.filter((u) => u.carryOver && u.editionId !== edition.id);
    const carried = waiting.filter((u) => carryUnitTo(u, edition)).length;
    if (waiting.length) log(edition.id, 'Sistema', 'Unidade', `${carried} pedido(s) de unidade mantido(s) voltou(aram) para análise nesta janela de inscrição.`);
    if (activate) {
      S.activeEditionId = edition.id;
      log(edition.id, 'Administração', 'Edição', 'Edição definida como a vigente para inscrições públicas.');
    }
    res.status(201).json({ success: true, edition: publicEdition(edition) });
  });
  app.put('/api/editions/:id', (req, res) => {
    const edition = editionById(req.params.id);
    if (!edition) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });

    const { title, description, openingDate, closingDate, isRegistrationOpen, startDate } = req.body || {};
    if (typeof startDate === 'string' && startDate && !isYmd(startDate)) return res.status(400).json({ error: 'Data de início da atuação inválida.' });
    const changes: string[] = [];
    if (typeof startDate === 'string' && startDate !== (edition.startDate ?? '')) {
      changes.push(`início da atuação para ${startDate ? startDate.split('-').reverse().join('/') : 'não informado'}`);
      edition.startDate = startDate || undefined;
    }
    if (title && title !== edition.title) { changes.push(`título para "${title}"`); edition.title = title; }
    if (description !== undefined && description !== edition.description) { changes.push('descrição'); edition.description = description; }
    if (openingDate && openingDate !== edition.openingDate) { changes.push('data de abertura'); edition.openingDate = openingDate; }
    if (closingDate && closingDate !== edition.closingDate) { changes.push('data de encerramento'); edition.closingDate = closingDate; }
    if (typeof isRegistrationOpen === 'boolean' && isRegistrationOpen !== edition.isRegistrationOpen) {
      edition.isRegistrationOpen = isRegistrationOpen;
      changes.push(isRegistrationOpen ? 'inscrições reabertas' : 'inscrições encerradas');
    }
    if (changes.length) {
      log(edition.id, 'Administração', 'Edição', `Edição atualizada: ${changes.join(', ')}.`);
    }
    res.json({ success: true, edition: publicEdition(edition) });
  });
  app.post('/api/editions/:id/activate', (req, res) => {
    const edition = editionById(req.params.id);
    if (!edition) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    S.activeEditionId = edition.id;
    log(edition.id, 'Administração', 'Edição', 'Edição definida como a vigente para inscrições públicas.');
    res.json({ success: true });
  });
  app.post('/api/editions/:id/close', (req, res) => {
    const edition = editionById(req.params.id);
    if (!edition) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    edition.status = 'Encerrada';
    edition.isRegistrationOpen = false;
    log(edition.id, 'Administração', 'Edição', 'Edição encerrada. Inscrições fechadas.');
    res.json({ success: true, edition: publicEdition(edition) });
  });
  app.post('/api/editions/:id/reopen', (req, res) => {
    const edition = editionById(req.params.id);
    if (!edition) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    edition.status = 'Em andamento';
    log(edition.id, 'Administração', 'Edição', 'Edição reaberta (em andamento).');
    res.json({ success: true, edition: publicEdition(edition) });
  });
  // Exclusão de edição (perfil Administrador; exige confirm: "EXCLUIR"). Apaga também as inscrições, unidades,
  // vinculações, desistências e alterações de vinculação da edição. O registro de atividades é preservado.
  app.post('/api/editions/:id/delete', (req, res) => {
    const edition = editionById(req.params.id);
    if (!edition) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    if (!confirmedWipe(req)) return res.status(400).json({ error: 'Confirmação ausente.' });
    if (edition.isInitial) return res.status(409).json({ error: `A edição "${INITIAL_EDITION_TITLE}" guarda as designações já existentes do painel de vinculações e não pode ser excluída.` });
    if (edition.id === S.activeEditionId) return res.status(409).json({ error: 'Esta é a janela vigente no portal. Torne outra janela vigente antes de excluí-la.' });
    if (S.editions.length <= 1) return res.status(409).json({ error: 'É preciso manter ao menos uma janela de inscrição.' });

    const id = edition.id;
    const counts = {
      magistrates: S.magistrates.filter((m) => m.editionId === id).length,
      units: S.units.filter((u) => u.editionId === id).length,
      matches: S.matches.filter((m) => m.editionId === id).length,
    };
    // Vinculações entre janelas: as que usam magistrado ou unidade da janela excluída também saem; quem fica sem vínculo volta à espera
    const goneMags = new Set(S.magistrates.filter((m) => m.editionId === id).map((m) => m.id));
    const goneUnits = new Set(S.units.filter((u) => u.editionId === id).map((u) => u.id));
    const dropped = S.matches.filter((m) => m.editionId === id || goneMags.has(m.magistrateId) || goneUnits.has(m.unitId));
    S.magistrates = S.magistrates.filter((m) => m.editionId !== id);
    S.units = S.units.filter((u) => u.editionId !== id);
    S.matches = S.matches.filter((m) => !dropped.includes(m));
    dropped.forEach((mt) => {
      const g = S.magistrates.find((x) => x.id === mt.magistrateId);
      if (g && g.status === 'Atribuído' && !S.matches.some((x) => x.magistrateId === g.id)) g.status = 'Lista de Espera';
      if (S.units.some((u) => u.id === mt.unitId)) refreshUnitStatus(mt.unitId);
    });
    S.panelEntries = S.panelEntries.filter((p) => p.editionId !== id);
    S.withdrawals = S.withdrawals.filter((w) => w.editionId !== id);
    S.transfers = S.transfers.filter((t) => t.editionId !== id);
    S.changeRequests = S.changeRequests.filter((r) => r.editionId !== id);
    S.units.forEach((u) => {
      // Pedido que tinha sido transportado para a edição excluída volta a aguardar a próxima edição
      if (u.carriedToEditionId === id) { u.carriedToEditionId = undefined; u.carryOver = true; }
      if (u.carriedFromEditionId === id) u.carriedFromEditionId = undefined;
    });
    S.editions = S.editions.filter((e) => e.id !== id);
    log(null, 'Administração', 'Edição',
      `EXCLUSÃO DE EDIÇÃO: "${edition.title}" excluída, com ${counts.magistrates} inscrição(ões) de magistrado(s), ${counts.units} unidade(s) e ${counts.matches} vinculação(ões).`);
    res.json({ success: true, ...counts });
  });
}
