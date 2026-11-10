// Área administrativa: login, cabeçalho com filtro de janela, abas e as listas de magistrados e unidades. As telas de cada assunto ficam em src/admin/.
import { Badge, Field, Modal, Notice, formatDate, formatDateTime, magistrateTone, useFeedback } from './ui';
import React, { useCallback, useEffect, useState } from 'react';
import { api, download, getToken, setToken } from './api';
import { Edition, FaqItem, LogEntry, Magistrate, Match, Unit, WorkType, hearingPeriodLabel } from './types';
import { Lock, Unlock, Plus, Trash2, Check, Pencil, Download, LogOut, Radio, Archive, RotateCcw, ChevronDown, ChevronRight, X, ArrowUp, ArrowDown, Settings2 } from 'lucide-react';
import { MagistrateForm, UnitForm } from './Forms';
import { BackupAdmin } from './admin/backup';
import { CatalogAdmin } from './admin/catalog';
import { AttendedUnits, type Presence, PresenceNote, SupplyDemand } from './admin/dashboard';
import { EditionForm, ExcludeModal, FaqForm } from './admin/forms';
import { SlotsControl, UnitDetail, UnitLinkRow, unitMatchesOf } from './admin/linking';
import { PanelAdmin } from './admin/panel';
import { dmy, readPref, SELECTION_ORDER, type Sub, unitLabel, writePref } from './admin/shared';
import { StandardizeAdmin } from './admin/standardize';
import { DateCell, SmartTable, Toolbar } from './admin/table';
import { UsersAdmin } from './admin/users';

const SUBS: { id: Sub; label: string }[] = [
  { id: 'overview', label: 'Painel' },
  { id: 'editions', label: 'Janelas de inscrição' },
  { id: 'magistrates', label: 'Magistrados' },
  { id: 'units', label: 'Unidades' },
  { id: 'matches', label: 'Vinculações' },
  { id: 'standardize', label: 'Padronizar nomes' },
  { id: 'catalog', label: 'Comarcas e unidades' },
  { id: 'faq', label: 'Perguntas frequentes' },
  { id: 'log', label: 'Registro' },
  { id: 'backup', label: 'Backup' },
  { id: 'users', label: 'Usuários' },
];

/** Seções da aba Vinculações: designações vigentes e histórico, vincular unidades e lista de espera */
type LinkView = 'panel' | 'link' | 'waiting';

