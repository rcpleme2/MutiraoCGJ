import React, { useCallback, useEffect, useState } from 'react';
import { Lock, Unlock, Plus, Trash2, Check, Pencil, Download, Sparkles, LogOut, Radio, Archive, RotateCcw, ChevronDown, ChevronRight, X } from 'lucide-react';
import { api, download, getToken, setToken } from './api';
import { Edition, LogEntry, Magistrate, Match, Unit, WorkType, WORK_TYPES } from './types';
import { Badge, EmptyRow, Field, Modal, Notice, formatDate, formatDateTime, magistrateTone, useFeedback } from './ui';
import { MagistrateForm, UnitForm } from './Forms';

type Sub = 'overview' | 'editions' | 'magistrates' | 'units' | 'matches' | 'waiting' | 'log';

const SUBS: { id: Sub; label: string }[] = [
  { id: 'overview', label: 'Painel' },
  { id: 'editions', label: 'Edições' },
  { id: 'magistrates', label: 'Magistrados' },
  { id: 'units', label: 'Unidades' },
  { id: 'matches', label: 'Vinculações' },
  { id: 'waiting', label: 'Lista de espera' },
  { id: 'log', label: 'Registro' },
];

const toLocalInput = (iso: string) => iso.slice(0, 16);

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
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
        <Field label="Abertura"><input required type="datetime-local" className="input" value={f.openingDate} onChange={e => setF({ ...f, openingDate: e.target.value })} /></Field>
        <Field label="Encerramento"><input required type="datetime-local" className="input" value={f.closingDate} onChange={e => setF({ ...f, closingDate: e.target.value })} /></Field>
      </div>
      {initial ? (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isRegistrationOpen} onChange={e => setF({ ...f, isRegistrationOpen: e.target.checked })} /> Inscrições públicas abertas</label>
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
    .filter(m => m.status !== 'Rejeitado' && !taken.has(m.id)
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
    : mag.acceptsHearings ? 'Audiência e Sentença' : 'Sentença';

const workTypeTone = (w: WorkType) => (w === 'Sentença' ? 'neutral' : w === 'Audiência' ? 'info' : 'ok') as 'neutral' | 'info' | 'ok';
const unitMatchesOf = (unit: Unit, matches: Match[]) =>
  matches.filter(m => m.unitId === unit.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

function WorkTypeSelect({ value, onChange }: { value: WorkType; onChange: (v: WorkType) => void }) {
  return (
    <select className="input !py-2 text-sm" value={value} onChange={e => onChange(e.target.value as WorkType)} aria-label="Atuação do magistrado">
      {WORK_TYPES.map(w => <option key={w} value={w}>{w === 'Audiência e Sentença' ? 'Audiência e sentença' : w === 'Audiência' ? 'Para audiências' : 'Para sentenças'}</option>)}
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
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2">Vincular magistrado da mesma área</div>
        {unit.selection !== 'Escolhida' ? (
          <p className="text-sm text-muted">Escolha a unidade para o mutirão antes de vincular um magistrado.</p>
        ) : linked.length > 0 ? (
          <div className="space-y-2">
            {linked.map(match => {
              const mag = magistrates.find(m => m.id === match.magistrateId);
              return (
                <div key={match.id} className="flex items-center justify-between gap-3 bg-ok-soft text-ok rounded-md px-3 py-2.5 text-sm">
                  <span>
                    {match.exceptionReason && <strong>Exceção · </strong>}
                    <strong>{mag?.name || 'magistrado removido'}</strong> · {match.assignedArea} · <strong>{match.workType}</strong>
                    {match.exceptionReason && <span className="block text-xs opacity-80 mt-0.5">Motivo: {match.exceptionReason}</span>}
                  </span>
                  <button className="btn-secondary btn-sm shrink-0" disabled={busy} onClick={() => onUnlink(match.id)}>Desfazer</button>
                </div>
              );
            })}
            <p className="text-xs text-muted">A regra é um magistrado por unidade. Para incluir outro, em caráter de exceção, use a aba <strong>Vinculações</strong>.</p>
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted">Nenhum magistrado aprovado e disponível com preferência nas áreas desta unidade ({unit.areas.join(', ')}).</p>
        ) : (
          <div className="space-y-2">
            {candidates.map(({ m, area, rank }) => (
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
            {chosen && (
              <div className="rounded-md bg-surface border border-line p-3">
                <div className="label">O magistrado atuará em</div>
                <WorkTypeSelect value={effective} onChange={setWorkType} />
                <WorkTypeWarnings unit={unit} mag={chosen.m} workType={effective} />
              </div>
            )}
            <button className="btn-primary btn-sm" disabled={!chosen || busy} onClick={() => chosen && onLink(chosen.m.id, chosen.area, effective)}>
              <Check className="w-4 h-4" /> Vincular selecionado
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

type SaveLink = (unit: Unit, magistrateId: string, area: string, workType: WorkType, match?: Match, exceptionReason?: string) => void;

/* ---------- Um magistrado vinculado (ou a vincular) à unidade ---------- */
function LinkSlot({ unit, magistrates, matches, match, exception, busy, onSave, onUnlink, onCancel }: {
  unit: Unit;
  magistrates: Magistrate[];
  matches: Match[];
  match?: Match;
  /** vínculo novo adicional (exceção): exige motivo */
  exception?: boolean;
  busy: boolean;
  onSave: SaveLink;
  onUnlink: (matchId: string) => void;
  onCancel?: () => void;
}) {
  const { same, other } = eligibleFor(unit, magistrates, matches, match);
  const all = [...same, ...other];
  const [magId, setMagId] = useState(match?.magistrateId ?? '');
  const [workType, setWorkType] = useState<WorkType | ''>(match?.workType ?? '');
  const [reason, setReason] = useState('');

  const sel = all.find(e => e.m.id === magId);
  const effective: WorkType | '' = workType || (sel ? defaultWorkType(unit, sel.m) : '');
  const changed = !!sel && (!match || match.magistrateId !== magId || match.workType !== effective);
  const reasonOk = !exception || reason.trim().length > 0;

  const label = (e: Eligible) =>
    `${e.m.name}${e.rank ? ` — ${e.rank}ª preferência` : ''}${e.m.acceptsHearings ? '' : ' — não aceita audiências'}`;

  return (
    <div className={exception ? 'rounded-md border border-warn/40 bg-warn-soft/40 p-3 sm:p-4' : ''}>
      {exception && (
        <p className="text-xs text-warn mb-3"><strong>Vinculação excepcional.</strong> A regra é um magistrado por unidade; registre o motivo para incluir mais um.</p>
      )}
      {match?.exceptionReason && (
        <p className="text-xs mb-2"><Badge tone="warn">Exceção</Badge> <span className="text-muted ml-1">Motivo: {match.exceptionReason}</span></p>
      )}
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
          <button className="btn-primary btn-sm" disabled={!changed || !reasonOk || busy}
            onClick={() => sel && effective && onSave(unit, sel.m.id, sel.area, effective, match, exception ? reason.trim() : undefined)}>
            <Check className="w-4 h-4" /> {match ? 'Salvar' : 'Vincular'}
          </button>
          {match && <button className="btn-secondary btn-sm" disabled={busy} onClick={() => onUnlink(match.id)}>Desfazer</button>}
          {!match && onCancel && <button className="btn-ghost btn-sm" onClick={onCancel}>Cancelar</button>}
        </div>
      </div>
      {sel && effective && <WorkTypeWarnings unit={unit} mag={sel.m} workType={effective} />}
      {sel && sel.rank === 0 && <p className="text-[11px] text-warn mt-1.5">Área fora das preferências do magistrado; será registrada como {sel.area}.</p>}
      {exception && (
        <div className="mt-3">
          <label className="label">Motivo da exceção (obrigatório)</label>
          <textarea rows={2} className="input" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Ex.: Acervo de 900 processos; um único magistrado não comporta o volume no período." />
        </div>
      )}
    </div>
  );
}

/* ---------- Linha da aba Vinculações: uma unidade escolhida e seus magistrados ---------- */
function UnitLinkRow({ unit, magistrates, matches, busy, onSave, onUnlink }: {
  unit: Unit;
  magistrates: Magistrate[];
  matches: Match[];
  busy: boolean;
  onSave: SaveLink;
  onUnlink: (matchId: string) => void;
}) {
  const linked = unitMatchesOf(unit, matches);
  const [adding, setAdding] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const canAddMore = linked.length > 0 && eligibleFor(unit, magistrates, matches).same.length + eligibleFor(unit, magistrates, matches).other.length > 0;

  return (
    <div className={`card p-4 sm:p-5 ${linked.length ? 'border-ok/30' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-serif font-semibold text-navy leading-snug">{unit.unitName}</div>
          <div className="text-xs text-muted mt-0.5">{unit.comarca} · {unit.judgeName}</div>
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
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <Badge tone={linked.length ? 'ok' : 'warn'}>{linked.length ? 'Vinculada' : 'Sem magistrado'}</Badge>
          {linked.length > 1 && <Badge tone="warn">Exceção: {linked.length} magistrados</Badge>}
        </div>
      </div>

      <div className="mt-4 space-y-4 border-t border-line pt-4">
        {linked.length === 0 && (
          <LinkSlot unit={unit} magistrates={magistrates} matches={matches} busy={busy} onSave={onSave} onUnlink={onUnlink} />
        )}
        {linked.map(m => (
          <LinkSlot key={`${m.id}-${m.magistrateId}-${m.workType}`} unit={unit} magistrates={magistrates} matches={matches} match={m}
            busy={busy} onSave={onSave} onUnlink={onUnlink} />
        ))}
        {adding && (
          <LinkSlot exception unit={unit} magistrates={magistrates} matches={matches} busy={busy}
            onSave={onSave} onUnlink={onUnlink} onCancel={() => setAdding(false)} />
        )}
        {linked.length > 0 && !adding && (
          <button className="text-xs text-bronze hover:underline disabled:opacity-50 disabled:no-underline" disabled={!canAddMore}
            title={canAddMore ? '' : 'Não há outro magistrado disponível'}
            onClick={() => setAdding(true)}>
            + Vincular outro magistrado (exceção)
          </button>
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

  const [sub, setSub] = useState<Sub>('overview');
  const [editions, setEditions] = useState<Edition[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [magistrates, setMagistrates] = useState<Magistrate[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [waiting, setWaiting] = useState<Magistrate[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState('');

  const [modal, setModal] = useState<null | 'mag' | 'mag-edit' | 'reject' | 'wipe' | 'unit' | 'unit-edit' | 'edition-new' | 'edition-edit' | 'password'>(null);
  const [matchFilter, setMatchFilter] = useState<'all' | 'open' | 'linked'>('all');
  const [editingEdition, setEditingEdition] = useState<Edition | null>(null);
  const [editingMag, setEditingMag] = useState<Magistrate | null>(null);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [openUnitId, setOpenUnitId] = useState('');
  const [rejecting, setRejecting] = useState<{ kind: 'magistrates' | 'units'; id: string; name: string; linked: boolean } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [wiping, setWiping] = useState<'magistrates' | 'units' | 'matches' | null>(null);
  const [wipeText, setWipeText] = useState('');
  const [linking, setLinking] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
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

  const loadScoped = useCallback(async () => {
    if (!selectedId) return;
    const q = `?edition=${encodeURIComponent(selectedId)}`;
    const r = await run(() => Promise.all([
      api<Magistrate[]>(`/magistrates${q}`), api<Unit[]>(`/units${q}`), api<Match[]>(`/matches${q}`),
      api<Magistrate[]>(`/waiting-list${q}`), api<LogEntry[]>(`/log${q}`),
    ]));
    if (!r) return;
    [setMagistrates, setUnits, setMatches, setWaiting, setLog].forEach((set, i) => (set as any)(r[i]));
  }, [selectedId, run]);

  const refresh = useCallback(async () => { await loadEditions(); await loadScoped(); onEditionsChanged(); }, [loadEditions, loadScoped, onEditionsChanged]);

  useEffect(() => { if (authed) loadEditions(); }, [authed]);
  useEffect(() => { if (authed) { loadScoped(); setAi({ loading: false, items: [] }); } }, [authed, selectedId]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const r = await api<{ token: string }>('/admin/login', { method: 'POST', json: { password } });
      setToken(r.token); setPassword(''); setAuthed(true);
    } catch (err: any) { setLoginError(err.message); }
  };
  const logout = () => { setToken(''); setAuthed(false); };

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
          <Field label="Senha"><input type="password" required autoFocus className="input" value={password} onChange={e => setPassword(e.target.value)} /></Field>
          <button className="btn-primary w-full"><Unlock className="w-4 h-4" /> Entrar</button>
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
  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => api('/admin/password', { method: 'POST', json: pw }), 'Senha alterada.');
    if (r) { setModal(null); setPw({ currentPassword: '', newPassword: '' }); }
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
  const chooseUnit = async (id: string) => { await run(() => api(`/units/${id}/choose`, { method: 'POST' }), 'Unidade escolhida para o mutirão.'); refresh(); };

  /** Cria ou altera uma vinculação (magistrado, área e atuação: audiência e/ou sentença) */
  const saveLink = async (unit: Unit, magistrateId: string, area: string, workType: WorkType, match?: Match, exceptionReason?: string) => {
    setLinking(true);
    const body = { magistrateId, unitId: unit.id, assignedArea: area, workType, ...(exceptionReason ? { exceptionReason } : {}) };
    const r = await run(() => match
      ? api(`/matches/${match.id}`, { method: 'PUT', json: body })
      : api('/matches', { method: 'POST', json: withEdition(body) }),
      match ? 'Vinculação atualizada.' : exceptionReason ? 'Vinculação excepcional registrada.' : 'Vinculação efetivada.');
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
            <button className="btn-secondary btn-sm" onClick={() => setModal('password')}><Lock className="w-4 h-4" /> Alterar senha</button>
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
                  <div className="text-[11px] text-muted">Inscrições {e.isRegistrationOpen ? 'abertas' : 'fechadas'}</div>
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
          </Toolbar>
          <Table head={['Magistrado(a)', 'Lotação', 'Preferências', 'Audiências', 'Status', 'Ações']}>
            {magistrates.length === 0 && <EmptyRow cols={6}>Nenhuma inscrição nesta edição.</EmptyRow>}
            {magistrates.map(m => (
              <tr key={m.id}>
                <td className="td"><div className="font-medium">{m.name}</div><div className="text-xs text-muted">{m.email}</div><div className="text-[11px] text-muted/80">{m.registeredIp ? `IP ${m.registeredIp} · ` : ''}{formatDateTime(m.createdAt)}</div>{m.declaration && <div className="text-[11px] text-ok mt-0.5">Declaração de regularidade aceita</div>}</td>
                <td className="td text-muted">{m.currentLocation}</td>
                <td className="td text-xs"><div className="text-bronze font-medium">1ª: {m.firstPreference}</div><div className="text-muted">2ª: {m.secondPreference || '—'}</div></td>
                <td className="td"><Badge tone={m.acceptsHearings ? 'ok' : 'neutral'}>{m.acceptsHearings ? 'Aceita' : 'Não aceita'}</Badge></td>
                <td className="td">
                  <Badge tone={magistrateTone(m.status)}>{m.status}</Badge>
                  {m.status === 'Rejeitado' && m.rejectionReason && (
                    <div className="text-[11px] text-danger mt-1.5 max-w-[14rem] leading-snug" title={m.rejectionReason}>Motivo: {m.rejectionReason}</div>
                  )}
                </td>
                <td className="td text-right whitespace-nowrap">
                  {(m.status === 'Aguardando Conferência' || m.status === 'Rejeitado') && <button className="btn-secondary btn-sm mr-1" onClick={() => approve(m.id)}><Check className="w-3.5 h-3.5" /> {m.status === 'Rejeitado' ? 'Reconsiderar' : 'Aprovar'}</button>}
                  {m.status !== 'Rejeitado' && <button className="btn-secondary btn-sm mr-1 !text-danger" onClick={() => { setRejecting({ kind: 'magistrates', id: m.id, name: m.name, linked: m.status === 'Atribuído' }); setRejectReason(''); setModal('reject'); }}><X className="w-3.5 h-3.5" /> Rejeitar</button>}
                  <button className="btn-ghost btn-sm" title="Editar" onClick={() => { setEditingMag(m); setModal('mag-edit'); }}><Pencil className="w-4 h-4" /></button>
                  <button className="btn-danger" title="Excluir" onClick={() => del('magistrates', m.id, `a inscrição de ${m.name}`)}><Trash2 className="w-4 h-4" /></button>
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
            {units.some(u => u.selection === 'Em análise') && (
              <button className="btn-secondary btn-sm" onClick={chooseAll}>
                <Check className="w-4 h-4" /> Aprovar todas pendentes ({units.filter(u => u.selection === 'Em análise').length})
              </button>
            )}
            {units.length > 0 && (
              <button className="btn-secondary btn-sm !text-danger" onClick={() => startWipe('units')}><Trash2 className="w-4 h-4" /> Excluir tudo ({units.length})</button>
            )}
            <button className="btn-primary btn-sm" onClick={() => setModal('unit')}><Plus className="w-4 h-4" /> Cadastrar</button>
            <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/csv?type=units&${q}`, 'unidades.csv')}><Download className="w-4 h-4" /> CSV</button>
          </Toolbar>
          <Table head={['Unidade / Comarca', 'Áreas e auxílio', 'Triagem', 'Status', 'Ações']}>
            {units.length === 0 && <EmptyRow cols={5}>Nenhuma unidade inscrita nesta edição.</EmptyRow>}
            {units.map(u => {
              const open = openUnitId === u.id;
              return (
                <React.Fragment key={u.id}>
                  <tr className={open ? 'bg-paper' : ''}>
                    <td className="td">
                      <button className="flex items-start gap-1.5 text-left" onClick={() => setOpenUnitId(open ? '' : u.id)} aria-expanded={open} title="Ver justificativa e vincular magistrado">
                        {open ? <ChevronDown className="w-4 h-4 mt-0.5 shrink-0 text-bronze" /> : <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 text-muted" />}
                        <span><span className="font-medium block">{u.unitName}</span><span className="text-xs text-muted block">{u.comarca} · Resp.: {u.judgeName}</span><span className="text-xs text-muted block">{u.email}</span><span className="text-[11px] text-muted/80 block">{u.registeredIp ? `IP ${u.registeredIp} · ` : ''}{formatDateTime(u.createdAt)}</span></span>
                      </button>
                    </td>
                    <td className="td"><div className="flex flex-wrap gap-1">{u.areas.map(a => <Badge key={a} tone="info">{a}</Badge>)}<Badge tone="neutral">Precisa de: {u.supportNeeded}</Badge></div></td>
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
                      <td colSpan={5} className="px-4 pb-5 pt-1">
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
              <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/xlsx/matches?${q}`, 'vinculacoes.xlsx')}><Download className="w-4 h-4" /> XLSX</button>
            </Toolbar>
            <p className="text-sm text-muted mb-4">
              Unidades escolhidas para o mutirão. Selecione o magistrado no menu e informe se a atuação será em <strong className="text-ink">audiências</strong>, <strong className="text-ink">sentenças</strong> ou em ambas. A regra é <strong className="text-ink">um magistrado por unidade</strong>; um segundo só em caráter de exceção, com motivo.
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
                    onSave={saveLink} onUnlink={unlinkFromUnit} />
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
          <Table head={['Magistrado(a)', 'Lotação', '1ª preferência', '2ª preferência', 'Audiências', 'Inscrição']}>
            {waiting.length === 0 && <EmptyRow cols={6}>Nenhum magistrado em espera.</EmptyRow>}
            {waiting.map(m => (
              <tr key={m.id}>
                <td className="td"><div className="font-medium">{m.name}</div><div className="text-xs text-muted">{m.email}</div></td>
                <td className="td text-muted">{m.currentLocation}</td>
                <td className="td text-bronze font-medium">{m.firstPreference}</td>
                <td className="td text-muted">{m.secondPreference || '—'}</td>
                <td className="td text-muted">{m.acceptsHearings ? 'Aceita' : 'Não aceita'}</td>
                <td className="td text-xs text-muted">{formatDateTime(m.createdAt)}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {/* ---------- Registro ---------- */}
      {sub === 'log' && (
        <div>
          <Toolbar title="Registro de atividades">
            <select className="input !w-auto !py-1.5 text-xs" value={logFilter} onChange={e => setLogFilter(e.target.value)}>
              <option value="">Todas as categorias</option>
              {['Edição', 'Magistrado', 'Unidade', 'Vinculação', 'Exportação', 'Acesso'].map(c => <option key={c}>{c}</option>)}
            </select>
            <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/csv?type=log&${q}`, 'registro.csv')}><Download className="w-4 h-4" /> CSV</button>
          </Toolbar>
          <Table head={['Data/hora', 'Responsável', 'Categoria', 'Descrição']}>
            {logRows.length === 0 && <EmptyRow cols={4}>Sem registros.</EmptyRow>}
            {logRows.map(l => (
              <tr key={l.id}>
                <td className="td text-xs text-muted whitespace-nowrap">{formatDateTime(l.timestamp)}</td>
                <td className="td text-xs">{l.actor}</td>
                <td className="td"><Badge tone="neutral">{l.category}</Badge></td>
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
          <MagistrateForm withStatus submitLabel="Salvar magistrado" onSubmit={async p => {
            const r = await run(() => api('/magistrates', { method: 'POST', json: withEdition(p) }), 'Magistrado incluído.');
            if (r) { setModal(null); refresh(); }
            return !!r;
          }} />
        </Modal>
      )}
      {modal === 'unit' && (
        <Modal title="Cadastrar unidade judicial" onClose={() => setModal(null)}>
          <UnitForm submitLabel="Salvar unidade" onSubmit={async p => {
            const r = await run(() => api('/units', { method: 'POST', json: withEdition(p) }), 'Unidade incluída.');
            if (r) { setModal(null); refresh(); }
            return !!r;
          }} />
        </Modal>
      )}
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
          <MagistrateForm withStatus initial={editingMag} submitLabel="Salvar alterações" onSubmit={async p => {
            const r = await run(() => api(`/magistrates/${editingMag.id}`, { method: 'PUT', json: p }), 'Inscrição atualizada.');
            if (r) { setModal(null); refresh(); }
            return !!r;
          }} />
        </Modal>
      )}
      {modal === 'unit-edit' && editingUnit && (
        <Modal title="Editar unidade judicial" onClose={() => setModal(null)}>
          <UnitForm withStatus initial={editingUnit} submitLabel="Salvar alterações" onSubmit={async p => {
            const r = await run(() => api(`/units/${editingUnit.id}`, { method: 'PUT', json: p }), 'Unidade atualizada.');
            if (r) { setModal(null); refresh(); }
            return !!r;
          }} />
        </Modal>
      )}
      {modal === 'edition-new' && <Modal title="Nova edição" onClose={() => setModal(null)}><EditionForm onSubmit={createEdition} /></Modal>}
      {modal === 'edition-edit' && editingEdition && <Modal title="Editar edição" onClose={() => setModal(null)}><EditionForm initial={editingEdition} onSubmit={updateEdition} /></Modal>}
      {modal === 'password' && (
        <Modal title="Alterar senha administrativa" onClose={() => setModal(null)}>
          <form onSubmit={changePassword} className="space-y-4">
            <Field label="Senha atual"><input required type="password" className="input" value={pw.currentPassword} onChange={e => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
            <Field label="Nova senha (mín. 6 caracteres)"><input required minLength={6} type="password" className="input" value={pw.newPassword} onChange={e => setPw({ ...pw, newPassword: e.target.value })} /></Field>
            <p className="text-xs text-muted">Se a variável ADMIN_PASSWORD estiver definida, ela volta a valer após reiniciar o servidor.</p>
            <button className="btn-primary w-full">Salvar senha</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
