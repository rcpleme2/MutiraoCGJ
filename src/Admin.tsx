import React, { useCallback, useEffect, useState } from 'react';
import { Lock, Unlock, Plus, Trash2, Check, Pencil, Download, Sparkles, LogOut, Radio, Archive, RotateCcw, ChevronDown, ChevronRight, X, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { api, download, getToken, setToken } from './api';
import { Edition, FaqItem, LogEntry, Magistrate, Match, PanelRow, Transfer, Unit, Withdrawal, WorkType, WORK_TYPES } from './types';
import { COMARCAS, canonicalComarca, catalogById, fullUnitName, unitsOfComarca } from './catalogo-tjpr';
import { Badge, EmptyRow, Field, Modal, Notice, formatDate, formatDateTime, magistrateTone, useFeedback } from './ui';
import { MagistrateForm, UnitForm } from './Forms';

type Sub = 'overview' | 'editions' | 'magistrates' | 'units' | 'matches' | 'waiting' | 'panel' | 'faq' | 'log' | 'backup' | 'standardize';

const SUBS: { id: Sub; label: string }[] = [
  { id: 'overview', label: 'Painel' },
  { id: 'editions', label: 'Edições' },
  { id: 'magistrates', label: 'Magistrados' },
  { id: 'units', label: 'Unidades' },
  { id: 'matches', label: 'Vinculações' },
  { id: 'waiting', label: 'Lista de espera' },
  { id: 'panel', label: 'Painel de vinculações' },
  { id: 'standardize', label: 'Padronizar nomes' },
  { id: 'faq', label: 'Perguntas frequentes' },
  { id: 'log', label: 'Registro' },
  { id: 'backup', label: 'Backup' },
];

const toLocalInput = (iso: string) => iso.slice(0, 16);

type SortDir = 'asc' | 'desc';

/** Cabeçalho de coluna clicável que alterna entre mais recentes e mais antigas primeiro. */
function SortHeader({ label, dir, onToggle }: { label: string; dir: SortDir; onToggle: () => void }) {
  const Icon = dir === 'desc' ? ArrowDown : ArrowUp;
  return (
    <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink"
      title={dir === 'desc' ? 'Mais recentes primeiro (clique para inverter)' : 'Mais antigas primeiro (clique para inverter)'}
      aria-label={`${label}: ${dir === 'desc' ? 'mais recentes primeiro' : 'mais antigas primeiro'}. Clique para inverter`}>
      {label} <Icon className="w-3.5 h-3.5 text-bronze" />
    </button>
  );
}

/** Data e hora da inscrição em duas linhas (a hora com segundos ajuda a desempatar). */
function DateCell({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <div className="whitespace-nowrap">
      <div className="text-sm">{d.toLocaleDateString('pt-BR')}</div>
      <div className="text-xs text-muted">{d.toLocaleTimeString('pt-BR')}</div>
    </div>
  );
}

const byDate = <T extends { createdAt: string; id: string }>(dir: SortDir) => (a: T, b: T) =>
  (dir === 'asc' ? 1 : -1) * (a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

/** "Nome da unidade" + separador + "comarca" (ex.: 1ª VARA CÍVEL DE CURITIBA), sem repetir a comarca. */
const unitLabel = (u: { unitName: string; comarca?: string; separator?: string }) => fullUnitName(u);

type UnitSortKey = 'date' | 'name' | 'selection';
const SELECTION_ORDER: Record<string, number> = { 'Em análise': 0, 'Escolhida': 1, 'Rejeitada': 2 };
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

/** Cabeçalho de coluna clicável; a seta só aparece (em destaque) na coluna que ordena a tabela. */
function ColSort({ label, active, dir, onToggle }: { label: string; active: boolean; dir: SortDir; onToggle: () => void }) {
  const Icon = !active ? ArrowUpDown : dir === 'desc' ? ArrowDown : ArrowUp;
  return (
    <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink"
      aria-label={`Ordenar por ${label}${active ? (dir === 'asc' ? ' (crescente)' : ' (decrescente)') : ''}`}>
      {label} <Icon className={`w-3.5 h-3.5 ${active ? 'text-bronze' : 'text-muted'}`} />
    </button>
  );
}

/** Aviso discreto: já há magistrado atuando na comarca e/ou na vara no painel geral de vinculações. */
function PresenceNote({ p }: { p: { comarca: string[]; unit: string[] } }) {
  const parts = [p.unit.length ? 'vara' : '', p.comarca.length ? 'comarca' : ''].filter(Boolean);
  const names = [...new Set([...p.unit, ...p.comarca])];
  return (
    <span className="text-[11px] text-bronze block" title={`Painel geral de vinculações: ${names.join(', ')}`}>
      ◦ Já há atuação {parts.length === 2 ? 'na vara e na comarca' : parts[0] === 'vara' ? 'nesta vara' : 'nesta comarca'} ({names.length})
    </span>
  );
}

/** Dashboard: unidades atendidas (escolhidas e com magistrado vinculado, de todas as edições), com os magistrados e filtro/separação por área. */
function AttendedUnits({ refreshKey }: { refreshKey: number }) {
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
    <Table head={['Unidade / Comarca', 'Magistrados vinculados', 'Edição']}>
      {list.length === 0 && <EmptyRow cols={3}>Nenhuma unidade atendida.</EmptyRow>}
      {groupUnits(list).map(g => (
        <tr key={g.label + g.edition}>
          <td className="td font-medium">{g.label}</td>
          <td className="td">
            <ul className="space-y-0.5">
              {g.rows.map(r => <li key={r.id} className="text-sm">{r.name}{!area && !split && <span className="text-xs text-bronze"> · {r.area}</span>}</li>)}
            </ul>
          </td>
          <td className="td text-xs text-muted">{[...new Set(g.rows.map(r => r.editionTitle))].join(', ')}</td>
        </tr>
      ))}
    </Table>
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

function Table({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
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

/** Filtro de edição das listas: mostra apenas os registros da edição escolhida (a mesma "edição em gestão" do topo). */
function EditionFilter({ editions, value, onChange, what }: { editions: Edition[]; value: string; onChange: (id: string) => void; what: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <label className="text-xs font-medium text-muted tracking-wide" htmlFor={`ed-filter-${what}`}>Edição</label>
      <select id={`ed-filter-${what}`} className="input max-w-sm" value={value} onChange={e => onChange(e.target.value)}>
        <option value="all">Todas as edições — {editions.reduce((n, e) => n + (what === 'magistrados' ? e.stats?.magistrates ?? 0 : e.stats?.units ?? 0), 0)} {what}</option>
        {editions.map(e => <option key={e.id} value={e.id}>{e.title}{e.isActive ? ' (vigente)' : ''} — {what === 'magistrados' ? e.stats?.magistrates ?? 0 : e.stats?.units ?? 0} {what}</option>)}
      </select>
      <span className="text-xs text-muted">{value === 'all' ? `Exibindo os ${what} de todas as edições (somente consulta e edição de registros).` : `Exibindo apenas os ${what} desta edição.`}</span>
    </div>
  );
}

function Toolbar({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h3 className="text-lg font-semibold text-navy">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/* ---------- Formulário de edição ---------- */
function EditionForm({ initial, onSubmit }: { initial?: Edition; onSubmit: (v: any) => Promise<void> }) {
  const [f, setF] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    openingDate: initial ? toLocalInput(initial.openingDate) : '',
    closingDate: initial ? toLocalInput(initial.closingDate) : '',
    isRegistrationOpen: initial?.isRegistrationOpen ?? true,
    activate: !initial,
  });
  return (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); onSubmit(f); }}>
      <Field label="Título da edição">
        <input required className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Ex.: Mutirão de Julgamento TJPR - 2ª Edição 2026" />
      </Field>
      <Field label="Descrição">
        <textarea rows={3} className="input" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
      </Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Abertura (horário de Brasília)"><input required type="datetime-local" className="input" value={f.openingDate} onChange={e => setF({ ...f, openingDate: e.target.value })} /></Field>
        <Field label="Encerramento (horário de Brasília)"><input required type="datetime-local" className="input" value={f.closingDate} onChange={e => setF({ ...f, closingDate: e.target.value })} /></Field>
      </div>
      {initial ? (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isRegistrationOpen} onChange={e => setF({ ...f, isRegistrationOpen: e.target.checked })} /> Inscrições públicas habilitadas <span className="text-muted">(as datas acima também precisam estar vigentes)</span></label>
      ) : (
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.activate} onChange={e => setF({ ...f, activate: e.target.checked })} />
          <span>Tornar esta a edição vigente <span className="text-muted">(as inscrições públicas passam a ser registradas nela)</span></span></label>
      )}
      <button className="btn-primary w-full">{initial ? 'Salvar alterações' : 'Criar edição'}</button>
    </form>
  );
}

/* ---------- Regras de elegibilidade e modalidade da vinculação ---------- */
interface Eligible { m: Magistrate; area: string; rank: 0 | 1 | 2 }

/**
 * Magistrados que podem ser vinculados à unidade, separados em "mesma área" (1ª/2ª preferência) e "outras áreas".
 * `current` é a vinculação em edição (o magistrado dela continua na lista); quem está vinculado em qualquer
 * outro lugar, inclusive nesta mesma unidade, não é oferecido.
 */
function eligibleFor(unit: Unit, magistrates: Magistrate[], matches: Match[], current?: Match) {
  const taken = new Set(matches.filter(x => x.id !== current?.id).map(x => x.magistrateId));
  const list: Eligible[] = magistrates
    .filter(m => m.editionId === unit.editionId && m.status !== 'Rejeitado' && m.status !== 'Desistente' && !taken.has(m.id)
      && (m.status !== 'Aguardando Conferência' || m.id === current?.magistrateId))
    .map(m => {
      const first = unit.areas.includes(m.firstPreference);
      const second = !first && !!m.secondPreference && unit.areas.includes(m.secondPreference);
      return { m, area: first ? m.firstPreference : second ? m.secondPreference : unit.areas[0], rank: (first ? 1 : second ? 2 : 0) as 0 | 1 | 2 };
    })
    .sort((x, y) => (x.rank || 3) - (y.rank || 3) || x.m.name.localeCompare(y.m.name));
  return { same: list.filter(e => e.rank > 0), other: list.filter(e => e.rank === 0) };
}

/** Mesma regra do servidor: o que o magistrado fará, dado o auxílio pedido e a disposição para audiências. */
const defaultWorkType = (unit: Unit, mag: Magistrate): WorkType =>
  unit.supportNeeded === 'Audiência' || unit.supportNeeded === 'Sentença'
    ? unit.supportNeeded
    : mag.acceptsHearings ? 'Audiência' : 'Sentença'; // unidade pediu os dois: audiências só se o magistrado aceita

