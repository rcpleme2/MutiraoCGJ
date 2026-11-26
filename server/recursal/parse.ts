// Leitura de planilhas (.xlsx/.csv) com o número do processo na 1ª coluna e a Turma na 2ª.
import XLSX from 'xlsx';
import { isHeaderCell } from './rows.ts';

export const MAX_ROWS = 5000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Converte o arquivo (base64) em linhas [número, turma]. Lança Error com mensagem amigável. */
export function readSheet(base64: string, fileName: string): { rows: string[][]; source: 'csv' | 'xlsx' } {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length === 0) throw new Error('O arquivo está vazio.');
  if (buf.length > MAX_FILE_BYTES) throw new Error('Arquivo acima de 5 MB.');
  const isXlsx = buf[0] === 0x50 && buf[1] === 0x4b; // "PK": .xlsx é um zip
  if (!isXlsx && !/\.(csv|txt)$/i.test(fileName)) throw new Error('Envie um arquivo .xlsx ou .csv.');
  let wb: XLSX.WorkBook;
  try { wb = isXlsx ? XLSX.read(buf, { type: 'buffer', cellText: true }) : XLSX.read(buf.toString('utf-8').replace(/^﻿/, ''), { type: 'string', FS: pickDelimiter(buf.toString('utf-8')) }); }
  catch { throw new Error('Não foi possível ler o arquivo. Use o modelo disponível para download.'); }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('A planilha não tem nenhuma aba.');
  const all = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });
  const rows = all.map((r) => [String(r[0] ?? '').trim(), String(r[1] ?? '').trim()]).filter((r) => r[0] || r[1]);
  if (rows.length && isHeaderCell(rows[0][0])) rows.shift();
  if (rows.length > MAX_ROWS) throw new Error(`Limite de ${MAX_ROWS} linhas por envio.`);
  return { rows, source: isXlsx ? 'xlsx' : 'csv' };
}

function pickDelimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  const c = (ch: string) => head.split(ch).length - 1;
  return c(';') >= c(',') && c(';') >= c('\t') ? ';' : c('\t') > c(',') ? '\t' : ',';
}

/** Lê as `cols` primeiras colunas de uma planilha (.xlsx/.csv). A 1ª linha é descartada se for cabeçalho (começa por "Nome"). */
export function readSheetCols(base64: string, fileName: string, cols: number): string[][] {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length === 0) throw new Error('O arquivo está vazio.');
  if (buf.length > MAX_FILE_BYTES) throw new Error('Arquivo acima de 5 MB.');
  const isXlsx = buf[0] === 0x50 && buf[1] === 0x4b;
  if (!isXlsx && !/\.(csv|txt)$/i.test(fileName)) throw new Error('Envie um arquivo .xlsx ou .csv.');
  let wb: XLSX.WorkBook;
  try { wb = isXlsx ? XLSX.read(buf, { type: 'buffer', cellText: true }) : XLSX.read(buf.toString('utf-8').replace(/^\uFEFF/, ''), { type: 'string', FS: pickDelimiter(buf.toString('utf-8')) }); }
  catch { throw new Error('Não foi possível ler o arquivo.'); }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('A planilha não tem nenhuma aba.');
  const all = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });
  const rows = all.map((r) => Array.from({ length: cols }, (_, i) => String(r[i] ?? '').trim())).filter((r) => r.some(Boolean));
  if (rows.length && /^nome/i.test(rows[0][0])) rows.shift();
  if (rows.length > 20000) throw new Error('Limite de 20.000 linhas por importação.');
  return rows;
}