export default function Admin({ onEditionsChanged }: { onEditionsChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const [authed, setAuthed] = useState(!!getToken());
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  // Etapa 2 do login (código do aplicativo autenticador) ou cadastro do aplicativo no primeiro acesso
  const [loginStep, setLoginStep] = useState<null | { kind: 'totp' | 'enroll'; challenge: string; secret?: string; qrSvg?: string }>(null);
  const [totpCode, setTotpCode] = useState('');
  const [rememberDevice, setRememberDevice] = useState(false);
  const [keepSession, setKeepSession] = useState(() => readPref<{ on: boolean }>('mutirao-keep-session', { on: false }).on);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginMode, setLoginMode] = useState<{ users: boolean; shared: boolean }>({ users: false, shared: true });
  const [me, setMe] = useState<{ name: string; role: 'admin' | 'gestor' | 'consulta'; shared: boolean; users: boolean; sessionExpiresAt?: string; keep?: boolean; otherSessions?: number; hiddenTabs?: string[] } | null>(null);
  const [tabsOpen, setTabsOpen] = useState(false);
  const [tabsDraft, setTabsDraft] = useState<string[]>([]);
  const [myPw, setMyPw] = useState<null | { current: string; next: string }>(null);
  const [excluding, setExcluding] = useState<Magistrate | null>(null);
  const [backupWarn, setBackupWarn] = useState('');
  useEffect(() => {
    if (me?.role !== 'admin') return;
    api<{ configured: boolean; last: { at: string; ok: boolean; error?: string } | null }>('/backup/auto/status').then(st => {
      if (!st.configured) return setBackupWarn('');
      if (!st.last) return setBackupWarn('O backup automático está configurado, mas ainda não rodou nenhuma vez.');
      if (!st.last.ok) return setBackupWarn(`O último backup automático falhou (${formatDateTime(st.last.at)}). Veja a aba Backup.`);
      if (Date.now() - Date.parse(st.last.at) > 36 * 3600_000) return setBackupWarn(`O último backup automático é de ${formatDateTime(st.last.at)} (mais de 36 horas).`);
      setBackupWarn('');
    }).catch(() => {});
  }, [me]);
  useEffect(() => { if (!authed) api<{ users: boolean; shared: boolean }>('/admin/login-mode').then(setLoginMode).catch(() => {}); }, [authed]);

  const [sub, setSub] = useState<Sub>('overview');
  const [linkView, setLinkView] = useState<LinkView>('panel');
  const [editions, setEditions] = useState<Edition[]>([]);
  // Filtro por janela de inscrição ('all' = todo o mutirão). Magistrados, unidades e vinculações ficam sempre completos na memória
  // (a vinculação pode unir janelas diferentes); o filtro só restringe o que é exibido.
  const [selectedId, setSelectedId] = useState('all');
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
  const [presence, setPresence] = useState<Record<string, Presence>>({});
  const [rejecting, setRejecting] = useState<{ kind: 'magistrates' | 'units'; id: string; name: string; linked: boolean } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectCarry, setRejectCarry] = useState(false);
  const [faqItems, setFaqItems] = useState<FaqItem[]>([]);
  const [editingFaq, setEditingFaq] = useState<FaqItem | null>(null);
  const [wiping, setWiping] = useState<'magistrates' | 'units' | 'matches' | null>(null);
  const [wipeText, setWipeText] = useState('');
  const [deletingEdition, setDeletingEdition] = useState<Edition | null>(null);
  const [deleteText, setDeleteText] = useState('');
  const [linking, setLinking] = useState(false);

  const selected = editions.find(e => e.id === selectedId);
  const allScope = selectedId === 'all';
  const inScope = (x: { editionId: string }) => allScope || x.editionId === selectedId;
  /** Janela que recebe os cadastros feitos pela administração: a filtrada ou, com "todas", a vigente no portal */
  const target = selected ?? editions.find(e => e.isActive) ?? editions[0];
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
    setSelectedId(prev => (prev === 'all' || r.editions.some(e => e.id === prev) ? prev : 'all'));
  }, [run]);

  const loadFaq = useCallback(async () => {
    const r = await run(() => api<FaqItem[]>('/faq/all'));
    if (r) setFaqItems(r);
  }, [run]);

  const loadScoped = useCallback(async () => {
    if (!selectedId) return;
    const q = `?edition=${encodeURIComponent(selectedId)}`;
    const r = await run(() => Promise.all([
      api<Magistrate[]>('/magistrates?edition=all'), api<Unit[]>('/units?edition=all'), api<Match[]>('/matches?edition=all'),
      api<Magistrate[]>(`/waiting-list${q}`), api<LogEntry[]>(`/log${selectedId === 'all' ? '' : q}`),
    ]));
    if (!r) return;
    api<Record<string, Presence>>('/panel/presence').then(setPresence).catch(() => setPresence({}));
    [setMagistrates, setUnits, setMatches, setWaiting, setLog].forEach((set, i) => (set as any)(r[i]));
  }, [selectedId, run]);

  const refresh = useCallback(async () => { await loadEditions(); await loadScoped(); onEditionsChanged(); }, [loadEditions, loadScoped, onEditionsChanged]);

  useEffect(() => { if (authed) { loadEditions(); loadFaq(); api<typeof me>('/admin/me').then(setMe).catch(() => setMe(null)); } }, [authed]);
  useEffect(() => { if (authed) loadScoped(); }, [authed, selectedId]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const account = loginEmail.trim().toLowerCase() || 'shared';
      const devices = readPref<Record<string, string>>('mutirao-devices', {});
      if (!loginStep) {
        writePref('mutirao-keep-session', { on: keepSession });
        const r = await api<{ token?: string; keep?: boolean; step: 'totp' | 'enroll'; challenge: string; secret?: string; qrSvg?: string }>('/admin/login', { method: 'POST', json: { email: loginEmail.trim(), password, deviceToken: devices[account], keep: keepSession } });
        setPassword('');
        if (r.token) { setToken(r.token, r.keep === true); setAuthed(true); return; } // dispositivo lembrado: dispensa o código
        setLoginStep({ kind: r.step, challenge: r.challenge, secret: r.secret, qrSvg: r.qrSvg });
        setTotpCode('');
      } else {
        const r = await api<{ token: string; keep?: boolean; deviceToken?: string }>('/admin/login/verify', { method: 'POST', json: { challenge: loginStep.challenge, code: totpCode, remember: rememberDevice, keep: keepSession } });
        if (r.deviceToken) writePref('mutirao-devices', { ...devices, [account]: r.deviceToken });
        else if (devices[account]) { delete devices[account]; writePref('mutirao-devices', devices); }
        setToken(r.token, r.keep === true); setLoginStep(null); setTotpCode(''); setAuthed(true);
      }
    } catch (err: any) {
      setLoginError(err.message);
      if (loginStep && /expirada|esgotadas/i.test(err.message)) setLoginStep(null);
    }
  };
  const logout = () => { api('/admin/logout', { method: 'POST' }).catch(() => {}); setToken(''); setMe(null); setAuthed(false); };

  const q = `edition=${encodeURIComponent(selectedId)}`;
  const withEdition = (body: object) => ({ ...body, editionId: target?.id, source: 'admin' });

  /* ---------- Login ---------- */
  // Abas que o perfil pode ver e, delas, as que o usuário escolheu esconder na própria tela
  const allowedSubs = SUBS.filter(t => me?.role === 'admin' || (t.id !== 'users' && t.id !== 'backup'));
  const hiddenTabs = (me?.hiddenTabs ?? []).filter(id => allowedSubs.some(t => t.id === id));
  useEffect(() => {
    if (!hiddenTabs.includes(sub)) return;
    const first = allowedSubs.find(t => !hiddenTabs.includes(t.id));
    if (first) setSub(first.id);
  }, [me?.hiddenTabs, me?.role]);

  if (!authed) {
    return (
      <div className="card max-w-sm mx-auto p-8 mt-6">
        <Lock className="w-5 h-5 text-bronze mb-3" />
        <h2 className="text-2xl font-semibold text-navy">Área administrativa</h2>
        <p className="text-sm text-muted mt-1 mb-6">Acesso restrito à coordenação do mutirão.</p>
        {loginError && <div className="mb-4"><Notice tone="danger">{loginError}</Notice></div>}
        <form onSubmit={login} className="space-y-4">
          {!loginStep && (loginMode.users || loginEmail) && (
            <Field label={loginMode.shared ? 'E-mail (deixe em branco para usar a senha compartilhada)' : 'E-mail'}>
              <input type="email" required={!loginMode.shared} autoFocus autoComplete="username" className="input" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} />
            </Field>
          )}
          {!loginStep && (
            <Field label="Senha"><input type="password" required autoFocus={!loginMode.users} autoComplete="current-password" className="input" value={password} onChange={e => setPassword(e.target.value)} /></Field>
          )}
          {!loginStep && (
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" className="mt-0.5" checked={keepSession} onChange={e => setKeepSession(e.target.checked)} />
              <span>Manter conectado por 30 dias <span className="block text-xs text-muted">A sessão continua aberta neste navegador, mesmo depois de fechá-lo, até você clicar em Sair. Não marque em computador compartilhado.</span></span>
            </label>
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
          {loginStep && (
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" className="mt-0.5" checked={rememberDevice} onChange={e => setRememberDevice(e.target.checked)} />
              <span>Lembrar este dispositivo por 30 dias <span className="block text-xs text-muted">Nos próximos acessos, só a senha será pedida. Não marque em computador compartilhado.</span></span>
            </label>
          )}
          <button className="btn-primary w-full"><Unlock className="w-4 h-4" /> {loginStep ? (loginStep.kind === 'enroll' ? 'Ativar e entrar' : 'Verificar e entrar') : 'Continuar'}</button>
          {loginStep && <button type="button" className="btn-ghost w-full" onClick={() => { setLoginStep(null); setLoginError(''); }}>Voltar</button>}
        </form>
      </div>
    );
  }

  /* ---------- Ações ---------- */
  const excludeMag = async (reason: string, sei: string) => {
    if (!excluding) return;
    if (await run(() => api(`/magistrates/${excluding.id}/exclude`, { method: 'POST', json: { reason, sei } }), 'Magistrado excluído.')) { setExcluding(null); refresh(); }
  };
  const restoreMag = async (m: Magistrate) => {
    if (!(await confirm(`Desfazer a exclusão de ${m.name}? A inscrição volta ao status anterior (vinculações desfeitas não são restauradas).`, 'Desfazer exclusão'))) return;
    await run(() => api(`/magistrates/${m.id}/restore`, { method: 'POST' }), 'Exclusão desfeita.'); refresh();
  };
  const del = async (kind: 'magistrates' | 'units' | 'matches', id: string, what: string) => {
    if (!(await confirm(`Excluir ${what}? Esta ação ficará registrada.`, 'Excluir'))) return;
    await run(() => api(`/${kind}/${id}`, { method: 'DELETE' }), 'Registro excluído.');
    refresh();
  };
  const approve = async (id: string) => { await run(() => api(`/magistrates/${id}/approve`, { method: 'POST' }), 'Inscrição aprovada.'); refresh(); };
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
    const r = await run(() => api('/editions', { method: 'POST', json: v }), 'Janela de inscrição criada.');
    if (r) { setModal(null); await loadEditions(); onEditionsChanged(); setSub('editions'); }
  };
  const updateEdition = async (v: any) => {
    if (!editingEdition) return;
    const r = await run(() => api(`/editions/${editingEdition.id}`, { method: 'PUT', json: v }), 'Janela de inscrição atualizada.');
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
    const r = await run(() => api(`/${rejecting.kind}/${rejecting.id}/reject`, { method: 'POST', json: { reason: rejectReason, carryOver: rejecting.kind === 'units' && rejectCarry } }),
      rejecting.kind === 'units' ? (rejectCarry ? 'Unidade rejeitada; o pedido volta para análise na próxima janela.' : 'Unidade rejeitada.') : 'Inscrição rejeitada.');
    if (r) { setModal(null); refresh(); }
  };
  const WIPE = {
    magistrates: { path: '/magistrates/delete-all', label: 'inscrições de magistrados', count: () => magistrates.filter(inScope).length,
      effect: 'As vinculações desses magistrados também serão removidas, e as unidades afetadas voltarão a ficar sem magistrado.' },
    units: { path: '/units/delete-all', label: 'unidades judiciais', count: () => units.filter(inScope).length,
      effect: 'As vinculações dessas unidades também serão removidas, e os magistrados afetados voltarão à lista de espera.' },
    matches: { path: '/matches/delete-all', label: 'vinculações', count: () => matches.filter(inScope).length,
      effect: 'Os magistrados voltarão à lista de espera e as unidades ficarão sem magistrado. As inscrições são mantidas.' },
  } as const;
  const startWipe = (kind: 'magistrates' | 'units' | 'matches') => { setWiping(kind); setWipeText(''); setModal('wipe'); };
  const confirmWipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wiping || wipeText.trim() !== 'EXCLUIR') return;
    const r = await run(() => api<{ count: number }>(`${WIPE[wiping].path}?${q}`, { method: 'POST', json: { confirm: 'EXCLUIR' } }));
    if (r) { toast(`${r.count} registro(s) excluído(s).`); setModal(null); refresh(); }
  };

  const confirmDeleteEdition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deletingEdition || deleteText.trim() !== 'EXCLUIR') return;
    const r = await run(() => api(`/editions/${deletingEdition.id}/delete`, { method: 'POST', json: { confirm: 'EXCLUIR' } }), `Janela "${deletingEdition.title}" excluída.`);
    if (r) { setDeletingEdition(null); refresh(); }
  };

  const approveAll = async () => {
    const n = magistrates.filter(m => inScope(m) && m.status === 'Aguardando Conferência').length;
    if (!(await confirm(`Aprovar as ${n} inscrição(ões) de magistrado(s) pendente(s)? Inscrições rejeitadas não serão alteradas.`, 'Aprovar todos'))) return;
    const r = await run(() => api<{ count: number }>(`/magistrates/approve-all?${q}`, { method: 'POST' }));
    if (r) toast(`${r.count} inscrição(ões) aprovada(s).`);
    refresh();
  };
  const chooseAll = async () => {
    const n = units.filter(u => inScope(u) && u.selection === 'Em análise').length;
    if (!(await confirm(`Escolher as ${n} unidade(s) em análise para o mutirão? Unidades rejeitadas não serão alteradas.`, 'Escolher todas'))) return;
    const r = await run(() => api<{ count: number }>(`/units/choose-all?${q}`, { method: 'POST' }));
    if (r) toast(`${r.count} unidade(s) escolhida(s).`);
    refresh();
  };
  const setSlots = async (unit: Unit, n: number) => {
    const r = await run(() => api(`/units/${unit.id}`, { method: 'PUT', json: { slots: n } }), `Magistrados a alocar: ${n}.`);
    if (r) refresh();
  };
  const mergeUnit = async (u: Unit) => {
    if (!(await confirm(`Fundir as ${u.duplicateCount} inscrições de "${unitLabel(u)}" desta janela em uma só? Vinculações, vagas, áreas e justificativas passam para a inscrição mais antiga.`, 'Fundir'))) return;
    await run(() => api('/units/merge', { method: 'POST', json: { id: u.id } }), 'Inscrições fundidas.'); refresh();
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

  const sortedMagistrates = magistrates.filter(m => inScope(m) && m.status !== 'Excluído'); // a ordem é definida pelos cabeçalhos da tabela
  const excludedMags = magistrates.filter(m => inScope(m) && m.status === 'Excluído').sort((a, b) => (b.excludedAt ?? '').localeCompare(a.excludedAt ?? ''));
  const sortedUnits = units.filter(inScope);

  const readOnlyEdition = selected?.status === 'Encerrada';
  const logRows = log.filter(l => !logFilter || l.category === logFilter);

  return (
    <div className="space-y-6">
      {/* Cabeçalho: mutirão único, com filtro opcional por janela de inscrição */}
      <div className="card p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <label className="label" htmlFor="janela-filtro">Janela de inscrição</label>
          <div className="flex flex-wrap items-center gap-3">
            <select id="janela-filtro" className="input max-w-md" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
              <option value="all">Todas as janelas (mutirão completo)</option>
              {editions.map(e => <option key={e.id} value={e.id}>{e.title}{e.isActive ? ' (vigente no portal)' : ''}</option>)}
            </select>
            {selected && <Badge tone={selected.status === 'Encerrada' ? 'neutral' : 'ok'}>{selected.status}</Badge>}
            {selected?.isActive && <Badge tone="info">Vigente no portal</Badge>}
            {!selected && target && <span className="text-xs text-muted">Inscrições do portal e novos cadastros vão para <strong className="text-ink">{target.title}</strong>.</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setModal('edition-new')}><Plus className="w-4 h-4" /> Nova janela</button>
          <button className="btn-ghost" onClick={logout}><LogOut className="w-4 h-4" /> Sair</button>
        </div>
      </div>
      {me && (
        <div className="flex flex-wrap items-center justify-end gap-3 -mt-3 text-xs text-muted">
          <span>Conectado como <strong className="text-ink">{me.name}</strong> · {({ admin: 'Administrador', gestor: 'Gestor', consulta: 'Consulta' } as const)[me.role]}</span>
          {me.keep && me.sessionExpiresAt && <span title="Opção &quot;Manter conectado&quot; marcada no login">Conectado até {formatDateTime(me.sessionExpiresAt)}</span>}
          {!!me.otherSessions && <button className="text-bronze hover:underline" onClick={async () => {
            if (!(await confirm(`Encerrar ${me.otherSessions} outra(s) sessão(ões) aberta(s) com o seu acesso em outros computadores ou navegadores? Esta sessão continua aberta.`, 'Encerrar sessões'))) return;
            if (await run(() => api('/admin/me/sessions/end-others', { method: 'POST' }), 'Outras sessões encerradas.')) setMe({ ...me, otherSessions: 0 });
          }}>Encerrar outras sessões ({me.otherSessions})</button>}
          {!me.shared && <button className="text-bronze hover:underline" onClick={() => setMyPw({ current: '', next: '' })}>Alterar minha senha</button>}
          {me.shared && me.role === 'admin' && !me.users && <button className="text-bronze hover:underline" onClick={() => setSub('users')}>Cadastre usuários individuais (recomendado)</button>}
        </div>
      )}
      {me?.role === 'consulta' && <Notice tone="ok">Perfil somente consulta: você pode ver e exportar, mas não alterar dados.</Notice>}
      {myPw && (
        <Modal title="Alterar minha senha" onClose={() => setMyPw(null)}>
          <form className="space-y-4" onSubmit={async e => { e.preventDefault(); if (await run(() => api('/admin/me/password', { method: 'POST', json: myPw }), 'Senha alterada.')) setMyPw(null); }}>
            <Field label="Senha atual"><input className="input" type="password" required autoComplete="current-password" value={myPw.current} onChange={e => setMyPw({ ...myPw, current: e.target.value })} /></Field>
            <Field label="Nova senha (mín. 10 caracteres)"><input className="input" type="password" required minLength={10} autoComplete="new-password" value={myPw.next} onChange={e => setMyPw({ ...myPw, next: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setMyPw(null)}>Cancelar</button><button className="btn-primary">Salvar</button></div>
          </form>
        </Modal>
      )}

      {readOnlyEdition && <Notice tone="danger">Esta janela de inscrição está encerrada. Os dados continuam editáveis aqui, mas o portal público não aceita inscrições nela.</Notice>}

      <div className="flex flex-wrap gap-x-1 border-b border-line">
        {allowedSubs.filter(t => !hiddenTabs.includes(t.id)).map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${sub === t.id ? 'border-navy text-navy font-medium' : 'border-transparent text-muted hover:text-ink'}`}>
            {t.label}
          </button>
        ))}
        <button type="button" title="Escolher as abas que aparecem na sua tela" aria-label="Personalizar abas" onClick={() => { setTabsDraft(hiddenTabs); setTabsOpen(true); }}
          className="ml-auto px-3 py-2.5 text-sm text-muted hover:text-ink flex items-center gap-1.5 whitespace-nowrap"><Settings2 className="w-4 h-4" /> Personalizar abas</button>
      </div>

      {tabsOpen && (
        <Modal title="Abas da sua tela" onClose={() => setTabsOpen(false)}>
          <form className="space-y-4" onSubmit={async e => {
            e.preventDefault();
            const r = await run(() => api<{ hiddenTabs: string[] }>('/admin/me/tabs', { method: 'PUT', json: { hidden: tabsDraft } }), 'Abas atualizadas.');
            if (r && me) { setMe({ ...me, hiddenTabs: r.hiddenTabs }); setTabsOpen(false); }
          }}>
            <p className="text-sm text-muted">Marque as abas que devem aparecer. A escolha vale só para você (em qualquer computador) e não muda o que o seu perfil pode acessar.</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {allowedSubs.map(t => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!tabsDraft.includes(t.id)} onChange={e => setTabsDraft(e.target.checked ? tabsDraft.filter(x => x !== t.id) : [...tabsDraft, t.id])} /> {t.label}
                </label>
              ))}
            </div>
            <div className="flex justify-between gap-2">
              <button type="button" className="btn-ghost" onClick={() => setTabsDraft([])}>Mostrar todas</button>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost" onClick={() => setTabsOpen(false)}>Cancelar</button>
                <button className="btn-primary" disabled={allowedSubs.every(t => tabsDraft.includes(t.id))}>Salvar</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* ---------- Painel ---------- */}
      {sub === 'overview' && (
        <div className="space-y-6">
          {backupWarn && <Notice tone="danger">{backupWarn}</Notice>}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              ['Magistrados', magistrates.filter(inScope).length], ['Unidades', units.filter(inScope).length], ['Vinculações', matches.filter(inScope).length],
              ['Em espera', waiting.length], ['Unidades sem magistrado', units.filter(u => inScope(u) && u.selection === 'Escolhida' && u.status === 'Pendente').length],
            ].map(([l, v]) => (
              <div key={l as string} className="card p-5">
                <div className="text-3xl font-serif font-semibold text-navy">{v}</div>
                <div className="text-xs text-muted mt-1">{l}</div>
              </div>
            ))}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="card p-5 space-y-3">
              <h4 className="font-semibold text-navy">Exportação</h4>
              <p className="text-sm text-muted">Dados {allScope ? 'de todo o mutirão' : 'desta janela de inscrição'}, incluindo o registro de atividades.</p>
              <div className="flex gap-2 flex-wrap">
                <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/csv?type=all&${q}`, 'mutirao.csv')}><Download className="w-4 h-4" /> CSV</button>
                <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/xlsx/matches?${q}`, 'vinculacoes.xlsx')}><Download className="w-4 h-4" /> XLSX</button>
              </div>
            </div>
          </div>
          <SupplyDemand editionId={selectedId} refreshKey={matches.length + units.length + magistrates.length} onGo={setSub} />
          <AttendedUnits refreshKey={matches.length + units.length} />
          <div className="card p-5">
            <h4 className="font-semibold text-navy mb-3">Últimas atividades</h4>
            {log.slice(0, 6).map(l => (
              <div key={l.id} className="flex gap-3 py-1.5 text-sm"><span className="text-xs text-muted w-36 shrink-0 pt-0.5">{formatDateTime(l.timestamp)}</span><span>{l.description}{l.by && <span className="text-xs text-muted"> — {l.by}</span>}</span></div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- Janelas de inscrição ---------- */}
      {sub === 'editions' && (
        <div className="space-y-6">
          <Toolbar title="Janelas de inscrição">
            <button className="btn-primary btn-sm" onClick={() => setModal('edition-new')}><Plus className="w-4 h-4" /> Nova janela</button>
          </Toolbar>
          <SmartTable id="edicoes" picker={false} rows={editions} rowKey={e => e.id} empty="Nenhuma janela de inscrição." defaultSort={{ key: 'created', dir: 'desc' }}
            rowClass={e => (e.id === selectedId ? 'bg-bronze-soft/40' : '')} cols={[
            { id: 'title', label: 'Janela', sort: e => e.title, render: e => <><div className="font-medium">{e.title}</div><div className="text-xs text-muted">Criada em {formatDate(e.createdAt)}</div></> },
            { id: 'created', label: 'Período', sort: e => e.openingDate, tdClass: 'text-muted text-xs', render: e => <>{formatDate(e.openingDate)} a {formatDate(e.closingDate)}<div className={e.startDate ? 'text-bronze' : 'text-warn'}>Início da atuação: {e.startDate ? dmy(e.startDate) : 'a informar'}</div></> },
            { id: 'stats', label: 'Inscritos', sort: e => e.stats?.magistrates ?? 0, tdClass: 'text-xs text-muted', render: e => <>{e.stats?.magistrates ?? 0} magistrados<br />{e.stats?.units ?? 0} unidades · {e.stats?.matches ?? 0} vínculos</> },
            { id: 'status', label: 'Situação', sort: e => e.status, tdClass: 'space-y-1', render: e => <>
              <div><Badge tone={e.status === 'Encerrada' ? 'neutral' : 'ok'}>{e.status}</Badge></div>
              {e.isActive && <div><Badge tone="info">Vigente no portal</Badge></div>}
              {e.registration && (
                <div title={e.registration.message}>
                  <Badge tone={e.registration.state === 'open' ? 'ok' : e.registration.state === 'not_yet' ? 'warn' : 'neutral'}>
                    {{ open: 'Inscrições abertas', not_yet: 'Ainda não abriu', ended: 'Prazo encerrado', paused: 'Inscrições suspensas', closed: 'Janela encerrada' }[e.registration.state as string] ?? e.registration.state}
                  </Badge>
                </div>
              )}
            </> },
            { id: 'actions', label: 'Ações', align: 'right', tdClass: 'whitespace-nowrap', render: e => <>
              {e.id !== selectedId && <button className="btn-ghost btn-sm" title="Mostrar só os registros desta janela" onClick={() => setSelectedId(e.id)}>Filtrar</button>}
              {!e.isActive && e.status === 'Em andamento' && <button className="btn-ghost btn-sm" title="Tornar vigente" onClick={() => editionAction(e.id, 'activate', 'Janela vigente atualizada.', 'Tornar esta edição a vigente? As novas inscrições públicas passarão a ser registradas nela.')}><Radio className="w-4 h-4" /></button>}
              {e.status === 'Em andamento'
                ? <button className="btn-ghost btn-sm" title="Encerrar janela" onClick={() => editionAction(e.id, 'close', 'Janela encerrada.', 'Encerrar a janela de inscrição? As inscrições públicas serão fechadas.')}><Archive className="w-4 h-4" /></button>
                : <button className="btn-ghost btn-sm" title="Reabrir janela" onClick={() => editionAction(e.id, 'reopen', 'Janela reaberta.')}><RotateCcw className="w-4 h-4" /></button>}
              <button className="btn-ghost btn-sm" title="Editar" onClick={() => { setEditingEdition(e); setModal('edition-edit'); }}><Pencil className="w-4 h-4" /></button>
              {me?.role === 'admin' && (
                <button className="btn-ghost btn-sm !text-danger disabled:opacity-30" title={e.isInitial ? 'A janela das vinculações iniciais não pode ser excluída' : e.isActive ? 'Torne outra janela vigente antes de excluir esta' : 'Excluir janela'}
                  disabled={e.isInitial || e.isActive || editions.length <= 1} onClick={() => { setDeletingEdition(e); setDeleteText(''); }}><Trash2 className="w-4 h-4" /></button>
              )}
            </> },
          ]} />
          <p className="text-xs text-muted">O mutirão é um só: magistrados de qualquer janela podem ser vinculados a unidades de qualquer janela. A janela guarda a origem da inscrição e a data padrão de início da atuação. O portal recebe inscrições apenas na janela vigente, dentro do prazo.</p>
        </div>
      )}

      {/* ---------- Magistrados ---------- */}
      {sub === 'magistrates' && (
        <div>
          <Toolbar title="Magistrados voluntários">
            {sortedMagistrates.some(m => m.status === 'Aguardando Conferência') && (
              <button className="btn-secondary btn-sm" onClick={approveAll}>
                <Check className="w-4 h-4" /> Aprovar todos pendentes ({sortedMagistrates.filter(m => m.status === 'Aguardando Conferência').length})
              </button>
            )}
            {!allScope && sortedMagistrates.length + excludedMags.length > 0 && (
              <button className="btn-secondary btn-sm !text-danger" onClick={() => startWipe('magistrates')}><Trash2 className="w-4 h-4" /> Excluir tudo da janela ({sortedMagistrates.length + excludedMags.length})</button>
            )}
            <button className="btn-primary btn-sm" onClick={() => setModal('mag')}><Plus className="w-4 h-4" /> Cadastrar</button>
            <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/csv?type=magistrates&${q}`, 'magistrados.csv')}><Download className="w-4 h-4" /> CSV</button>
          </Toolbar>
          <SmartTable id="magistrados" rows={sortedMagistrates} rowKey={m => m.id} empty={allScope ? 'Nenhuma inscrição.' : 'Nenhuma inscrição nesta janela.'} defaultSort={{ key: 'name', dir: 'asc' }} cols={[
            { id: 'name', label: 'Magistrado(a)', sort: m => m.name, tdClass: 'min-w-[13rem]', render: m => <>
              <div className="font-medium">{m.name}</div>
              <div className="text-[11px] text-bronze">{m.editionTitle}</div>
              {m.duplicateCount && <div className="text-[11px] text-danger mt-0.5">◦ Mesmo nome com {m.duplicateCount} inscrições em aberto</div>}
              {m.linkedElsewhere && <div className="text-[11px] text-danger mt-0.5 leading-snug">
                ◦ Duplicidade: já vinculado(a) e ativo(a) por outra inscrição
                {m.linkedElsewhere.map((l, i) => <div key={i} className="text-muted">{l.unit} ({l.area}) · {l.editionTitle}</div>)}
              </div>}
              {m.priorWithdrawal && <div className="text-[11px] text-warn mt-0.5">Já desistiu antes (SEI {m.priorWithdrawal.sei || 'não informado'}{m.priorWithdrawal.requestDate ? `, pedido em ${m.priorWithdrawal.requestDate.split('-').reverse().join('/')}` : ''}). Se deferida esta inscrição, a desistência passa a valer só para o período anterior.</div>}
            </> },
            { id: 'email', label: 'E-mail', optional: true, hidden: true, sort: m => m.email, render: m => <span className="text-xs text-muted break-all">{m.email || '—'}</span> },
            { id: 'ip', label: 'IP', optional: true, hidden: true, sort: m => m.registeredIp ?? '', render: m => <span className="text-xs text-muted font-mono">{m.registeredIp || '—'}</span> },
            { id: 'createdAt', label: 'Inscrição', optional: true, hidden: true, sort: m => m.createdAt, render: m => <DateCell iso={m.createdAt} /> },
            { id: 'location', label: 'Lotação', optional: true, filter: m => m.currentLocation, sort: m => m.currentLocation, tdClass: 'text-muted', render: m => <>{m.currentLocation}{m.currentLocation && !m.locationCatalogId && <span className="text-[11px] text-warn block">◦ A padronizar</span>}</> },
            { id: 'prefs', label: 'Preferências', optional: true, filter: m => [m.firstPreference, m.secondPreference].filter(Boolean), sort: m => m.firstPreference, tdClass: 'text-xs', render: m => <><div className="text-bronze font-medium">1ª: {m.firstPreference}</div><div className="text-muted">2ª: {m.secondPreference || '—'}</div></> },
            { id: 'hearings', label: 'Audiências', optional: true, filter: m => (m.acceptsHearings ? ['Aceita audiências', ...(m.hearingPeriod ? [hearingPeriodLabel(m.hearingPeriod)] : [])] : 'Não aceita'), sort: m => (m.acceptsHearings ? 1 : 0), render: m => <div className="flex flex-col items-start gap-0.5"><Badge tone={m.acceptsHearings ? 'ok' : 'neutral'}>{m.acceptsHearings ? 'Aceita' : 'Não aceita'}</Badge>{m.acceptsHearings && m.hearingPeriod && <span className="text-[11px] text-muted">{hearingPeriodLabel(m.hearingPeriod)}</span>}</div> },
            { id: 'status', label: 'Status', sort: m => m.status, filter: m => m.status, render: m => <>
              <Badge tone={magistrateTone(m.status)}>{m.status}</Badge>
              {m.status === 'Rejeitado' && m.rejectionReason && <div className="text-[11px] text-danger mt-1.5 max-w-[14rem] leading-snug" title={m.rejectionReason}>Motivo: {m.rejectionReason}</div>}
            </> },
            { id: 'actions', label: 'Ações', align: 'right', render: m => (
              <div className="flex flex-wrap justify-end gap-1.5">
                {(m.status === 'Aguardando Conferência' || m.status === 'Rejeitado') && <button className="btn-secondary btn-sm" onClick={() => approve(m.id)}><Check className="w-3.5 h-3.5" /> {m.status === 'Rejeitado' ? 'Reconsiderar' : 'Aprovar'}</button>}
                {m.status !== 'Rejeitado' && <button className="btn-secondary btn-sm !text-danger" onClick={() => { setRejecting({ kind: 'magistrates', id: m.id, name: m.name, linked: m.status === 'Atribuído' }); setRejectReason(''); setModal('reject'); }}><X className="w-3.5 h-3.5" /> Rejeitar</button>}
                <button className="btn-ghost btn-sm" title="Editar" onClick={() => { setEditingMag(m); setModal('mag-edit'); }}><Pencil className="w-4 h-4" /></button>
                <button className="btn-danger" title="Excluir (com justificativa)" onClick={() => setExcluding(m)}><Trash2 className="w-4 h-4" /></button>
              </div>
            ) },
          ]} />
          {excludedMags.length > 0 && (
            <div className="mt-8 space-y-2">
              <h4 className="font-semibold text-navy">Excluídos <span className="text-muted font-normal">({excludedMags.length})</span></h4>
              <SmartTable id="excluidos" picker={false} rows={excludedMags} rowKey={m => m.id} empty="" defaultSort={{ key: 'at', dir: 'desc' }} cols={[
                { id: 'name', label: 'Magistrado(a)', sort: m => m.name, render: m => <><div className="font-medium">{m.name}</div><div className="text-[11px] text-bronze">{m.editionTitle}</div></> },
                { id: 'reason', label: 'Motivo', sort: m => m.exclusionReason ?? '', tdClass: 'whitespace-pre-wrap', render: m => m.exclusionReason },
                { id: 'sei', label: 'SEI', sort: m => m.exclusionSei ?? '', tdClass: 'font-mono text-xs', render: m => m.exclusionSei || '—' },
                { id: 'at', label: 'Exclusão', sort: m => m.excludedAt ?? '', tdClass: 'text-xs text-muted whitespace-nowrap', render: m => <>{m.excludedAt ? formatDateTime(m.excludedAt) : '—'}{m.excludedBy && <div>{m.excludedBy}</div>}</> },
                { id: 'actions', label: '', align: 'right', render: m => <button className="btn-secondary btn-sm" onClick={() => restoreMag(m)}><RotateCcw className="w-3.5 h-3.5" /> Desfazer</button> },
              ]} />
            </div>
          )}
          {excluding && <ExcludeModal name={excluding.name} onClose={() => setExcluding(null)} onSubmit={excludeMag} />}
        </div>
      )}

      {/* ---------- Unidades ---------- */}
      {sub === 'units' && (
        <div>
          <Toolbar title="Unidades judiciais">
            {sortedUnits.some(u => u.selection === 'Em análise') && (
              <button className="btn-secondary btn-sm" onClick={chooseAll}>
                <Check className="w-4 h-4" /> Aprovar todas pendentes ({sortedUnits.filter(u => u.selection === 'Em análise').length})
              </button>
            )}
            {!allScope && sortedUnits.length > 0 && (
              <button className="btn-secondary btn-sm !text-danger" onClick={() => startWipe('units')}><Trash2 className="w-4 h-4" /> Excluir tudo da janela ({sortedUnits.length})</button>
            )}
            <button className="btn-primary btn-sm" onClick={() => setModal('unit')}><Plus className="w-4 h-4" /> Cadastrar</button>
            <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/xlsx/unlinked-units?${q}`, 'unidades-sem-magistrado.xlsx')}><Download className="w-4 h-4" /> Sem magistrado (XLSX)</button>
            <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/csv?type=units&${q}`, 'unidades.csv')}><Download className="w-4 h-4" /> CSV</button>
          </Toolbar>
          <SmartTable id="unidades" rows={sortedUnits} rowKey={u => u.id} empty={allScope ? 'Nenhuma unidade inscrita.' : 'Nenhuma unidade inscrita nesta janela.'} defaultSort={{ key: 'name', dir: 'asc' }}
            rowClass={u => (openUnitId === u.id ? 'bg-paper' : '')}
            after={(u, span) => openUnitId === u.id && (
              <tr className="bg-paper">
                <td colSpan={span} className="px-4 pb-5 pt-1">
                  <UnitDetail unit={u} magistrates={magistrates} matches={matches} busy={linking}
                    onLink={(magId, area, workType) => saveLink(u, magId, area, workType)} onUnlink={unlinkFromUnit} />
                </td>
              </tr>
            )}
            cols={[
              { id: 'name', label: 'Unidade / Comarca', sort: u => unitLabel(u), tdClass: 'min-w-[15rem]', render: u => {
                const open = openUnitId === u.id;
                return (
                  <button className="flex items-start gap-1.5 text-left" onClick={() => setOpenUnitId(open ? '' : u.id)} aria-expanded={open} title="Ver justificativa e vincular magistrado">
                    {open ? <ChevronDown className="w-4 h-4 mt-0.5 shrink-0 text-bronze" /> : <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 text-muted" />}
                    <span>
                      <span className="font-medium block">{unitLabel(u)}</span>
                      {!u.catalogId && <span className="text-[11px] text-warn block">◦ A padronizar (fora da lista oficial)</span>}
                      {u.duplicateCount && <span className="text-[11px] text-danger block">◦ Unidade inscrita {u.duplicateCount} vezes nesta janela</span>}
                      {presence[u.id] && <PresenceNote p={presence[u.id]} />}
                      <span className="text-[11px] text-bronze block">{u.editionTitle}</span>
                    </span>
                  </button>
                );
              } },
              { id: 'comarca', label: 'Comarca', optional: true, hidden: true, sort: u => u.comarca, filter: u => u.comarca || '—', render: u => <span className="text-xs">{u.comarca || '—'}</span> },
              { id: 'judge', label: 'Responsável', optional: true, sort: u => u.judgeName, tdClass: 'text-xs text-muted', render: u => u.judgeName || '—' },
              { id: 'email', label: 'E-mail', optional: true, hidden: true, sort: u => u.email, render: u => <span className="text-xs text-muted break-all">{u.email || '—'}</span> },
              { id: 'ip', label: 'IP', optional: true, hidden: true, sort: u => u.registeredIp ?? '', render: u => <span className="text-xs text-muted font-mono">{u.registeredIp || '—'}</span> },
              { id: 'createdAt', label: 'Inscrição', optional: true, hidden: true, sort: u => u.createdAt, render: u => <DateCell iso={u.createdAt} /> },
              { id: 'areas', label: 'Áreas e auxílio', optional: true, filter: u => [...u.areas, `Precisa de: ${u.supportNeeded}`, ...(u.hearingPeriod ? [`Audiências: ${hearingPeriodLabel(u.hearingPeriod)}`] : [])], sort: u => u.areas.join(', '), render: u => <div className="flex flex-wrap gap-1">{u.areas.map(a => <Badge key={a} tone="info">{a}</Badge>)}<Badge tone="neutral">Precisa de: {u.supportNeeded}</Badge>{u.hearingPeriod && <Badge tone="neutral">Audiências: {hearingPeriodLabel(u.hearingPeriod).toLowerCase()}</Badge>}</div> },
              { id: 'slots', label: 'Magistrados', optional: true, sort: u => matches.filter(m => m.unitId === u.id).length, render: u => <SlotsControl bare unit={u} linked={matches.filter(m => m.unitId === u.id).length} onChange={n => setSlots(u, n)} /> },
              { id: 'selection', label: 'Triagem', filter: u => u.selection, sort: u => SELECTION_ORDER[u.selection] ?? 9, render: u => <>
                <Badge tone={u.selection === 'Escolhida' ? 'ok' : u.selection === 'Rejeitada' ? 'danger' : 'warn'}>{u.selection}</Badge>
                {u.selection === 'Rejeitada' && u.rejectionReason && <div className="text-[11px] text-danger mt-1.5 max-w-[12rem] leading-snug" title={u.rejectionReason}>Motivo: {u.rejectionReason}</div>}
                {u.selection === 'Rejeitada' && u.carryOver && <div className="text-[11px] text-bronze mt-1">Pedido mantido: volta para análise na próxima janela</div>}
                {u.carriedFromEditionId && u.selection !== 'Rejeitada' && <div className="text-[11px] text-bronze mt-1">Pedido mantido de janela anterior</div>}
              </> },
              { id: 'status', label: 'Status', optional: true, filter: u => (u.selection === 'Escolhida' ? u.status : '—'), sort: u => (u.selection === 'Escolhida' ? u.status : ''), render: u => (u.selection === 'Escolhida' ? <Badge tone={u.status === 'Atendida' ? 'ok' : 'warn'}>{u.status}</Badge> : <span className="text-xs text-muted">—</span>) },
              { id: 'actions', label: 'Ações', align: 'right', render: u => {
                const open = openUnitId === u.id;
                return (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {u.duplicateCount && <button className="btn-secondary btn-sm" onClick={() => mergeUnit(u)}>Fundir repetidas</button>}
                    {u.selection !== 'Escolhida' && <button className="btn-secondary btn-sm" onClick={() => chooseUnit(u.id)}><Check className="w-3.5 h-3.5" /> Escolher</button>}
                    {u.selection !== 'Rejeitada' && <button className="btn-secondary btn-sm !text-danger" onClick={() => { setRejecting({ kind: 'units', id: u.id, name: u.unitName, linked: u.status === 'Atendida' }); setRejectReason(''); setRejectCarry(false); setModal('reject'); }}><X className="w-3.5 h-3.5" /> Rejeitar</button>}
                    <button className="btn-ghost btn-sm" title="Justificativa e vinculação" onClick={() => setOpenUnitId(open ? '' : u.id)}>{open ? 'Fechar' : 'Detalhes'}</button>
                    <button className="btn-ghost btn-sm" title="Editar" onClick={() => { setEditingUnit(u); setModal('unit-edit'); }}><Pencil className="w-4 h-4" /></button>
                    <button className="btn-danger" title="Excluir" onClick={() => del('units', u.id, `a unidade ${u.unitName}`)}><Trash2 className="w-4 h-4" /></button>
                  </div>
                );
              } },
            ]} />
        </div>
      )}

      {/* ---------- Vinculações ---------- */}
      {sub === 'matches' && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Seções de vinculações">
          {([
            ['panel', 'Vigentes e histórico'],
            ['link', `Vincular unidades (${units.filter(u => inScope(u) && u.selection === 'Escolhida' && !matches.some(m => m.unitId === u.id)).length} sem magistrado)`],
            ['waiting', `Lista de espera (${waiting.length})`],
          ] as [LinkView, string][]).map(([id, text]) => (
            <button key={id} type="button" role="tab" aria-selected={linkView === id} onClick={() => setLinkView(id)}
              className={`px-3.5 py-2 rounded-md text-sm border transition-colors ${linkView === id ? 'bg-navy text-white border-navy' : 'bg-surface text-muted border-line hover:text-ink'}`}>{text}</button>
          ))}
        </div>
      )}

      {sub === 'matches' && linkView === 'link' && (() => {
        const chosenUnits = units.filter(u => inScope(u) && u.selection === 'Escolhida');
        const linkedCount = chosenUnits.filter(u => matches.some(m => m.unitId === u.id)).length;
        const rows = chosenUnits.filter(u => {
          const has = matches.some(m => m.unitId === u.id);
          return matchFilter === 'all' || (matchFilter === 'linked' ? has : !has);
        });
        return (
          <div>
            <Toolbar title="Vincular unidades">
            {!allScope && matches.some(inScope) && (
              <button className="btn-secondary btn-sm !text-danger" onClick={() => startWipe('matches')}><Trash2 className="w-4 h-4" /> Excluir tudo da janela ({matches.filter(inScope).length})</button>
            )}
              <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/xlsx/unlinked-units?${q}`, 'unidades-sem-magistrado.xlsx')}><Download className="w-4 h-4" /> Unidades sem magistrado (XLSX)</button>
              <button className="btn-secondary btn-sm" onClick={() => exportFile(`/export/xlsx/matches?${q}`, 'vinculacoes.xlsx')}><Download className="w-4 h-4" /> Vinculações (XLSX)</button>
              <button className="btn-secondary btn-sm" onClick={() => exportFile(`/panel/report.pdf${allScope ? '' : `?edition=${encodeURIComponent(selectedId)}`}`, 'designacoes.pdf')}><Download className="w-4 h-4" /> Relatório {allScope ? '' : 'da janela '}(PDF)</button>
              <button className="btn-secondary btn-sm" onClick={() => exportFile(`/panel/report.pdf?por=area${allScope ? '' : `&edition=${encodeURIComponent(selectedId)}`}`, 'designacoes-por-area.pdf')}><Download className="w-4 h-4" /> PDF por área{allScope ? '' : ' da janela'}</button>
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
      {sub === 'matches' && linkView === 'waiting' && (
        <div>
          <Toolbar title="Lista de espera" />
          <SmartTable id="espera" rows={waiting} rowKey={m => m.id} empty="Nenhum magistrado em espera." defaultSort={{ key: 'createdAt', dir: 'asc' }} cols={[
            { id: 'name', label: 'Magistrado(a)', sort: m => m.name, render: m => <div className="font-medium">{m.name}</div> },
            { id: 'email', label: 'E-mail', optional: true, hidden: true, sort: m => m.email, render: m => <span className="text-xs text-muted break-all">{m.email || '—'}</span> },
            { id: 'location', label: 'Lotação', optional: true, sort: m => m.currentLocation, tdClass: 'text-muted', render: m => m.currentLocation },
            { id: 'first', label: '1ª preferência', filter: m => m.firstPreference, sort: m => m.firstPreference, tdClass: 'text-bronze font-medium', render: m => m.firstPreference },
            { id: 'second', label: '2ª preferência', optional: true, filter: m => m.secondPreference || '—', sort: m => m.secondPreference, tdClass: 'text-muted', render: m => m.secondPreference || '—' },
            { id: 'hearings', label: 'Audiências', optional: true, filter: m => (m.acceptsHearings ? 'Aceita' : 'Não aceita'), sort: m => (m.acceptsHearings ? 1 : 0), tdClass: 'text-muted', render: m => (m.acceptsHearings ? `Aceita${m.hearingPeriod ? ` (${hearingPeriodLabel(m.hearingPeriod).toLowerCase()})` : ''}` : 'Não aceita') },
            { id: 'createdAt', label: 'Inscrição', optional: true, hidden: true, sort: m => m.createdAt, render: m => <DateCell iso={m.createdAt} /> },
          ]} />
        </div>
      )}

      {sub === 'standardize' && <StandardizeAdmin run={run} confirm={confirm} onChanged={refresh} />}
      {sub === 'catalog' && <CatalogAdmin run={run} confirm={confirm} readOnly={me?.role === 'consulta'} onChanged={refresh} />}
      {sub === 'users' && me?.role === 'admin' && <UsersAdmin run={run} confirm={confirm} />}
      {sub === 'backup' && <BackupAdmin run={run} confirm={confirm} onRestored={refresh} />}
      {sub === 'matches' && linkView === 'panel' && <PanelAdmin run={run} confirm={confirm} onChanged={refresh} />}

      {/* ---------- Perguntas frequentes ---------- */}
      {sub === 'faq' && (
        <div>
          <Toolbar title="Perguntas frequentes">
            <button className="btn-primary btn-sm" onClick={() => { setEditingFaq(null); setModal('faq-new'); }}><Plus className="w-4 h-4" /> Nova pergunta</button>
          </Toolbar>
          <p className="text-sm text-muted mb-4">
            Conteúdo geral do portal, comum a todo o mutirão. Apenas as perguntas <strong className="text-ink">publicadas</strong> aparecem na página pública
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
          <SmartTable id="registro" rows={logRows} rowKey={l => l.id} empty="Sem registros." defaultSort={{ key: 'at', dir: 'desc' }} cols={[
            { id: 'at', label: 'Data/hora', sort: l => l.timestamp, tdClass: 'text-xs text-muted whitespace-nowrap', render: l => formatDateTime(l.timestamp) },
            { id: 'who', label: 'Responsável', optional: true, filter: l => l.actor, sort: l => `${l.actor} ${l.by ?? ''}`, tdClass: 'text-xs', render: l => <>{l.actor}{l.by && <div className="text-muted">{l.by}</div>}</> },
            { id: 'cat', label: 'Categoria', optional: true, filter: l => l.category, sort: l => l.category, render: l => <Badge tone="neutral">{l.category}</Badge> },
            { id: 'ip', label: 'IP', optional: true, hidden: true, sort: l => l.ip ?? '', tdClass: 'text-xs text-muted font-mono whitespace-nowrap', render: l => l.ip ?? '—' },
            { id: 'desc', label: 'Descrição', sort: l => l.description, render: l => l.description },
          ]} />
          <p className="text-xs text-muted mt-3">Registro das últimas 500 ocorrências {allScope ? 'do mutirão' : 'da janela'}, incluindo acessos ao painel.</p>
        </div>
      )}

      {/* ---------- Modais ---------- */}
      {modal === 'mag' && (
        <Modal title={`Cadastrar magistrado — ${target?.title ?? ''}`} onClose={() => setModal(null)}>
          <MagistrateForm withStatus relaxed={target?.isInitial} submitLabel="Salvar magistrado" onSubmit={async p => {
            const r = await run(() => api('/magistrates', { method: 'POST', json: withEdition(p) }), 'Magistrado incluído.');
            if (r) { setModal(null); refresh(); }
            return !!r;
          }} />
        </Modal>
      )}
      {modal === 'unit' && (
        <Modal title={`Cadastrar unidade judicial — ${target?.title ?? ''}`} onClose={() => setModal(null)}>
          <UnitForm withSlots relaxed={target?.isInitial} submitLabel="Salvar unidade" onSubmit={async p => {
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
              <strong>Ação irreversível.</strong> Serão excluídas <strong>{WIPE[wiping].count()}</strong> {WIPE[wiping].label} da janela
              {' '}<strong>{selected?.title}</strong>. {WIPE[wiping].effect}
            </div>
            <p className="text-xs text-muted">As demais janelas não são afetadas. A exclusão fica registrada no histórico de atividades. Recomenda-se exportar o CSV antes de continuar.</p>
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
      {deletingEdition && (
        <Modal title="Excluir janela de inscrição" onClose={() => setDeletingEdition(null)}>
          <form onSubmit={confirmDeleteEdition} className="space-y-4">
            <div className="rounded-md bg-danger-soft text-danger px-4 py-3 text-sm leading-relaxed">
              <strong>Ação irreversível.</strong> A janela <strong>{deletingEdition.title}</strong> será excluída junto com
              {' '}<strong>{deletingEdition.stats?.magistrates ?? 0}</strong> inscrição(ões) de magistrados, <strong>{deletingEdition.stats?.units ?? 0}</strong> unidade(s)
              {' '}e <strong>{deletingEdition.stats?.matches ?? 0}</strong> vinculação(ões), além das desistências e alterações de vinculação registradas nela.
            </div>
            <p className="text-xs text-muted">As demais janelas não são afetadas e o registro de atividades é mantido. Vinculações de magistrados de outras janelas a unidades desta janela também são desfeitas. Recomenda-se baixar um backup (aba Backup) antes de continuar.</p>
            <Field label="Para confirmar, digite EXCLUIR">
              <input autoFocus className="input" value={deleteText} onChange={e => setDeleteText(e.target.value)} placeholder="EXCLUIR" autoComplete="off" />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setDeletingEdition(null)}>Cancelar</button>
              <button className="btn-primary !bg-danger" disabled={deleteText.trim() !== 'EXCLUIR'}>Excluir janela</button>
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
            <Field label="Motivo da rejeição (aparece para o inscrito na consulta de status)">
              <textarea required autoFocus rows={4} className="input" value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder={rejecting.kind === 'units' ? 'Ex.: Demanda não se enquadra nos critérios do mutirão.' : 'Ex.: Declaração de regularidade incompatível com os registros funcionais.'} />
            </Field>
            {rejecting.kind === 'units' && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={rejectCarry} onChange={e => setRejectCarry(e.target.checked)} />
                <span>Rejeitar agora, mas <strong>manter o pedido</strong>: ele volta para análise na próxima janela de inscrição (na seguinte, se já existir, ou assim que ela for criada).</span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn-primary" disabled={!rejectReason.trim()}>{rejecting.kind === 'units' ? 'Rejeitar unidade' : 'Rejeitar inscrição'}</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'mag-edit' && editingMag && (
        <Modal title="Editar magistrado" onClose={() => setModal(null)}>
          <MagistrateForm withStatus relaxed={editions.find(e => e.id === editingMag.editionId)?.isInitial} initial={editingMag} submitLabel="Salvar alterações" onSubmit={async p => {
            const r = await run(() => api(`/magistrates/${editingMag.id}`, { method: 'PUT', json: p }), 'Inscrição atualizada.');
            if (r) { setModal(null); refresh(); }
            return !!r;
          }} />
        </Modal>
      )}
      {modal === 'unit-edit' && editingUnit && (
        <Modal title="Editar unidade judicial" onClose={() => setModal(null)}>
          <UnitForm withSlots relaxed={editions.find(e => e.id === editingUnit.editionId)?.isInitial} initial={editingUnit} submitLabel="Salvar alterações" onSubmit={async p => {
            const r = await run(() => api(`/units/${editingUnit.id}`, { method: 'PUT', json: p }), 'Unidade atualizada.');
            if (r) { setModal(null); refresh(); }
            return !!r;
          }} />
        </Modal>
      )}
      {modal === 'edition-new' && <Modal title="Nova janela de inscrição" onClose={() => setModal(null)}><EditionForm onSubmit={createEdition} /></Modal>}
      {modal === 'edition-edit' && editingEdition && <Modal title="Editar janela de inscrição" onClose={() => setModal(null)}><EditionForm initial={editingEdition} onSubmit={updateEdition} /></Modal>}
    </div>
  );
}
