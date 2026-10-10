/**
 * Aproximação de nomes digitados livremente ("1a vara civel de curitiba", "JEC Londrina"...) às unidades do catálogo oficial.
 * Usada na conciliação ("Padronizar nomes"), na importação de planilha do painel e na detecção de atuação na mesma vara.
 */
import { CATALOG, COMARCAS, type CatalogUnit } from './catalogo-tjpr';

const ORDINAL_WORDS: Record<string, string> = {
  PRIMEIRA: '1', PRIMEIRO: '1', SEGUNDA: '2', SEGUNDO: '2', TERCEIRA: '3', TERCEIRO: '3', QUARTA: '4', QUARTO: '4',
  QUINTA: '5', QUINTO: '5', SEXTA: '6', SEXTO: '6', SETIMA: '7', SETIMO: '7', OITAVA: '8', OITAVO: '8', NONA: '9', NONO: '9', DECIMA: '10', DECIMO: '10',
};
const ABBREVIATIONS: Record<string, string> = {
  JEC: 'JUIZADO ESPECIAL CIVEL', JECRIM: 'JUIZADO ESPECIAL CRIMINAL', JECC: 'JUIZADO ESPECIAL CIVEL CRIMINAL',
  JEFP: 'JUIZADO ESPECIAL FAZENDA PUBLICA', JE: 'JUIZADO ESPECIAL', ESP: 'ESPECIAL', JUIZ: 'JUIZADO', VFP: 'VARA FAZENDA PUBLICA',
  CRIM: 'CRIMINAL', CIV: 'CIVEL', FAM: 'FAMILIA', INF: 'INFANCIA', EXEC: 'EXECUCOES', FISC: 'FISCAIS', FAZ: 'FAZENDA',
};
/** Palavras que não distinguem uma unidade de outra */
const STOP = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'COMARCA', 'FORO', 'CENTRAL', 'REGIAO', 'METROPOLITANA', 'ACERVO', 'UNIDADE', 'JUDICIAL', 'JUDICIARIA', 'DIREITO']);

const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Palavras significativas, com ordinais em algarismos ("1ª", "1A", "PRIMEIRA" → "1") e singular ("CIVEIS" → "CIVEL"). */
export function tokens(text: string): string[] {
  const t = fold(text).replace(/(\d+)\s*[ªºAO°]\b/g, '$1').replace(/[^A-Z0-9]+/g, ' ');
  return t.split(' ').filter(Boolean).flatMap((w) => (ABBREVIATIONS[w] ?? w).split(' ')).map((w) => {
    if (ORDINAL_WORDS[w]) return ORDINAL_WORDS[w];
    if (w.length > 4 && w.endsWith('AIS')) return `${w.slice(0, -3)}AL`;
    if (w.length > 4 && w.endsWith('EIS')) return `${w.slice(0, -3)}EL`;
    if (w.length > 4 && w.endsWith('S') && !/\d/.test(w)) return w.slice(0, -1);
    return w;
  }).filter((w) => !STOP.has(w));
}

const COMARCA_FOLDED = COMARCAS.map((c) => ({ c, f: ` ${fold(c).replace(/[^A-Z0-9]+/g, ' ').trim()} ` })).sort((a, b) => b.f.length - a.f.length);
/** Comarca citada no texto (a de nome mais longo, para não confundir "CAMPO LARGO" com "LARGO"). */
export function comarcaInText(text: string): string | undefined {
  const t = ` ${fold(text).replace(/[^A-Z0-9]+/g, ' ').trim()} `;
  return COMARCA_FOLDED.find((x) => t.includes(x.f))?.c;
}

const PREPARED = CATALOG.map((u) => ({ u, tk: new Set(tokens(u.unitName)), comarcaTk: new Set(tokens(u.comarca)) }));

export interface CatalogSuggestion { id: string; label: string; comarca: string; score: number }

/**
 * Até `limit` unidades do catálogo mais parecidas com o texto. `comarcaHint` (comarca já conhecida) restringe a busca.
 * score de 0 a 1: ≥ 0,85 alta confiança; ≥ 0,6 média.
 */
export function suggestCatalog(text: string, comarcaHint?: string, limit = 3): CatalogSuggestion[] {
  const comarca = comarcaHint || comarcaInText(text);
  const words = tokens(text);
  if (!words.length) return [];
  const pool = comarca ? PREPARED.filter((p) => p.u.comarca === comarca) : PREPARED;
  const scored = pool.map((p) => {
    const tw = words.filter((w) => !p.comarcaTk.has(w)); // o nome da comarca no texto não conta como palavra da unidade
    const set = new Set(tw);
    let inter = 0; for (const w of set) if (p.tk.has(w)) inter++;
    const dice = (2 * inter) / (set.size + p.tk.size || 1);
    const textCov = set.size ? inter / set.size : 0;   // quanto do texto a unidade explica
    const unitCov = p.tk.size ? inter / p.tk.size : 0; // quanto da unidade aparece no texto
    let score = 0.5 * dice + 0.5 * Math.max(textCov, unitCov);
    // Número da vara/juizado: diferente derruba; ausente no texto deixa ambíguo ("VARA CÍVEL" pode ser a 1ª ou a 2ª)
    const nT = tw.filter((w) => /^\d+$/.test(w)), nU = [...p.tk].filter((w) => /^\d+$/.test(w));
    if (nU.length && nT.length && !nU.some((n) => nT.includes(n))) score *= 0.35;
    else if (nU.length && !nT.length) score *= 0.85;
    else if (!nU.length && nT.length) score *= 0.8;
    else if (unitCov === 1) score = Math.max(score, 0.75 + 0.25 * (p.tk.size / Math.max(set.size, p.tk.size))); // unidade inteira citada, com observações extras
    if (comarca && !comarcaHint) score = Math.min(1, score + 0.05);
    return { u: p.u, score };
  }).filter((x) => x.score > 0.3).sort((a, b) => b.score - a.score || a.u.label.localeCompare(b.u.label, 'pt-BR'));
  return scored.slice(0, limit).map(({ u, score }) => ({ id: u.id, label: u.label, comarca: u.comarca, score: Math.round(score * 100) / 100 }));
}

/** Unidade do catálogo quando a correspondência é inequívoca (alta confiança e bem à frente da segunda opção). */
export function resolveCatalog(text: string, comarcaHint?: string): CatalogUnit | undefined {
  const [a, b] = suggestCatalog(text, comarcaHint, 2);
  if (!a || a.score < 0.85 || (b && b.score > a.score - 0.1)) return undefined;
  return CATALOG.find((u) => u.id === a.id);
}
