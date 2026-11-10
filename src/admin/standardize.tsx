// Padronização de nomes (conciliação com a lista oficial) e duplicidades de magistrados.
import { useCallback, useEffect, useState } from 'react';
import { COMARCAS, canonicalComarca, catalogById, unitsOfComarca } from '../catalogo-tjpr';
import { Badge, EmptyRow } from '../ui';
import { Check } from 'lucide-react';
import { api } from '../api';
import { type RunFn } from './shared';
import { Table, Toolbar } from './table';

/* ---------- Padronizar nomes: conciliação com o catálogo oficial de comarcas e unidades ---------- */
export interface Suggestion { id: string; label: string; comarca: string; score: number }

export interface StdGroup { key: string; label: string; comarca: string; ids: string[]; editions?: string[]; links?: number; names?: string[]; suggestions: Suggestion[] }

export const confident = (g: StdGroup) => g.suggestions[0]?.score >= 0.85 && !(g.suggestions[1] && g.suggestions[1].score > g.suggestions[0].score - 0.1);

export const confTone = (s: number) => (s >= 0.85 ? 'ok' : s >= 0.6 ? 'warn' : 'neutral') as 'ok' | 'warn' | 'neutral';

export function StdRow({ g, kind, onApply }: { g: StdGroup; kind: 'unit' | 'location'; onApply: (catalogId: string, note: string) => Promise<void> }) {
  // Só vem marcada a sugestão que se destaca das demais (empates ficam para a escolha da coordenação)
  const top = g.suggestions[0], second = g.suggestions[1];
  const [sel, setSel] = useState(top && top.score >= 0.6 && !(second && second.score >= top.score - 0.05) ? top.id : '');
  const [other, setOther] = useState(false);
  const [comarca, setComarca] = useState(canonicalComarca(g.comarca) ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = catalogById(sel);
  return (
    <tr className="align-top">
      <td className="td">
        <div className="font-medium">{g.label}</div>
        <div className="text-xs text-muted mt-0.5">
          {kind === 'unit' ? <>{g.ids.length > 1 ? `${g.ids.length} inscrições · ` : ''}{g.links ? `${g.links} vinculação(ões) · ` : ''}{(g.editions ?? []).join(', ')}</> : (g.names ?? []).join(', ')}
        </div>
      </td>
      <td className="td min-w-[18rem]">
        {!other ? (
          <div className="space-y-1.5">
            {g.suggestions.length === 0 && <p className="text-xs text-muted">Sem sugestão.</p>}
            {g.suggestions.map(s => (
              <label key={s.id} className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="radio" className="mt-1" name={`std-${g.key}`} checked={sel === s.id} onChange={() => setSel(s.id)} />
                <span>{s.label} <Badge tone={confTone(s.score)}>{Math.round(s.score * 100)}%</Badge></span>
              </label>
            ))}
            <button type="button" className="text-xs text-bronze hover:underline" onClick={() => { setOther(true); setSel(''); }}>Escolher outra unidade da lista…</button>
          </div>
        ) : (
          <div className="space-y-2">
            <select className="input !py-2 text-sm" value={comarca} onChange={e => { setComarca(e.target.value); setSel(''); }} aria-label="Comarca">
              <option value="" disabled>Comarca…</option>
              {COMARCAS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="input !py-2 text-sm" value={sel} disabled={!comarca} onChange={e => setSel(e.target.value)} aria-label="Unidade">
              <option value="" disabled>Unidade…</option>
              {unitsOfComarca(comarca).map(u => <option key={u.id} value={u.id}>{u.unitName}</option>)}
            </select>
            <button type="button" className="text-xs text-bronze hover:underline" onClick={() => { setOther(false); setSel(g.suggestions[0]?.id ?? ''); }}>Voltar às sugestões</button>
          </div>
        )}
        {kind === 'unit' && (
          <input className="input !py-2 text-sm mt-2" maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder="Observação da designação (opcional)" aria-label="Observação" />
        )}
      </td>
      <td className="td text-right">
        <button className="btn-primary btn-sm" disabled={!chosen || busy} onClick={async () => { setBusy(true); await onApply(sel, note); setBusy(false); }}
          title={chosen ? `Passa a ser: ${chosen.label}` : 'Escolha a unidade oficial'}><Check className="w-4 h-4" /> Aplicar</button>
      </td>
    </tr>
  );
}

export interface DupSide { key: string; name: string; records: { id: string; edition: string; status: string; email: string }[] }

export interface DupPair { a: DupSide; b: DupSide; reason: string }

export function DupRow({ d, run, onDone }: { d: DupPair; run: RunFn; onDone: () => Promise<void> }) {
  const longer = d.a.name.length >= d.b.name.length ? d.a.name : d.b.name;
  const [name, setName] = useState(longer);
  const side = (x: DupSide) => (
    <div><strong className="text-ink">{x.name}</strong><div className="text-xs text-muted">{x.records.map(r => `${r.edition} (${r.status})`).join('; ')}</div></div>
  );
  return (
    <tr className="align-top">
      <td className="td space-y-2">{side(d.a)}{side(d.b)}<div className="text-[11px] text-bronze">{d.reason}</div></td>
      <td className="td min-w-[16rem] space-y-1.5">
        {[d.a.name, d.b.name].map(n => (
          <label key={n} className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" checked={name === n} onChange={() => setName(n)} /> {n}</label>
        ))}
        <input className="input !py-2 text-sm" value={name} onChange={e => setName(e.target.value)} aria-label="Grafia a adotar" />
      </td>
      <td className="td text-right whitespace-nowrap space-y-1.5">
        <button className="btn-primary btn-sm w-full" disabled={!name.trim()} onClick={async () => { if (await run(() => api('/duplicates/merge', { method: 'POST', json: { keys: [d.a.key, d.b.key], name } }), 'Registros unificados.')) await onDone(); }}>É a mesma pessoa</button>
        <button className="btn-secondary btn-sm w-full" onClick={async () => { if (await run(() => api('/duplicates/dismiss', { method: 'POST', json: { keys: [d.a.key, d.b.key] } }))) await onDone(); }}>Não é</button>
      </td>
    </tr>
  );
}

export function StandardizeAdmin({ run, confirm, onChanged }: { run: RunFn; confirm: (m: string, label?: string) => Promise<boolean>; onChanged: () => void }) {
  const [data, setData] = useState<{ units: StdGroup[]; locations: StdGroup[] } | null>(null);
  const [dups, setDups] = useState<DupPair[]>([]);
  const [names, setNames] = useState<{ count: number; sample: { kind: string; from: string; to: string }[] } | null>(null);
  const load = useCallback(async () => {
    const r = await run(() => Promise.all([api<{ units: StdGroup[]; locations: StdGroup[] }>('/standardize'), api<{ count: number; sample: { kind: string; from: string; to: string }[] }>('/standardize/names')]));
    if (r) { setData(r[0]); setNames(r[1]); }
    const d = await run(() => api<DupPair[]>('/duplicates')); if (d) setDups(d);
  }, [run]);
  const fixNames = async () => {
    if (!names || !(await confirm(`Padronizar ${names.count} nome(s) em MAIÚSCULAS, sem tratamentos como "Dr." ou "Dra."? O nome original de cada magistrado fica guardado.`, 'Padronizar nomes'))) return;
    const r = await run(() => api('/standardize/names', { method: 'POST' }), 'Nomes padronizados.');
    if (r) { await load(); onChanged(); }
  };
  useEffect(() => { load(); }, []);
  const apply = async (kind: 'unit' | 'location', g: StdGroup, catalogId: string, note: string) => {
    const r = await run(() => api('/standardize/apply', { method: 'POST', json: { kind, ids: g.ids, catalogId, note } }), 'Nome padronizado.');
    if (r) { await load(); onChanged(); }
  };
  if (!data) return <div className="card p-8 text-sm text-muted">Carregando…</div>;
  const auto = [...data.units.filter(confident).map(g => ({ kind: 'unit' as const, g })), ...data.locations.filter(confident).map(g => ({ kind: 'location' as const, g }))];
  const applyAll = async () => {
    if (!(await confirm(`Aplicar as ${auto.length} sugestões de alta confiança? Recomenda-se exportar um backup antes (aba Backup). Unidades repetidas na mesma janela serão fundidas.`, 'Aplicar todas'))) return;
    const r = await run(() => api<{ units: number; locations: number; merged: number }>('/standardize/apply', { method: 'POST', json: { items: auto.map(a => ({ kind: a.kind, ids: a.g.ids, catalogId: a.g.suggestions[0].id })) } }));
    if (r) { await load(); onChanged(); }
  };
  const section = (title: string, kind: 'unit' | 'location', list: StdGroup[], empty: string) => (
    <div className="space-y-2">
      <h4 className="font-semibold text-navy">{title} <span className="text-muted font-normal">({list.length})</span></h4>
      <Table head={[kind === 'unit' ? 'Como está' : 'Lotação informada', 'Unidade oficial', '']}>
        {list.length === 0 && <EmptyRow cols={3}>{empty}</EmptyRow>}
        {list.map(g => <StdRow key={g.key} g={g} kind={kind} onApply={(id, note) => apply(kind, g, id, note)} />)}
      </Table>
    </div>
  );
  return (
    <div className="space-y-6">
      <Toolbar title="Padronizar nomes">
        {auto.length > 0 && <button className="btn-primary btn-sm" onClick={applyAll}><Check className="w-4 h-4" /> Aplicar sugestões de alta confiança ({auto.length})</button>}
      </Toolbar>
      <p className="text-sm text-muted -mt-2">
        Registros com unidade ou lotação fora da lista oficial do TJPR (digitados em "Outra", importados de planilha ou anteriores à lista).
        Ao aplicar, o nome oficial substitui o digitado e inscrições repetidas da mesma unidade numa janela são fundidas. Faça um backup antes de aplicações em lote.
      </p>
      <div className="card p-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h4 className="font-semibold text-navy">Nomes de magistrados em MAIÚSCULAS</h4>
          {names && names.count > 0 ? (
            <>
              <p className="text-sm text-muted mt-1">{names.count} registro(s) fora da grafia padrão. Exemplos:</p>
              <ul className="text-xs mt-2 space-y-0.5">{names.sample.slice(0, 6).map((n, i) => <li key={i}><span className="text-muted">{n.from}</span> → <strong className="text-ink">{n.to}</strong></li>)}</ul>
            </>
          ) : <p className="text-sm text-muted mt-1">Todos os nomes já estão padronizados. Novas inscrições já entram em MAIÚSCULAS.</p>}
        </div>
        {names && names.count > 0 && <button className="btn-primary btn-sm" onClick={fixNames}><Check className="w-4 h-4" /> Padronizar {names.count} nome(s)</button>}
      </div>
      <div className="space-y-2">
        <h4 className="font-semibold text-navy">Possíveis duplicidades de magistrados <span className="text-muted font-normal">({dups.length})</span></h4>
        <p className="text-sm text-muted">Nomes iguais (sem diferença de acento, caixa ou tratamento) já são tratados como a mesma pessoa. Aqui aparecem nomes <strong className="text-ink">parecidos</strong>, que precisam da sua confirmação.</p>
        <Table head={['Nomes', 'Grafia a adotar', '']}>
          {dups.length === 0 && <EmptyRow cols={3}>Nenhuma duplicidade provável.</EmptyRow>}
          {dups.map(d => <DupRow key={d.a.key + d.b.key} d={d} run={run} onDone={async () => { await load(); onChanged(); }} />)}
        </Table>
      </div>
      {section('Unidades', 'unit', data.units, 'Todas as unidades estão padronizadas.')}
      {section('Lotações de magistrados', 'location', data.locations, 'Todas as lotações estão padronizadas.')}
    </div>
  );
}
