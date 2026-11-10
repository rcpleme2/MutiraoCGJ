// Painel: unidades atendidas, presença no painel e oferta × demanda.
import React, { useEffect, useState } from 'react';
import { PanelRow } from '../types';
import { api } from '../api';
import { Badge, EmptyRow } from '../ui';
import { type PanelAdminData } from './panel';
import { collator, type Sub, unitLabel } from './shared';
import { SmartTable } from './table';

/** Aviso discreto: já há magistrado atuando na mesma unidade e/ou em outras unidades da mesma comarca (painel geral de vinculações). */
export type Presence = { comarca: string; inComarca: { name: string; unit: string }[]; inUnit: { name: string; unit: string }[] };

export function PresenceNote({ p }: { p: Presence }) {
  const list = (xs: { name: string; unit: string }[]) => xs.map(x => `${x.name} — ${x.unit}`).join('\n');
  return (
    <>
      {p.inUnit.length > 0 && (
        <span className="text-[11px] text-danger block" title={list(p.inUnit)}>◦ Já há atuação nesta unidade: {p.inUnit.map(x => x.name).join(', ')}</span>
      )}
      {p.inComarca.length > 0 && (
        <span className="text-[11px] text-bronze block" title={list(p.inComarca)}>◦ Já há atuação na comarca de {p.comarca}: {p.inComarca.length} {p.inComarca.length === 1 ? 'magistrado' : 'magistrados'} em {[...new Set(p.inComarca.map(x => x.unit))].length === 1 ? p.inComarca[0].unit : `${new Set(p.inComarca.map(x => x.unit)).size} unidades`}</span>
      )}
    </>
  );
}

/** Dashboard: unidades atendidas (escolhidas e com magistrado vinculado, de todas as edições), com os magistrados e filtro/separação por área. */
export function AttendedUnits({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<PanelRow[]>([]);
  const [area, setArea] = useState('');
  const [split, setSplit] = useState(false);
  useEffect(() => {
    api<PanelAdminData>('/panel/admin').then(d => setRows(d.rows)).catch(() => setRows([]));
  }, [refreshKey]);
  const areas = [...new Set(rows.map(r => r.area.trim()).filter(Boolean))].sort(collator.compare);
  const shown = rows.filter(r => !area || r.area.trim() === area);
  const groupUnits = (list: PanelRow[]) => {
    const m = new Map<string, { label: string; edition: string; rows: PanelRow[] }>();
    for (const r of list) {
      const g = m.get(r.unitId) ?? { label: unitLabel({ unitName: r.unit, comarca: r.comarca, separator: r.separator }), edition: r.editionTitle, rows: [] };
      g.rows.push(r); m.set(r.unitId, g);
    }
    return [...m.values()].sort((a, b) => collator.compare(a.label, b.label));
  };
  const renderTable = (list: PanelRow[]) => (
    <SmartTable id="atendidas" picker={false} rows={groupUnits(list)} rowKey={g => g.label + g.edition} empty="Nenhuma unidade atendida." defaultSort={{ key: 'unit', dir: 'asc' }} cols={[
      { id: 'unit', label: 'Unidade / Comarca', sort: g => g.label, tdClass: 'font-medium', render: g => g.label },
      { id: 'mags', label: 'Magistrados vinculados', sort: g => g.rows.length, render: g => (
        <ul className="space-y-0.5">{g.rows.map(r => <li key={r.id} className="text-sm">{r.name}{!area && !split && <span className="text-xs text-bronze"> · {r.area}</span>}</li>)}</ul>
      ) },
      { id: 'edition', label: 'Janela', sort: g => g.edition, tdClass: 'text-xs text-muted', render: g => [...new Set(g.rows.map(r => r.editionTitle))].join(', ') },
    ]} />
  );
  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-semibold text-navy">Unidades atendidas <span className="text-xs font-normal text-muted">({groupUnits(shown).length} {groupUnits(shown).length === 1 ? 'unidade' : 'unidades'} · todas as edições)</span></h4>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} /> Separar por área</label>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por área">
        {['', ...areas].map(a => (
          <button key={a || 'all'} type="button" aria-pressed={area === a} onClick={() => setArea(a)}
            className={`px-2.5 py-1 rounded-full border text-xs ${area === a ? 'bg-navy text-white border-navy' : 'border-line text-muted hover:text-ink'}`}>{a || 'Todas as áreas'}</button>
        ))}
      </div>
      {split
        ? (areas.filter(a => !area || a === area).map(a => (
          <div key={a}><h5 className="text-sm font-semibold text-bronze mb-2">{a}</h5>{renderTable(shown.filter(r => r.area.trim() === a))}</div>
        )))
        : renderTable(shown)}
    </div>
  );
}

