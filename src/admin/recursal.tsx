// Administração do Mutirão da Turma Recursal: painel, processos, voluntários e distribuição.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Trash2, Wand2, Undo2 } from 'lucide-react';
import { api, download } from '../api';
import { RecursalOverview, RecursalProcessView, RecursalVolunteerView } from '../types';
import { Badge, EmptyRow, Modal, formatDateTime } from '../ui';
import { TURMAS, TurmaChip } from '../recursalCommon';
import { type RunFn } from './shared';
import { Toolbar } from './table';

type View = 'panel' | 'processes' | 'volunteers' | 'distribution';
const VIEWS: { id: View; label: string }[] = [{ id: 'panel', label: 'Painel' }, { id: 'distribution', label: 'Distribuição' }, { id: 'processes', label: 'Processos' }, { id: 'volunteers', label: 'Voluntários' }];

export function RecursalAdmin({ run, confirm, readOnly, isAdmin }: { run: RunFn; confirm: (m: string, label?: string) => Promise<boolean>; readOnly: boolean; isAdmin: boolean }) {
  const [data, setData] = useState<RecursalOverview | null>(null);
  const [view, setView] = useState<View>('panel');
  const load = useCallback(() => api<RecursalOverview>('/recursal/overview').then(setData).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <p className="text-sm text-muted">Carregando…</p>;
  const act = async (fn: () => Promise<unknown>, ok?: string) => { const r = await run(fn, ok); await load(); return r; };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1 border-b border-line">
        {VIEWS.map((v) => <button key={v.id} onClick={() => setView(v.id)} className={`px-4 py-2 text-sm -mb-px border-b-2 ${view === v.id ? 'border-bronze text-navy font-medium' : 'border-transparent text-muted hover:text-ink'}`}>{v.label}</button>)}
      </div>
      {view === 'panel' && <PanelView data={data} />}
      {view === 'distribution' && <Distribution data={data} act={act} confirm={confirm} readOnly={readOnly} />}
      {view === 'processes' && <Processes data={data} act={act} confirm={confirm} readOnly={readOnly} isAdmin={isAdmin} />}
      {view === 'volunteers' && <Volunteers data={data} act={act} confirm={confirm} readOnly={readOnly} isAdmin={isAdmin} />}
    </div>
  );
}
type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<unknown>;
type Confirm = (m: string, label?: string) => Promise<boolean>;

const Stat = ({ label, value }: { label: string; value: number }) => <div className="card p-4"><div className="text-2xl font-semibold text-navy">{value}</div><div className="text-xs text-muted mt-1">{label}</div></div>;
const exportBtns = (turma = '') => (
  <>
    <button className="btn-secondary btn-sm" onClick={() => download(`/recursal/export.xlsx${turma ? `?turma=${turma}` : ''}`, 'mutirao-turma-recursal.xlsx')}><Download className="w-4 h-4 inline mr-1" />Tabela .xlsx</button>
    <button className="btn-secondary btn-sm" onClick={() => download(`/recursal/export.csv${turma ? `?turma=${turma}` : ''}`, 'mutirao-turma-recursal.csv')}><Download className="w-4 h-4 inline mr-1" />Tabela .csv</button>
  </>
);

