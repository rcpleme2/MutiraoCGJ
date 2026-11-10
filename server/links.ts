// Vinculações: painel de designações vigentes, histórico de atuação, alterações, desistências e pessoas.
import { comarcaInText, resolveCatalog, tokens as nameTokens } from '../src/catalogo-match';
import { catalogById, canonicalComarca, fullUnitName, CATALOG_SEPARATOR } from '../src/catalogo-tjpr';
import { editionById, ensureInitialEdition, INITIAL_EDITION_TITLE } from './editions.ts';
import { log, newId, S } from './state.ts';
import { type ActingPeriod, type Magistrate, type Match, MATCH_WORK_TYPES, type PanelRow, type Person, type Unit, type WorkType } from './types.ts';
import { BRT, canonicalPersonName, cleanCell, cleanText, isYmd, norm, normName, personKey, ymdBrt, ymdDayBefore, ymdMonthEnd } from './util.ts';

/** Modalidade padrão da vinculação, conforme o auxílio pedido pela unidade e a disposição do magistrado */
export const defaultWorkType = (unit: Unit, mag: Magistrate): WorkType => {
  if (unit.supportNeeded === 'Audiência' || unit.supportNeeded === 'Sentença') return unit.supportNeeded;
  return mag.acceptsHearings ? 'Audiência' : 'Sentença'; // a unidade pediu os dois: audiências só se o magistrado aceita
};
/** Atendimento da unidade conforme as vinculações existentes e o número de magistrados a alocar (vagas). */
export function refreshUnitStatus(unitId: string) {
  const unit = S.units.find((u) => u.id === unitId);
  if (!unit) return;
  const linked = S.matches.filter((m) => m.unitId === unitId).length;
  // Pendente: nenhum magistrado; Em Andamento: vagas parcialmente preenchidas; Atendida: todas as vagas preenchidas
  unit.status = linked === 0 ? 'Pendente' : linked >= (unit.slots || 1) ? 'Atendida' : 'Em Andamento';
}
export const linkedCount = (unitId: string) => S.matches.filter((m) => m.unitId === unitId).length;
/**
 * Quem desistiu pode pedir nova inscrição. Quando uma inscrição do mesmo nome (comparação sem acento e sem diferença de caixa)
 * é deferida (Aprovado / Lista de Espera / Atribuído), a desistência passa a valer apenas para o período anterior: fica registrada como encerrada.
 */
