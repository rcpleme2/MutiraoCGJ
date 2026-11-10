// Tabela com ordenação, filtros por coluna e escolha de colunas (SmartTable) e componentes de cabeçalho.
import { ArrowUp, ArrowDown, ArrowUpDown, Filter } from 'lucide-react';
import React, { useState } from 'react';
import { EmptyRow } from '../ui';
import { collator, readPref, writePref } from './shared';

export type SortDir = 'asc' | 'desc';

/** Data e hora da inscrição em duas linhas (a hora com segundos ajuda a desempatar). */
export function DateCell({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <div className="whitespace-nowrap">
      <div className="text-sm">{d.toLocaleDateString('pt-BR')}</div>
      <div className="text-xs text-muted">{d.toLocaleTimeString('pt-BR')}</div>
    </div>
  );
}

/** Cabeçalho de coluna clicável; a seta só aparece (em destaque) na coluna que ordena a tabela. */
export function ColSort({ label, active, dir, onToggle }: { label: string; active: boolean; dir: SortDir; onToggle: () => void }) {
  const Icon = !active ? ArrowUpDown : dir === 'desc' ? ArrowDown : ArrowUp;
  return (
    <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink"
      aria-label={`Ordenar por ${label}${active ? (dir === 'asc' ? ' (crescente)' : ' (decrescente)') : ''}`}>
      {label} <Icon className={`w-3.5 h-3.5 ${active ? 'text-bronze' : 'text-muted'}`} />
    </button>
  );
}

/* ---------- Tabela com ordenação pelos cabeçalhos e escolha de colunas (preferências guardadas no navegador) ---------- */
export interface Col<T> {
  id: string;
  label: string;
  render: (x: T) => React.ReactNode;
  /** valor usado na ordenação (sem ele, a coluna não ordena) */
  sort?: (x: T) => string | number;
  /** valores usados no filtro do cabeçalho (sem ele, a coluna não filtra) */
  filter?: (x: T) => string | string[];
  /** pode ser ocultada pelo usuário; `hidden` = começa oculta */
  optional?: boolean;
  hidden?: boolean;
  align?: 'right';
  tdClass?: string;
}

