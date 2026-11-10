// Lista oficial de comarcas e unidades: aplicação, conciliação de nomes e uso pelas inscrições.
import { catalogById, canonicalComarca, fullUnitName, CATALOG_SEPARATOR, BUILTIN_COMARCAS, BUILTIN_UNITS, setCatalog, slug, type CatalogRecord } from '../src/catalogo-tjpr';
import { comarcaInText, resolveCatalog } from '../src/catalogo-match';
import { editionById } from './editions.ts';
import { linkedCount, refreshUnitStatus } from './links.ts';
import { log, S } from './state.ts';
import { type Unit } from './types.ts';
import { canonicalPersonName, fold, norm, upper } from './util.ts';
import { MAX_SLOTS } from './validation.ts';

/** Ativa a lista gravada (ou a embutida, se nunca foi editada) */
export function applyCatalog() {
  if (!S.catalogUnits.length && !S.catalogComarcas.length) { setCatalog(BUILTIN_COMARCAS, BUILTIN_UNITS); return; }
  setCatalog(S.catalogComarcas.map((c) => c.name), S.catalogUnits);
}
/** Antes da primeira edição, copia a lista embutida para o estado (passa a ser gravada no banco). */
export function materializeCatalog() {
  if (S.catalogUnits.length || S.catalogComarcas.length) return;
  S.catalogUnits = BUILTIN_UNITS.map((u) => ({ ...u }));
  S.catalogComarcas = BUILTIN_COMARCAS.map((name) => ({ id: slug(name), name }));
}
/**
 * Conferência das unidades das edições que não são a inicial: indica, a partir do painel geral de vinculações
 * (designações vigentes de todas as edições), se já há magistrado atuando na comarca e/ou na mesma vara.
 * As vinculações da própria unidade não contam.
 */
/** Unidade oficial e comarca de cada inscrição: pelo catálogo; para nomes digitados, pela melhor correspondência inequívoca */
export function unitResolver() {
  const idOf = new Map<string, string | undefined>(), comarcaOfMap = new Map<string, string>();
  return (x: Unit) => {
    if (!idOf.has(x.id)) {
      const full = fullUnitName(x);
      const id = x.catalogId ?? resolveCatalog(full, canonicalComarca(x.comarca))?.id;
      idOf.set(x.id, id);
      comarcaOfMap.set(x.id, canonicalComarca(x.comarca) ?? catalogById(id)?.comarca ?? comarcaInText(full) ?? x.comarca ?? '');
    }
    return { id: idOf.get(x.id), comarca: comarcaOfMap.get(x.id) ?? '', full: norm(fullUnitName(x)) };
  };
}
export const sameUnit = (a: { id?: string; full: string }, b: { id?: string; full: string }) => (a.id && b.id ? a.id === b.id : a.full === b.full);
/**
 * Aplica a padronização: liga os registros à unidade do catálogo (o nome oficial substitui o digitado).
 * Unidades que ficarem repetidas na mesma edição são fundidas (vinculações, vagas, áreas e justificativas passam para uma só).
 * `note` (opcional) vira observação das designações dessas unidades.
 */