export function reconcileWithdrawals() {
  const approved = ['Aprovado', 'Lista de Espera', 'Atribuído'];
  for (const w of S.withdrawals) {
    if (w.endedAt) continue;
    const key = personKey(w.name);
    const ids = new Set(w.magistrateIds ?? []);
    const back = S.magistrates.find((m) => approved.includes(m.status) && personKey(m.name) === key && (ids.has(m.id) || (m.createdAt > w.createdAt && !ids.has(m.id))));
    if (!back) continue;
    w.endedAt = new Date().toISOString();
    w.returnedMagistrateId = back.id;
    log(back.editionId, 'Sistema', 'Magistrado', `Nova inscrição de ${back.name} deferida: a desistência (SEI ${w.sei || 'não informado'}) passa a valer apenas para o período de ${w.requestDate ? w.requestDate.split('-').reverse().join('/') : 'registro'} até hoje.`);
  }
}
/** Linha de cabeçalho colada da planilha (ex.: Magistrado / Área / Designado para) — nunca é uma designação. */
export function isHeaderRow(name: string, area: string, unit: string) {
  const [a, b, c] = [normName(name), normName(area), normName(unit)];
  return /^(nome|magistrad|juiz|juiza)/.test(a) && b.startsWith('area') && /^(design|unidade|vara|lotac)/.test(c);
}
/** Unidade da edição inicial pelo nome (cria se não existir; campos desconhecidos em branco). */
export function ensureInitialUnit(unitName: string, area: string): Unit {
  const ed = ensureInitialEdition();
  // Nome que corresponde sem ambiguidade a uma unidade do catálogo oficial já entra padronizado
  const cat = resolveCatalog(unitName);
  let unit = cat
    ? S.units.find((u) => u.editionId === ed.id && u.catalogId === cat.id)
    : S.units.find((u) => u.editionId === ed.id && !u.catalogId && normName(u.unitName) === normName(unitName));
  if (!unit) {
    unit = {
      id: newId('unit'), editionId: ed.id, unitName: cat ? cat.unitName : unitName.toLocaleUpperCase('pt-BR'), judgeName: '', email: '',
      comarca: cat ? cat.comarca : '', separator: cat ? cat.separator : CATALOG_SEPARATOR, catalogId: cat?.id, areas: area ? [area] : [],
      supportNeeded: 'Audiência e Sentença', description: '', createdAt: new Date().toISOString(), status: 'Pendente', selection: 'Escolhida', slots: 1,
    };
    S.units.push(unit);
  } else if (area && !unit.areas.some((a) => normName(a) === normName(area))) unit.areas.push(area);
  return unit;
}
/** Cria magistrado, unidade (reaproveitada pelo nome) e vinculação reais na edição inicial; campos desconhecidos ficam em branco. */
export function createInitialLink(r: { name: string; area: string; unit: string }) {
  const ed = ensureInitialEdition();
  const now = new Date().toISOString();
  const unit = ensureInitialUnit(r.unit, r.area);
  const mag: Magistrate = {
    id: newId('mag'), editionId: ed.id, name: canonicalPersonName(r.name), email: '', currentLocation: '', firstPreference: r.area, secondPreference: '',
    acceptsHearings: false, createdAt: now, status: 'Atribuído',
  };
  S.magistrates.push(mag);
  unit.slots = Math.max(unit.slots || 1, linkedCount(unit.id) + 1);
  // Texto da planilha com informações além da unidade oficial (ex.: "(acervo cível), Vara Estadual...") fica como observação
  const official = new Set(nameTokens(fullUnitName(unit)));
  const extra = unit.catalogId && nameTokens(r.unit).some((w) => !official.has(w));
  S.matches.push({ id: newId('match'), editionId: ed.id, magistrateId: mag.id, unitId: unit.id, assignedArea: r.area, workType: 'Sentença', status: 'Vinculado', createdAt: now, ...(extra ? { note: r.unit } : {}) });
  refreshUnitStatus(unit.id);
}
/** Linhas coladas de versões anteriores viram vinculações reais na edição inicial (uma única vez). */
export function migratePanelEntries() {
  const ed = ensureInitialEdition();
  // Atuação das vinculações iniciais: apenas para sentença (a modalidade "audiência e sentença" deixou de existir)
  S.matches.filter((m) => m.editionId === ed.id && m.workType === 'Audiência e Sentença').forEach((m) => { m.workType = 'Sentença'; });
  // Remove linha de cabeçalho da planilha que tenha sido importada como se fosse designação
  for (const mt of S.matches.filter((m) => m.editionId === ed.id)) {
    const mag = S.magistrates.find((m) => m.id === mt.magistrateId); const un = S.units.find((u) => u.id === mt.unitId);
    if (mag && un && isHeaderRow(mag.name, mt.assignedArea, un.unitName)) {
      S.matches = S.matches.filter((m) => m.id !== mt.id);
      S.magistrates = S.magistrates.filter((m) => m.id !== mag.id);
      if (!S.matches.some((m) => m.unitId === un.id)) S.units = S.units.filter((u) => u.id !== un.id);
      else refreshUnitStatus(un.id);
      log(ed.id, 'Sistema', 'Vinculação', 'Linha de cabeçalho da planilha removida das vinculações iniciais.');
    }
  }
  if (S.panelEntries.length === 0) return;
  const count = S.panelEntries.length;
  for (const e of S.panelEntries) if (!isHeaderRow(e.name, e.area, e.unit)) createInitialLink(e);
  S.panelEntries = [];
  log(null, 'Sistema', 'Vinculação', `${count} designação(ões) importada(s) de planilha convertida(s) em vinculações da edição "${INITIAL_EDITION_TITLE}".`);
}
export const panelKey = (r: { name: string; area: string; unit: string }) => `${norm(r.name)}|${norm(r.area)}|${norm(r.unit)}`;
/** Tabela única com as designações vigentes de TODAS as edições (as de edições anteriores continuam valendo até a desistência). */
export const preferenceMet = (mag: Magistrate, area: string): 0 | 1 | 2 =>
  mag.firstPreference && norm(mag.firstPreference) === norm(area) ? 1 : mag.secondPreference && norm(mag.secondPreference) === norm(area) ? 2 : 0;
export const preferenceText = (r: { preference?: number; firstPreference?: string }) =>
  r.preference === 1 ? '1ª preferência' : r.preference === 2 ? '2ª preferência' : r.firstPreference ? 'Fora das preferências' : '—';
