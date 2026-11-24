// Mutirão da Turma Recursal (portal público): enviar processos ou inscrever-se como voluntário.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle as AlertIcon, FileText, Scale, Plus, Trash2, Download, Upload, CheckCircle2, AlertTriangle, XCircle, ArrowLeft } from 'lucide-react';
import { api } from './api';
import { RecursalCheck, RecursalRowCheck, RecursalWindowInfo } from './types';
import { Badge, Field, Notice } from './ui';
import { TURMAS, TurmaChip, fileToBase64, turmaStyle } from './recursalCommon';

export function EligibilityNotice() {
  return (
    <div role="note" className="flex items-start gap-3 rounded-md bg-warn-soft text-warn px-4 py-3 text-sm leading-relaxed">
      <AlertIcon className="w-4 h-4 mt-0.5 shrink-0" />
      <p><strong>Atenção:</strong> somente magistrados lotados ou designados nas Turmas Recursais podem participar. Inscrições de magistrados que não se enquadrem nessas condições serão rejeitadas.</p>
    </div>
  );
}

/** Faixa visível com a situação do prazo de inscrição */
export function WindowBanner({ w }: { w: RecursalWindowInfo | null }) {
  if (!w) return null;
  const open = w.state === 'open';
  return (
    <div role="status" className={`flex items-start gap-3 rounded-md px-4 py-3 text-sm leading-relaxed ${open ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
      <Badge tone={open ? 'ok' : 'danger'}>{{ open: 'Inscrições abertas', not_yet: 'Ainda não abertas', ended: 'Encerradas', not_set: 'Fechadas' }[w.state]}</Badge>
      <p>{w.message}</p>
    </div>
  );
}

type Mode = 'choose' | 'send' | 'volunteer';
type Row = { number: string; turma: string };
const emptyRow = (): Row => ({ number: '', turma: '' });

/** Linha colada do Excel: "número<TAB|;>turma" ou "número turma" */
const parsePasted = (text: string): Row[] => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
  const parts = l.split(/[\t;]/);
  if (parts.length >= 2) return { number: parts[0].trim(), turma: parts[1].trim() };
  const m = /^(\S+)\s+(.+)$/.exec(l);
  return m ? { number: m[1], turma: m[2] } : { number: l, turma: '' };
});

const download = (name: string, content: string) => {
  const url = URL.createObjectURL(new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
};
const stateBadge = (r: RecursalRowCheck) => r.state === 'valida' ? <Badge tone="ok">Válido</Badge> : r.state === 'duplicada' ? <Badge tone="warn">Duplicado</Badge> : <Badge tone="danger">Fora do padrão</Badge>;

export default function Recursal() {
  const [mode, setMode] = useState<Mode>('choose');
  const [win, setWin] = useState<RecursalWindowInfo | null>(null);
  useEffect(() => {
    const load = () => api<RecursalWindowInfo>('/recursal/window').then(setWin).catch(() => {});
    load(); const t = setInterval(load, 60_000); return () => clearInterval(t);
  }, []);
  const closed = !!win && win.state !== 'open';
  return (
    <section className="max-w-3xl mx-auto space-y-4">
      {mode === 'choose' && (
        <div className="card p-7 sm:p-10">
          <Scale className="w-5 h-5 text-bronze mb-3" />
          <h2 className="text-2xl font-semibold text-navy">Mutirão da Turma Recursal</h2>
          <p className="text-sm text-muted mt-1.5 mb-7 leading-relaxed">Como deseja participar? Os processos são distribuídos sempre a relator de Turma diversa daquela em que tramitam.</p>
          <div className="mb-4"><WindowBanner w={win} /></div>
          <div className="mb-6"><EligibilityNotice /></div>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { id: 'send' as Mode, icon: FileText, title: 'Enviar processos', text: 'Indique processos para julgamento no mutirão, digitando os números ou enviando uma planilha .csv/.xlsx.', cta: 'Continuar' },
              { id: 'volunteer' as Mode, icon: Scale, title: 'Ser voluntário', text: 'Inscreva-se como relator e informe em quais Turmas Recursais você já atua.', cta: 'Inscrever-se' },
            ].map((c) => (
              <button key={c.id} onClick={() => setMode(c.id)} className="text-left flex flex-col items-start justify-start rounded-lg border border-line bg-surface p-6 hover:border-bronze hover:shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-bronze">
                <c.icon className="w-6 h-6 text-bronze mb-3" />
                <div className="text-lg font-semibold text-navy">{c.title}</div>
                <p className="text-sm text-muted mt-1.5 leading-relaxed">{c.text}</p>
                <span className="inline-block mt-4 text-sm font-medium text-navy">{c.cta} →</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {mode !== 'choose' && (
        <button onClick={() => setMode('choose')} className="btn-ghost btn-sm mb-4 inline-flex items-center gap-1.5"><ArrowLeft className="w-4 h-4" /> Voltar</button>
      )}
      {mode !== 'choose' && <WindowBanner w={win} />}
      {mode === 'send' && <SendProcesses closed={closed} />}
      {mode === 'volunteer' && <VolunteerForm closed={closed} />}
    </section>
  );
}

function SendProcesses({ closed }: { closed: boolean }) {
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [website, setWebsite] = useState('');
  const [input, setInput] = useState<'manual' | 'file' | null>(null);
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [check, setCheck] = useState<RecursalCheck | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState<RecursalCheck | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const payload = () => ({ submitterName: name, submitterEmail: email, website, ...(input === 'file' && file ? { file } : { rows: rows.filter((r) => r.number.trim() || r.turma.trim()).map((r) => [r.number, r.turma]) }) });
  const call = async (path: string) => {
    setBusy(true); setError('');
    try { return await api<RecursalCheck>(path, { method: 'POST', json: payload() }); }
    catch (e: any) { setError(e.message); return null; }
    finally { setBusy(false); }
  };
  const verify = async () => { setCheck(null); const r = await call('/recursal/validate'); if (r) setCheck(r); };
  const send = async () => { const r = await call('/recursal/processes'); if (r) setDone(r); };
  const setRow = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const onPaste = (i: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!/[\r\n]/.test(text.trim())) return;
    e.preventDefault();
    const pasted = parsePasted(text);
    setRows((rs) => [...rs.slice(0, i), ...pasted, ...rs.slice(i + 1)]); setCheck(null);
  };
  const pickFile = async (f?: File | null) => {
    setCheck(null); setFile(null); if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setError('Arquivo acima de 5 MB.'); return; }
    try { setFile({ name: f.name, base64: await fileToBase64(f) }); setError(''); } catch (e: any) { setError(e.message); }
  };
  const errorReport = (rs: RecursalRowCheck[]) => download('relatorio-de-erros.csv', ['Linha;Número informado;Turma informada;Situação;Motivo', ...rs.filter((r) => r.state !== 'valida').map((r) => [r.line, r.input, r.turmaInput, r.state === 'duplicada' ? 'Duplicado' : 'Fora do padrão', r.error ?? ''].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))].join('\r\n'));

  if (done) {
    return (
      <div className="card p-7 sm:p-10 space-y-5">
        <Notice tone="ok"><strong>{done.summary.valid} processo(s) enviado(s) com sucesso.</strong> {done.summary.invalid > 0 && `${done.summary.invalid} fora do padrão e `}{done.summary.duplicates > 0 && `${done.summary.duplicates} duplicado(s) não foram incluídos.`}</Notice>
        {done.rows.length > 0 && <button className="btn-secondary btn-sm" onClick={() => errorReport(done.rows)}><Download className="w-4 h-4 inline mr-1" />Baixar relatório dos não incluídos</button>}
        <button className="btn-primary" onClick={() => { setDone(null); setCheck(null); setRows([emptyRow(), emptyRow(), emptyRow()]); setFile(null); }}>Enviar mais processos</button>
      </div>
    );
  }
  const filled = rows.some((r) => r.number.trim());
  const ready = name.trim() && email.trim() && (input === 'file' ? !!file : filled);
  // Motivo, em texto, de o envio ainda não estar liberado
  const blockReason = closed ? 'As inscrições estão fora do prazo.'
    : !name.trim() || !email.trim() ? 'Preencha seu nome e o e-mail institucional.'
    : input === 'file' ? (!file ? 'Escolha o arquivo com os processos.' : !check ? 'Clique em Conferir antes de enviar.' : check.summary.valid === 0 ? 'Nenhum processo válido: corrija os apontamentos e confira de novo.' : '')
    : !filled ? 'Informe ao menos um número de processo.' : !check ? 'Clique em Conferir antes de enviar.' : check.summary.valid === 0 ? 'Nenhum processo válido: corrija os apontamentos e confira de novo.' : '';
  return (
    <div className="card p-7 sm:p-10 space-y-6">
      <div className="pb-5 border-b border-line">
        <FileText className="w-5 h-5 text-bronze mb-3" />
        <h2 className="text-2xl font-semibold text-navy">Enviar processos</h2>
        <p className="text-sm text-muted mt-1.5">Cada processo deve seguir o padrão CNJ (com ou sem pontos e traço) e indicar a Turma Recursal em que tramita (1ª a 6ª).</p>
      </div>
      <EligibilityNotice />
      {error && <Notice tone="danger">{error}</Notice>}
      {input === null ? (
        <div role="radiogroup" aria-label="Como informar os processos" className="grid sm:grid-cols-2 gap-4">
          {([['manual', FileText, 'Digitar ou colar', 'Informe os números e as Turmas diretamente, ou cole linhas copiadas do Excel.'], ['file', Upload, 'Enviar arquivo', 'Envie uma planilha .csv ou .xlsx (1ª coluna: número; 2ª coluna: Turma). Há modelo para baixar.']] as const).map(([id, Icon, label, text]) => (
            <button key={id} type="button" role="radio" aria-checked="false" onClick={() => { setInput(id); setCheck(null); setError(''); }}
              className="text-left flex flex-col items-start rounded-lg border border-line bg-surface p-6 hover:border-bronze hover:shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-bronze">
              <Icon className="w-6 h-6 text-bronze mb-3" />
              <div className="text-lg font-semibold text-navy">{label}</div>
              <p className="text-sm text-muted mt-1.5 leading-relaxed">{text}</p>
              <span className="inline-block mt-4 text-sm font-medium text-navy">Escolher →</span>
            </button>
          ))}
        </div>
      ) : (<>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted">Forma de envio: <strong className="text-ink">{input === 'file' ? 'arquivo .csv/.xlsx' : 'digitar ou colar'}</strong></span>
        <button type="button" className="btn-ghost btn-sm" onClick={() => { setInput(null); setCheck(null); setFile(null); setError(''); }}>Trocar forma de envio</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Seu nome"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" /></Field>
        <Field label="E-mail institucional"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} autoComplete="email" /></Field>
      </div>
      <input className="hidden" tabIndex={-1} aria-hidden="true" autoComplete="off" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} />

      {input === 'manual' ? (
        <div className="space-y-2">
          <p className="text-xs text-muted">Dica: cole várias linhas copiadas do Excel no primeiro campo (número e Turma lado a lado).</p>
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input aria-label={`Número do processo, linha ${i + 1}`} className="input flex-1 font-mono text-sm" placeholder="0000000-00.0000.8.16.0000" value={r.number} onChange={(e) => { setRow(i, { number: e.target.value }); setCheck(null); }} onPaste={(e) => onPaste(i, e)} />
              <select aria-label={`Turma, linha ${i + 1}`} className="input w-28" value={r.turma} onChange={(e) => { setRow(i, { turma: e.target.value }); setCheck(null); }}>
                <option value="">Turma…</option>{TURMAS.map((t) => <option key={t} value={`${t}ª`}>{t}ª Turma</option>)}
              </select>
              <button type="button" aria-label="Remover linha" className="btn-ghost btn-sm" onClick={() => { setRows((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : [emptyRow()])); setCheck(null); }}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" className="btn-secondary btn-sm" onClick={() => setRows((rs) => [...rs, emptyRow()])}><Plus className="w-4 h-4 inline mr-1" />Linha</button>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line bg-paper p-6 text-center space-y-3"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files[0]); }}>
          <Upload className="w-6 h-6 text-bronze mx-auto" />
          <p className="text-sm text-muted">Arraste um arquivo .csv ou .xlsx (1ª coluna: número do processo; 2ª coluna: Turma).</p>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.txt" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
          <button type="button" className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>Escolher arquivo</button>
          {file && <p className="text-sm text-ink">Arquivo: <strong>{file.name}</strong></p>}
        </div>
      )}
      {input === 'file' && (
        <div className="flex flex-wrap gap-3 text-sm">
          <a className="text-navy underline inline-flex items-center gap-1" href="/api/recursal/template.xlsx" download><Download className="w-4 h-4" />Baixar modelo (.xlsx)</a>
          <a className="text-navy underline inline-flex items-center gap-1" href="/api/recursal/template.csv" download><Download className="w-4 h-4" />Baixar modelo (.csv)</a>
        </div>
      )}

      {check && (
        <div className="space-y-3" aria-live="polite">
          <div className="flex flex-wrap gap-4 text-sm font-medium">
            <span className="text-ok inline-flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />{check.summary.valid} válido(s)</span>
            <span className="text-danger inline-flex items-center gap-1"><XCircle className="w-4 h-4" />{check.summary.invalid} fora do padrão / sem Turma</span>
            <span className="text-warn inline-flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{check.summary.duplicates} duplicado(s)</span>
          </div>
          {check.rows.some((r) => r.state !== 'valida' || r.warning) && (
            <div className="overflow-x-auto border border-line rounded-md max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-paper sticky top-0"><tr><th className="th">Linha</th><th className="th">Número informado</th><th className="th">Turma</th><th className="th">Situação</th></tr></thead>
                <tbody>
                  {check.rows.filter((r) => r.state !== 'valida' || r.warning).slice(0, 500).map((r) => (
                    <tr key={r.line} className={r.state === 'invalida' ? 'bg-danger-soft/40' : r.state === 'duplicada' ? 'bg-warn-soft/40' : ''}>
                      <td className="td">{r.line}</td><td className="td font-mono text-xs">{r.input}</td>
                      <td className="td">{r.turma ? <TurmaChip turma={r.turma} /> : <span className="text-xs text-muted">{r.turmaInput || '—'}</span>}</td>
                      <td className="td">{stateBadge(r)}<div className="text-xs text-muted mt-1">{r.error ?? r.warning}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {check.summary.invalid + check.summary.duplicates > 0 && <button className="btn-ghost btn-sm" onClick={() => errorReport(check.rows)}><Download className="w-4 h-4 inline mr-1" />Baixar relatório de erros</button>}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        {blockReason && <p role="status" className="text-sm text-muted mr-auto">{blockReason}</p>}
        <button className="btn-secondary" disabled={busy || !ready} onClick={verify}>{busy && !check ? 'Conferindo…' : 'Conferir'}</button>
        <button className="btn-primary" disabled={!!blockReason || busy} onClick={send}>{check ? `Enviar ${check.summary.valid} válido(s)` : 'Enviar'}</button>
      </div>
      </>)}
    </div>
  );
}

function VolunteerForm({ closed }: { closed: boolean }) {
  const [f, setF] = useState({ name: '', email: '', note: '', website: '' });
  const [turmas, setTurmas] = useState<number[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [ok, setOk] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/recursal/volunteers', { method: 'POST', json: { ...f, turmas } }); setOk(true); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  if (ok) return <div className="card p-7 sm:p-10"><Notice tone="ok"><strong>Inscrição recebida.</strong> A administração fará a conferência e, aprovada, você receberá processos de Turmas em que não atua.</Notice></div>;
  return (
    <form onSubmit={submit} className="card p-7 sm:p-10 space-y-6">
      <div className="pb-5 border-b border-line">
        <Scale className="w-5 h-5 text-bronze mb-3" />
        <h2 className="text-2xl font-semibold text-navy">Inscrição de voluntário</h2>
        <p className="text-sm text-muted mt-1.5">Você receberá processos apenas de Turmas em que <strong>não</strong> atua.</p>
      </div>
      <EligibilityNotice />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Nome completo"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} required /></Field>
        <Field label="E-mail institucional"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={160} required /></Field>
      </div>
      <fieldset>
        <legend className="label">Já atuo em: (marque todas)</legend>
        <div className="flex flex-wrap gap-2 mt-1">
          {TURMAS.map((t) => { const on = turmas.includes(t); return (
            <button key={t} type="button" aria-pressed={on} onClick={() => setTurmas(on ? turmas.filter((x) => x !== t) : [...turmas, t])}
              style={on ? turmaStyle(t) : undefined} className={`px-4 py-2 rounded-md border text-sm font-medium ${on ? '' : 'border-line text-muted hover:text-ink'}`}>{t}ª Turma Recursal</button>
          ); })}
        </div>
      </fieldset>
      <Field label="Observação (opcional)"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={500} /></Field>
      <input className="hidden" tabIndex={-1} aria-hidden="true" autoComplete="off" name="website" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
      {(() => { const why = closed ? 'As inscrições estão fora do prazo.' : !f.name.trim() || !f.email.trim() ? 'Preencha seu nome e o e-mail institucional.' : turmas.length === 0 ? 'Marque ao menos uma Turma em que você já atua.' : '';
        return <div className="flex flex-wrap items-center justify-end gap-3">{why && <p role="status" className="text-sm text-muted mr-auto">{why}</p>}<button className="btn-primary" disabled={!!why || busy}>{busy ? 'Enviando…' : 'Inscrever-se'}</button></div>; })()}
    </form>
  );
}

export interface RecursalStatus {
  volunteer: { status: 'Aguardando' | 'Aprovado' | 'Inativo'; turmas: number[]; capacity?: number; processes: number } | null;
  batches: { id: string; createdAt: string; source: string; fileName?: string; total: number; accepted: number; rejected: number; duplicates: number; distributed: number }[];
}
/** "Consultar status": situação no Mutirão - Turma Recursal (sem nome de relator nem números de processos) */
export function RecursalStatusCard({ r }: { r: RecursalStatus }) {
  const v = r.volunteer;
  const tone = v?.status === 'Aprovado' ? 'ok' : v?.status === 'Inativo' ? 'danger' : 'warn';
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-bronze">Mutirão - Turma Recursal</h3>
      {v && (
        <div className="border border-line rounded-md p-5 space-y-2">
          <div className="flex justify-between gap-3">
            <div className="font-serif font-semibold text-navy">Inscrição como voluntário</div>
            <Badge tone={tone}>{v.status === 'Inativo' ? 'Rejeitada' : v.status === 'Aprovado' ? 'Aprovada' : 'Aguardando conferência'}</Badge>
          </div>
          <div className="text-xs text-muted flex items-center gap-1.5 flex-wrap">Atua em: {v.turmas.map((t) => <TurmaChip key={t} turma={t} />)}</div>
          {v.status === 'Aprovado' && <div className="bg-ok-soft text-ok text-sm rounded-md px-3 py-2.5">Processos designados a você até agora: <strong>{v.processes}</strong>.</div>}
          {v.status === 'Inativo' && <div className="bg-danger-soft text-danger text-sm rounded-md px-3 py-2.5">A inscrição não foi aceita. Somente magistrados lotados ou designados nas Turmas Recursais podem participar.</div>}
        </div>
      )}
      {r.batches.map((b) => (
        <div key={b.id} className="border border-line rounded-md p-5 space-y-2">
          <div className="flex justify-between gap-3">
            <div><div className="font-serif font-semibold text-navy">Envio de processos</div><div className="text-xs text-muted">{new Date(b.createdAt).toLocaleString('pt-BR')} · {b.fileName ?? 'digitação'}</div></div>
            <Badge tone={b.distributed === b.accepted && b.accepted > 0 ? 'ok' : 'warn'}>{b.distributed} de {b.accepted} distribuído(s)</Badge>
          </div>
          <div className="text-xs text-muted">Recebidos: <span className="text-ink">{b.total}</span> · aceitos: <span className="text-ink">{b.accepted}</span> · fora do padrão CNJ ou sem Turma: <span className="text-ink">{b.rejected}</span> · duplicados: <span className="text-ink">{b.duplicates}</span></div>
        </div>
      ))}
    </div>
  );
}