/* ---------- Painel oferta × demanda ---------- */
export interface Dashboard {
  totals: { units: number; chosen: number; openSlots: number; available: number; matches: number; covered: number; missing: number; spare: number; pendingUnits: number };
  byArea: { area: string; units: number; openSlots: number; covered: number; missing: number; spare: number }[];
  byComarca: { comarca: string; pending: number; partial: number; attended: number }[];
  alerts: {
    ownPlace: { name: string; unit: string; kind: string }[];
    waitingLong: { name: string; days: number; area: string }[];
    unitsWithout: { unit: string; areas: string; since: string }[];
    toStandardize: { units: number; locations: number };
  };
}

export function SupplyDemand({ editionId, refreshKey, onGo }: { editionId: string; refreshKey: number; onGo: (s: Sub) => void }) {
  const [scope, setScope] = useState<'edition' | 'all'>('all');
  const [d, setD] = useState<Dashboard | null>(null);
  const [allComarcas, setAllComarcas] = useState(false);
  useEffect(() => {
    api<Dashboard>(`/dashboard?edition=${scope === 'all' ? 'all' : encodeURIComponent(editionId)}`).then(setD).catch(() => setD(null));
  }, [scope, editionId, refreshKey]);
  if (!d) return null;
  const a = d.alerts;
  const alertCard = (title: string, n: number, tone: 'danger' | 'warn' | 'neutral', children: React.ReactNode) => (
    <details className={`card p-4 ${n ? '' : 'opacity-70'}`}>
      <summary className="cursor-pointer flex items-center justify-between gap-3 text-sm font-medium text-navy">
        <span>{title}</span><Badge tone={n ? tone : 'neutral'}>{n}</Badge>
      </summary>
      <div className="mt-3 text-sm max-h-64 overflow-auto">{n ? children : <p className="text-muted">Nada a apontar.</p>}</div>
    </details>
  );
  const comarcaRows = allComarcas ? d.byComarca : d.byComarca.slice(0, 10);
  return (
    <div className="card p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-semibold text-navy">Oferta × demanda</h4>
        <div className={`flex gap-1.5 ${editionId === 'all' ? 'hidden' : ''}`} role="group" aria-label="Abrangência">
          {(['edition', 'all'] as const).map(s => (
            <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}
              className={`px-2.5 py-1 rounded-full border text-xs ${scope === s ? 'bg-navy text-white border-navy' : 'border-line text-muted hover:text-ink'}`}>{s === 'edition' ? 'Janela filtrada' : 'Todo o mutirão'}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {([
          ['Vagas abertas', d.totals.openSlots, 'juízes que as unidades escolhidas ainda precisam', 'text-navy'],
          ['Voluntários disponíveis', d.totals.available, 'aprovados, ainda sem designação', 'text-navy'],
          ['Faltam designar', d.totals.missing, 'vagas sem voluntário compatível (área e comarca)', d.totals.missing ? 'text-danger' : 'text-ok'],
          ['Sobram', d.totals.spare, 'voluntários sem vaga compatível', d.totals.spare ? 'text-warn' : 'text-muted'],
        ] as const).map(([l, v, hint, tone]) => (
          <div key={l} className="border border-line rounded-md p-3">
            <div className={`text-2xl font-serif font-semibold ${tone}`}>{v}</div>
            <div className="text-xs font-medium text-ink">{l}</div>
            <div className="text-[11px] text-muted leading-snug">{hint}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto border border-line rounded-md">
        <table className="w-full text-sm">
          <thead><tr><th className="th">Área de atuação</th><th className="th text-right">Vagas abertas</th><th className="th text-right">Cobertas por voluntários</th><th className="th text-right">Faltam juízes</th><th className="th text-right">Voluntários sobrando</th></tr></thead>
          <tbody className="divide-y divide-line">
            {d.byArea.length === 0 && <EmptyRow cols={5}>Nenhuma vaga aberta nas unidades escolhidas.</EmptyRow>}
            {d.byArea.map(r => (
              <tr key={r.area}>
                <td className="td font-medium">{r.area}<div className="text-[11px] text-muted font-normal">{r.units} unidade(s)</div></td>
                <td className="td text-right">{r.openSlots}</td>
                <td className="td text-right text-ok">{r.covered}</td>
                <td className={`td text-right font-semibold ${r.missing ? 'text-danger' : 'text-muted'}`}>{r.missing ? `${r.missing} a designar` : '—'}</td>
                <td className={`td text-right ${r.spare ? 'text-warn' : 'text-muted'}`}>{r.spare || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-2 text-[11px] text-muted border-t border-line">
          Cada vaga aberta é casada com um voluntário disponível que tenha a área entre a 1ª ou a 2ª preferência e atue em outra comarca; "Faltam" é o que sobra sem par. Unidades com mais de uma área aparecem juntas na mesma linha.
          {d.totals.pendingUnits > 0 && <> Há {d.totals.pendingUnits} unidade(s) ainda em análise, que não entram na conta até serem escolhidas.</>}
        </p>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="overflow-x-auto border border-line rounded-md">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Comarca</th><th className="th text-right">Sem magistrado</th><th className="th text-right">Parcial</th><th className="th text-right">Atendidas</th></tr></thead>
            <tbody className="divide-y divide-line">
              {comarcaRows.length === 0 && <EmptyRow cols={4}>Nenhuma unidade escolhida.</EmptyRow>}
              {comarcaRows.map(r => (
                <tr key={r.comarca}><td className="td">{r.comarca}</td><td className={`td text-right ${r.pending ? 'text-danger font-semibold' : 'text-muted'}`}>{r.pending}</td><td className="td text-right">{r.partial}</td><td className="td text-right text-ok">{r.attended}</td></tr>
              ))}
            </tbody>
          </table>
          {d.byComarca.length > 10 && <button className="w-full py-2 text-xs text-bronze hover:underline border-t border-line" onClick={() => setAllComarcas(!allComarcas)}>{allComarcas ? 'Mostrar só as 10 primeiras' : `Mostrar todas as ${d.byComarca.length} comarcas`}</button>}
        </div>
        <div className="space-y-2">
          {alertCard('Designados na própria vara/comarca de lotação', a.ownPlace.length, 'danger',
            <ul className="space-y-1">{a.ownPlace.map((x, i) => <li key={i}><strong>{x.name}</strong> → {x.unit} <span className="text-danger text-xs">({x.kind})</span></li>)}</ul>)}
          {alertCard('Unidades escolhidas sem magistrado', a.unitsWithout.length, 'warn',
            <ul className="space-y-1">{a.unitsWithout.map((x, i) => <li key={i}>{x.unit} <span className="text-xs text-muted">· {x.areas}</span></li>)}</ul>)}
          {alertCard('Aprovados sem designação há mais de 15 dias', a.waitingLong.length, 'warn',
            <ul className="space-y-1">{a.waitingLong.map((x, i) => <li key={i}><strong>{x.name}</strong> <span className="text-xs text-muted">· {x.area} · {x.days} dias</span></li>)}</ul>)}
          {alertCard('Registros a padronizar (fora da lista oficial)', a.toStandardize.units + a.toStandardize.locations, 'neutral',
            <div className="space-y-2"><p>{a.toStandardize.units} unidade(s) e {a.toStandardize.locations} lotação(ões) de magistrados.</p>
              <button className="btn-secondary btn-sm" onClick={() => onGo('standardize')}>Abrir "Padronizar nomes"</button></div>)}
        </div>
      </div>
    </div>
  );
}
