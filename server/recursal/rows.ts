// Conferência das linhas (número + Turma): padrão CNJ, Turma e duplicidades.
import { type Turma, normalizeTurma, turmaLabel, validateCnj } from './cnj.ts';

/** Cabeçalhos como "Número do processo", "Processo", "nº". */
export const isHeaderCell = (v: string) => /^(n[uú]mero|n[º°o.]?\b|processo|cnj)/i.test(v.trim()) && !/\d{5,}/.test(v);

export type RowState = 'valida' | 'invalida' | 'duplicada';
export interface CheckedRow { line: number; input: string; turmaInput: string; cnj: string; formatted: string; turma: Turma | null; state: RowState; error?: string; warning?: string }

/** `existing`: números (20 dígitos) já cadastrados. Linhas = [número, turma]; `firstLine` = nº da linha do arquivo/formulário. */
export function checkRows(rows: string[][], existing: Set<string>, firstLine = 1): CheckedRow[] {
  const seen = new Map<string, number>();
  return rows.map((r, i) => {
    const line = firstLine + i;
    const v = validateCnj(r[0]);
    const turma = normalizeTurma(r[1]);
    const base = { line, input: r[0] ?? '', turmaInput: r[1] ?? '', cnj: v.digits, formatted: v.ok ? v.formatted : (r[0] ?? ''), turma, ...(v.warning ? { warning: v.warning } : {}) };
    if (!v.ok) return { ...base, state: 'invalida' as const, error: v.error };
    if (!turma) return { ...base, state: 'invalida' as const, error: r[1] ? `Turma "${r[1]}" não reconhecida: use 1ª a 6ª Turma Recursal.` : 'Informe a Turma Recursal em que o processo tramita (1ª a 6ª).' };
    if (existing.has(v.digits)) return { ...base, state: 'duplicada' as const, error: 'Processo já cadastrado em envio anterior.' };
    const first = seen.get(v.digits);
    if (first !== undefined) return { ...base, state: 'duplicada' as const, error: `Repetido na linha ${first}.` };
    seen.set(v.digits, line);
    return { ...base, state: 'valida' as const };
  });
}
export { turmaLabel };
