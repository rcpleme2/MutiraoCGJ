// Utilitários de texto, datas (horário de Brasília) e CSV.
import express from 'express';

export const clientIp = (req: express.Request) => (req.ip || 'desconhecido').replace(/^::ffff:/, '');
/** Texto obrigatório: precisa ser string, não vazia e dentro do limite. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
}
/** Texto livre (motivos etc.): sempre devolve string, limitada ao tamanho máximo. */
export const freeText = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** Dados antigos ou corrompidos (ex.: gravados antes da validação) são convertidos para tipos seguros. */
export const asText = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
// As datas das edições são horário de Brasília (sem horário de verão desde 2019); o servidor roda em UTC.
export const BRT = '-03:00';
export const isYmd = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00${BRT}`)) && d >= '2000-01-01';
/** Dia anterior / último dia do mês de uma data AAAA-MM-DD */
export const ymdDayBefore = (ymd: string) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
export const ymdMonthEnd = (ymd: string) => new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0)).toISOString().slice(0, 10);
/** Data (AAAA-MM-DD) de um instante ISO no horário de Brasília */
export const ymdBrt = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
export const fmtLocal = (local: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  return m ? `${m[3]}/${m[2]}/${m[1]} às ${m[4]}:${m[5]}` : local;
};
// Neutraliza injeção de fórmulas em planilhas (=, +, -, @) e escapa aspas
export const csvCell = (v: unknown) => {
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
};
export const normName = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Chave de comparação de nomes de pessoas: sem acentos, sem diferença de caixa/pontuação e sem tratamentos (Dr., Dra., Juiz...). */
export const PERSON_TITLES = new Set(['dr', 'dra', 'juiz', 'juiza', 'des', 'desa', 'desembargador', 'desembargadora', 'exmo', 'exma', 'sr', 'sra']);
/** Grafia padrão do nome do magistrado: sem tratamento inicial (Dr., Dra., Juiz...), espaços simples e em MAIÚSCULAS. */
export function canonicalPersonName(t: string): string {
  const words = t.replace(/\s+/g, ' ').trim().split(' ');
  const bare = (w: string) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  while (words.length > 1 && PERSON_TITLES.has(bare(words[0]))) words.shift();
  return words.join(' ').toLocaleUpperCase('pt-BR');
}
export const personKey = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ')
  .split(/\s+/).filter((w) => w && !PERSON_TITLES.has(w)).join(' ');
export const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const cleanCell = (t: string) => t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
/** Lê texto copiado do Excel (colunas separadas por tabulação; também aceita ';'). Aspas de células são respeitadas. */
export function parseSheetText(text: string): string[][] {
  const delim = text.includes('\t') ? '\t' : text.includes(';') ? ';' : '\t';
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false; } else cell += ch;
    } else if (ch === '"' && cell === '') inQuotes = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = []; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
// Registra a desistência de um magistrado: sai de todas as designações vigentes (de qualquer edição) e passa à relação de desistentes.
export const validYmd = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00${BRT}`)) && d >= '2000-01-01';
export const dmyOf = (d?: string) => (d ? d.split('-').reverse().join('/') : 'não informada');
export const upper = (t: string) => t.replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');
export const fold = (t: string) => norm(t).toUpperCase();
export const brDate = (d?: string) => {
  if (!d) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d.split('-').reverse().join('/');
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};
export const workLabel = (w?: string) => (w === 'Audiência' ? 'Audiências' : w || '—');