const workTypeTone = (w: WorkType) => (w === 'Sentença' ? 'neutral' : w === 'Audiência' ? 'info' : 'ok') as 'neutral' | 'info' | 'ok';
const unitMatchesOf = (unit: Unit, matches: Match[]) =>
  matches.filter(m => m.unitId === unit.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

function WorkTypeSelect({ value, onChange }: { value: WorkType; onChange: (v: WorkType) => void }) {
  return (
    <select className="input !py-2 text-sm" value={value} onChange={e => onChange(e.target.value as WorkType)} aria-label="Atuação do magistrado">
      {value === 'Audiência e Sentença' && <option value={value}>Audiência e sentença (antigo)</option>}
      {WORK_TYPES.map(w => <option key={w} value={w}>{w === 'Audiência' ? 'Para audiências' : 'Para sentença'}</option>)}
    </select>
  );
}

function WorkTypeWarnings({ unit, mag, workType }: { unit: Unit; mag?: Magistrate; workType: WorkType }) {
  const hearings = workType !== 'Sentença';
  return (
    <>
      {mag && hearings && !mag.acceptsHearings && <p className="text-[11px] text-warn mt-1.5">Este magistrado informou que não aceita realizar audiências.</p>}
      {workType !== unit.supportNeeded && <p className="text-[11px] text-muted mt-1.5">A unidade pediu auxílio para <strong>{unit.supportNeeded.toLowerCase()}</strong>; esta vinculação cobre {workType.toLowerCase()}.</p>}
    </>
  );
}

/** Quantos magistrados serão alocados na unidade (vagas). Reduzir abaixo do número de vinculados é recusado pelo servidor. */
function SlotsControl({ unit, linked, onChange, compact, bare }: { unit: Unit; linked: number; onChange: (n: number) => void; compact?: boolean; bare?: boolean }) {
  const select = (
    <select className="input !w-auto !py-1 !px-2 text-sm" value={unit.slots} onChange={e => onChange(Number(e.target.value))}
      aria-label={`Magistrados a alocar na unidade ${unit.unitName}`}>
      {Array.from({ length: 20 }, (_, i) => i + 1).map(n => <option key={n} value={n} disabled={n < linked}>{n}</option>)}
    </select>
  );
  // Na tabela (coluna já intitulada "Magistrados") só o seletor e a contagem, para economizar espaço
  if (bare) return <div className="flex items-center gap-2 whitespace-nowrap">{select}<span className="text-[11px] text-muted">{linked} vinculado{linked === 1 ? '' : 's'}</span></div>;
  return (
    <label className={`inline-flex items-center gap-2 ${compact ? 'text-xs' : 'text-sm'} text-muted`}>
      <span>Magistrados a alocar</span>
      {select}
      <span className="text-[11px]">({linked} vinculado{linked === 1 ? '' : 's'})</span>
    </label>
  );
}

/* ---------- Detalhe da unidade (aba Unidades): justificativa e vinculação por área ---------- */
function UnitDetail({ unit, magistrates, matches, busy, onLink, onUnlink }: {
  unit: Unit;
  magistrates: Magistrate[];
  matches: Match[];
  busy: boolean;
  onLink: (magistrateId: string, area: string, workType: WorkType) => void;
  onUnlink: (matchId: string) => void;
}) {
  const [picked, setPicked] = useState('');
  const [workType, setWorkType] = useState<WorkType | ''>('');
  const linked = unitMatchesOf(unit, matches);
  const open = linked.length < unit.slots;
  const candidates = eligibleFor(unit, magistrates, matches).same;
  const chosen = candidates.find(c => c.m.id === picked);
  const effective: WorkType = workType || (chosen ? defaultWorkType(unit, chosen.m) : unit.supportNeeded);

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2">Justificativa apresentada</div>
        {unit.description.trim()
          ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{unit.description}</p>
          : <p className="text-sm text-muted italic">Nenhuma justificativa informada.</p>}
        <div className="text-xs text-muted mt-3">Auxílio solicitado: <span className="text-ink">{unit.supportNeeded}</span> · Responsável: <span className="text-ink">{unit.judgeName}</span></div>
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2">Magistrados da unidade ({linked.length} de {unit.slots})</div>
        {unit.selection !== 'Escolhida' ? (
          <p className="text-sm text-muted">Escolha a unidade para o mutirão antes de vincular um magistrado.</p>
        ) : (
          <div className="space-y-2">
            {linked.map(match => {
              const mag = magistrates.find(m => m.id === match.magistrateId);
              return (
                <div key={match.id} className="flex items-center justify-between gap-3 bg-ok-soft text-ok rounded-md px-3 py-2.5 text-sm">
                  <span><strong>{mag?.name || 'magistrado removido'}</strong> · {match.assignedArea} · <strong>{match.workType}</strong></span>
                  <button className="btn-secondary btn-sm shrink-0" disabled={busy} onClick={() => onUnlink(match.id)}>Desfazer</button>
                </div>
              );
            })}
            {open && candidates.length === 0 && (
              <p className="text-sm text-muted">Nenhum magistrado aprovado e disponível com preferência nas áreas desta unidade ({unit.areas.join(', ')}).</p>
            )}
            {open && candidates.map(({ m, area, rank }) => (
              <label key={m.id} className={`flex items-start gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors ${picked === m.id ? 'border-navy bg-navy/5' : 'border-line bg-surface hover:border-slate-300'}`}>
                <input type="checkbox" className="mt-1" checked={picked === m.id} onChange={() => { setPicked(picked === m.id ? '' : m.id); setWorkType(''); }} />
                <span className="text-sm min-w-0">
                  <span className="font-medium">{m.name}</span>
                  <span className="block text-xs text-muted">{m.currentLocation}</span>
                  <span className="flex flex-wrap gap-1.5 mt-1.5">
                    <Badge tone="info">{rank}ª preferência: {area}</Badge>
                    <Badge tone={m.acceptsHearings ? 'ok' : 'neutral'}>{m.acceptsHearings ? 'Aceita audiências' : 'Não aceita audiências'}</Badge>
                  </span>
                </span>
              </label>
            ))}
            {open && chosen && (
              <div className="rounded-md bg-surface border border-line p-3">
                <div className="label">O magistrado atuará em</div>
                <WorkTypeSelect value={effective} onChange={setWorkType} />
                <WorkTypeWarnings unit={unit} mag={chosen.m} workType={effective} />
              </div>
            )}
            {open && candidates.length > 0 && (
              <button className="btn-primary btn-sm" disabled={!chosen || busy} onClick={() => chosen && onLink(chosen.m.id, chosen.area, effective)}>
                <Check className="w-4 h-4" /> Vincular selecionado
              </button>
            )}
            {!open && <p className="text-xs text-muted">Todas as vagas estão preenchidas. Aumente o número de magistrados a alocar para vincular mais.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

type SaveLink = (unit: Unit, magistrateId: string, area: string, workType: WorkType, match?: Match) => void;

/* ---------- Uma vaga da unidade: magistrado vinculado ou a vincular ---------- */
function LinkSlot({ unit, magistrates, matches, match, busy, onSave, onUnlink }: {
  unit: Unit;
  magistrates: Magistrate[];
  matches: Match[];
  match?: Match;
  busy: boolean;
  onSave: SaveLink;
  onUnlink: (matchId: string) => void;
}) {
  const { same, other } = eligibleFor(unit, magistrates, matches, match);
  const all = [...same, ...other];
  const [magId, setMagId] = useState(match?.magistrateId ?? '');
  const [workType, setWorkType] = useState<WorkType | ''>(match?.workType ?? '');

  const sel = all.find(e => e.m.id === magId);
  const effective: WorkType | '' = workType || (sel ? defaultWorkType(unit, sel.m) : '');
  const changed = !!sel && (!match || match.magistrateId !== magId || match.workType !== effective);

  const label = (e: Eligible) =>
    `${e.m.name}${e.rank ? ` — ${e.rank}ª preferência` : ''}${e.m.acceptsHearings ? '' : ' — não aceita audiências'}`;

  return (
    <div>
      <div className="grid md:grid-cols-[1.4fr_1fr_auto] gap-3 items-start">
        <div>
          <label className="label">Magistrado</label>
          <select className="input" value={magId} onChange={e => { setMagId(e.target.value); setWorkType(''); }}>
            <option value="">{all.length ? 'Selecione um magistrado…' : 'Nenhum magistrado disponível'}</option>
            {same.length > 0 && (
              <optgroup label="Mesma área (preferência do magistrado)">
                {same.map(e => <option key={e.m.id} value={e.m.id}>{label(e)}</option>)}
              </optgroup>
            )}
            {other.length > 0 && (
              <optgroup label="Outras áreas">
                {other.map(e => <option key={e.m.id} value={e.m.id}>{label(e)}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <div>
          <label className="label">Atuação na unidade</label>
          <WorkTypeSelect value={(effective || unit.supportNeeded) as WorkType} onChange={setWorkType} />
        </div>
        <div className="flex flex-wrap items-end gap-2 md:pt-[1.55rem]">
          <button className="btn-primary btn-sm" disabled={!changed || busy}
            onClick={() => sel && effective && onSave(unit, sel.m.id, sel.area, effective, match)}>
            <Check className="w-4 h-4" /> {match ? 'Salvar' : 'Vincular'}
          </button>
          {match && <button className="btn-secondary btn-sm" disabled={busy} onClick={() => onUnlink(match.id)}>Desfazer</button>}
        </div>
      </div>
      {sel && effective && <WorkTypeWarnings unit={unit} mag={sel.m} workType={effective} />}
      {sel && sel.rank === 0 && <p className="text-[11px] text-warn mt-1.5">Área fora das preferências do magistrado; será registrada como {sel.area}.</p>}
    </div>
  );
}

/* ---------- Linha da aba Vinculações: uma unidade escolhida e suas vagas ---------- */
function UnitLinkRow({ unit, magistrates, matches, busy, onSave, onUnlink, onSlots }: {
  unit: Unit;
  magistrates: Magistrate[];
  matches: Match[];
  busy: boolean;
  onSave: SaveLink;
  onUnlink: (matchId: string) => void;
  onSlots: (n: number) => void;
}) {
  const linked = unitMatchesOf(unit, matches);
  const emptySlots = Math.max(0, unit.slots - linked.length);
  const [showWhy, setShowWhy] = useState(false);
  const full = linked.length >= unit.slots;

  return (
    <div className={`card p-4 sm:p-5 ${full ? 'border-ok/30' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-serif font-semibold text-navy leading-snug">{unitLabel(unit)}</div>
          <div className="text-xs text-muted mt-0.5">{unit.judgeName}</div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {unit.areas.map(a => <Badge key={a} tone="info">{a}</Badge>)}
            <Badge tone={workTypeTone(unit.supportNeeded)}>Precisa de: {unit.supportNeeded}</Badge>
          </div>
          {unit.description.trim() && (
            <div className="mt-2.5">
              <button className="text-xs text-bronze hover:underline" onClick={() => setShowWhy(!showWhy)}>{showWhy ? 'Ocultar justificativa' : 'Ver justificativa'}</button>
              {showWhy && <p className="text-sm leading-relaxed whitespace-pre-wrap mt-1.5 text-ink">{unit.description}</p>}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <Badge tone={full ? 'ok' : linked.length ? 'info' : 'warn'}>
            {linked.length === 0 ? 'Sem magistrado' : full ? `Vinculada (${linked.length} de ${unit.slots})` : `Em andamento (${linked.length} de ${unit.slots})`}
          </Badge>
          <SlotsControl compact unit={unit} linked={linked.length} onChange={onSlots} />
        </div>
      </div>

      <div className="mt-4 space-y-4 border-t border-line pt-4">
        {linked.map(m => (
          <LinkSlot key={`${m.id}-${m.magistrateId}-${m.workType}`} unit={unit} magistrates={magistrates} matches={matches} match={m}
            busy={busy} onSave={onSave} onUnlink={onUnlink} />
        ))}
        {Array.from({ length: emptySlots }, (_, i) => (
          <LinkSlot key={`empty-${i}`} unit={unit} magistrates={magistrates} matches={matches} busy={busy} onSave={onSave} onUnlink={onUnlink} />
        ))}
      </div>
    </div>
  );
}

/* ---------- Formulário de pergunta frequente ---------- */
function FaqForm({ initial, onSubmit }: { initial?: FaqItem; onSubmit: (v: { question: string; answer: string; published: boolean }) => Promise<void> }) {
  const [f, setF] = useState({ question: initial?.question ?? '', answer: initial?.answer ?? '', published: initial?.published ?? true });
  return (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); onSubmit(f); }}>
      <Field label="Pergunta">
        <input required maxLength={300} className="input" value={f.question} onChange={e => setF({ ...f, question: e.target.value })} />
      </Field>
      <Field label="Resposta">
        <textarea required rows={7} maxLength={4000} className="input" value={f.answer} onChange={e => setF({ ...f, answer: e.target.value })} />
        <p className="text-[11px] text-muted mt-1">Texto simples; as quebras de linha são preservadas. {f.answer.length}/4000</p>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.published} onChange={e => setF({ ...f, published: e.target.checked })} />
        Publicada (visível na página pública)
      </label>
      <button className="btn-primary w-full">{initial ? 'Salvar alterações' : 'Adicionar pergunta'}</button>
    </form>
  );
}

/* ---------- Painel de vinculações (restrito): tabela única, desistências e relatório em PDF ---------- */
type RunFn = <T,>(fn: () => Promise<T>, okMessage?: string) => Promise<T | undefined>;
interface PanelAdminData { rows: PanelRow[]; withdrawals: Withdrawal[]; transfers: Transfer[]; initialEdition: { id: string; title: string } }
interface PanelPreview { total: number; duplicates: number; errorCount: number; errors: { line: number; message: string }[]; preview: { name: string; area: string; unit: string }[] }

function PanelAdmin({ run, confirm, onChanged }: {
  run: RunFn; confirm: (m: string, label?: string) => Promise<boolean>; onChanged: () => void;
}) {
  const [data, setData] = useState<PanelAdminData | null>(null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<PanelPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState<string[]>([]);
  const [dropping, setDropping] = useState<PanelRow | null>(null);
  const [editingWd, setEditingWd] = useState<Withdrawal | null>(null);
  const [moving, setMoving] = useState<{ row: PanelRow; units: Unit[] } | null>(null);
  const [moveUnit, setMoveUnit] = useState('');
  const [moveNewName, setMoveNewName] = useState('');
  const [moveDate, setMoveDate] = useState('');
  const [sei, setSei] = useState('');
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const [requestDate, setRequestDate] = useState(today());

  const load = useCallback(async () => {
    const r = await run(() => api<PanelAdminData>('/panel/admin'));
    if (r) setData(r);
  }, [run]);
  useEffect(() => { load(); }, []);

  const check = async () => {
    setBusy(true);
    const r = await run(() => api<PanelPreview & { success: boolean }>('/panel/import', { method: 'POST', json: { text, dryRun: true } }));
    setBusy(false);
    if (r) setPreview(r);
  };
  const doImport = async (ignoreErrors: boolean) => {
    setBusy(true);
    const r = await run(() => api('/panel/import', { method: 'POST', json: { text, ignoreErrors } }), 'Designações importadas.');
    setBusy(false);
    if (r) { setText(''); setPreview(null); await load(); onChanged(); }
  };
  const removeRow = async (r: PanelRow) => {
    if (!(await confirm(`Desfazer a vinculação de ${r.name} à unidade ${r.unit}? O magistrado volta à lista de espera.`, 'Desfazer vinculação'))) return;
    await run(() => api(`/panel/rows/${r.id}`, { method: 'DELETE' }), 'Vinculação desfeita.');
    await load(); onChanged();
  };
  const submitWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dropping) return;
    const r = await run(() => api('/panel/withdrawals', { method: 'POST', json: { name: dropping.name, sei, requestDate } }), 'Desistência registrada.');
    if (r) { setDropping(null); setSei(''); await load(); onChanged(); }
  };
  const submitEditWd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWd) return;
    const r = await run(() => api(`/panel/withdrawals/${editingWd.id}`, { method: 'PUT', json: { sei: editingWd.sei, requestDate: editingWd.requestDate ?? '' } }), 'Desistência atualizada.');
    if (r) { setEditingWd(null); await load(); }
  };
  const openMove = async (r: PanelRow) => {
    const list = await run(() => api<Unit[]>(`/units?edition=${encodeURIComponent(r.editionId)}`));
    if (!list) return;
    setMoving({ row: r, units: list.filter(u => u.selection === 'Escolhida' && u.id !== r.unitId).sort((a, b) => a.unitName.localeCompare(b.unitName, 'pt-BR')) });
    setMoveUnit(''); setMoveNewName(''); setMoveDate(today());
  };
  const submitMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moving) return;
    const r = await run(() => api(`/matches/${moving.row.id}`, { method: 'PUT', json: moveNewName.trim() ? { newUnitName: moveNewName.trim(), effectiveDate: moveDate } : { unitId: moveUnit, effectiveDate: moveDate } }), 'Vinculação alterada.');
    if (r) { setMoving(null); await load(); onChanged(); }
  };
  const undoWithdrawal = async (w: Withdrawal) => {
    if (!(await confirm(`Desfazer a desistência de ${w.name}? O magistrado volta à lista de espera; as designações anteriores não são restauradas.`, 'Desfazer desistência'))) return;
    await run(() => api(`/panel/withdrawals/${w.id}`, { method: 'DELETE' }), 'Registro de desistência desfeito.');
    await load(); onChanged();
  };
  const exportPdf = () => run(() => download('/panel/report.pdf', 'designacoes.pdf'));

  if (!data) return <div className="card p-8 text-sm text-muted">Carregando…</div>;
  const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const term = fold(query.trim());
  const areaMap = new Map<string, { label: string; count: number }>();
  data.rows.forEach(r => { const k = fold(r.area.trim()); const c = areaMap.get(k); if (c) c.count++; else areaMap.set(k, { label: r.area.trim(), count: 1 }); });
  const areas = [...areaMap.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, 'pt-BR'));
  const selected = areaFilter.filter(k => areaMap.has(k));
  const rows = data.rows.filter(r => (selected.length === 0 || selected.includes(fold(r.area.trim()))) && (!term || fold(`${r.name} ${r.area} ${r.unit} ${r.comarca ?? ''}`).includes(term)));

  return (
    <div className="space-y-6">
      <Toolbar title="Painel de vinculações">
        <button className="btn-secondary btn-sm" onClick={exportPdf}><Download className="w-4 h-4" /> Exportar relatório em PDF</button>
      </Toolbar>
      <p className="text-sm text-muted -mt-2">
        Relação total das vinculações vigentes de <strong className="text-ink">todas as edições</strong>, de uso restrito da administração. As designações de edições anteriores continuam valendo até que seja registrada a desistência.
        Ao desfazer uma vinculação, a linha sai daqui automaticamente. Para trocar a vara de alguém, use "Alterar vara" (informa a partir de quando atua na nova unidade; a anterior fica registrada até o dia anterior).
      </p>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-line">
          <h4 className="font-semibold text-navy">Vinculações vigentes <span className="text-muted font-normal">({data.rows.length})</span></h4>
          <input className="input max-w-xs" type="search" placeholder="Buscar por nome, área ou unidade" aria-label="Buscar no painel" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        {areas.length > 1 && (
          <div className="p-4 border-b border-line" role="group" aria-label="Filtrar por área de atuação">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-xs font-medium text-muted tracking-wide">Área de atuação</span>
              {selected.length > 0 && <button className="text-xs text-bronze hover:underline" onClick={() => setAreaFilter([])}>Limpar filtro</button>}
            </div>
            <div className="flex flex-wrap gap-2">
              {areas.map(([k, a]) => {
                const on = selected.includes(k);
                return (
                  <button key={k} type="button" aria-pressed={on} onClick={() => setAreaFilter(on ? selected.filter(x => x !== k) : [...selected, k])}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${on ? 'bg-navy text-white border-navy' : 'bg-surface text-muted border-line hover:text-ink hover:border-slate-300'}`}>
                    {a.label} <span className={on ? 'text-white/70' : 'text-muted/70'}>({a.count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Magistrado(a)</th><th className="th">Área de atuação</th><th className="th">Unidade</th><th className="th">Atuação</th><th className="th">Edição</th><th className="th w-64"></th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">{data.rows.length === 0 ? 'Nenhuma vinculação vigente.' : 'Nenhum resultado para o filtro escolhido.'}</td></tr>}
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="td font-medium">{r.name}</td>
                  <td className="td text-muted">{r.area}</td>
                  <td className="td">{r.unit}{r.comarca && <div className="text-xs text-muted">{r.comarca}</div>}{r.note && <div className="text-xs text-muted">Obs.: {r.note}</div>}{r.startDate && <div className="text-xs text-bronze">a partir de {r.startDate.split('-').reverse().join('/')}</div>}</td>
                  <td className="td text-xs">{r.workType === 'Audiência' ? 'Audiências' : r.workType === 'Sentença' ? 'Sentença' : r.workType}</td>
                  <td className="td text-xs text-muted">{r.editionTitle}</td>
                  <td className="td text-right whitespace-nowrap">
                    <button className="btn-secondary btn-sm mr-1" onClick={() => openMove(r)}>Alterar vara</button>
                    <button className="btn-secondary btn-sm" onClick={() => { setDropping(r); setSei(''); setRequestDate(today()); }}>Desistência</button>
                    <button className="btn-danger" title="Desfazer vinculação" aria-label="Excluir" onClick={() => removeRow(r)}><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && <p className="px-4 py-2.5 text-xs text-muted border-t border-line">{rows.length} de {data.rows.length} designações</p>}
      </div>

      {data.transfers.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-line"><h4 className="font-semibold text-navy">Alterações de vinculação <span className="text-muted font-normal">({data.transfers.length})</span></h4></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Magistrado(a)</th><th className="th">Vinculação anterior</th><th className="th">Nova vinculação</th></tr></thead>
              <tbody className="divide-y divide-line">
                {data.transfers.map(t => {
                  const d = new Date(`${t.effectiveDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
                  const dmy = (ymd: string) => ymd.split('-').reverse().join('/');
                  return (
                    <tr key={t.id}>
                      <td className="td font-medium">{t.name}</td>
                      <td className="td">{t.fromUnit}<div className="text-xs text-muted">até {dmy(d.toISOString().slice(0, 10))}</div></td>
                      <td className="td">{t.toUnit}<div className="text-xs text-bronze">a partir de {dmy(t.effectiveDate)}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-line"><h4 className="font-semibold text-navy">Desistentes <span className="text-muted font-normal">({data.withdrawals.length})</span></h4></div>
        {data.withdrawals.length === 0 ? <p className="p-8 text-center text-sm text-muted">Nenhuma desistência registrada.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Magistrado(a)</th><th className="th">Área</th><th className="th">Unidade</th><th className="th">SEI</th><th className="th">Pedido em</th><th className="th">Situação</th><th className="th w-56"></th></tr></thead>
              <tbody className="divide-y divide-line">
                {data.withdrawals.map(w => (
                  <tr key={w.id}>
                    <td className="td font-medium">{w.name}</td><td className="td text-muted">{w.area}</td><td className="td">{w.unit}</td>
                    <td className="td font-mono text-xs">{w.sei || <span className="text-warn font-sans">A informar</span>}</td><td className="td text-muted whitespace-nowrap">{w.requestDate ? w.requestDate.split('-').reverse().join('/') : <span className="text-warn">A informar</span>}</td>
                    <td className="td text-xs">{w.endedAt ? <span className="text-warn">Apenas no período, até {formatDate(w.endedAt)}<br />(nova inscrição deferida)</span> : <span className="text-muted">Em vigor</span>}</td>
                    <td className="td text-right whitespace-nowrap"><button className="btn-secondary btn-sm mr-1" onClick={() => setEditingWd({ ...w })}><Pencil className="w-3.5 h-3.5" /> Editar</button><button className="btn-secondary btn-sm" onClick={() => undoWithdrawal(w)}><RotateCcw className="w-3.5 h-3.5" /> Desfazer</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <details className="card p-5">
        <summary className="cursor-pointer font-semibold text-navy">Importar de uma planilha</summary>
        <div className="space-y-4 mt-4">
          <p className="text-sm text-muted">
            No Excel, selecione as colunas <strong className="text-ink">Nome</strong>, <strong className="text-ink">Área</strong> e <strong className="text-ink">Designado Para</strong> (com ou sem a linha de cabeçalho),
            copie (Ctrl+C) e cole abaixo (Ctrl+V). Cada linha vira uma vinculação da edição <strong className="text-ink">{data.initialEdition.title}</strong> (e-mail, lotação e comarca ficam em branco) e pode ser ajustada na aba Vinculações.
          </p>
          <textarea rows={8} className="input font-mono text-xs" placeholder={'Nome\tÁrea\tDesignado Para\nDra. Fulana de Tal\tCrime\t1ª Vara Criminal de Curitiba'}
            value={text} onChange={e => { setText(e.target.value); setPreview(null); }} aria-label="Linhas copiadas da planilha" />
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-secondary btn-sm" disabled={!text.trim() || busy} onClick={check}>Conferir</button>
          </div>
          {preview && (
            <div className="rounded-md border border-line bg-paper p-4 space-y-3">
              <div className="text-sm">
                <strong className="text-ink">{preview.total}</strong> linha(s) válida(s)
                {preview.duplicates > 0 && <> · <span className="text-muted">{preview.duplicates} repetida(s) (ignoradas)</span></>}
                {preview.errorCount > 0 && <> · <span className="text-danger">{preview.errorCount} com problema</span></>}
              </div>
              {preview.errors.length > 0 && (
                <ul className="text-xs text-danger list-disc pl-5 space-y-0.5 max-h-32 overflow-y-auto">
                  {preview.errors.map(e => <li key={e.line}>Linha {e.line}: {e.message}</li>)}
                </ul>
              )}
              {preview.preview.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr><th className="th">Nome</th><th className="th">Área</th><th className="th">Designado para</th></tr></thead>
                    <tbody className="divide-y divide-line">{preview.preview.map((r, i) => <tr key={i}><td className="px-3 py-2">{r.name}</td><td className="px-3 py-2 text-muted">{r.area}</td><td className="px-3 py-2">{r.unit}</td></tr>)}</tbody>
                  </table>
                  {preview.total > preview.preview.length && <p className="text-[11px] text-muted mt-1.5">Mostrando as {preview.preview.length} primeiras.</p>}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {preview.errorCount === 0 && <button className="btn-primary btn-sm" disabled={busy || preview.total === 0 && preview.duplicates === 0} onClick={() => doImport(false)}><Check className="w-4 h-4" /> Importar {preview.total} linha(s)</button>}
                {preview.errorCount > 0 && preview.total > 0 && <button className="btn-primary btn-sm" disabled={busy} onClick={() => doImport(true)}><Check className="w-4 h-4" /> Importar {preview.total} válida(s), ignorando as {preview.errorCount} com problema</button>}
              </div>
            </div>
          )}
        </div>
      </details>

      {moving && (
        <Modal title="Alterar vara" onClose={() => setMoving(null)}>
          <form onSubmit={submitMove} className="space-y-4">
            <p className="text-sm text-muted"><strong className="text-ink">{moving.row.name}</strong> atua hoje em <strong className="text-ink">{moving.row.unit}</strong>. A vinculação anterior ficará registrada como válida até o dia anterior à data informada.</p>
            <Field label="Nova unidade">
              <select className="input" required={!moveNewName.trim()} value={moveUnit} onChange={e => setMoveUnit(e.target.value)} disabled={!!moveNewName.trim()}>
                <option value="" disabled>Selecione…</option>
                {moving.units.map(u => <option key={u.id} value={u.id}>{unitLabel(u)}</option>)}
              </select>
            </Field>
            {moving.row.editionId === data.initialEdition.id && (
              <Field label="Ou digite o nome da nova vara (se ainda não estiver na lista)">
                <input className="input" maxLength={300} value={moveNewName} onChange={e => setMoveNewName(e.target.value)} placeholder="Ex.: 2ª Vara Cível de Londrina" />
              </Field>
            )}
            <Field label="Atuará na nova unidade a partir de">
              <input className="input" type="date" required value={moveDate} onChange={e => setMoveDate(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setMoving(null)}>Cancelar</button>
              <button className="btn-primary" disabled={(!moveUnit && !moveNewName.trim()) || !moveDate}>Registrar alteração</button>
            </div>
          </form>
        </Modal>
      )}

      {editingWd && (
        <Modal title="Editar desistência" onClose={() => setEditingWd(null)}>
          <form onSubmit={submitEditWd} className="space-y-4">
            <p className="text-sm text-muted"><strong className="text-ink">{editingWd.name}</strong></p>
            <Field label="Número do processo SEI">
              <input className="input" autoFocus maxLength={100} value={editingWd.sei} onChange={e => setEditingWd({ ...editingWd, sei: e.target.value })} placeholder="0000000-00.2026.8.16.6000" />
            </Field>
            <Field label="Data do pedido de desistência">
              <input className="input" type="date" value={editingWd.requestDate ?? ''} onChange={e => setEditingWd({ ...editingWd, requestDate: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setEditingWd(null)}>Cancelar</button>
              <button className="btn-primary">Salvar</button>
            </div>
          </form>
        </Modal>
      )}

      {dropping && (
        <Modal title="Registrar desistência" onClose={() => setDropping(null)}>
          <form onSubmit={submitWithdrawal} className="space-y-4">
            <p className="text-sm text-muted"><strong className="text-ink">{dropping.name}</strong> deixará todas as designações vigentes e passará à relação de desistentes.</p>
            <Field label="Número do processo SEI em que consta a desistência (pode ser informado depois)">
              <input className="input" autoFocus maxLength={100} value={sei} onChange={e => setSei(e.target.value)} placeholder="0000000-00.2026.8.16.6000" />
            </Field>
            <Field label="Data do pedido de desistência (pode ser informada depois)">
              <input className="input" type="date" value={requestDate} max={today()} onChange={e => setRequestDate(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setDropping(null)}>Cancelar</button>
              <button className="btn-primary">Registrar desistência</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ---------- Padronizar nomes: conciliação com o catálogo oficial de comarcas e unidades ---------- */
interface Suggestion { id: string; label: string; comarca: string; score: number }
interface StdGroup { key: string; label: string; comarca: string; ids: string[]; editions?: string[]; links?: number; names?: string[]; suggestions: Suggestion[] }
const confident = (g: StdGroup) => g.suggestions[0]?.score >= 0.85 && !(g.suggestions[1] && g.suggestions[1].score > g.suggestions[0].score - 0.1);
const confTone = (s: number) => (s >= 0.85 ? 'ok' : s >= 0.6 ? 'warn' : 'neutral') as 'ok' | 'warn' | 'neutral';

function StdRow({ g, kind, onApply }: { g: StdGroup; kind: 'unit' | 'location'; onApply: (catalogId: string, note: string) => Promise<void> }) {
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

function StandardizeAdmin({ run, confirm, onChanged }: { run: RunFn; confirm: (m: string, label?: string) => Promise<boolean>; onChanged: () => void }) {
  const [data, setData] = useState<{ units: StdGroup[]; locations: StdGroup[] } | null>(null);
  const [names, setNames] = useState<{ count: number; sample: { kind: string; from: string; to: string }[] } | null>(null);
  const load = useCallback(async () => {
    const r = await run(() => Promise.all([api<{ units: StdGroup[]; locations: StdGroup[] }>('/standardize'), api<{ count: number; sample: { kind: string; from: string; to: string }[] }>('/standardize/names')]));
    if (r) { setData(r[0]); setNames(r[1]); }
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
    if (!(await confirm(`Aplicar as ${auto.length} sugestões de alta confiança? Recomenda-se exportar um backup antes (aba Backup). Unidades repetidas na mesma edição serão fundidas.`, 'Aplicar todas'))) return;
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
        Ao aplicar, o nome oficial substitui o digitado e inscrições repetidas da mesma unidade numa edição são fundidas. Faça um backup antes de aplicações em lote.
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
      {section('Unidades', 'unit', data.units, 'Todas as unidades estão padronizadas.')}
      {section('Lotações de magistrados', 'location', data.locations, 'Todas as lotações estão padronizadas.')}
    </div>
  );
}

/* ---------- Backup e restauração ---------- */
function BackupAdmin({ run, confirm, onRestored }: { run: RunFn; confirm: (m: string, label?: string) => Promise<boolean>; onRestored: () => void }) {
  const [summary, setSummary] = useState<null | { name: string; data: any; counts: string }>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useFeedback();

  const pick = async (file?: File | null) => {
    setSummary(null);
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data?.app !== 'mutirao-cgj' || !Array.isArray(data.editions)) throw new Error();
      const n = (k: string) => (Array.isArray(data[k]) ? data[k].length : 0);
      setSummary({ name: file.name, data, counts: `${n('editions')} edição(ões), ${n('magistrates')} magistrado(s), ${n('units')} unidade(s), ${n('matches')} vinculação(ões), ${n('withdrawals')} desistência(s)` });
    } catch { toast('O arquivo escolhido não é um backup válido deste sistema.', 'danger'); }
  };
  const restore = async () => {
    if (!summary) return;
    if (!(await confirm(`Restaurar o backup "${summary.name}" (${summary.counts})? Os dados atuais de edições, magistrados, unidades, vinculações, desistências e perguntas frequentes serão SUBSTITUÍDOS. Faça um backup dos dados atuais antes, se necessário.`, 'Restaurar backup'))) return;
    setBusy(true);
    const r = await run(() => api('/backup/restore', { method: 'POST', json: { confirm: 'RESTAURAR', data: summary.data } }), 'Backup restaurado.');
    setBusy(false);
    if (r) { setSummary(null); setText(String(Date.now())); onRestored(); }
  };

  return (
    <div className="space-y-6">
      <Toolbar title="Backup e restauração" />
      <div className="card p-5 space-y-3">
        <h4 className="font-semibold text-navy">Exportar backup</h4>
        <p className="text-sm text-muted">Salva em um único arquivo (.json) todas as edições, magistrados, unidades, vinculações, desistências, perguntas frequentes e o registro de atividades.
          O arquivo contém dados pessoais (nomes, e-mails e IPs): guarde-o em local seguro. Não inclui a senha nem o segredo do aplicativo autenticador.</p>
        <button className="btn-primary btn-sm" onClick={() => run(() => download('/backup', 'backup-mutirao.json'))}><Download className="w-4 h-4" /> Exportar backup</button>
      </div>
      <div className="card p-5 space-y-3">
        <h4 className="font-semibold text-navy">Restaurar a partir de um backup</h4>
        <Notice tone="danger">A restauração <strong>substitui</strong> os dados atuais pelos do arquivo. O registro de atividades é preservado e recebe uma entrada sobre a restauração.</Notice>
        <input key={text} type="file" accept=".json,application/json" className="text-sm" aria-label="Arquivo de backup" onChange={e => pick(e.target.files?.[0])} />
        {summary && (
          <div className="rounded-md border border-line bg-paper p-4 space-y-3 text-sm">
            <div><strong className="text-ink">{summary.name}</strong>{summary.data.exportedAt && <span className="text-muted"> · gerado em {formatDateTime(summary.data.exportedAt)}</span>}</div>
            <div className="text-muted">Contém: {summary.counts}.</div>
            <button className="btn-danger !bg-danger-soft" disabled={busy} onClick={restore}><RotateCcw className="w-4 h-4" /> Restaurar este backup</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Admin({ onEditionsChanged }: { onEditionsChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const [authed, setAuthed] = useState(!!getToken());
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  // Etapa 2 do login (código do aplicativo autenticador) ou cadastro do aplicativo no primeiro acesso
  const [loginStep, setLoginStep] = useState<null | { kind: 'totp' | 'enroll'; challenge: string; secret?: string; qrSvg?: string }>(null);
  const [totpCode, setTotpCode] = useState('');

  const [sub, setSub] = useState<Sub>('overview');
  const [editions, setEditions] = useState<Edition[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [viewAll, setViewAll] = useState(false); // abas Magistrados/Unidades: todas as edições
  const pickEdition = (id: string) => { if (id === 'all') setViewAll(true); else { setViewAll(false); setSelectedId(id); } };
  const [magistrates, setMagistrates] = useState<Magistrate[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [waiting, setWaiting] = useState<Magistrate[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState('');

  const [modal, setModal] = useState<null | 'mag' | 'mag-edit' | 'reject' | 'wipe' | 'faq-new' | 'faq-edit' | 'unit' | 'unit-edit' | 'edition-new' | 'edition-edit'>(null);
  const [matchFilter, setMatchFilter] = useState<'all' | 'open' | 'linked'>('all');
  const [editingEdition, setEditingEdition] = useState<Edition | null>(null);
  const [editingMag, setEditingMag] = useState<Magistrate | null>(null);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [openUnitId, setOpenUnitId] = useState('');
  const [presence, setPresence] = useState<Record<string, { comarca: string[]; unit: string[] }>>({});
  const [rejecting, setRejecting] = useState<{ kind: 'magistrates' | 'units'; id: string; name: string; linked: boolean } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [sortDir, setSortDir] = useState<Record<'magistrates' | 'units' | 'waiting', SortDir>>(() => {
    try { return { magistrates: 'desc', units: 'desc', waiting: 'desc', ...JSON.parse(localStorage.getItem('mutirao-sort') || '{}') }; }
    catch { return { magistrates: 'desc', units: 'desc', waiting: 'desc' }; }
  });
  const [unitSort, setUnitSort] = useState<{ key: UnitSortKey; dir: SortDir }>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('mutirao-unit-sort') || '{}');
      if (['date', 'name', 'selection'].includes(v.key) && ['asc', 'desc'].includes(v.dir)) return v;
    } catch { /* armazenamento indisponível */ }
    return { key: 'date', dir: 'desc' };
  });
  const toggleUnitSort = (key: UnitSortKey) => setUnitSort(prev => {
    const next = prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } as const : { key, dir: key === 'date' ? 'desc' : 'asc' } as const;
    try { localStorage.setItem('mutirao-unit-sort', JSON.stringify(next)); } catch { /* armazenamento indisponível */ }
    return next;
  });
  const toggleSort = (k: 'magistrates' | 'units' | 'waiting') => setSortDir(prev => {
    const next = { ...prev, [k]: prev[k] === 'desc' ? 'asc' : 'desc' } as typeof prev;
    try { localStorage.setItem('mutirao-sort', JSON.stringify(next)); } catch { /* armazenamento indisponível */ }
    return next;
  });
  const [faqItems, setFaqItems] = useState<FaqItem[]>([]);
  const [editingFaq, setEditingFaq] = useState<FaqItem | null>(null);
  const [wiping, setWiping] = useState<'magistrates' | 'units' | 'matches' | null>(null);
  const [wipeText, setWipeText] = useState('');
  const [linking, setLinking] = useState(false);
  const [ai, setAi] = useState<{ loading: boolean; items: any[] }>({ loading: false, items: [] });

  const selected = editions.find(e => e.id === selectedId);

  // Executa uma chamada tratando erro e expiração de sessão
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMessage?: string): Promise<T | undefined> => {
    try {
      const r = await fn();
      if (okMessage) toast(okMessage);
      return r;
    } catch (e: any) {
      if (!getToken()) setAuthed(false);
      toast(e.message || 'Erro na operação.', 'danger');
    }
  }, [toast]);

  const loadEditions = useCallback(async () => {
    const r = await run(() => api<{ activeEditionId: string; editions: Edition[] }>('/editions'));
    if (!r) return;
    setEditions(r.editions);
    setSelectedId(prev => (r.editions.some(e => e.id === prev) ? prev : r.activeEditionId));
  }, [run]);

  const loadFaq = useCallback(async () => {
    const r = await run(() => api<FaqItem[]>('/faq/all'));
    if (r) setFaqItems(r);
  }, [run]);

  const loadScoped = useCallback(async () => {
    if (!selectedId) return;
    const q = `?edition=${encodeURIComponent(selectedId)}`;
    const lq = viewAll ? '?edition=all' : q;
    const r = await run(() => Promise.all([
      api<Magistrate[]>(`/magistrates${lq}`), api<Unit[]>(`/units${lq}`), api<Match[]>(`/matches${lq}`),
      api<Magistrate[]>(`/waiting-list${q}`), api<LogEntry[]>(`/log${q}`),
    ]));
    if (!r) return;
    api<Record<string, { comarca: string[]; unit: string[] }>>('/panel/presence').then(setPresence).catch(() => setPresence({}));
    [setMagistrates, setUnits, setMatches, setWaiting, setLog].forEach((set, i) => (set as any)(r[i]));
  }, [selectedId, viewAll, run]);

  const refresh = useCallback(async () => { await loadEditions(); await loadScoped(); onEditionsChanged(); }, [loadEditions, loadScoped, onEditionsChanged]);

  useEffect(() => { if (authed) { loadEditions(); loadFaq(); } }, [authed]);
  useEffect(() => { if (authed) { loadScoped(); setAi({ loading: false, items: [] }); } }, [authed, selectedId, viewAll]);
  useEffect(() => { if (sub !== 'magistrates' && sub !== 'units') setViewAll(false); }, [sub]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      if (!loginStep) {
        const r = await api<{ step: 'totp' | 'enroll'; challenge: string; secret?: string; qrSvg?: string }>('/admin/login', { method: 'POST', json: { password } });
        setPassword('');
        setLoginStep({ kind: r.step, challenge: r.challenge, secret: r.secret, qrSvg: r.qrSvg });
        setTotpCode('');
      } else {
        const r = await api<{ token: string }>('/admin/login/verify', { method: 'POST', json: { challenge: loginStep.challenge, code: totpCode } });
        setToken(r.token); setLoginStep(null); setTotpCode(''); setAuthed(true);
      }
    } catch (err: any) {
      setLoginError(err.message);
      if (loginStep && /expirada|esgotadas/i.test(err.message)) setLoginStep(null);
    }
  };
  const logout = () => { api('/admin/logout', { method: 'POST' }).catch(() => {}); setToken(''); setAuthed(false); };

  const q = `edition=${encodeURIComponent(selectedId)}`;
  const withEdition = (body: object) => ({ ...body, editionId: selectedId, source: 'admin' });

  /* ---------- Login ---------- */
  if (!authed) {
    return (
      <div className="card max-w-sm mx-auto p-8 mt-6">
        <Lock className="w-5 h-5 text-bronze mb-3" />
        <h2 className="text-2xl font-semibold text-navy">Área administrativa</h2>
        <p className="text-sm text-muted mt-1 mb-6">Acesso restrito à coordenação do mutirão.</p>
        {loginError && <div className="mb-4"><Notice tone="danger">{loginError}</Notice></div>}
        <form onSubmit={login} className="space-y-4">
          {!loginStep && (
            <Field label="Senha"><input type="password" required autoFocus className="input" value={password} onChange={e => setPassword(e.target.value)} /></Field>
          )}
          {loginStep?.kind === 'enroll' && (
            <div className="space-y-3">
              <p className="text-sm text-muted leading-relaxed">
                <strong className="text-ink">Primeiro acesso: ative a verificação em duas etapas.</strong> Abra um aplicativo autenticador
                (Google Authenticator, Microsoft Authenticator ou similar), escaneie o QR code e informe o código de 6 dígitos que ele exibir.
              </p>
              {loginStep.qrSvg && <img alt="QR code para o aplicativo autenticador" className="mx-auto w-44 h-44 border border-line rounded-md p-1 bg-white" src={`data:image/svg+xml;utf8,${encodeURIComponent(loginStep.qrSvg)}`} />}
              <p className="text-xs text-muted text-center break-all">Ou digite a chave: <span className="font-mono text-ink">{loginStep.secret}</span></p>
            </div>
          )}
          {loginStep?.kind === 'totp' && <p className="text-sm text-muted">Informe o código de 6 dígitos do seu aplicativo autenticador.</p>}
          {loginStep && (
            <Field label="Código de verificação">
              <input inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus autoComplete="one-time-code" className="input tracking-[0.4em] text-center font-mono"
                value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))} />
            </Field>
          )}
          <button className="btn-primary w-full"><Unlock className="w-4 h-4" /> {loginStep ? (loginStep.kind === 'enroll' ? 'Ativar e entrar' : 'Verificar e entrar') : 'Continuar'}</button>
          {loginStep && <button type="button" className="btn-ghost w-full" onClick={() => { setLoginStep(null); setLoginError(''); }}>Voltar</button>}
        </form>
      </div>
    );
  }

  /* ---------- Ações ---------- */
  const del = async (kind: 'magistrates' | 'units' | 'matches', id: string, what: string) => {
    if (!(await confirm(`Excluir ${what}? Esta ação ficará registrada.`, 'Excluir'))) return;
    await run(() => api(`/${kind}/${id}`, { method: 'DELETE' }), 'Registro excluído.');
    refresh();
  };
  const approve = async (id: string) => { await run(() => api(`/magistrates/${id}/approve`, { method: 'POST' }), 'Inscrição aprovada.'); refresh(); };
  const auto = async () => {
    const r = await run(() => api<{ newMatchesCount: number }>(`/matches/auto?${q}`, { method: 'POST' }));
    if (r) toast(`${r.newMatchesCount} nova(s) vinculação(ões) automática(s).`);
    refresh();
  };
  const askAi = async () => {
    setAi({ loading: true, items: [] });
    const r = await run(() => api<{ recommendations: any[] }>(`/ai/match-recommendations?${q}`, { method: 'POST' }));
    setAi({ loading: false, items: r?.recommendations || [] });
  };
  const exportFile = (path: string, name: string) => run(() => download(path, name)).then(loadScoped);

  const saveFaq = async (v: { question: string; answer: string; published: boolean }) => {
    const r = await run(() => editingFaq
      ? api(`/faq/${editingFaq.id}`, { method: 'PUT', json: v })
      : api('/faq', { method: 'POST', json: v }), editingFaq ? 'Pergunta atualizada.' : 'Pergunta adicionada.');
    if (r) { setModal(null); await loadFaq(); onEditionsChanged(); }
  };
  const moveFaq = async (id: string, direction: 'up' | 'down') => {
    await run(() => api(`/faq/${id}/move`, { method: 'POST', json: { direction } }));
    await loadFaq(); onEditionsChanged();
  };
  const toggleFaq = async (f: FaqItem) => {
    await run(() => api(`/faq/${f.id}`, { method: 'PUT', json: { published: !f.published } }), f.published ? 'Pergunta despublicada.' : 'Pergunta publicada.');
    await loadFaq(); onEditionsChanged();
  };
  const deleteFaq = async (f: FaqItem) => {
    if (!(await confirm(`Excluir a pergunta "${f.question}"?`, 'Excluir'))) return;
    await run(() => api(`/faq/${f.id}`, { method: 'DELETE' }), 'Pergunta excluída.');
    await loadFaq(); onEditionsChanged();
  };

  const createEdition = async (v: any) => {
    const r = await run(() => api('/editions', { method: 'POST', json: v }), 'Edição criada.');
    if (r) { setModal(null); await loadEditions(); onEditionsChanged(); setSub('editions'); }
  };
  const updateEdition = async (v: any) => {
    if (!editingEdition) return;
    const r = await run(() => api(`/editions/${editingEdition.id}`, { method: 'PUT', json: v }), 'Edição atualizada.');
    if (r) { setModal(null); refresh(); }
  };
  const editionAction = async (id: string, action: 'activate' | 'close' | 'reopen', msg: string, ask?: string) => {
    if (ask && !(await confirm(ask))) return;
    await run(() => api(`/editions/${id}/${action}`, { method: 'POST' }), msg);
    refresh();
  };

  const rejectItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejecting) return;
    const r = await run(() => api(`/${rejecting.kind}/${rejecting.id}/reject`, { method: 'POST', json: { reason: rejectReason } }),
      rejecting.kind === 'units' ? 'Unidade rejeitada.' : 'Inscrição rejeitada.');
    if (r) { setModal(null); refresh(); }
  };
  const WIPE = {
    magistrates: { path: '/magistrates/delete-all', label: 'inscrições de magistrados', count: () => magistrates.length,
      effect: 'As vinculações desses magistrados também serão removidas, e as unidades afetadas voltarão a ficar sem magistrado.' },
    units: { path: '/units/delete-all', label: 'unidades judiciais', count: () => units.length,
      effect: 'As vinculações dessas unidades também serão removidas, e os magistrados afetados voltarão à lista de espera.' },
    matches: { path: '/matches/delete-all', label: 'vinculações', count: () => matches.length,
      effect: 'Os magistrados voltarão à lista de espera e as unidades ficarão sem magistrado. As inscrições são mantidas.' },
  } as const;
  const startWipe = (kind: 'magistrates' | 'units' | 'matches') => { setWiping(kind); setWipeText(''); setModal('wipe'); };
  const confirmWipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wiping || wipeText.trim() !== 'EXCLUIR') return;
    const r = await run(() => api<{ count: number }>(`${WIPE[wiping].path}?${q}`, { method: 'POST', json: { confirm: 'EXCLUIR' } }));
    if (r) { toast(`${r.count} registro(s) excluído(s).`); setModal(null); refresh(); }
  };

  const approveAll = async () => {
    const n = magistrates.filter(m => m.status === 'Aguardando Conferência').length;
    if (!(await confirm(`Aprovar as ${n} inscrição(ões) de magistrado(s) pendente(s)? Inscrições rejeitadas não serão alteradas.`, 'Aprovar todos'))) return;
    const r = await run(() => api<{ count: number }>(`/magistrates/approve-all?${q}`, { method: 'POST' }));
    if (r) toast(`${r.count} inscrição(ões) aprovada(s).`);
    refresh();
  };
  const chooseAll = async () => {
    const n = units.filter(u => u.selection === 'Em análise').length;
    if (!(await confirm(`Escolher as ${n} unidade(s) em análise para o mutirão? Unidades rejeitadas não serão alteradas.`, 'Escolher todas'))) return;
    const r = await run(() => api<{ count: number }>(`/units/choose-all?${q}`, { method: 'POST' }));
    if (r) toast(`${r.count} unidade(s) escolhida(s).`);
    refresh();
  };
  const setSlots = async (unit: Unit, n: number) => {
    const r = await run(() => api(`/units/${unit.id}`, { method: 'PUT', json: { slots: n } }), `Magistrados a alocar: ${n}.`);
    if (r) refresh();
  };
  const chooseUnit = async (id: string) => { await run(() => api(`/units/${id}/choose`, { method: 'POST' }), 'Unidade escolhida para o mutirão.'); refresh(); };

  /** Cria ou altera uma vinculação (magistrado, área e atuação: audiência e/ou sentença) */
  const saveLink = async (unit: Unit, magistrateId: string, area: string, workType: WorkType, match?: Match) => {
    setLinking(true);
    const body = { magistrateId, unitId: unit.id, assignedArea: area, workType };
    const r = await run(() => match
      ? api(`/matches/${match.id}`, { method: 'PUT', json: body })
      : api('/matches', { method: 'POST', json: withEdition(body) }),
      match ? 'Vinculação atualizada.' : 'Vinculação efetivada.');
    setLinking(false);
    if (r) refresh();
  };
  const unlinkFromUnit = async (matchId: string) => {
    if (!(await confirm('Desfazer esta vinculação? A unidade e o magistrado voltarão a ficar disponíveis.', 'Desfazer'))) return;
    setLinking(true);
    await run(() => api(`/matches/${matchId}`, { method: 'DELETE' }), 'Vinculação desfeita.');
    setLinking(false);
    refresh();
  };

  const sortedMagistrates = [...magistrates].sort(byDate<Magistrate>(sortDir.magistrates));
  const sortedUnits = [...units].sort((a, b) => {
    if (unitSort.key === 'date') return byDate<Unit>(unitSort.dir)(a, b);
    const cmp = unitSort.key === 'name'
      ? collator.compare(unitLabel(a), unitLabel(b))
      : (SELECTION_ORDER[a.selection] ?? 9) - (SELECTION_ORDER[b.selection] ?? 9);
    return (unitSort.dir === 'asc' ? 1 : -1) * cmp || byDate<Unit>('desc')(a, b);
  });
  const sortedWaiting = [...waiting].sort(byDate<Magistrate>(sortDir.waiting));

  const readOnlyEdition = selected?.status === 'Encerrada';
  const logRows = log.filter(l => !logFilter || l.category === logFilter);

  return (
    <div className="space-y-6">
      {/* Cabeçalho + seletor de edição */}
      <div className="card p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <label className="label">Edição em gestão</label>
          <div className="flex flex-wrap items-center gap-3">
            <select className="input max-w-md" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
              {editions.map(e => <option key={e.id} value={e.id}>{e.title}{e.isActive ? ' (vigente)' : ''}</option>)}
            </select>
            {selected && <Badge tone={selected.status === 'Encerrada' ? 'neutral' : 'ok'}>{selected.status}</Badge>}
            {selected?.isActive && <Badge tone="info">Vigente no portal</Badge>}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setModal('edition-new')}><Plus className="w-4 h-4" /> Nova edição</button>
          <button className="btn-ghost" onClick={logout}><LogOut className="w-4 h-4" /> Sair</button>
        </div>
      </div>

      {readOnlyEdition && <Notice tone="danger">Esta edição está encerrada. Os dados continuam editáveis aqui, mas o portal público não aceita novas inscrições.</Notice>}

      <div className="flex gap-1 border-b border-line overflow-x-auto">
        {SUBS.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${sub === t.id ? 'border-navy text-navy font-medium' : 'border-transparent text-muted hover:text-ink'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ---------- Painel ---------- */}
      {sub === 'overview' && selected && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              ['Magistrados', magistrates.length], ['Unidades', units.length], ['Vinculações', matches.length],
              ['Em espera', waiting.length], ['Unidades sem magistrado', units.filter(u => u.selection === 'Escolhida' && u.status === 'Pendente').length],
            ].map(([l, v]) => (
              <div key={l as string} className="card p-5">
                <div className="text-3xl font-serif font-semibold text-navy">{v}</div>
                <div className="text-xs text-muted mt-1">{l}</div>
              </div>
            ))}
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="card p-5 space-y-3">
              <h4 className="font-semibold text-navy">Vinculação automática</h4>
              <p className="text-sm text-muted">Vincula magistrados aprovados priorizando a 1ª e a 2ª preferência, apenas nesta edição.</p>
              <button className="btn-primary btn-sm" onClick={auto}><Sparkles className="w-4 h-4" /> Executar</button>
            </div>
            <div className="card p-5 space-y-3">
              <h4 className="font-semibold text-navy">Sugestões por IA</h4>
              <p className="text-sm text-muted">Propostas de alocação para revisão. Dados de inscritos são enviados ao serviço de IA.</p>
              <button className="btn-secondary btn-sm" onClick={askAi} disabled={ai.loading}><Sparkles className="w-4 h-4" /> {ai.loading ? 'Gerando…' : 'Gerar sugestões'}</button>
            </div>
            <div className="card p-5 space-y-3">
              <h4 className="font-semibold text-navy">Exportação</h4>
              <p className="text-sm text-muted">Dados desta edição, incluindo o registro de atividades.</p>
              <div className="flex gap-2 flex-wrap">
                <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/csv?type=all&${q}`, 'mutirao.csv')}><Download className="w-4 h-4" /> CSV</button>
                <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/xlsx/matches?${q}`, 'vinculacoes.xlsx')}><Download className="w-4 h-4" /> XLSX</button>
              </div>
            </div>
          </div>
          <AttendedUnits refreshKey={matches.length + units.length} />
          {ai.items.length > 0 && (
            <div className="card p-5">
              <h4 className="font-semibold text-navy mb-3">Sugestões da IA</h4>
              <div className="divide-y divide-line">
                {ai.items.map((rec, i) => {
                  const mag = magistrates.find(m => m.id === rec.magistrateId);
                  const unit = units.find(u => u.id === rec.unitId);
                  return (
                    <div key={i} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{mag?.name || 'Magistrado'} → {unit?.unitName || 'Unidade'}</div>
                        <div className="text-xs text-bronze">{rec.assignedArea}</div>
                        <p className="text-xs text-muted mt-1">{rec.justification}</p>
                      </div>
                      {mag && unit && (
                        <button className="btn-secondary btn-sm shrink-0" onClick={async () => {
                          await run(() => api('/matches', { method: 'POST', json: { magistrateId: mag.id, unitId: unit.id, assignedArea: rec.assignedArea, source: 'ai' } }), 'Vinculação efetivada.');
                          setAi(a => ({ ...a, items: a.items.filter((_, j) => j !== i) })); refresh();
                        }}>Efetivar</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="card p-5">
            <h4 className="font-semibold text-navy mb-3">Últimas atividades</h4>
            {log.slice(0, 6).map(l => (
              <div key={l.id} className="flex gap-3 py-1.5 text-sm"><span className="text-xs text-muted w-36 shrink-0 pt-0.5">{formatDateTime(l.timestamp)}</span><span>{l.description}</span></div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- Edições ---------- */}
      {sub === 'editions' && (
        <div className="space-y-6">
          <Toolbar title="Edições do mutirão">
            <button className="btn-primary btn-sm" onClick={() => setModal('edition-new')}><Plus className="w-4 h-4" /> Nova edição</button>
          </Toolbar>
          <Table head={['Edição', 'Período', 'Inscritos', 'Situação', 'Ações']}>
            {editions.map(e => (
              <tr key={e.id} className={e.id === selectedId ? 'bg-bronze-soft/40' : ''}>
                <td className="td">
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-muted">Criada em {formatDate(e.createdAt)}</div>
                </td>
                <td className="td text-muted text-xs">{formatDate(e.openingDate)} a {formatDate(e.closingDate)}</td>
                <td className="td text-xs text-muted">{e.stats?.magistrates ?? 0} magistrados<br />{e.stats?.units ?? 0} unidades · {e.stats?.matches ?? 0} vínculos</td>
                <td className="td space-y-1">
                  <div><Badge tone={e.status === 'Encerrada' ? 'neutral' : 'ok'}>{e.status}</Badge></div>
                  {e.isActive && <div><Badge tone="info">Vigente no portal</Badge></div>}
                  {e.registration && (
                    <div title={e.registration.message}>
                      <Badge tone={e.registration.state === 'open' ? 'ok' : e.registration.state === 'not_yet' ? 'warn' : 'neutral'}>
                        {{ open: 'Inscrições abertas', not_yet: 'Ainda não abriu', ended: 'Prazo encerrado', paused: 'Inscrições suspensas', closed: 'Edição encerrada' }[e.registration.state as string] ?? e.registration.state}
                      </Badge>
                    </div>
                  )}
                </td>
                <td className="td text-right whitespace-nowrap">
                  {e.id !== selectedId && <button className="btn-ghost btn-sm" onClick={() => setSelectedId(e.id)}>Gerir</button>}
                  {!e.isActive && e.status === 'Em andamento' && <button className="btn-ghost btn-sm" title="Tornar vigente" onClick={() => editionAction(e.id, 'activate', 'Edição vigente atualizada.', 'Tornar esta edição a vigente? As novas inscrições públicas passarão a ser registradas nela.')}><Radio className="w-4 h-4" /></button>}
                  {e.status === 'Em andamento'
                    ? <button className="btn-ghost btn-sm" title="Encerrar edição" onClick={() => editionAction(e.id, 'close', 'Edição encerrada.', 'Encerrar a edição? As inscrições públicas serão fechadas.')}><Archive className="w-4 h-4" /></button>
                    : <button className="btn-ghost btn-sm" title="Reabrir edição" onClick={() => editionAction(e.id, 'reopen', 'Edição reaberta.')}><RotateCcw className="w-4 h-4" /></button>}
                  <button className="btn-ghost btn-sm" title="Editar" onClick={() => { setEditingEdition(e); setModal('edition-edit'); }}><Pencil className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-muted">Cada edição mantém suas próprias inscrições de magistrados e unidades, vinculações e registro de atividades. O portal público recebe inscrições apenas na edição vigente.</p>
        </div>
      )}

      {/* ---------- Magistrados ---------- */}
      {sub === 'magistrates' && (
        <div>
          <Toolbar title="Magistrados voluntários">
            {!viewAll && <>
            {magistrates.some(m => m.status === 'Aguardando Conferência') && (
              <button className="btn-secondary btn-sm" onClick={approveAll}>
                <Check className="w-4 h-4" /> Aprovar todos pendentes ({magistrates.filter(m => m.status === 'Aguardando Conferência').length})
              </button>
            )}
            {magistrates.length > 0 && (
              <button className="btn-secondary btn-sm !text-danger" onClick={() => startWipe('magistrates')}><Trash2 className="w-4 h-4" /> Excluir tudo ({magistrates.length})</button>
            )}
            <button className="btn-primary btn-sm" onClick={() => setModal('mag')}><Plus className="w-4 h-4" /> Cadastrar</button>
            <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/csv?type=magistrates&${q}`, 'magistrados.csv')}><Download className="w-4 h-4" /> CSV</button>
          </>}
          </Toolbar>
          <EditionFilter editions={editions} value={viewAll ? 'all' : selectedId} onChange={pickEdition} what="magistrados" />
          <Table head={['Magistrado(a)', <SortHeader key="d" label="Inscrição" dir={sortDir.magistrates} onToggle={() => toggleSort('magistrates')} />, 'Lotação', 'Preferências', 'Audiências', 'Status', 'Ações']}>
            {magistrates.length === 0 && <EmptyRow cols={7}>Nenhuma inscrição nesta edição.</EmptyRow>}
            {sortedMagistrates.map(m => (
              <tr key={m.id}>
                <td className="td"><div className="font-medium">{m.name}</div>{viewAll && <div className="text-[11px] text-bronze">{m.editionTitle}</div>}<div className="text-xs text-muted">{m.email}</div>{m.registeredIp && <div className="text-[11px] text-muted/80">IP {m.registeredIp}</div>}{m.declaration && <div className="text-[11px] text-ok mt-0.5">Declaração de regularidade aceita</div>}{m.priorWithdrawal && <div className="text-[11px] text-warn mt-0.5">Já desistiu antes (SEI {m.priorWithdrawal.sei || 'não informado'}{m.priorWithdrawal.requestDate ? `, pedido em ${m.priorWithdrawal.requestDate.split('-').reverse().join('/')}` : ''}). Se deferida esta inscrição, a desistência passa a valer só para o período anterior.</div>}</td>
                <td className="td"><DateCell iso={m.createdAt} /></td>
                <td className="td text-muted">{m.currentLocation}{m.currentLocation && !m.locationCatalogId && <span className="text-[11px] text-warn block">◦ A padronizar</span>}</td>
                <td className="td text-xs"><div className="text-bronze font-medium">1ª: {m.firstPreference}</div><div className="text-muted">2ª: {m.secondPreference || '—'}</div></td>
                <td className="td"><Badge tone={m.acceptsHearings ? 'ok' : 'neutral'}>{m.acceptsHearings ? 'Aceita' : 'Não aceita'}</Badge></td>
                <td className="td">
                  <Badge tone={magistrateTone(m.status)}>{m.status}</Badge>
                  {m.status === 'Rejeitado' && m.rejectionReason && (
                    <div className="text-[11px] text-danger mt-1.5 max-w-[14rem] leading-snug" title={m.rejectionReason}>Motivo: {m.rejectionReason}</div>
                  )}
                </td>
                <td className="td">
                 <div className="flex flex-wrap justify-end gap-1.5">
                  {(m.status === 'Aguardando Conferência' || m.status === 'Rejeitado') && <button className="btn-secondary btn-sm" onClick={() => approve(m.id)}><Check className="w-3.5 h-3.5" /> {m.status === 'Rejeitado' ? 'Reconsiderar' : 'Aprovar'}</button>}
                  {m.status !== 'Rejeitado' && <button className="btn-secondary btn-sm !text-danger" onClick={() => { setRejecting({ kind: 'magistrates', id: m.id, name: m.name, linked: m.status === 'Atribuído' }); setRejectReason(''); setModal('reject'); }}><X className="w-3.5 h-3.5" /> Rejeitar</button>}
                  <button className="btn-ghost btn-sm" title="Editar" onClick={() => { setEditingMag(m); setModal('mag-edit'); }}><Pencil className="w-4 h-4" /></button>
                  <button className="btn-danger" title="Excluir" onClick={() => del('magistrates', m.id, `a inscrição de ${m.name}`)}><Trash2 className="w-4 h-4" /></button>
                 </div>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {/* ---------- Unidades ---------- */}
      {sub === 'units' && (
        <div>
          <Toolbar title="Unidades judiciais">
            {!viewAll && <>
            {units.some(u => u.selection === 'Em análise') && (
              <button className="btn-secondary btn-sm" onClick={chooseAll}>
                <Check className="w-4 h-4" /> Aprovar todas pendentes ({units.filter(u => u.selection === 'Em análise').length})
              </button>
            )}
            {units.length > 0 && (
              <button className="btn-secondary btn-sm !text-danger" onClick={() => startWipe('units')}><Trash2 className="w-4 h-4" /> Excluir tudo ({units.length})</button>
            )}
            <button className="btn-primary btn-sm" onClick={() => setModal('unit')}><Plus className="w-4 h-4" /> Cadastrar</button>
            <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/xlsx/unlinked-units?${q}`, 'unidades-sem-magistrado.xlsx')}><Download className="w-4 h-4" /> Sem magistrado (XLSX)</button>
            <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/csv?type=units&${q}`, 'unidades.csv')}><Download className="w-4 h-4" /> CSV</button>
          </>}
          </Toolbar>
          <EditionFilter editions={editions} value={viewAll ? 'all' : selectedId} onChange={pickEdition} what="unidades" />
          <Table head={[
            <ColSort key="n" label="Unidade / Comarca" active={unitSort.key === 'name'} dir={unitSort.dir} onToggle={() => toggleUnitSort('name')} />,
            <ColSort key="d" label="Inscrição" active={unitSort.key === 'date'} dir={unitSort.dir} onToggle={() => toggleUnitSort('date')} />,
            'Áreas e auxílio', 'Magistrados',
            <ColSort key="s" label="Triagem" active={unitSort.key === 'selection'} dir={unitSort.dir} onToggle={() => toggleUnitSort('selection')} />,
            'Status', 'Ações']}>
            {units.length === 0 && <EmptyRow cols={7}>Nenhuma unidade inscrita nesta edição.</EmptyRow>}
            {sortedUnits.map(u => {
              const open = openUnitId === u.id;
              return (
                <React.Fragment key={u.id}>
                  <tr className={open ? 'bg-paper' : ''}>
                    <td className="td">
                      <button className="flex items-start gap-1.5 text-left" onClick={() => setOpenUnitId(open ? '' : u.id)} aria-expanded={open} title="Ver justificativa e vincular magistrado">
                        {open ? <ChevronDown className="w-4 h-4 mt-0.5 shrink-0 text-bronze" /> : <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 text-muted" />}
                        <span><span className="font-medium block">{unitLabel(u)}</span>{!u.catalogId && <span className="text-[11px] text-warn block">◦ A padronizar (fora da lista oficial)</span>}{presence[u.id] && <PresenceNote p={presence[u.id]} />}{viewAll && <span className="text-[11px] text-bronze block">{u.editionTitle}</span>}<span className="text-xs text-muted block">Resp.: {u.judgeName}</span><span className="text-xs text-muted block">{u.email}</span>{u.registeredIp && <span className="text-[11px] text-muted/80 block">IP {u.registeredIp}</span>}</span>
                      </button>
                    </td>
                    <td className="td"><DateCell iso={u.createdAt} /></td>
                    <td className="td"><div className="flex flex-wrap gap-1">{u.areas.map(a => <Badge key={a} tone="info">{a}</Badge>)}<Badge tone="neutral">Precisa de: {u.supportNeeded}</Badge></div></td>
                    <td className="td"><SlotsControl bare unit={u} linked={matches.filter(m => m.unitId === u.id).length} onChange={n => setSlots(u, n)} /></td>
                    <td className="td">
                      <Badge tone={u.selection === 'Escolhida' ? 'ok' : u.selection === 'Rejeitada' ? 'danger' : 'warn'}>{u.selection}</Badge>
                      {u.selection === 'Rejeitada' && u.rejectionReason && (
                        <div className="text-[11px] text-danger mt-1.5 max-w-[12rem] leading-snug" title={u.rejectionReason}>Motivo: {u.rejectionReason}</div>
                      )}
                    </td>
                    <td className="td">{u.selection === 'Escolhida' ? <Badge tone={u.status === 'Atendida' ? 'ok' : 'warn'}>{u.status}</Badge> : <span className="text-xs text-muted">—</span>}</td>
                    <td className="td">
                     <div className="flex flex-wrap justify-end gap-1.5">
                      {u.selection !== 'Escolhida' && <button className="btn-secondary btn-sm" onClick={() => chooseUnit(u.id)}><Check className="w-3.5 h-3.5" /> Escolher</button>}
                      {u.selection !== 'Rejeitada' && <button className="btn-secondary btn-sm !text-danger" onClick={() => { setRejecting({ kind: 'units', id: u.id, name: u.unitName, linked: u.status === 'Atendida' }); setRejectReason(''); setModal('reject'); }}><X className="w-3.5 h-3.5" /> Rejeitar</button>}
                      <button className="btn-ghost btn-sm" title="Justificativa e vinculação" onClick={() => setOpenUnitId(open ? '' : u.id)}>{open ? 'Fechar' : 'Detalhes'}</button>
                      <button className="btn-ghost btn-sm" title="Editar" onClick={() => { setEditingUnit(u); setModal('unit-edit'); }}><Pencil className="w-4 h-4" /></button>
                      <button className="btn-danger" title="Excluir" onClick={() => del('units', u.id, `a unidade ${u.unitName}`)}><Trash2 className="w-4 h-4" /></button>
                     </div>
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-paper">
                      <td colSpan={7} className="px-4 pb-5 pt-1">
                        <UnitDetail unit={u} magistrates={magistrates} matches={matches} busy={linking}
                          onLink={(magId, area, workType) => saveLink(u, magId, area, workType)} onUnlink={unlinkFromUnit} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </Table>
        </div>
      )}

      {/* ---------- Vinculações ---------- */}
      {sub === 'matches' && (() => {
        const chosenUnits = units.filter(u => u.selection === 'Escolhida');
        const linkedCount = chosenUnits.filter(u => matches.some(m => m.unitId === u.id)).length;
        const rows = chosenUnits.filter(u => {
          const has = matches.some(m => m.unitId === u.id);
          return matchFilter === 'all' || (matchFilter === 'linked' ? has : !has);
        });
        return (
          <div>
            <Toolbar title="Vinculações">
            {matches.length > 0 && (
              <button className="btn-secondary btn-sm !text-danger" onClick={() => startWipe('matches')}><Trash2 className="w-4 h-4" /> Excluir tudo ({matches.length})</button>
            )}
              <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/xlsx/unlinked-units?${q}`, 'unidades-sem-magistrado.xlsx')}><Download className="w-4 h-4" /> Unidades sem magistrado (XLSX)</button>
              <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/xlsx/matches?${q}`, 'vinculacoes.xlsx')}><Download className="w-4 h-4" /> Vinculações (XLSX)</button>
            </Toolbar>
            <p className="text-sm text-muted mb-4">
              Unidades escolhidas para o mutirão. Defina em cada unidade <strong className="text-ink">quantos magistrados serão alocados</strong> (padrão 1),
              selecione os magistrados nos menus e informe se a atuação será em <strong className="text-ink">audiências</strong>, <strong className="text-ink">sentenças</strong> ou em ambas.
              Os magistrados da mesma área aparecem primeiro; quem está aguardando conferência ou foi rejeitado não é listado.
            </p>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {([['all', `Todas (${chosenUnits.length})`], ['open', `Sem magistrado (${chosenUnits.length - linkedCount})`], ['linked', `Vinculadas (${linkedCount})`]] as const).map(([id, text]) => (
                <button key={id} onClick={() => setMatchFilter(id)}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${matchFilter === id ? 'bg-navy text-white border-navy' : 'bg-surface text-muted border-line hover:text-ink'}`}>{text}</button>
              ))}
            </div>
            {chosenUnits.length === 0 && (
              <div className="card p-10 text-center text-sm text-muted">Nenhuma unidade escolhida. Escolha as unidades na aba <strong>Unidades</strong> para vinculá-las aqui.</div>
            )}
            <div className="space-y-3">
              {rows.map(u => {
                const sig = unitMatchesOf(u, matches).map(m => `${m.id}:${m.magistrateId}:${m.workType}`).join('|');
                return (
                  <UnitLinkRow key={`${u.id}-${sig}`}
                    unit={u} magistrates={magistrates} matches={matches} busy={linking}
                    onSave={saveLink} onUnlink={unlinkFromUnit} onSlots={n => setSlots(u, n)} />
                );
              })}
              {chosenUnits.length > 0 && rows.length === 0 && <div className="card p-8 text-center text-sm text-muted">Nenhuma unidade neste filtro.</div>}
            </div>
          </div>
        );
      })()}

      {/* ---------- Espera ---------- */}
      {sub === 'waiting' && (
        <div>
          <Toolbar title="Lista de espera" />
          <Table head={['Magistrado(a)', 'Lotação', '1ª preferência', '2ª preferência', 'Audiências', <SortHeader key="d" label="Inscrição" dir={sortDir.waiting} onToggle={() => toggleSort('waiting')} />]}>
            {waiting.length === 0 && <EmptyRow cols={6}>Nenhum magistrado em espera.</EmptyRow>}
            {sortedWaiting.map(m => (
              <tr key={m.id}>
                <td className="td"><div className="font-medium">{m.name}</div><div className="text-xs text-muted">{m.email}</div></td>
                <td className="td text-muted">{m.currentLocation}</td>
                <td className="td text-bronze font-medium">{m.firstPreference}</td>
                <td className="td text-muted">{m.secondPreference || '—'}</td>
                <td className="td text-muted">{m.acceptsHearings ? 'Aceita' : 'Não aceita'}</td>
                <td className="td"><DateCell iso={m.createdAt} /></td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {/* ---------- Painel público ---------- */}
      {sub === 'standardize' && <StandardizeAdmin run={run} confirm={confirm} onChanged={refresh} />}
      {sub === 'backup' && <BackupAdmin run={run} confirm={confirm} onRestored={refresh} />}
      {sub === 'panel' && <PanelAdmin run={run} confirm={confirm} onChanged={refresh} />}

      {/* ---------- Perguntas frequentes ---------- */}
      {sub === 'faq' && (
        <div>
          <Toolbar title="Perguntas frequentes">
            <button className="btn-primary btn-sm" onClick={() => { setEditingFaq(null); setModal('faq-new'); }}><Plus className="w-4 h-4" /> Nova pergunta</button>
          </Toolbar>
          <p className="text-sm text-muted mb-4">
            Conteúdo geral do portal, comum a todas as edições. Apenas as perguntas <strong className="text-ink">publicadas</strong> aparecem na página pública
            (o item “Perguntas Frequentes” só surge no menu quando há alguma publicada). Use as setas para definir a ordem.
          </p>
          {faqItems.length === 0 && <div className="card p-10 text-center text-sm text-muted">Nenhuma pergunta cadastrada.</div>}
          <div className="space-y-3">
            {faqItems.map((f, i) => (
              <div key={f.id} className="card p-4 sm:p-5 flex items-start gap-4">
                <div className="flex flex-col gap-1 shrink-0">
                  <button className="btn-ghost btn-sm !px-2" title="Subir" disabled={i === 0} onClick={() => moveFaq(f.id, 'up')}><ArrowUp className="w-4 h-4" /></button>
                  <button className="btn-ghost btn-sm !px-2" title="Descer" disabled={i === faqItems.length - 1} onClick={() => moveFaq(f.id, 'down')}><ArrowDown className="w-4 h-4" /></button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-serif font-semibold text-navy">{f.question}</span>
                    <Badge tone={f.published ? 'ok' : 'neutral'}>{f.published ? 'Publicada' : 'Rascunho'}</Badge>
                  </div>
                  <p className="text-sm text-muted mt-1.5 whitespace-pre-wrap line-clamp-3">{f.answer}</p>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
                  <button className="btn-secondary btn-sm" onClick={() => toggleFaq(f)}>{f.published ? 'Despublicar' : 'Publicar'}</button>
                  <button className="btn-ghost btn-sm" title="Editar" onClick={() => { setEditingFaq(f); setModal('faq-edit'); }}><Pencil className="w-4 h-4" /></button>
                  <button className="btn-danger" title="Excluir" onClick={() => deleteFaq(f)}><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- Registro ---------- */}
      {sub === 'log' && (
        <div>
          <Toolbar title="Registro de atividades">
            <select className="input !w-auto !py-1.5 text-xs" value={logFilter} onChange={e => setLogFilter(e.target.value)}>
              <option value="">Todas as categorias</option>
              {['Edição', 'Magistrado', 'Unidade', 'Vinculação', 'Exportação', 'Acesso', 'Conteúdo'].map(c => <option key={c}>{c}</option>)}
            </select>
            <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/csv?type=log&${q}`, 'registro.csv')}><Download className="w-4 h-4" /> CSV</button>
          </Toolbar>
          <Table head={['Data/hora', 'Responsável', 'Categoria', 'IP', 'Descrição']}>
            {logRows.length === 0 && <EmptyRow cols={5}>Sem registros.</EmptyRow>}
            {logRows.map(l => (
              <tr key={l.id}>
                <td className="td text-xs text-muted whitespace-nowrap">{formatDateTime(l.timestamp)}</td>
                <td className="td text-xs">{l.actor}</td>
                <td className="td"><Badge tone="neutral">{l.category}</Badge></td>
                <td className="td text-xs text-muted font-mono whitespace-nowrap">{l.ip ?? '—'}</td>
                <td className="td">{l.description}</td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-muted mt-3">Registro das últimas 500 ocorrências da edição, incluindo acessos ao painel.</p>
        </div>
      )}

      {/* ---------- Modais ---------- */}
      {modal === 'mag' && (
        <Modal title="Cadastrar magistrado" onClose={() => setModal(null)}>
          <MagistrateForm withStatus relaxed={selected?.isInitial} submitLabel="Salvar magistrado" onSubmit={async p => {
            const r = await run(() => api('/magistrates', { method: 'POST', json: withEdition(p) }), 'Magistrado incluído.');
            if (r) { setModal(null); refresh(); }
            return !!r;
          }} />
        </Modal>
      )}
      {modal === 'unit' && (
        <Modal title="Cadastrar unidade judicial" onClose={() => setModal(null)}>
          <UnitForm withSlots relaxed={selected?.isInitial} submitLabel="Salvar unidade" onSubmit={async p => {
            const r = await run(() => api('/units', { method: 'POST', json: withEdition(p) }), 'Unidade incluída.');
            if (r) { setModal(null); refresh(); }
            return !!r;
          }} />
        </Modal>
      )}
      {modal === 'faq-new' && <Modal title="Nova pergunta" onClose={() => setModal(null)}><FaqForm onSubmit={saveFaq} /></Modal>}
      {modal === 'faq-edit' && editingFaq && <Modal title="Editar pergunta" onClose={() => setModal(null)}><FaqForm initial={editingFaq} onSubmit={saveFaq} /></Modal>}
      {modal === 'wipe' && wiping && (
        <Modal title="Excluir tudo" onClose={() => setModal(null)}>
          <form onSubmit={confirmWipe} className="space-y-4">
            <div className="rounded-md bg-danger-soft text-danger px-4 py-3 text-sm leading-relaxed">
              <strong>Ação irreversível.</strong> Serão excluídas <strong>{WIPE[wiping].count()}</strong> {WIPE[wiping].label} da edição
              {' '}<strong>{selected?.title}</strong>. {WIPE[wiping].effect}
            </div>
            <p className="text-xs text-muted">Edições anteriores não são afetadas. A exclusão fica registrada no histórico de atividades. Recomenda-se exportar o CSV antes de continuar.</p>
            <Field label='Para confirmar, digite EXCLUIR'>
              <input autoFocus className="input" value={wipeText} onChange={e => setWipeText(e.target.value)} placeholder="EXCLUIR" autoComplete="off" />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn-primary !bg-danger" disabled={wipeText.trim() !== 'EXCLUIR'}>Excluir tudo</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'reject' && rejecting && (
        <Modal title={rejecting.kind === 'units' ? 'Rejeitar unidade' : 'Rejeitar inscrição'} onClose={() => setModal(null)}>
          <form onSubmit={rejectItem} className="space-y-4">
            <p className="text-sm text-muted">
              {rejecting.kind === 'units' ? 'Unidade' : 'Inscrição de'} <strong className="text-ink">{rejecting.name}</strong>.
              {rejecting.linked && <span className="block mt-1 text-warn">{rejecting.kind === 'units' ? 'A unidade está vinculada a um magistrado: a vinculação será desfeita e ele voltará à lista de espera.' : 'O magistrado está vinculado a uma unidade: a vinculação será desfeita e a unidade voltará a ficar sem magistrado.'}</span>}
            </p>
            <Field label="Motivo da rejeição (uso interno; o inscrito vê apenas o status)">
              <textarea required autoFocus rows={4} className="input" value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder={rejecting.kind === 'units' ? 'Ex.: Demanda não se enquadra nos critérios do mutirão.' : 'Ex.: Declaração de regularidade incompatível com os registros funcionais.'} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn-primary" disabled={!rejectReason.trim()}>{rejecting.kind === 'units' ? 'Rejeitar unidade' : 'Rejeitar inscrição'}</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'mag-edit' && editingMag && (
        <Modal title="Editar magistrado" onClose={() => setModal(null)}>
          <MagistrateForm withStatus relaxed={selected?.isInitial} initial={editingMag} submitLabel="Salvar alterações" onSubmit={async p => {
            const r = await run(() => api(`/magistrates/${editingMag.id}`, { method: 'PUT', json: p }), 'Inscrição atualizada.');
            if (r) { setModal(null); refresh(); }
            return !!r;
          }} />
        </Modal>
      )}
      {modal === 'unit-edit' && editingUnit && (
        <Modal title="Editar unidade judicial" onClose={() => setModal(null)}>
          <UnitForm withSlots relaxed={selected?.isInitial} initial={editingUnit} submitLabel="Salvar alterações" onSubmit={async p => {
            const r = await run(() => api(`/units/${editingUnit.id}`, { method: 'PUT', json: p }), 'Unidade atualizada.');
            if (r) { setModal(null); refresh(); }
            return !!r;
          }} />
        </Modal>
      )}
      {modal === 'edition-new' && <Modal title="Nova edição" onClose={() => setModal(null)}><EditionForm onSubmit={createEdition} /></Modal>}
      {modal === 'edition-edit' && editingEdition && <Modal title="Editar edição" onClose={() => setModal(null)}><EditionForm initial={editingEdition} onSubmit={updateEdition} /></Modal>}
    </div>
  );
}