export const countValues = (vals: string[]) => {
  const m = new Map<string, number>();
  vals.forEach(v => m.set(v, (m.get(v) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => collator.compare(a[0], b[0]));
};

/** Filtro do cabeçalho: escolher um ou mais valores a exibir */
export function ColFilter({ label, options, selected, onChange, open, onOpen }: {
  label: string; options: [string, number][]; selected: string[]; onChange: (v: string[]) => void; open: boolean; onOpen: (o: boolean) => void;
}) {
  const [q, setQ] = useState('');
  const on = selected.length > 0;
  const list = options.filter(([v]) => !q || v.toLowerCase().includes(q.toLowerCase()));
  return (
    <span className="relative inline-block font-normal normal-case tracking-normal">
      <button type="button" aria-label={`Filtrar ${label}`} aria-expanded={open} title={`Filtrar ${label}`} onClick={() => { setQ(''); onOpen(!open); }}
        className={`p-0.5 rounded ${on ? 'text-bronze bg-bronze-soft' : 'text-muted/70 hover:text-ink'}`}>
        <Filter className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-20" onClick={() => onOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-30 w-64 card shadow-lg p-3 space-y-2 text-sm text-ink text-left">
            {options.length > 8 && <input className="input !py-1.5 text-xs" placeholder="Buscar…" value={q} onChange={e => setQ(e.target.value)} autoFocus />}
            <div className="max-h-56 overflow-auto space-y-1.5">
              {list.length === 0 && <p className="text-xs text-muted">Nenhum valor.</p>}
              {list.map(([v, n]) => (
                <label key={v} className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={selected.includes(v)} onChange={() => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])} />
                  <span className="flex-1 min-w-0 break-words">{v}</span><span className="text-xs text-muted">{n}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-between text-xs pt-1 border-t border-line">
              <button className="text-bronze hover:underline" onClick={() => onChange(options.map(o => o[0]))}>Marcar todos</button>
              <button className="text-bronze hover:underline" onClick={() => onChange([])}>Limpar</button>
            </div>
          </div>
        </>
      )}
    </span>
  );
}

export function SmartTable<T>({ id, cols, rows, rowKey, empty, defaultSort, rowClass, after, picker = true, bare = false }: {
  id: string; cols: Col<T>[]; rows: T[]; rowKey: (x: T) => string; empty: React.ReactNode;
  defaultSort?: { key: string; dir: SortDir }; rowClass?: (x: T) => string;
  /** linha extra logo abaixo de cada linha (ex.: detalhes expandidos), recebe o número de colunas visíveis */
  after?: (x: T, colSpan: number) => React.ReactNode;
  picker?: boolean;
  /** sem moldura própria (para usar dentro de outro cartão) */
  bare?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>(() => readPref(`mutirao-sort-${id}`, defaultSort ?? { key: '', dir: 'asc' }));
  const [hidden, setHidden] = useState<Record<string, boolean>>(() => readPref(`mutirao-cols-${id}`, Object.fromEntries(cols.filter(c => c.hidden).map(c => [c.id, true]))));
  const visible = cols.filter(c => !(c.optional && hidden[c.id]));
  const toggleSort = (key: string) => setSort(prev => { const next = { key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' as SortDir : 'asc' as SortDir }; writePref(`mutirao-sort-${id}`, next); return next; });
  const toggleCol = (cid: string) => setHidden(prev => { const next = { ...prev, [cid]: !prev[cid] }; writePref(`mutirao-cols-${id}`, next); return next; });
  const sortCol = cols.find(c => c.id === sort.key && c.sort);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [openFilter, setOpenFilter] = useState('');
  const valuesOf = (c: Col<T>, x: T) => { const v = c.filter!(x); return (Array.isArray(v) ? v : [v]).map(t => t || '—'); };
  const active = cols.filter(c => c.filter && (filters[c.id]?.length ?? 0) > 0);
  const shown = active.length ? rows.filter(x => active.every(c => valuesOf(c, x).some(v => filters[c.id].includes(v)))) : rows;
  const sorted = sortCol ? [...shown].sort((a, b) => {
    const va = sortCol.sort!(a), vb = sortCol.sort!(b);
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(String(va ?? ''), String(vb ?? ''));
    return sort.dir === 'asc' ? cmp : -cmp;
  }) : shown;
  const optional = cols.filter(c => c.optional);
  return (
    <div className={bare ? '' : 'space-y-2'}>
      {picker && optional.length > 0 && (
        <div className={`flex justify-end ${bare ? 'px-3 pt-2' : ''}`}>
          <details className="relative">
            <summary className="list-none cursor-pointer btn-ghost btn-sm text-xs">Colunas ({visible.length}/{cols.length})</summary>
            <div className="absolute right-0 z-20 mt-1 w-56 card shadow-lg p-3 space-y-1.5">
              {optional.map(c => (
                <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={!hidden[c.id]} onChange={() => toggleCol(c.id)} /> {c.label}
                </label>
              ))}
            </div>
          </details>
        </div>
      )}
      {active.length > 0 && (
        <div className={`flex flex-wrap items-center gap-2 text-xs text-muted ${bare ? 'px-3 pt-2' : ''}`}>
          <span>Filtrando por {active.map(c => c.label).join(', ')} — {shown.length} de {rows.length}</span>
          <button className="text-bronze hover:underline" onClick={() => setFilters({})}>Limpar filtros</button>
        </div>
      )}
      <div className={bare ? '' : 'card overflow-hidden'}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>{visible.map(c => (
              <th key={c.id} className={`th ${c.align === 'right' ? 'text-right' : ''}`} aria-sort={sort.key === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                <span className="inline-flex items-center gap-1">
                  {c.sort ? <ColSort label={c.label} active={sort.key === c.id} dir={sort.dir} onToggle={() => toggleSort(c.id)} /> : c.label}
                  {c.filter && (
                    <ColFilter label={c.label} open={openFilter === c.id} onOpen={o => setOpenFilter(o ? c.id : '')}
                      options={countValues(rows.flatMap(x => valuesOf(c, x)))} selected={filters[c.id] ?? []}
                      onChange={v => setFilters(f => ({ ...f, [c.id]: v }))} />
                  )}
                </span>
              </th>
            ))}</tr></thead>
            <tbody className="divide-y divide-line">
              {sorted.length === 0 && <EmptyRow cols={visible.length}>{empty}</EmptyRow>}
              {sorted.map(x => (
                <React.Fragment key={rowKey(x)}>
                  <tr className={rowClass?.(x) ?? ''}>{visible.map(c => <td key={c.id} className={`td ${c.align === 'right' ? 'text-right' : ''} ${c.tdClass ?? ''}`}>{c.render(x)}</td>)}</tr>
                  {after?.(x, visible.length)}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function Table({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>{head.map((h, i) => <th key={i} className={`th ${h === 'Ações' ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function Toolbar({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h3 className="text-lg font-semibold text-navy">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