export function panelRows(): PanelRow[] {
  const seen = new Map<string, PanelRow>();
  for (const mt of S.matches) {
    const mag = S.magistrates.find((m) => m.id === mt.magistrateId);
    const un = S.units.find((u) => u.id === mt.unitId);
    if (!mag || !un || mag.status === 'Desistente' || mag.status === 'Excluído' || isHeaderRow(mag.name, mt.assignedArea, un.unitName)) continue;
    const k = `${panelKey({ name: mag.name, area: mt.assignedArea, unit: un.unitName })}|${mt.editionId}`;
    if (!seen.has(k)) seen.set(k, { id: mt.id, editionId: mt.editionId, editionTitle: editionById(mt.editionId)?.title ?? '', magistrateId: mag.id, unitId: un.id, name: mag.name, area: mt.assignedArea, unit: un.unitName, comarca: un.comarca, separator: un.separator, workType: mt.workType, startDate: mt.startDate, since: mt.startDate ?? editionById(mt.editionId)?.startDate, note: mt.note, postit: mt.postit, postitUpdatedAt: mt.postitUpdatedAt, firstPreference: mag.firstPreference, secondPreference: mag.secondPreference, preference: preferenceMet(mag, mt.assignedArea) });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.unit.localeCompare(b.unit, 'pt-BR'));
}
export function actingPeriods(): ActingPeriod[] {
  const title = (id: string) => editionById(id)?.title ?? '';
  // Início não registrado: vigência da última alteração que levou a pessoa a esta unidade (até a data final), senão o início da edição
  const startOf = (editionId: string, explicit: string | undefined, who: { ids: string[]; name: string }, unit: string, until?: string) => {
    if (explicit) return explicit;
    const key = personKey(who.name);
    const arrival = S.transfers.filter((t) => (who.ids.includes(t.magistrateId) || personKey(t.name) === key) && norm(t.toUnit) === norm(unit) && (!until || t.effectiveDate <= until))
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
    return arrival?.effectiveDate ?? editionById(editionId)?.startDate;
  };
  const out: ActingPeriod[] = [];
  for (const r of panelRows()) {
    const unit = unitLabel(r);
    const hint = catalogById(S.units.find((u) => u.id === r.unitId)?.catalogId)?.comarca ?? r.comarca;
    out.push({ id: r.id, name: r.name, editionId: r.editionId, editionTitle: r.editionTitle, area: r.area, unit, workType: r.workType ?? '', start: r.since, endReason: '',
      comarca: canonicalComarca(hint) ?? comarcaInText(unit) ?? hint ?? '' });
  }
  for (const t of S.transfers) {
    const end = ymdDayBefore(t.effectiveDate);
    out.push({ id: `${t.id}:de`, name: t.name, editionId: t.editionId, editionTitle: title(t.editionId), area: t.area, unit: t.fromUnit, workType: t.fromWorkType,
      start: startOf(t.editionId, t.fromStartDate, { ids: [t.magistrateId], name: t.name }, t.fromUnit, end), end, endReason: 'Alteração de vinculação', ...(t.sei ? { sei: t.sei } : {}) });
  }
  for (const w of S.withdrawals) {
    const end = w.requestDate ? ymdMonthEnd(w.requestDate) : undefined;
    const held = w.designations ?? [{ editionId: w.editionId, area: w.area, unit: w.unit }];
    held.forEach((h, i) => out.push({ id: `${w.id}:${i}`, name: w.name, editionId: h.editionId, editionTitle: title(h.editionId), area: h.area, unit: h.unit, workType: h.workType ?? '',
      start: startOf(h.editionId, h.startDate, { ids: w.magistrateIds ?? [], name: w.name }, h.unit, end), end, endReason: 'Desistência', ...(w.sei ? { sei: w.sei } : {}) }));
  }
  for (const m of S.magistrates) {
    if (m.status !== 'Excluído' || !m.excludedFrom) continue;
    const end = m.excludedAt ? ymdBrt(m.excludedAt) : undefined;
    m.excludedFrom.forEach((h, i) => out.push({ id: `${m.id}:exc${i}`, name: m.name, editionId: h.editionId, editionTitle: title(h.editionId), area: h.area, unit: h.unit, workType: h.workType ?? '',
      start: startOf(h.editionId, h.startDate, { ids: [m.id], name: m.name }, h.unit, end), end, endReason: 'Exclusão', ...(m.exclusionSei ? { sei: m.exclusionSei } : {}) }));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || (a.start ?? '').localeCompare(b.start ?? '') || (a.end ?? '9').localeCompare(b.end ?? '9'));
}
/** Dias de atuação no período (inclusive o primeiro e o último; períodos em curso contam até hoje) */
export const periodDays = (p: { start?: string; end?: string }) => {
  if (!p.start) return null;
  const end = p.end ?? ymdBrt(new Date().toISOString());
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${p.start}T00:00:00Z`)) / 86_400_000) + 1;
  return days > 0 ? days : 0;
};
export const personOf = (magistrateId: string, name: string): Person =>
  ({ key: personKey(name), email: S.magistrates.find((m) => m.id === magistrateId)?.email?.trim().toLowerCase() ?? '' });
export const samePerson = (a: Person, b: Person) => a.key === b.key || (!!a.email && a.email === b.email);
/** Desfaz uma vinculação (o painel é calculado a partir delas, então a linha some automaticamente). */
export function undoMatch(id: string, reason = 'Vinculação desfeita') {
  const match = S.matches.find((m) => m.id === id);
  if (!match) return;
  const mag = S.magistrates.find((m) => m.id === match.magistrateId);
  if (mag && mag.status === 'Atribuído') mag.status = 'Lista de Espera';
  log(match.editionId, 'Administração', 'Vinculação', `${reason}: ${describeMatch(match)}.`);
  S.matches = S.matches.filter((m) => m.id !== id);
  refreshUnitStatus(match.unitId);
}
export const unitLabel = (r: { unit: string; comarca?: string; separator?: string }) => fullUnitName({ unitName: r.unit, comarca: r.comarca, separator: r.separator });
export const describeMatch = (mt: Match) => {
  const mag = S.magistrates.find((m) => m.id === mt.magistrateId);
  const un = S.units.find((u) => u.id === mt.unitId);
  return `${mag?.name || 'Magistrado'} → ${un ? fullUnitName(un) : 'Unidade'} (${mt.assignedArea}; ${mt.workType})`;
};
/**
 * Altera uma vinculação (troca de magistrado, unidade, área, tipo ou data de início).
 * Com data de vigência, a troca de unidade, área ou tipo do mesmo magistrado é uma alteração de vinculação:
 * o período anterior vai até a véspera e o novo começa na data. Usada pela edição da vinculação e pelo painel (alterar vara/área/tipo).
 */
export function updateMatch(match: Match, body: any): { status: number; error: string } | { match: Match } {
  const fail = (status: number, error: string) => ({ status, error });

  const before = describeMatch(match);
  const { magistrateId, unitId, assignedArea, workType } = body;
  if (workType && !MATCH_WORK_TYPES.includes(workType)) {
    return fail(400, 'Modalidade inválida. Use Para audiências ou Para sentença.');
  }

  const nextMag = S.magistrates.find((m) => m.id === (magistrateId || match.magistrateId));
  const newUnitName = typeof body?.newUnitName === 'string' ? cleanText(body.newUnitName, 300) : null;
  const initialMatch = editionById(match.editionId)?.isInitial === true;
  // Na edição "Vinculações iniciais" a vara de destino pode ser digitada (é criada se ainda não existir)
  const nextUnit = initialMatch && newUnitName ? ensureInitialUnit(newUnitName, match.assignedArea) : S.units.find((u) => u.id === (unitId || match.unitId));
  if (!nextMag || !nextUnit) return fail(400, 'Magistrado ou unidade não encontrados.');
  if (nextMag.status === 'Rejeitado') {
    return fail(400, 'A inscrição deste magistrado foi rejeitada. Reconsidere-a antes de vincular.');
  }

  if (nextUnit.selection !== 'Escolhida') {
    return fail(400, 'Só é possível vincular unidades escolhidas para o mutirão.');
  }

  // O magistrado escolhido não pode estar vinculado em outra unidade; mover para outra unidade exige vaga livre
  if (S.matches.some((m) => m.id !== match.id && m.magistrateId === nextMag.id)) {
    return fail(409, 'Este magistrado já está vinculado a outra unidade. Desfaça essa vinculação antes.');
  }
  const movingUnit = nextUnit.id !== match.unitId;
  if (movingUnit && initialMatch && linkedCount(nextUnit.id) >= (nextUnit.slots || 1)) nextUnit.slots = linkedCount(nextUnit.id) + 1; // varas das vinculações iniciais não limitam o número de magistrados
  if (movingUnit && linkedCount(nextUnit.id) >= (nextUnit.slots || 1)) {
    return fail(409, `Todas as ${nextUnit.slots || 1} vaga(s) da unidade de destino já estão preenchidas.`);
  }

  const oldUnitId = match.unitId;
  const oldMag = S.magistrates.find((m) => m.id === match.magistrateId);
  const changedMag = nextMag.id !== oldMag?.id;
  // Troca de unidade do mesmo magistrado: exige a data a partir da qual ele atuará na nova unidade (a antiga vale até o dia anterior)
  const effectiveDate = typeof body?.effectiveDate === 'string' ? body.effectiveDate.trim() : '';
  const transferSei = typeof body?.sei === 'string' ? cleanCell(body.sei) : '';
  if (transferSei && (transferSei.length < 3 || transferSei.length > 100)) return fail(400, 'Número do processo SEI inválido.');
  const newArea = typeof assignedArea === 'string' ? cleanCell(assignedArea) : '';
  if (newArea.length > 150) return fail(400, 'Área de atuação longa demais.');
  const changingArea = !!newArea && newArea !== match.assignedArea;
  const changingWorkType = !!workType && workType !== match.workType;
  // Trocar a unidade do mesmo magistrado é uma alteração de vinculação e exige a data de vigência. A área e o tipo também,
  // quando informada a data (painel de vinculações) ou na edição das vinculações iniciais.
  const isTransfer = !changedMag && (movingUnit || ((changingArea || changingWorkType) && (initialMatch || !!effectiveDate)));
  if (isTransfer && (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || Number.isNaN(Date.parse(`${effectiveDate}T00:00:00${BRT}`)) || effectiveDate < '2000-01-01')) {
    return fail(400, 'Informe a partir de quando o magistrado atuará na nova unidade.');
  }
  // Correção da data de início (sem alteração de vara/área): em branco volta a valer o início da edição
  const newStart = typeof body?.startDate === 'string' ? body.startDate.trim() : null;
  if (newStart && !isYmd(newStart)) return fail(400, 'Data de início da atuação inválida.');
  if (newStart !== null && isTransfer) return fail(400, 'Na alteração de vara/área, o início na nova unidade é a data de vigência.');
  const oldUnit = S.units.find((u) => u.id === oldUnitId);
  const oldWorkType = match.workType; const oldArea = match.assignedArea; const oldStart = match.startDate;
  if (oldMag && changedMag) oldMag.status = 'Lista de Espera';

  match.magistrateId = nextMag.id;
  if (changedMag) match.editionId = nextMag.editionId; // a vinculação pertence à janela de inscrição do magistrado
  match.unitId = nextUnit.id;
  match.assignedArea = newArea || match.assignedArea;
  if (initialMatch && match.assignedArea && !nextUnit.areas.some((a) => normName(a) === normName(match.assignedArea))) nextUnit.areas.push(match.assignedArea);
  match.workType = workType || (movingUnit || changedMag ? defaultWorkType(nextUnit, nextMag) : match.workType);
  match.exceptionReason = undefined;
  nextMag.status = 'Atribuído';
  refreshUnitStatus(oldUnitId);
  refreshUnitStatus(nextUnit.id);
  const startBefore = match.startDate;
  if (changedMag) match.startDate = undefined; // outro magistrado: começa no início da edição, salvo data informada
  if (newStart !== null) match.startDate = newStart && newStart !== editionById(match.editionId)?.startDate ? newStart : undefined;
  if (isTransfer) {
    match.startDate = effectiveDate;
    const label = (u?: Unit) => (u ? fullUnitName(u) : 'unidade removida');
    S.transfers.push({ id: newId('tr'), editionId: match.editionId, magistrateId: nextMag.id, name: nextMag.name, ...(oldStart ? { fromStartDate: oldStart } : {}), area: oldArea, toArea: match.assignedArea, ...(transferSei ? { sei: transferSei } : {}), fromUnit: label(oldUnit), toUnit: label(nextUnit),
      fromWorkType: oldWorkType, toWorkType: match.workType, effectiveDate, createdAt: new Date().toISOString() });
  }

  const startNote = !isTransfer && match.startDate !== startBefore
    ? ` (início da atuação: ${(match.startDate ?? editionById(match.editionId)?.startDate)?.split('-').reverse().join('/') ?? 'não informado'})` : '';
  const what = [movingUnit && 'nova unidade', changingArea && 'nova área', changingWorkType && 'novo tipo'].filter(Boolean).join(', ');
  log(match.editionId, 'Administração', 'Vinculação', `Vinculação alterada${startNote}${isTransfer ? ` (${what} a partir de ${effectiveDate.split('-').reverse().join('/')}${transferSei ? `; SEI ${transferSei}` : ''})` : ''}: de ${before} para ${describeMatch(match)}.`);
  return { match };
}
export const fullUnitOf = (u?: Unit) => (u ? fullUnitName(u) : 'unidade removida');
/** A designação precisa ser para fora da comarca em que o magistrado atua */
export const sameComarcaAs = (m: Magistrate, u: Unit) => {
  const mc = normName(m.locationComarca || '');
  if (mc) return mc === normName(u.comarca);
  return !!u.comarca && normName(m.currentLocation).includes(normName(u.comarca)); // lotação digitada sem comarca da lista
};
