// Janelas de inscrição (antigas edições): prazo, vigência, escopo das consultas e a janela "Vinculações iniciais".
import express from 'express';
import { log, newId, S } from './state.ts';
import { type Edition, type RegistrationState, type Scope, type Unit } from './types.ts';
import { BRT, fmtLocal, normName } from './util.ts';

export const editionById = (id: string | undefined) => S.editions.find((e) => e.id === id);
/** Primeira edição (não inicial) criada depois da edição informada */
export function nextEditionAfter(editionId: string): Edition | undefined {
  const cur = editionById(editionId);
  if (!cur) return undefined;
  return S.editions.filter((e) => !e.isInitial && e.id !== cur.id && e.createdAt > cur.createdAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
}
/**
 * Pedido de unidade rejeitado e mantido: volta a "Em análise" na janela de inscrição seguinte (o mesmo registro, mantendo a data
 * original da inscrição). Devolve false se a unidade já tem outro pedido em aberto nessa janela.
 */
export function carryUnitTo(u: Unit, target: Edition): boolean {
  u.carryOver = false;
  const same = (x: Unit) => (u.catalogId ? x.catalogId === u.catalogId : normName(x.unitName) === normName(u.unitName) && normName(x.comarca) === normName(u.comarca));
  if (S.units.some((x) => x.id !== u.id && x.editionId === target.id && x.selection !== 'Rejeitada' && same(x))) return false;
  Object.assign(u, { carriedFromEditionId: u.editionId, editionId: target.id, selection: 'Em análise', status: 'Pendente',
    rejectionReason: undefined, rejectedAt: undefined, carriedToEditionId: undefined });
  return true;
}
export function scopeOf(req: express.Request): Scope | undefined {
  if (req.query.edition === 'all' || req.body?.editionId === 'all') return { all: true, title: 'Todas as janelas', has: () => true };
  const e = resolveEdition(req);
  return e ? { all: false, edition: e, title: e.title, has: (x) => x.editionId === e.id } : undefined;
}
/** Resolves the edition targeted by a request (?edition=, body.editionId) or falls back to the active one. */
export function resolveEdition(req: express.Request): Edition | undefined {
  const id = (req.query.edition as string) || req.body?.editionId || S.activeEditionId;
  return editionById(id);
}
export function registrationState(e: Edition): RegistrationState {
  if (e.status === 'Encerrada') return 'closed';
  if (!e.isRegistrationOpen) return 'paused';
  const opens = Date.parse(`${e.openingDate}${BRT}`);
  const closes = Date.parse(`${e.closingDate}${BRT}`) + 60_000; // inclui o minuto final inteiro (até hh:mm:59)
  if (Number.isNaN(opens) || Number.isNaN(closes)) return 'paused'; // datas inválidas: fecha por segurança
  const now = Date.now();
  if (now < opens) return 'not_yet';
  if (now >= closes) return 'ended';
  return 'open';
}
export function registrationMessage(e: Edition, state: RegistrationState) {
  if (state === 'not_yet') return `As inscrições ainda não foram abertas. Abertura em ${fmtLocal(e.openingDate)} (horário de Brasília).`;
  if (state === 'ended') return `O prazo de inscrições foi encerrado em ${fmtLocal(e.closingDate)} (horário de Brasília).`;
  return 'As inscrições estão encerradas ou temporariamente suspensas pela coordenação.';
}
export const publicEdition = (e: Edition) => {
  const state = registrationState(e);
  return { ...e, isActive: e.id === S.activeEditionId, registration: { state, message: state === 'open' ? '' : registrationMessage(e, state) } };
};
export function editionStats(e: Edition) {
  const mags = S.magistrates.filter((m) => m.editionId === e.id);
  const us = S.units.filter((u) => u.editionId === e.id);
  const ms = S.matches.filter((m) => m.editionId === e.id);
  return {
    magistrates: mags.length,
    units: us.length,
    matches: ms.length,
    waiting: mags.filter((m) => m.status !== 'Atribuído' && m.status !== 'Rejeitado' && m.status !== 'Desistente' && m.status !== 'Excluído').length,
    pendingUnits: us.filter((u) => u.selection === 'Escolhida' && u.status === 'Pendente').length,
  };
}
// Guarda as designações já existentes (importadas de planilha). Nunca é a edição vigente do portal e não recebe inscrições públicas.
export const INITIAL_EDITION_TITLE = 'Vinculações iniciais';
/** Início da atuação das vinculações iniciais (as demais edições têm a data definida no cadastro da edição) */
export const INITIAL_START_DATE = '2026-06-15';
export function ensureInitialEdition(): Edition {
  let ed = S.editions.find((e) => e.isInitial) ?? S.editions.find((e) => normName(e.title) === normName(INITIAL_EDITION_TITLE));
  if (!ed) {
    ed = {
      id: newId('ed'), title: INITIAL_EDITION_TITLE,
      description: 'Designações já existentes (magistrado, área e unidade). Altere aqui as varas para atualizar o painel de vinculações.',
      openingDate: '2026-01-01T00:00', closingDate: '2026-01-01T00:00',
      isRegistrationOpen: false, status: 'Em andamento', createdAt: new Date().toISOString(), isInitial: true,
    };
    S.editions.push(ed);
    log(ed.id, 'Sistema', 'Edição', `Edição "${ed.title}" criada.`);
  }
  ed.isInitial = true;
  ed.isRegistrationOpen = false;
  if (!ed.startDate) ed.startDate = INITIAL_START_DATE;
  return ed;
}
