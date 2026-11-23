// Número único de processo (padrão CNJ, Res. 65/2008) e Turmas Recursais.
export const TURMAS = [1, 2, 3, 4, 5, 6] as const;
export type Turma = (typeof TURMAS)[number];
export const turmaLabel = (t: number) => `${t}ª Turma Recursal`;

/** Apenas os dígitos do número informado (aceita pontos, traço e espaços). */
export const digitsOf = (v: unknown) => String(v ?? '').replace(/[\s.\-–—_/]/g, '');

/** NNNNNNN-DD.AAAA.J.TR.OOOO */
export function formatCnj(d: string): string {
  return d.length === 20 ? `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d[13]}.${d.slice(14, 16)}.${d.slice(16)}` : d;
}

/** Dígito verificador: 98 − ((NNNNNNN AAAA J TR OOOO 00) mod 97). */
export function cnjCheckDigits(d: string): string {
  const base = d.slice(0, 7) + d.slice(9); // sem o DV
  let rem = 0;
  for (const ch of base + '00') rem = (rem * 10 + Number(ch)) % 97;
  return String(98 - rem).padStart(2, '0');
}

export interface CnjResult { ok: boolean; digits: string; formatted: string; error?: string; warning?: string }

export function validateCnj(input: unknown, now = new Date()): CnjResult {
  const raw = String(input ?? '').trim();
  const digits = digitsOf(raw);
  const fail = (error: string): CnjResult => ({ ok: false, digits, formatted: raw, error });
  if (!digits) return fail('Número do processo em branco.');
  if (!/^\d+$/.test(digits)) return fail('O número contém caracteres que não são dígitos, pontos ou traço.');
  if (digits.length !== 20) return fail(`Fora do padrão CNJ: tem ${digits.length} dígitos (esperado 20, NNNNNNN-DD.AAAA.J.TR.OOOO).`);
  const year = Number(digits.slice(9, 13));
  if (year < 1990 || year > now.getFullYear() + 1) return fail(`Ano de ajuizamento inválido (${year}).`);
  if (cnjCheckDigits(digits) !== digits.slice(7, 9)) return fail('Dígito verificador inválido: confira o número.');
  const warning = digits[13] !== '8' || digits.slice(14, 16) !== '16' ? 'Não é da Justiça Estadual do Paraná (J.TR ≠ 8.16).' : undefined;
  return { ok: true, digits, formatted: formatCnj(digits), ...(warning ? { warning } : {}) };
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
const WORDS: Record<string, number> = { primeira: 1, segunda: 2, terceira: 3, quarta: 4, quinta: 5, sexta: 6 };

/** Reconhece "1", "1ª", "1a", "I", "1ª Turma", "Primeira Turma Recursal"... → 1..6 (ou null). */
export function normalizeTurma(v: unknown): Turma | null {
  const t = String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/turma|recursal|\bda\b|\bde\b/g, ' ').replace(/[ºª°.\-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  let n: number | undefined;
  const m = /^(\d)\s?a?$/.exec(t);
  if (m) n = Number(m[1]); else n = ROMAN[t] ?? WORDS[t];
  return n && n >= 1 && n <= 6 ? (n as Turma) : null;
}