function PanelView({ data }: { data: RecursalOverview }) {
  const c = data.counts; const max = Math.max(1, ...data.matrix.map((m) => m.pending + m.distributed));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3"><Stat label="Processos" value={c.processes} /><Stat label="Pendentes" value={c.pending} /><Stat label="Distribuídos" value={c.distributed} /><Stat label="Voluntários" value={c.volunteers} /><Stat label="Aprovados" value={c.approved} /></div>
      <div className="card p-5">
        <h3 className="text-lg font-semibold text-navy mb-1">Processos por Turma de origem</h3>
        <p className="text-xs text-muted mb-4">Relatores aptos = voluntários aprovados que <strong>não</strong> atuam na Turma do processo.</p>
        <div className="space-y-2">
          {data.matrix.map((m) => (
            <div key={m.turma} className="flex items-center gap-3">
              <TurmaChip turma={m.turma} />
              <div className="flex-1 h-5 bg-paper rounded overflow-hidden flex" role="img" aria-label={`${m.pending} pendentes e ${m.distributed} distribuídos`}>
                <div className="bg-ok" style={{ width: `${(m.distributed / max) * 100}%` }} /><div className="bg-bronze/60" style={{ width: `${(m.pending / max) * 100}%` }} />
              </div>
              <span className="text-xs text-muted w-44 text-right">{m.pending} pend. · {m.distributed} dist. · <strong className={m.apt === 0 && m.pending ? 'text-danger' : 'text-ink'}>{m.apt} apto(s)</strong></span>
            </div>
          ))}
        </div>
        <div className="flex gap-4 text-xs text-muted mt-3"><span><span className="inline-block w-3 h-3 bg-ok align-middle mr-1" />Distribuídos</span><span><span className="inline-block w-3 h-3 bg-bronze/60 align-middle mr-1" />Pendentes</span></div>
      </div>
      <div className="card p-5">
        <h3 className="text-lg font-semibold text-navy mb-3">Envios recentes</h3>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="th">Data</th><th className="th">Remetente</th><th className="th">Origem</th><th className="th">Aceitos</th><th className="th">Fora do padrão</th><th className="th">Duplicados</th></tr></thead>
          <tbody>{data.batches.length === 0 ? <EmptyRow cols={6}>Nenhum envio ainda.</EmptyRow> : data.batches.map((b) => <tr key={b.id}><td className="td">{formatDateTime(b.createdAt)}</td><td className="td">{b.submitterName}<div className="text-xs text-muted">{b.submitterEmail}</div></td><td className="td">{b.fileName ?? 'Digitação'}</td><td className="td">{b.accepted}</td><td className="td">{b.rejected}</td><td className="td">{b.duplicates}</td></tr>)}</tbody></table></div>
      </div>
    </div>
  );
}

