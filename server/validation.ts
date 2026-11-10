// Validação dos dados de entrada (inscrições de magistrados e unidades) e normalização de registros antigos.
import { catalogById, canonicalComarca, fullUnitName, CATALOG_SEPARATOR } from '../src/catalogo-tjpr';
import express from 'express';
import { defaultWorkType } from './links.ts';
import { S } from './state.ts';
import { asHearingPeriod, type LogEntry, type Magistrate, type MagistrateStatus, type Parsed, type Unit, WORK_TYPES, type WorkType } from './types.ts';
import { asText, canonicalPersonName, cleanText } from './util.ts';

export const MAX_SLOTS = 20;
// Todo dado vindo de formulários é conferido (tipo, tamanho e valores permitidos) antes de ser gravado.
export const PREFERENCE_AREAS = [
  'Cível e Fazenda Pública',
  'Crime',
  'Família e Infância',
  'Juizado Cível, Crime e Fazenda Pública',
];
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Só e-mails institucionais são aceitos nas inscrições. Ajustável por ALLOWED_EMAIL_DOMAINS (lista separada
// por vírgulas; vazio = sem restrição). Subdomínios do domínio informado também são aceitos.
export const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS ?? 'tjpr.jus.br').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
export const emailDomainOk = (email: string) => {
  if (ALLOWED_EMAIL_DOMAINS.length === 0) return true;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return ALLOWED_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
};
export const EMAIL_DOMAIN_MESSAGE = `Use o e-mail institucional (${ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(' ou ')}).`;
export const MAGISTRATE_STATUSES: MagistrateStatus[] = ['Aguardando Conferência', 'Aprovado', 'Lista de Espera', 'Atribuído', 'Rejeitado', 'Desistente', 'Excluído'];
/**
 * Local (unidade ou lotação) informado num formulário: se vier o id do catálogo oficial, nome, comarca e separador
 * saem do catálogo; senão ("Outra"), a comarca precisa ser da lista e o nome digitado é gravado em MAIÚSCULAS.
 * `lenient` (edição "Vinculações iniciais"): aceita comarca fora da lista ou em branco.
 */
