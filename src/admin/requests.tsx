// Pedidos de alteração feitos no portal: análise (deferir ou indeferir).
import { PREFERENCE_AREAS, ChangeRequest, Unit, WORK_TYPES } from '../types';
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { COMARCAS, catalogById, fullUnitName, unitsOfComarca } from '../catalogo-tjpr';
import { Badge, Field, Modal, Notice, formatDateTime } from '../ui';
import { Check, X } from 'lucide-react';
import { type RunFn, unitOption } from './shared';
import { Toolbar } from './table';

/* ---------- Pedidos de alteração (feitos pelo portal por quem já está vinculado) ---------- */
export type Decision =
  | { kind: 'reject'; r: ChangeRequest; reason: string }
  | { kind: 'mag'; r: ChangeRequest; units: Unit[]; area: string; workType: string; comarca: string; unit: string; newName: string; date: string; sei: string; reason: string }
  | { kind: 'unit'; r: ChangeRequest; areas: string[]; slots: number; reason: string };

export function RequestsAdmin({ run, readOnly, onChanged }: { run: RunFn; readOnly: boolean; onChanged: () => void }) {
  const [list, setList] = useState<ChangeRequest[] | null>(null);
  const [all, setAll] = useState(false);
  const [d, setD] = useState<Decision | null>(null);
  const load = useCallback(async () => { const r = await run(() => api<ChangeRequest[]>('/requests')); if (r) setList(r); }, [run]);
  useEffect(() => { load(); }, []);

  const work = (w?: string) => (w === 'Audiência' ? 'Audiências' : w || '—');
  const openDefer = async (r: ChangeRequest) => {
    if (r.kind === 'unidade') {
      const live = r.live as { areas: string[]; slots: number } | null;
      setD({ kind: 'unit', r, areas: r.requested.areas ?? live?.areas ?? [], slots: (live?.slots ?? 1) + (r.requested.extraSlots ?? 0), reason: '' });
      return;
    }
    const live = r.live as { unitId: string; area: string; workType: string } | null;
    const us = await run(() => api<Unit[]>('/units?edition=all'));
    if (!us) return;
    setD({ kind: 'mag', r, units: us.filter(u => u.selection === 'Escolhida').sort((a, b) => a.unitName.localeCompare(b.unitName, 'pt-BR')),
      area: r.requested.area ?? live?.area ?? '', workType: r.requested.workType ?? live?.workType ?? 'Sentença', comarca: '', unit: '', newName: '', date: '', sei: '', reason: '' });
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d) return;
    let body: Record<string, unknown>;
    if (d.kind === 'reject') body = { decision: 'Indeferido', reason: d.reason };
    else if (d.kind === 'unit') body = { decision: 'Deferido', areas: d.areas, slots: d.slots, reason: d.reason };
    else {
      const cat = d.unit.startsWith('cat:') ? catalogById(d.unit.slice(4)) : undefined;
      body = { decision: 'Deferido', area: d.area, workType: d.workType, effectiveDate: d.date, sei: d.sei, reason: d.reason,
        ...(d.newName.trim() ? { newUnitName: d.newName.trim() } : cat ? { newUnitName: fullUnitName(cat) } : d.unit ? { unitId: d.unit } : {}) };
    }
    const r = await run(() => api(`/requests/${d.r.id}/decide`, { method: 'POST', json: body }), d.kind === 'reject' ? 'Pedido indeferido.' : 'Pedido deferido e alteração aplicada.');
    if (r) { setD(null); await load(); onChanged(); }
  };

  if (!list) return <div className="card p-8 text-sm text-muted">Carregando…</div>;
  const pending = list.filter(r => r.status === 'Pendente');
  const shown = all ? list : pending;
  return (
    <div className="space-y-6">
      <Toolbar title="Pedidos de alteração">
        <button type="button" aria-pressed={all} onClick={() => setAll(!all)}
          className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${all ? 'bg-navy text-white border-navy' : 'bg-surface text-muted border-line hover:text-ink'}`}>
          {all ? `Todos (${list.length})` : `Mostrar também os analisados (${list.length - pending.length})`}
        </button>
      </Toolbar>
      <p className="text-sm text-muted -mt-2">
        Pedidos feitos no portal ("Pedir alteração") por magistrados vinculados (outra área ou outro tipo de atuação) e por unidades atendidas (outras áreas ou mais magistrados).
        Ao deferir o pedido de um magistrado, defina a área, o tipo, a vara e a data de início: a atuação anterior fica registrada até a véspera e um novo período começa na data.
      </p>
      {shown.length === 0 && <div className="card p-8 text-center text-sm text-muted">{all ? 'Nenhum pedido recebido.' : 'Nenhum pedido pendente.'}</div>}
      {shown.map(r => {
        const live = r.live as any;
        return (
          <div key={r.id} className="card p-5 space-y-3">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <strong className="text-navy">{r.protocol}</strong>
                  <Badge tone="neutral">{r.kind === 'magistrado' ? 'Magistrado' : 'Unidade'}</Badge>
                  <Badge tone={r.status === 'Deferido' ? 'ok' : r.status === 'Indeferido' ? 'danger' : 'warn'}>{r.status}</Badge>
                </div>
                <div className="font-medium mt-1">{r.name}</div>
                <div className="text-xs text-muted">{r.editionTitle} · recebido em {formatDateTime(r.createdAt)}{r.ip ? ` · IP ${r.ip}` : ''}</div>
              </div>
              {r.status === 'Pendente' && !readOnly && (
                <div className="flex gap-2 self-start">
                  <button className="btn-primary btn-sm" disabled={!live} title={live ? '' : 'A designação ou a unidade não está mais vigente'} onClick={() => openDefer(r)}><Check className="w-4 h-4" /> Deferir</button>
                  <button className="btn-secondary btn-sm" onClick={() => setD({ kind: 'reject', r, reason: '' })}><X className="w-4 h-4" /> Indeferir</button>
                </div>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-md bg-paper border border-line px-3 py-2">
                <div className="text-[11px] uppercase tracking-wider text-muted mb-1">Como está</div>
                {r.kind === 'magistrado'
                  ? <>{r.current.unit}<div className="text-xs text-muted">Área: {r.current.area} · Tipo: {work(r.current.workType)}</div></>
                  : <>{r.current.unit}<div className="text-xs text-muted">Áreas: {r.current.areas?.join(', ') || '—'} · {r.current.slots} magistrado(s)</div></>}
              </div>
              <div className="rounded-md bg-bronze-soft/50 border border-line px-3 py-2">
                <div className="text-[11px] uppercase tracking-wider text-muted mb-1">O que foi pedido</div>
                {r.summary}
              </div>
            </div>
            <div className="text-sm"><span className="text-muted">Justificativa:</span> <span className="whitespace-pre-wrap">{r.justification}</span></div>
            {r.notes && <div className="text-sm"><span className="text-muted">Observações:</span> <span className="whitespace-pre-wrap">{r.notes}</span></div>}
            {r.status === 'Pendente' && !live && <Notice tone="danger">A designação ou a unidade deste pedido não está mais vigente. Indefira informando o motivo.</Notice>}
            {r.status !== 'Pendente' && (
              <div className={`text-sm rounded-md px-3 py-2 ${r.status === 'Deferido' ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
                {r.status} em {r.decidedAt ? formatDateTime(r.decidedAt) : '—'}{r.decidedBy ? ` por ${r.decidedBy}` : ''}.
                {r.outcome && <> Aplicado: {r.outcome}.</>}{r.decisionReason && <> {r.status === 'Indeferido' ? 'Motivo' : 'Observação'}: {r.decisionReason}</>}
              </div>
            )}
          </div>
        );
      })}

      {d && (
        <Modal title={d.kind === 'reject' ? `Indeferir pedido ${d.r.protocol}` : `Deferir pedido ${d.r.protocol}`} onClose={() => setD(null)}>
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-muted"><strong className="text-ink">{d.r.name}</strong> · pedido: {d.r.summary}</p>
            {d.kind === 'mag' && (() => {
              const live = d.r.live as { unitId: string; unit: string } | null;
              const comarcas = d.r.isInitial ? COMARCAS : [...new Set(d.units.map(u => u.comarca))].sort((x, y) => x.localeCompare(y, 'pt-BR'));
              const existing = d.units.filter(u => u.comarca === d.comarca);
              const have = new Set(existing.map(u => u.catalogId).filter(Boolean));
              const fromCatalog = d.r.isInitial && d.comarca ? unitsOfComarca(d.comarca).filter(c => !have.has(c.id)) : [];
              return <>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Área de atuação">
                    <select className="input" required value={d.area} onChange={e => setD({ ...d, area: e.target.value })}>
                      {d.area && !PREFERENCE_AREAS.includes(d.area) && <option value={d.area}>{d.area}</option>}
                      {PREFERENCE_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </Field>
                  <Field label="Tipo de atuação">
                    <select className="input" value={d.workType} onChange={e => setD({ ...d, workType: e.target.value })}>
                      {WORK_TYPES.map(w => <option key={w} value={w}>{work(w)}</option>)}
                    </select>
                  </Field>
                </div>
                <p className="text-xs text-muted">Vara atual: <strong className="text-ink">{live?.unit ?? '—'}</strong>. Para manter, deixe a comarca em branco.</p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Nova comarca">
                    <select className="input" value={d.comarca} onChange={e => setD({ ...d, comarca: e.target.value, unit: '' })} disabled={!!d.newName.trim()}>
                      <option value="">Manter a vara atual</option>
                      {comarcas.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="Nova vara">
                    <select className="input" value={d.unit} onChange={e => setD({ ...d, unit: e.target.value })} disabled={!d.comarca || !!d.newName.trim()}>
                      <option value="">{d.comarca ? 'Manter a vara atual' : 'Escolha a comarca primeiro'}</option>
                      {existing.filter(u => u.id !== live?.unitId).map(u => <option key={u.id} value={u.id}>{unitOption(u, existing)}</option>)}
                      {fromCatalog.map(c => <option key={c.id} value={`cat:${c.id}`}>{c.unitName}</option>)}
                    </select>
                  </Field>
                </div>
                {d.r.isInitial && (
                  <Field label="Ou digite o nome da nova vara (se ainda não estiver na lista)">
                    <input className="input" maxLength={300} value={d.newName} onChange={e => setD({ ...d, newName: e.target.value })} placeholder="Ex.: 2ª Vara Cível de Londrina" />
                  </Field>
                )}
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="A partir de"><input className="input" type="date" required value={d.date} onChange={e => setD({ ...d, date: e.target.value })} /></Field>
                  <Field label="Processo SEI (opcional)"><input className="input" maxLength={100} value={d.sei} onChange={e => setD({ ...d, sei: e.target.value })} /></Field>
                </div>
              </>;
            })()}
            {d.kind === 'unit' && <>
              <fieldset>
                <legend className="text-xs font-medium text-muted mb-2">Áreas da unidade</legend>
                <div className="grid sm:grid-cols-2 gap-2">
                  {[...PREFERENCE_AREAS, ...d.areas.filter(a => !PREFERENCE_AREAS.includes(a))].map(a => (
                    <label key={a} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={d.areas.includes(a)} onChange={e => setD({ ...d, areas: e.target.checked ? [...d.areas, a] : d.areas.filter(x => x !== a) })} /> {a}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label={`Número de magistrados da unidade (hoje: ${(d.r.live as any)?.slots ?? '—'}; vinculados: ${(d.r.live as any)?.linked ?? '—'})`}>
                <input className="input max-w-[8rem]" type="number" min={1} max={50} required value={d.slots} onChange={e => setD({ ...d, slots: Number(e.target.value) || 1 })} />
              </Field>
            </>}
            <Field label={d.kind === 'reject' ? 'Motivo do indeferimento (aparece para quem pediu)' : 'Observação (opcional; aparece para quem pediu)'}>
              <textarea className="input" rows={3} required={d.kind === 'reject'} maxLength={2000} value={d.reason} onChange={e => setD({ ...d, reason: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setD(null)}>Cancelar</button>
              <button className={d.kind === 'reject' ? 'btn-danger px-4' : 'btn-primary'} disabled={d.kind === 'unit' && d.areas.length === 0}>{d.kind === 'reject' ? 'Indeferir' : 'Deferir e aplicar'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