function Distribution({ data, act, confirm, readOnly }: { data: RecursalOverview; act: Act; confirm: Confirm; readOnly: boolean }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [turma, setTurma] = useState(0); const [q, setQ] = useState(''); const [volId, setVolId] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const pending = useMemo(() => data.processes.filter((p) => p.status === 'Pendente' && (!turma || p.turma === turma) && (!q || p.formatted.includes(q) || p.cnj.includes(q.replace(/\D/g, '') || '\u0000'))), [data, turma, q]);
  const selected = data.processes.filter((p) => sel.has(p.id));
  const selTurmas = new Set(selected.map((p) => p.turma));
  const blocked = (v: RecursalVolunteerView) => v.status !== 'Aprovado' ? 'Não aprovado' : [...selTurmas].find((t) => v.turmas.includes(t)) ? `Atua na ${[...selTurmas].find((t) => v.turmas.includes(t))}ª Turma — vedado` : v.capacity != null && v.load + selected.length > v.capacity ? 'Capacidade excedida' : '';
  const vols = data.volunteers.filter((v) => v.status === 'Aprovado');
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const assign = async () => {
    await act(() => api('/recursal/assign', { method: 'POST', json: { volunteerId: volId, processIds: [...sel] } }), 'Processos designados.');
    setSel(new Set()); setVolId('');
  };
  const distributed = data.processes.filter((p) => p.status === 'Distribuído');
  const doPreview = async () => { const r = await api('/recursal/auto-preview', { method: 'POST', json: {} }).catch((e) => { act(async () => { throw e; }); return null; }); if (r) setPreview(r); };
  const apply = async () => { await act(() => api('/recursal/auto-apply', { method: 'POST', json: {} }), 'Distribuição aplicada.'); setPreview(null); };
  const undo = async (ids: string[]) => { if (await confirm(`Desfazer a designação de ${ids.length} processo(s)?`, 'Desfazer')) await act(() => api('/recursal/unassign', { method: 'POST', json: { processIds: ids } }), 'Designação desfeita.'); };
  return (
    <div className="space-y-5">
      <Toolbar title="Distribuição de processos">
        {!readOnly && <button className="btn-secondary btn-sm" onClick={doPreview}><Wand2 className="w-4 h-4 inline mr-1" />Sugerir distribuição automática</button>}
        {exportBtns()}
      </Toolbar>
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card p-4 space-y-3">
          <div className="flex gap-2"><select className="input w-32" aria-label="Turma" value={turma} onChange={(e) => setTurma(Number(e.target.value))}><option value={0}>Todas</option>{TURMAS.map((t) => <option key={t} value={t}>{t}ª Turma</option>)}</select><input className="input flex-1" placeholder="Buscar número" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="text-xs text-muted flex justify-between"><span>{pending.length} pendente(s)</span><button className="underline" onClick={() => setSel(new Set(pending.map((p) => p.id)))}>Selecionar todos</button></div>
          <div className="max-h-96 overflow-y-auto divide-y divide-line">
            {pending.length === 0 && <p className="text-sm text-muted py-4 text-center">Nenhum processo pendente.</p>}
            {pending.slice(0, 1000).map((p) => <label key={p.id} className="flex items-center gap-3 py-2 text-sm cursor-pointer"><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} disabled={readOnly} /><span className="font-mono text-xs flex-1">{p.formatted}</span><TurmaChip turma={p.turma} /></label>)}
          </div>
        </div>
        <div className="card p-4 space-y-3">
          <div className="text-sm font-medium text-navy">Relatores voluntários {selected.length > 0 && <span className="text-muted font-normal">— para {selected.length} selecionado(s)</span>}</div>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {vols.length === 0 && <p className="text-sm text-muted py-4 text-center">Nenhum voluntário aprovado.</p>}
            {vols.map((v) => { const why = selected.length ? blocked(v) : ''; return (
              <label key={v.id} title={why} className={`flex items-center gap-3 rounded border p-2.5 text-sm ${why ? 'opacity-45 cursor-not-allowed border-line' : volId === v.id ? 'border-bronze bg-bronze-soft cursor-pointer' : 'border-line cursor-pointer hover:border-bronze'}`}>
                <input type="radio" name="vol" checked={volId === v.id} disabled={!!why || readOnly} onChange={() => setVolId(v.id)} />
                <span className="flex-1">{v.name}{why && <span className="block text-xs text-danger">{why}</span>}</span>
                <span className="flex gap-1">{v.turmas.map((t) => <TurmaChip key={t} turma={t} />)}</span>
                <span className="text-xs text-muted w-14 text-right">{v.load}{v.capacity ? `/${v.capacity}` : ''}</span>
              </label>); })}
          </div>
          {!readOnly && <button className="btn-primary w-full" disabled={!volId || selected.length === 0} onClick={assign}>Atribuir {selected.length || ''} selecionado(s) →</button>}
        </div>
      </div>
      <div className="card p-4">
        <h3 className="text-lg font-semibold text-navy mb-3">Distribuídos ({distributed.length})</h3>
        <div className="overflow-x-auto max-h-96 overflow-y-auto"><table className="w-full text-sm"><thead><tr><th className="th">Processo</th><th className="th">Turma</th><th className="th">Relator designado</th><th className="th">Atua em</th><th className="th" /></tr></thead>
          <tbody>{distributed.length === 0 ? <EmptyRow cols={5}>Nada distribuído ainda.</EmptyRow> : distributed.slice(0, 1000).map((p) => <tr key={p.id}><td className="td font-mono text-xs">{p.formatted}</td><td className="td"><TurmaChip turma={p.turma} /></td><td className="td">{p.volunteerName}</td><td className="td"><span className="flex gap-1">{p.volunteerTurmas.map((t) => <TurmaChip key={t} turma={t} />)}</span></td><td className="td text-right">{!readOnly && <button className="btn-ghost btn-sm" aria-label="Desfazer designação" onClick={() => undo([p.id])}><Undo2 className="w-4 h-4" /></button>}</td></tr>)}</tbody></table></div>
      </div>
      {preview && (
        <Modal title="Prévia da distribuição automática" wide onClose={() => setPreview(null)}>
          <div className="space-y-4 text-sm">
            <p><strong>{preview.pairs.length}</strong> processo(s) serão designados; <strong className={preview.unassignable.length ? 'text-danger' : ''}>{preview.unassignable.length}</strong> sem relator possível. A regra de ouro (Turma diversa) é conferida de novo ao aplicar.</p>
            <div className="flex flex-wrap gap-2">{preview.loads.map((l: any) => <Badge key={l.volunteerId} tone="info">{l.name}: {l.current} + {l.add}</Badge>)}</div>
            {preview.unassignable.length > 0 && <div className="rounded bg-danger-soft p-3"><div className="font-medium text-danger mb-1">Sem relator possível</div>{preview.unassignable.slice(0, 50).map((u: any) => <div key={u.processId} className="text-xs"><span className="font-mono">{u.formatted}</span> <TurmaChip turma={u.turma} /> — {u.reason}</div>)}</div>}
            <div className="max-h-64 overflow-y-auto border border-line rounded"><table className="w-full"><tbody>{preview.pairs.slice(0, 500).map((p: any) => <tr key={p.processId}><td className="td font-mono text-xs">{p.formatted}</td><td className="td"><TurmaChip turma={p.turma} /></td><td className="td">{p.volunteerName}</td></tr>)}</tbody></table></div>
            <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={() => setPreview(null)}>Cancelar</button><button className="btn-primary" disabled={!preview.pairs.length} onClick={apply}>Aplicar distribuição</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Processes({ data, act, confirm, readOnly, isAdmin }: { data: RecursalOverview; act: Act; confirm: Confirm; readOnly: boolean; isAdmin: boolean }) {
  const [turma, setTurma] = useState(0); const [st, setSt] = useState(''); const [q, setQ] = useState('');
  const rows = data.processes.filter((p) => (!turma || p.turma === turma) && (!st || p.status === st) && (!q || p.formatted.includes(q) || p.cnj.includes(q.replace(/\D/g, '') || '\u0000')));
  const wipe = async () => { if (await confirm('Excluir TODOS os processos e envios do Mutirão Recursal? Esta ação não pode ser desfeita.', 'Excluir tudo')) await act(() => api('/recursal/processes/delete-all', { method: 'POST', json: { confirm: 'EXCLUIR' } }), 'Processos excluídos.'); };
  return (
    <div className="space-y-4">
      <Toolbar title={`Processos (${rows.length})`}>{exportBtns(turma ? String(turma) : '')}{isAdmin && !readOnly && <button className="btn-danger btn-sm" onClick={wipe}>Excluir todos</button>}</Toolbar>
      <div className="flex gap-2 flex-wrap"><select className="input w-36" aria-label="Turma" value={turma} onChange={(e) => setTurma(Number(e.target.value))}><option value={0}>Todas as Turmas</option>{TURMAS.map((t) => <option key={t} value={t}>{t}ª Turma</option>)}</select><select className="input w-36" aria-label="Situação" value={st} onChange={(e) => setSt(e.target.value)}><option value="">Todas</option><option>Pendente</option><option>Distribuído</option></select><input className="input w-64" placeholder="Buscar número" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="card overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="th">Número do processo</th><th className="th">Turma em que tramita</th><th className="th">Relator designado</th><th className="th">Enviado por</th><th className="th">Situação</th><th className="th" /></tr></thead>
        <tbody>{rows.length === 0 ? <EmptyRow cols={6}>Nenhum processo.</EmptyRow> : rows.slice(0, 1000).map((p) => <tr key={p.id}><td className="td font-mono text-xs">{p.formatted}</td><td className="td"><TurmaChip turma={p.turma} /></td><td className="td">{p.volunteerName ?? '—'}</td><td className="td">{p.submitterName}<div className="text-xs text-muted">{p.submitterEmail}</div></td><td className="td"><Badge tone={p.status === 'Distribuído' ? 'ok' : 'warn'}>{p.status}</Badge></td><td className="td text-right">{!readOnly && <button className="btn-ghost btn-sm" aria-label="Excluir processo" onClick={async () => { if (await confirm(`Excluir o processo ${p.formatted}?`, 'Excluir')) act(() => api(`/recursal/processes/${p.id}`, { method: 'DELETE' })); }}><Trash2 className="w-4 h-4" /></button>}</td></tr>)}</tbody></table>{rows.length > 1000 && <p className="text-xs text-muted p-3">Mostrando 1000 de {rows.length}; use os filtros ou exporte a tabela.</p>}</div>
    </div>
  );
}

function Volunteers({ data, act, confirm, readOnly, isAdmin }: { data: RecursalOverview; act: Act; confirm: Confirm; readOnly: boolean; isAdmin: boolean }) {
  const patch = (v: RecursalVolunteerView, body: object, ok?: string) => act(() => api(`/recursal/volunteers/${v.id}`, { method: 'PATCH', json: body }), ok);
  const toggleTurma = (v: RecursalVolunteerView, t: number) => patch(v, { turmas: v.turmas.includes(t) ? v.turmas.filter((x) => x !== t) : [...v.turmas, t] });
  return (
    <div className="space-y-4">
      <Toolbar title={`Voluntários (${data.volunteers.length})`} />
      <p className="text-sm text-warn bg-warn-soft rounded-md px-4 py-3">Somente magistrados lotados ou designados nas Turmas Recursais podem participar. Rejeite (situação “Inativo”) as inscrições de quem não se enquadrar nessas condições.</p>
      <div className="card overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="th">Magistrado</th><th className="th">Atua em</th><th className="th">Carga</th><th className="th">Situação</th><th className="th" /></tr></thead>
        <tbody>{data.volunteers.length === 0 ? <EmptyRow cols={5}>Nenhum voluntário inscrito.</EmptyRow> : data.volunteers.map((v) => (
          <tr key={v.id}><td className="td">{v.name}<div className="text-xs text-muted">{v.email}{v.note ? ` · ${v.note}` : ''}</div></td>
            <td className="td"><span className="flex gap-1 flex-wrap">{TURMAS.map((t) => <button key={t} disabled={readOnly} aria-pressed={v.turmas.includes(t)} aria-label={`${t}ª Turma`} onClick={() => toggleTurma(v, t)}><TurmaChip turma={t} dim={!v.turmas.includes(t)} /></button>)}</span></td>
            <td className="td">{v.load}{v.capacity ? ` / ${v.capacity}` : ''}</td>
            <td className="td"><select className="input w-32" aria-label="Situação" disabled={readOnly} value={v.status} onChange={(e) => patch(v, { status: e.target.value }, 'Situação atualizada.')}><option>Aguardando</option><option>Aprovado</option><option>Inativo</option></select></td>
            <td className="td text-right">{isAdmin && !readOnly && <button className="btn-ghost btn-sm" aria-label="Excluir voluntário" onClick={async () => { if (await confirm(`Excluir o voluntário ${v.name}?`, 'Excluir')) act(() => api(`/recursal/volunteers/${v.id}`, { method: 'DELETE' })); }}><Trash2 className="w-4 h-4" /></button>}</td></tr>))}</tbody></table></div>
    </div>
  );
}
