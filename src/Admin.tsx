import React, { useCallback, useEffect, useState } from 'react';
import { Lock, Unlock, Plus, Trash2, Check, Pencil, Download, Sparkles, LogOut, Radio, Archive, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import { api, download, getToken, setToken } from './api';
import { Edition, LogEntry, Magistrate, Match, Unit, PREFERENCE_AREAS } from './types';
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

/* ---------- Detalhe da unidade: justificativa e vinculação por área ---------- */
function UnitDetail({ unit, magistrates, matches, busy, onLink, onUnlink }: {
  unit: Unit;
  magistrates: Magistrate[];
  matches: Match[];
  busy: boolean;
  onLink: (magistrateId: string, area: string) => void;
  onUnlink: (matchId: string) => void;
}) {
  const [picked, setPicked] = useState('');
  const match = matches.find(m => m.unitId === unit.id);
  const linked = match && magistrates.find(m => m.id === match.magistrateId);
  const matchedIds = new Set(matches.map(m => m.magistrateId));

  // Magistrados ainda sem vínculo cuja 1ª ou 2ª preferência está entre as áreas da unidade
  const candidates = magistrates
    .filter(m => !matchedIds.has(m.id) && m.status !== 'Atribuído'
      && (unit.areas.includes(m.firstPreference) || unit.areas.includes(m.secondPreference)))
    .map(m => ({
      m,
      area: unit.areas.includes(m.firstPreference) ? m.firstPreference : m.secondPreference,
      rank: unit.areas.includes(m.firstPreference) ? 1 : 2,
    }))
    .sort((a, b) => a.rank - b.rank || Number(a.m.status === 'Aguardando Conferência') - Number(b.m.status === 'Aguardando Conferência'));

  const chosen = candidates.find(c => c.m.id === picked);

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
        {match ? (
          <div className="flex items-center justify-between gap-3 bg-ok-soft text-ok rounded-md px-3 py-2.5 text-sm">
            <span>Vinculada a <strong>{linked?.name || 'magistrado removido'}</strong> · {match.assignedArea}</span>
            <button className="btn-secondary btn-sm shrink-0" disabled={busy} onClick={() => onUnlink(match.id)}>Desfazer</button>
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted">Nenhum magistrado disponível com preferência nas áreas desta unidade ({unit.areas.join(', ')}).</p>
        ) : (
          <div className="space-y-2">
            {candidates.map(({ m, area, rank }) => {
              const warn = !m.acceptsHearings && unit.supportNeeded !== 'Sentença';
              return (
                <label key={m.id} className={`flex items-start gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors ${picked === m.id ? 'border-navy bg-navy/5' : 'border-line bg-surface hover:border-slate-300'}`}>
                  <input type="checkbox" className="mt-1" checked={picked === m.id} onChange={() => setPicked(picked === m.id ? '' : m.id)} />
                  <span className="text-sm min-w-0">
                    <span className="font-medium">{m.name}</span>
                    <span className="block text-xs text-muted">{m.currentLocation}</span>
                    <span className="flex flex-wrap gap-1.5 mt-1.5">
                      <Badge tone="info">{rank}ª preferência: {area}</Badge>
                      {m.status === 'Aguardando Conferência' && <Badge tone="warn">Aguardando conferência</Badge>}
                      <Badge tone={m.acceptsHearings ? 'ok' : 'neutral'}>{m.acceptsHearings ? 'Aceita audiências' : 'Não aceita audiências'}</Badge>
                    </span>
                    {warn && <span className="block text-[11px] text-warn mt-1">A unidade precisa de {unit.supportNeeded.toLowerCase()}, e o magistrado não aceita audiências.</span>}
                  </span>
                </label>
              );
            })}
            <button className="btn-primary btn-sm" disabled={!chosen || busy} onClick={() => chosen && onLink(chosen.m.id, chosen.area)}>
              <Check className="w-4 h-4" /> Vincular selecionado
            </button>
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

  const [sub, setSub] = useState<Sub>('overview');
  const [editions, setEditions] = useState<Edition[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [magistrates, setMagistrates] = useState<Magistrate[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [waiting, setWaiting] = useState<Magistrate[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState('');

  const [modal, setModal] = useState<null | 'mag' | 'mag-edit' | 'unit' | 'unit-edit' | 'match' | 'edition-new' | 'edition-edit' | 'password'>(null);
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const [editingEdition, setEditingEdition] = useState<Edition | null>(null);
  const [editingMag, setEditingMag] = useState<Magistrate | null>(null);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [openUnitId, setOpenUnitId] = useState('');
  const [linking, setLinking] = useState(false);
  const [matchForm, setMatchForm] = useState({ magistrateId: '', unitId: '', assignedArea: PREFERENCE_AREAS[0] });
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

  const saveMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => editingMatch
      ? api(`/matches/${editingMatch.id}`, { method: 'PUT', json: matchForm })
      : api('/matches', { method: 'POST', json: withEdition(matchForm) }),
      editingMatch ? 'Vinculação alterada.' : 'Vinculação efetivada.');
    if (r) { setModal(null); refresh(); }
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
  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => api('/admin/password', { method: 'POST', json: pw }), 'Senha alterada.');
    if (r) { setModal(null); setPw({ currentPassword: '', newPassword: '' }); }
  };

  const linkFromUnit = async (unitId: string, magistrateId: string, area: string) => {
    setLinking(true);
    const r = await run(() => api('/matches', { method: 'POST', json: withEdition({ magistrateId, unitId, assignedArea: area }) }), 'Vinculação efetivada.');
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

  const openMatchModal = (m?: Match) => {
    setEditingMatch(m || null);
    setMatchForm(m ? { magistrateId: m.magistrateId, unitId: m.unitId, assignedArea: m.assignedArea } : { magistrateId: '', unitId: '', assignedArea: PREFERENCE_AREAS[0] });
    setModal('match');
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
              ['Em espera', waiting.length], ['Unidades pendentes', units.filter(u => u.status === 'Pendente').length],
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
            <button className="btn-primary btn-sm" onClick={() => setModal('mag')}><Plus className="w-4 h-4" /> Cadastrar</button>
            <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/csv?type=magistrates&${q}`, 'magistrados.csv')}><Download className="w-4 h-4" /> CSV</button>
          </Toolbar>
          <Table head={['Magistrado(a)', 'Lotação', 'Preferências', 'Audiências', 'Status', 'Ações']}>
            {magistrates.length === 0 && <EmptyRow cols={6}>Nenhuma inscrição nesta edição.</EmptyRow>}
            {magistrates.map(m => (
              <tr key={m.id}>
                <td className="td"><div className="font-medium">{m.name}</div><div className="text-xs text-muted">{m.email}</div>{m.registeredIp && <div className="text-[11px] text-muted/80">IP {m.registeredIp}</div>}</td>
                <td className="td text-muted">{m.currentLocation}</td>
                <td className="td text-xs"><div className="text-bronze font-medium">1ª: {m.firstPreference}</div><div className="text-muted">2ª: {m.secondPreference || '—'}</div></td>
                <td className="td"><Badge tone={m.acceptsHearings ? 'ok' : 'neutral'}>{m.acceptsHearings ? 'Aceita' : 'Não aceita'}</Badge></td>
                <td className="td"><Badge tone={magistrateTone(m.status)}>{m.status}</Badge></td>
                <td className="td text-right whitespace-nowrap">
                  {m.status === 'Aguardando Conferência' && <button className="btn-secondary btn-sm mr-1" onClick={() => approve(m.id)}><Check className="w-3.5 h-3.5" /> Aprovar</button>}
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
            <button className="btn-primary btn-sm" onClick={() => setModal('unit')}><Plus className="w-4 h-4" /> Cadastrar</button>
            <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/csv?type=units&${q}`, 'unidades.csv')}><Download className="w-4 h-4" /> CSV</button>
          </Toolbar>
          <Table head={['Unidade / Comarca', 'Responsável', 'Áreas', 'Auxílio', 'Status', 'Ações']}>
            {units.length === 0 && <EmptyRow cols={6}>Nenhuma unidade inscrita nesta edição.</EmptyRow>}
            {units.map(u => {
              const open = openUnitId === u.id;
              return (
                <React.Fragment key={u.id}>
                  <tr className={open ? 'bg-paper' : ''}>
                    <td className="td">
                      <button className="flex items-start gap-1.5 text-left" onClick={() => setOpenUnitId(open ? '' : u.id)} aria-expanded={open} title="Ver justificativa e vincular magistrado">
                        {open ? <ChevronDown className="w-4 h-4 mt-0.5 shrink-0 text-bronze" /> : <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 text-muted" />}
                        <span><span className="font-medium block">{u.unitName}</span><span className="text-xs text-muted block">{u.comarca} · {u.email}</span>{u.registeredIp && <span className="text-[11px] text-muted/80 block">IP {u.registeredIp}</span>}</span>
                      </button>
                    </td>
                    <td className="td text-muted">{u.judgeName}</td>
                    <td className="td"><div className="flex flex-wrap gap-1">{u.areas.map(a => <Badge key={a} tone="info">{a}</Badge>)}</div></td>
                    <td className="td"><Badge tone="neutral">{u.supportNeeded}</Badge></td>
                    <td className="td"><Badge tone={u.status === 'Atendida' ? 'ok' : 'warn'}>{u.status}</Badge></td>
                    <td className="td text-right whitespace-nowrap">
                      <button className="btn-ghost btn-sm" title="Justificativa e vinculação" onClick={() => setOpenUnitId(open ? '' : u.id)}>{open ? 'Fechar' : 'Detalhes'}</button>
                      <button className="btn-ghost btn-sm" title="Editar" onClick={() => { setEditingUnit(u); setModal('unit-edit'); }}><Pencil className="w-4 h-4" /></button>
                      <button className="btn-danger" title="Excluir" onClick={() => del('units', u.id, `a unidade ${u.unitName}`)}><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-paper">
                      <td colSpan={6} className="px-4 pb-5 pt-1">
                        <UnitDetail unit={u} magistrates={magistrates} matches={matches} busy={linking}
                          onLink={(magId, area) => linkFromUnit(u.id, magId, area)} onUnlink={unlinkFromUnit} />
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
      {sub === 'matches' && (
        <div>
          <Toolbar title="Vinculações">
            <button className="btn-primary btn-sm" onClick={() => openMatchModal()}><Plus className="w-4 h-4" /> Nova vinculação</button>
            <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/xlsx/matches?${q}`, 'vinculacoes.xlsx')}><Download className="w-4 h-4" /> XLSX</button>
          </Toolbar>
          <Table head={['Magistrado', 'Unidade', 'Área', 'Observações', 'Ações']}>
            {matches.length === 0 && <EmptyRow cols={5}>Nenhuma vinculação nesta edição.</EmptyRow>}
            {matches.map(mt => {
              const mag = magistrates.find(m => m.id === mt.magistrateId);
              const unit = units.find(u => u.id === mt.unitId);
              return (
                <tr key={mt.id}>
                  <td className="td"><div className="font-medium">{mag?.name || 'Removido'}</div><div className="text-xs text-muted">{mag?.email}</div></td>
                  <td className="td"><div className="font-medium">{unit?.unitName || 'Removida'}</div><div className="text-xs text-muted">{unit?.comarca}</div></td>
                  <td className="td text-bronze font-medium">{mt.assignedArea}</td>
                  <td className="td text-xs text-muted">
                    {mag && <div>Audiências: {mag.acceptsHearings ? 'aceita' : 'não aceita'}</div>}
                    {unit && <div>Unidade precisa de: {unit.supportNeeded}</div>}
                    {mag && unit && !mag.acceptsHearings && unit.supportNeeded !== 'Sentença' && <div className="text-warn font-medium mt-0.5">Atenção: magistrado não aceita audiências</div>}
                  </td>
                  <td className="td text-right whitespace-nowrap">
                    <button className="btn-ghost btn-sm" title="Alterar" onClick={() => openMatchModal(mt)}><Pencil className="w-4 h-4" /></button>
                    <button className="btn-danger" title="Desfazer" onClick={() => del('matches', mt.id, 'esta vinculação')}><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              );
            })}
          </Table>
        </div>
      )}

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
      {modal === 'match' && (
        <Modal title={editingMatch ? 'Alterar vinculação' : 'Nova vinculação'} onClose={() => setModal(null)}>
          <form onSubmit={saveMatch} className="space-y-4">
            <Field label="Magistrado">
              <select required className="input" value={matchForm.magistrateId} onChange={e => setMatchForm({ ...matchForm, magistrateId: e.target.value })}>
                <option value="">Selecione…</option>
                {magistrates.filter(m => m.status !== 'Atribuído' || m.id === matchForm.magistrateId).map(m => <option key={m.id} value={m.id}>{m.name} — {m.status}</option>)}
              </select>
            </Field>
            <Field label="Unidade judicial">
              <select required className="input" value={matchForm.unitId} onChange={e => setMatchForm({ ...matchForm, unitId: e.target.value })}>
                <option value="">Selecione…</option>
                {units.map(u => <option key={u.id} value={u.id}>{u.unitName} ({u.comarca}) — {u.supportNeeded}</option>)}
              </select>
            </Field>
            <Field label="Área atribuída">
              <select className="input" value={matchForm.assignedArea} onChange={e => setMatchForm({ ...matchForm, assignedArea: e.target.value })}>
                {PREFERENCE_AREAS.map(a => <option key={a}>{a}</option>)}
              </select>
            </Field>
            <button className="btn-primary w-full">{editingMatch ? 'Salvar alteração' : 'Efetivar vinculação'}</button>
          </form>
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