export function resolveCatalogPlace(
  b: any,
  base: { catalogId?: string; comarca?: string; name: string; separator?: string } | undefined,
  keys: { catalogKey: string; comarcaKey: string; nameKey: string; separatorKey?: string },
  lenient: boolean,
): { error: string } | { value: { catalogId?: string; comarca: string; name: string; separator: string } } {
  const has = (k: string) => b && b[k] != null;
  // Campos ausentes no corpo (edição parcial) mantêm o que já estava gravado
  if (base && !has(keys.catalogKey) && !has(keys.comarcaKey) && !has(keys.nameKey)) {
    return { value: { catalogId: base.catalogId, comarca: base.comarca ?? '', name: base.name, separator: base.separator || CATALOG_SEPARATOR } };
  }
  const cat = catalogById(has(keys.catalogKey) ? b[keys.catalogKey] : undefined);
  if (cat) return { value: { catalogId: cat.id, comarca: cat.comarca, name: cat.unitName, separator: cat.separator } };
  const rawComarca = has(keys.comarcaKey) ? b[keys.comarcaKey] : base?.comarca;
  const rawName = has(keys.nameKey) ? b[keys.nameKey] : base?.name;
  const comarcaText = cleanText(rawComarca, 150) ?? '';
  const comarca = canonicalComarca(comarcaText) ?? (lenient ? comarcaText : '');
  if (!lenient && !comarca) return { error: 'Escolha a comarca na lista.' };
  const name = (cleanText(rawName, 300) ?? '').toLocaleUpperCase('pt-BR');
  if (!lenient && !name) return { error: 'Escolha a unidade na lista ou, em "Outra", digite o nome da unidade.' };
  const sepRaw = keys.separatorKey && has(keys.separatorKey) ? cleanText(b[keys.separatorKey], 20) : base?.separator;
  return { value: { catalogId: undefined, comarca, name, separator: (sepRaw || CATALOG_SEPARATOR).toLocaleUpperCase('pt-BR') } };
}
/** `strict` (inscrição pública): o aceite de audiências é obrigatório e precisa vir preenchido. A 2ª escolha é opcional. */
export function parseMagistrate(b: any, base?: Magistrate, strict = false, lenient = false): Parsed<Pick<Magistrate, 'name' | 'nameAsTyped' | 'email' | 'currentLocation' | 'locationCatalogId' | 'locationComarca' | 'firstPreference' | 'secondPreference' | 'acceptsHearings' | 'hearingPeriod'>> {
  const pick = (k: keyof Magistrate) => (b?.[k] == null && base ? base[k] : b?.[k]);
  const rawName = cleanText(pick('name'), 200);
  const name = rawName ? canonicalPersonName(rawName) : null;
  const email = cleanText(pick('email'), 200) ?? '';
  // Lotação: unidade do catálogo oficial (o texto vem dele) ou comarca da lista + nome digitado em "Outra"
  const loc = resolveCatalogPlace(b, base ? { catalogId: base.locationCatalogId, comarca: base.locationComarca, name: base.currentLocation } : undefined,
    { catalogKey: 'locationCatalogId', comarcaKey: 'locationComarca', nameKey: 'currentLocation' }, lenient);
  if ('error' in loc) return loc;
  const currentLocation = loc.value.catalogId || loc.value.comarca ? fullUnitName({ unitName: loc.value.name, comarca: loc.value.comarca, separator: loc.value.separator }) : loc.value.name;
  // Edição "Vinculações iniciais": só o nome é obrigatório; e-mail, lotação e áreas podem ficar em branco ou em texto livre
  if (!name || (!lenient && (!email || !currentLocation))) {
    return { error: 'Preencha nome, e-mail e lotação com texto válido (nome até 200, lotação até 300 caracteres).' };
  }
  if (!(lenient && !email)) {
    if (!EMAIL_RE.test(email)) return { error: 'Informe um e-mail válido.' };
    if (!lenient && (!base || email.toLowerCase() !== base.email.toLowerCase()) && !emailDomainOk(email)) return { error: EMAIL_DOMAIN_MESSAGE };
  }
  const first = lenient ? cleanText(pick('firstPreference') ?? '', 150) : pick('firstPreference');
  if (typeof first !== 'string' || (!lenient && !PREFERENCE_AREAS.includes(first))) return { error: 'Escolha uma área válida na 1ª escolha.' };
  const second = pick('secondPreference') ?? '';
  if (typeof second !== 'string' || (!lenient && second !== '' && !PREFERENCE_AREAS.includes(second))) return { error: 'Escolha uma área válida na 2ª escolha.' };
  if (second && second === first) return { error: 'A 2ª escolha não pode ser igual à 1ª escolha.' };
  const hearings = pick('acceptsHearings');
  if (strict && typeof hearings !== 'boolean') return { error: 'Informe se aceita realizar audiências.' };
  // Período das audiências: só faz sentido para quem aceita audiências (vazio = não informado)
  const period = asHearingPeriod(pick('hearingPeriod'));
  if (period === null) return { error: 'Período para audiências inválido.' };
  const hearingPeriod = hearings === true && period ? period : undefined;
  if (strict && hearings === true && !hearingPeriod) return { error: 'Informe se pode auxiliar nas audiências de manhã, à tarde ou indiferentemente.' };
  return { value: { name, ...(b?.name != null && rawName && rawName !== name ? { nameAsTyped: rawName } : {}), email, currentLocation, locationCatalogId: loc.value.catalogId, locationComarca: loc.value.comarca || undefined, firstPreference: first, secondPreference: second, acceptsHearings: hearings === true, hearingPeriod } };
}
/** `strict` (inscrição pública): com auxílio para audiências, o período pretendido é obrigatório. */
export function parseUnit(b: any, base?: Unit, lenient = false, strict = false): Parsed<Pick<Unit, 'unitName' | 'judgeName' | 'email' | 'comarca' | 'separator' | 'catalogId' | 'areas' | 'supportNeeded' | 'hearingPeriod' | 'description' | 'slots'>> {
  const pick = (k: keyof Unit) => (b?.[k] == null && base ? base[k] : b?.[k]);
  // Unidade: do catálogo oficial (nome, comarca e separador vêm dele) ou comarca da lista + nome digitado em "Outra"
  const place = resolveCatalogPlace(b, base ? { catalogId: base.catalogId, comarca: base.comarca, name: base.unitName, separator: base.separator } : undefined,
    { catalogKey: 'catalogId', comarcaKey: 'comarca', nameKey: 'unitName', separatorKey: 'separator' }, lenient);
  if ('error' in place) return place;
  const { catalogId, comarca, separator } = place.value;
  const unitName = place.value.name || null;
  const judgeName = cleanText(pick('judgeName'), 200) ?? '';
  const email = cleanText(pick('email'), 200) ?? '';
  if (!unitName || (!lenient && (!judgeName || !email || !comarca))) {
    return { error: 'Preencha comarca, unidade, responsável e e-mail com texto válido.' };
  }
  if (!(lenient && !email)) {
    if (!EMAIL_RE.test(email)) return { error: 'Informe um e-mail válido.' };
    if (!lenient && (!base || email.toLowerCase() !== base.email.toLowerCase()) && !emailDomainOk(email)) return { error: EMAIL_DOMAIN_MESSAGE };
  }
  const areas = pick('areas');
  if (!Array.isArray(areas) || areas.length < 1 || areas.length > PREFERENCE_AREAS.length + 10
    || !areas.every((a) => typeof a === 'string' && (lenient ? a.trim() !== '' && a.length <= 150 : PREFERENCE_AREAS.includes(a)))
    || (!lenient && areas.length > PREFERENCE_AREAS.length)) {
    return { error: 'Selecione ao menos uma área válida.' };
  }
  const support = pick('supportNeeded') ?? 'Sentença';
  if (!WORK_TYPES.includes(support as WorkType)) return { error: 'Auxílio necessário inválido.' };
  const period = asHearingPeriod(pick('hearingPeriod'));
  if (period === null) return { error: 'Período pretendido para as audiências inválido.' };
  const withHearings = support === 'Audiência' || support === 'Audiência e Sentença';
  const hearingPeriod = withHearings && period ? period : undefined;
  if (strict && withHearings && !hearingPeriod) return { error: 'Informe se o auxílio nas audiências é pretendido no período da manhã, no período do expediente (tarde) ou indiferentemente.' };
  const slots = pick('slots') ?? 1;
  if (typeof slots !== 'number' || !Number.isInteger(slots) || slots < 1 || slots > MAX_SLOTS) return { error: `O número de magistrados a alocar deve ser um inteiro de 1 a ${MAX_SLOTS}.` };
  const description = pick('description') ?? '';
  if (typeof description !== 'string' || description.length > 2000) return { error: 'A justificativa pode ter no máximo 2000 caracteres.' };
  return { value: { unitName, judgeName, email, comarca, separator, catalogId, areas: [...new Set(areas as string[])], supportNeeded: support as WorkType, hearingPeriod, description: description.trim(), slots } };
}
export function sanitizeStoredRecords() {
  S.magistrates.forEach((m) => {
    m.name = asText(m.name); m.email = asText(m.email); m.currentLocation = asText(m.currentLocation);
    m.firstPreference = asText(m.firstPreference); m.secondPreference = asText(m.secondPreference);
    m.acceptsHearings = m.acceptsHearings === true;
  });
  S.units.forEach((u) => {
    u.unitName = asText(u.unitName); u.judgeName = asText(u.judgeName); u.email = asText(u.email);
    u.comarca = asText(u.comarca); u.separator = asText(u.separator).trim() || 'de'; u.description = asText(u.description);
    u.areas = Array.isArray(u.areas) ? u.areas.map(asText) : u.areas ? [asText(u.areas)] : [];
    if ((u.hearingPeriod as string) === 'Expediente') u.hearingPeriod = 'Tarde'; // "período do expediente" foi unificado com a tarde
  });
}
/** Dados gravados antes de existirem a triagem de unidades e a modalidade recebem valores coerentes */
export function normalizeLegacy() {
  sanitizeStoredRecords();
  S.units.forEach((u) => {
    if (!u.selection) u.selection = 'Escolhida';
    const linked = S.matches.filter((m) => m.unitId === u.id).length;
    u.slots = Math.max(1, Number.isInteger(u.slots) ? u.slots : 1, linked);
  });
  S.matches.forEach((m) => {
    if (m.workType === 'Audiência e Sentença') { // legado: a atuação agora é só para audiências ou só para sentença
      const u = S.units.find((x) => x.id === m.unitId); const g = S.magistrates.find((x) => x.id === m.magistrateId);
      m.workType = u && g ? defaultWorkType(u, g) : 'Sentença';
    }
    if (!m.workType) {
      const u = S.units.find((x) => x.id === m.unitId);
      const g = S.magistrates.find((x) => x.id === m.magistrateId);
      m.workType = u && g ? defaultWorkType(u, g) : 'Sentença';
    }
  });
}
/** Exclusões em lote exigem confirmação explícita no corpo da requisição (proteção contra chamadas acidentais). */
export const confirmedWipe = (req: express.Request) => req.body?.confirm === 'EXCLUIR';
export const actorOf = (source: unknown): LogEntry['actor'] => (source === 'admin' ? 'Administração' : 'Público');