/** Nomes de magistrados (e cópias em desistências e alterações) fora da grafia padrão em MAIÚSCULAS. */
export const namesToFix = () => [
  ...S.magistrates.filter((m) => m.name !== canonicalPersonName(m.name)).map((m) => ({ kind: 'magistrado', from: m.name, to: canonicalPersonName(m.name), apply: () => { if (!m.nameAsTyped) m.nameAsTyped = m.name; m.name = canonicalPersonName(m.name); } })),
  ...S.withdrawals.filter((w) => w.name !== canonicalPersonName(w.name)).map((w) => ({ kind: 'desistência', from: w.name, to: canonicalPersonName(w.name), apply: () => { w.name = canonicalPersonName(w.name); } })),
  ...S.transfers.filter((t) => t.name !== canonicalPersonName(t.name)).map((t) => ({ kind: 'alteração', from: t.name, to: canonicalPersonName(t.name), apply: () => { t.name = canonicalPersonName(t.name); } })),
];
/** Na edição, deixa uma só inscrição por unidade do catálogo (a mais antiga): vinculações, vagas, áreas e justificativas passam para ela. */
export function mergeCatalogDuplicates(edId: string, catalogId: string): number {
  const same = S.units.filter((x) => x.editionId === edId && x.catalogId === catalogId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const keeper = same[0];
  if (!keeper) return 0;
  for (const dup of same.slice(1)) {
    S.matches.filter((m) => m.unitId === dup.id).forEach((m) => { m.unitId = keeper.id; });
    const sum = (keeper.slots || 1) + (dup.slots || 1);
    keeper.slots = Math.max(linkedCount(keeper.id), editionById(edId)?.isInitial ? sum : Math.min(sum, MAX_SLOTS));
    keeper.areas = [...new Set([...keeper.areas, ...dup.areas])];
    if (dup.description && dup.description !== keeper.description) keeper.description = [keeper.description, dup.description].filter(Boolean).join('\n---\n').slice(0, 2000);
    if (keeper.selection !== 'Escolhida' && dup.selection === 'Escolhida') keeper.selection = 'Escolhida';
    S.units = S.units.filter((x) => x.id !== dup.id);
    log(edId, 'Administração', 'Unidade', `Inscrições repetidas da unidade "${fullUnitName(keeper)}" fundidas em uma só.`);
  }
  refreshUnitStatus(keeper.id);
  return same.length - 1;
}
/** Inscrição de unidade que corresponde a esta unidade da lista (pelo vínculo ou, se digitada, pelo nome completo) */
export const isSameUnit = (u: Unit, c: { id: string; label: string }) => (u.catalogId ? u.catalogId === c.id : norm(fullUnitName(u)) === norm(c.label));
/** Magistrados com designação vigente na unidade da lista (bloqueiam a exclusão) */
export const linkedTo = (c: { id: string; label: string }) => {
  const names = new Set<string>();
  for (const mt of S.matches) {
    const un = S.units.find((u) => u.id === mt.unitId);
    const mag = S.magistrates.find((m) => m.id === mt.magistrateId);
    if (un && mag && mag.status !== 'Desistente' && mag.status !== 'Excluído' && isSameUnit(un, c)) names.add(mag.name);
  }
  return [...names];
};
export const usageOf = (c: { id: string; label: string }) => ({
  linked: linkedTo(c),
  registrations: S.units.filter((u) => isSameUnit(u, c)).length,
  lotacao: S.magistrates.filter((m) => m.locationCatalogId === c.id).length,
});
/** Troca, nos registros já gravados, o nome antigo da unidade pelo novo (inscrições, lotações e textos do painel). */
export function cascadeUnit(old: { id: string; label: string; unitName: string; comarca: string; separator: string }, next: CatalogRecord) {
  const label = catalogById(next.id)?.label ?? `${next.unitName} ${next.separator} ${next.comarca}`;
  const olds = new Set([norm(old.label), norm(fullUnitName(old))]);
  const swap = (t: string) => (olds.has(norm(t)) ? label : t);
  let changed = 0;
  for (const u of S.units) if (isSameUnit(u, old)) { u.unitName = next.unitName; u.comarca = next.comarca; u.separator = next.separator; u.catalogId = next.id; changed++; }
  for (const m of S.magistrates) {
    if (m.locationCatalogId === old.id) { m.currentLocation = label; m.locationComarca = next.comarca; changed++; }
    m.excludedFrom?.forEach((h) => { h.unit = swap(h.unit); });
  }
  S.panelEntries.forEach((e) => { e.unit = swap(e.unit); });
  S.withdrawals.forEach((w) => { w.unit = swap(w.unit); });
  S.transfers.forEach((t) => { t.fromUnit = swap(t.fromUnit); t.toUnit = swap(t.toUnit); });
  return changed;
}
/** Ao apagar: as inscrições e lotações mantêm o nome como texto, sem o vínculo com a lista */
export function detachUnit(c: { id: string; label: string }) {
  for (const u of S.units) if (u.catalogId === c.id) u.catalogId = undefined;
  for (const m of S.magistrates) if (m.locationCatalogId === c.id) m.locationCatalogId = undefined;
}
export const findComarca = (name: unknown) => (typeof name === 'string' ? S.catalogComarcas.find((c) => fold(c.name) === fold(name)) : undefined);
export const uniqueId = (base: string, taken: Set<string>) => { let id = base, n = 2; while (taken.has(id)) id = `${base}-${n++}`; return id; };
export const readSeparator = (v: unknown) => (typeof v === 'string' && /^(DE|DA|DO|DOS|DAS|–|-)$/.test(v.trim().toUpperCase()) ? v.trim().toUpperCase().replace('-', '–') : CATALOG_SEPARATOR);
/** Valida comarca e nome da unidade; devolve o registro (sem id) ou erro */
export const readUnit = (b: any, selfId?: string): { error: string } | { value: Omit<CatalogRecord, 'id'> } => {
  const com = findComarca(b?.comarca);
  if (!com) return { error: 'Escolha uma comarca da lista.' };
  const unitName = upper(String(b?.unitName ?? '')).slice(0, 300);
  if (unitName.length < 3) return { error: 'Informe o nome da unidade.' };
  if (S.catalogUnits.some((u) => u.id !== selfId && u.comarca === com.name && fold(u.unitName) === fold(unitName))) return { error: 'Esta unidade já existe nesta comarca.' };
  return { value: { comarca: com.name, unitName, separator: readSeparator(b?.separator) } };
};
