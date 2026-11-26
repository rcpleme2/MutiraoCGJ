// Importação de lotações por planilha (Nome Pessoa, Comarca, Unidade) na aba Magistrados: conferência antes de gravar.
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { api } from '../api';
import { Badge, Modal, Notice } from '../ui';
import { fileToBase64 } from '../recursalCommon';
import { type RunFn } from './shared';

interface Row { line: number; name: string; comarca: string; unit: string; state: string; current?: string; next?: string; records?: number; official?: boolean; note?: string }
interface Result { summary: Record<string, number>; rows: Row[]; applied: boolean; changed?: number }

const LABEL: Record<string, [string, 'ok' | 'warn' | 'danger' | 'neutral' | 'info']> = {
  preencher: ['Será preenchida', 'ok'], atualizar: ['Será atualizada', 'info'], igual: ['Já igual', 'neutral'], ignorada: ['Mantida', 'neutral'],
  nao_encontrado: ['Não encontrado', 'danger'], duplicada: ['Repetida', 'warn'], invalida: ['Linha inválida', 'danger'],
};

export function LotacaoImport({ scopeQuery, run, confirm, onDone, onClose }: { scopeQuery: string; run: RunFn; confirm: (m: string, label?: string) => Promise<boolean>; onDone: () => void; onClose: () => void }) {
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [mode, setMode] = useState<'empty' | 'all'>('empty');
  const [res, setRes] = useState<Result | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  const call = async (apply: boolean) => {
    if (!file) return null;
    setBusy(true); setErr('');
    try { return await api<Result>(`/magistrates/import-lotacao?${scopeQuery}`, { method: 'POST', json: { file, mode, apply } }); }
    catch (e: any) { setErr(e.message); return null; } finally { setBusy(false); }
  };
  const pick = async (f?: File | null) => { setRes(null); setFile(null); if (f) setFile({ name: f.name, base64: await fileToBase64(f) }); };
  const check = async () => { const r = await call(false); if (r) setRes(r); };
  const apply = async () => {
    if (!res) return;
    const n = res.summary.preencher + res.summary.atualizar;
    if (!(await confirm(`Gravar a lotação de ${n} magistrado(s) (${mode === 'all' ? 'preenchendo e atualizando' : 'apenas as vazias'})? A alteração fica no registro de atividades.`, 'Gravar'))) return;
    const r = await run(() => call(true), undefined);
    if (r) { setRes(r); onDone(); }
  };
  const n = res ? res.summary.preencher + res.summary.atualizar : 0;
  const rows = res ? res.rows.filter(r => !filter || r.state === filter) : [];
  return (
    <Modal title="Importar lotações por planilha" wide onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">Planilha <strong className="text-ink">.xlsx ou .csv</strong> com as colunas <strong className="text-ink">Nome Pessoa, Comarca, Unidade</strong> (com linha de cabeçalho). O nome é comparado sem acento e sem diferença de caixa. Nada é gravado antes da conferência e da sua confirmação.</p>
        {err && <Notice tone="danger">{err}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <input ref={ref} type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={e => pick(e.target.files?.[0])} />
          <button type="button" className="btn-secondary btn-sm" onClick={() => ref.current?.click()}><Upload className="w-4 h-4 inline mr-1" />Escolher arquivo</button>
          {file && <span>Arquivo: <strong>{file.name}</strong></span>}
        </div>
        <fieldset className="space-y-1.5">
          <legend className="label">O que fazer com lotações já preenchidas?</legend>
          {([['empty', 'Preencher apenas as vazias (não altera as já preenchidas)'], ['all', 'Preencher as vazias e também atualizar as já preenchidas']] as const).map(([id, text]) => (
            <label key={id} className="flex items-center gap-2"><input type="radio" name="lot-mode" checked={mode === id} onChange={() => { setMode(id); setRes(null); }} /> {text}</label>
          ))}
        </fieldset>
        <div className="flex justify-end"><button className="btn-secondary" disabled={!file || busy} onClick={check}>{busy && !res ? 'Conferindo…' : 'Conferir'}</button></div>
        {res && (
          <div className="space-y-3">
            {res.applied && <Notice tone="ok"><strong>{res.changed} inscrição(ões) alterada(s).</strong></Notice>}
            <div className="flex flex-wrap gap-2">
              <button className={`px-3 py-1 rounded-full text-xs border ${filter === '' ? 'bg-navy text-white border-navy' : 'border-line text-muted'}`} onClick={() => setFilter('')}>Todas ({res.summary.total})</button>
              {Object.entries(LABEL).filter(([k]) => res.summary[k]).map(([k, [text]]) => (
                <button key={k} className={`px-3 py-1 rounded-full text-xs border ${filter === k ? 'bg-navy text-white border-navy' : 'border-line text-muted'}`} onClick={() => setFilter(k)}>{text} ({res.summary[k]})</button>
              ))}
            </div>
            <div className="overflow-auto max-h-80 border border-line rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-paper sticky top-0"><tr><th className="th">Linha</th><th className="th">Magistrado (planilha)</th><th className="th">Lotação atual</th><th className="th">Nova lotação</th><th className="th">Situação</th></tr></thead>
                <tbody>
                  {rows.slice(0, 1000).map(r => (
                    <tr key={r.line}>
                      <td className="td">{r.line}</td><td className="td">{r.name}</td>
                      <td className="td text-xs text-muted">{r.current || '—'}</td><td className="td text-xs">{r.next || <span className="text-muted">{r.comarca} · {r.unit}</span>}</td>
                      <td className="td"><Badge tone={LABEL[r.state]?.[1] ?? 'neutral'}>{LABEL[r.state]?.[0] ?? r.state}</Badge>{r.records && r.records > 1 ? <div className="text-[11px] text-muted mt-1">{r.records} inscrições</div> : null}{r.note && <div className="text-[11px] text-muted mt-1">{r.note}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {res.rows.length > 1000 && <p className="text-xs text-muted">Mostrando as 1.000 primeiras linhas; todas são consideradas na gravação.</p>}
            {!res.applied && <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={n === 0 || busy} onClick={apply}>Gravar {n} alteração(ões)</button></div>}
            {res.applied && <div className="flex justify-end"><button className="btn-primary" onClick={onClose}>Fechar</button></div>}
          </div>
        )}
      </div>
    </Modal>
  );
}
