import React, { useEffect, useState } from 'react';
import { Scale, UserCheck, Building2, ShieldCheck, Search, ArrowRight, Menu, X, ChevronDown, HelpCircle, LayoutList } from 'lucide-react';
import { api } from './api';
import { Edition, FaqItem, Magistrate, PanelRow, Unit } from './types';
import { Badge, FeedbackProvider, Notice, formatDate, magistrateTone } from './ui';
import { MagistrateForm, UnitForm } from './Forms';
import Admin from './Admin';
import ErrorBoundary from './ErrorBoundary';

type Tab = 'home' | 'magistrate' | 'unit' | 'status' | 'faq' | 'panel' | 'admin';

const NAV: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Início' },
  { id: 'magistrate', label: 'Inscrição de Magistrados' },
  { id: 'unit', label: 'Inscrição de Unidades' },
  { id: 'status', label: 'Consultar Status' },
];

function PageCard({ icon: Icon, title, subtitle, children }: { icon: React.ElementType; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="card max-w-2xl mx-auto p-7 sm:p-10">
      <div className="mb-7 pb-6 border-b border-line">
        <Icon className="w-5 h-5 text-bronze mb-3" />
        <h2 className="text-2xl font-semibold text-navy">{title}</h2>
        <p className="text-sm text-muted mt-1.5 leading-relaxed">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function RecordNotice() {
  return (
    <div className="rounded-md border border-line bg-paper px-4 py-3 text-xs text-muted leading-relaxed">
      <strong className="text-ink">Aviso:</strong> os dados de cada cadastro, inclusive as informações técnicas de acesso, são registrados.
      O uso inadequado da ferramenta, inclusive a inserção de informações falsas ou em nome de terceiros, poderá ser objeto de responsabilização.
    </div>
  );
}

function AppInner() {
  const [tab, setTab] = useState<Tab>('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [faq, setFaq] = useState<FaqItem[]>([]);
  const [panel, setPanel] = useState<{ visible: boolean; edition?: string; rows?: PanelRow[] }>({ visible: false });
  const [panelQuery, setPanelQuery] = useState('');
  const [panelAreas, setPanelAreas] = useState<string[]>([]); // áreas escolhidas pelo visitante (vazio = todas)
  const [openFaq, setOpenFaq] = useState('');
  const loadEdition = () => {
    api<FaqItem[]>('/faq').then(setFaq).catch(() => {});
    api<{ visible: boolean; edition?: string; rows?: PanelRow[] }>('/panel').then(setPanel).catch(() => {});
    return api<Edition | null>('/settings').then(setEdition).catch(() => setLoadError(true));
  };
  useEffect(() => {
    loadEdition();
    // Atualiza a situação das inscrições (abre/encerra por data) sem exigir que a pessoa recarregue a página
    const t = setInterval(loadEdition, 60_000);
    return () => clearInterval(t);
  }, []);

  // Inscrições públicas
  const [busy, setBusy] = useState(false);
  const [magOk, setMagOk] = useState(false);
  const [unitOk, setUnitOk] = useState(false);
  const [formError, setFormError] = useState('');

  const submitPublic = (path: string, done: (v: boolean) => void) => async (payload: Record<string, unknown>) => {
    setBusy(true); setFormError(''); done(false);
    try {
      await api(path, { method: 'POST', json: payload });
      done(true);
      return true;
    } catch (e: any) {
      setFormError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Consulta
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<{ magistrates: Magistrate[]; units: Unit[] } | null>(null);
  const [consultError, setConsultError] = useState('');
  const [consulting, setConsulting] = useState(false);

  const consult = async (e: React.FormEvent) => {
    e.preventDefault();
    setConsultError(''); setResult(null); setConsulting(true);
    try {
      setResult(await api('/status', { method: 'POST', json: { email } }));
    } catch (err: any) {
      setConsultError(err.message);
    } finally {
      setConsulting(false);
    }
  };

  const go = (t: Tab) => { if (t === 'home' || t === 'magistrate' || t === 'unit' || t === 'panel') loadEdition(); setTab(t); setMenuOpen(false); setFormError(''); setMagOk(false); setUnitOk(false); };

  if (loadError) return <div className="min-h-screen flex items-center justify-center text-muted">Não foi possível carregar o sistema.</div>;

  const regState = edition?.registration?.state ?? 'closed';
  const open = regState === 'open';
  const regMessage = edition?.registration?.message || 'As inscrições não estão abertas no momento.';
  // A página só aparece no menu quando há perguntas publicadas
  const nav = [...NAV, ...(panel.visible ? [{ id: 'panel' as Tab, label: 'Painel de Vinculações' }] : []), ...(faq.length ? [{ id: 'faq' as Tab, label: 'Perguntas Frequentes' }] : [])];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-navy text-white sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <button onClick={() => go('home')} className="flex items-center gap-3 text-left">
            <Scale className="w-5 h-5 text-bronze-soft" />
            <span className="font-serif text-[17px] font-semibold tracking-tight leading-tight whitespace-nowrap">
              Mutirão de Julgamento
              <span className="hidden 2xl:block text-[11px] font-sans font-normal text-white/60 tracking-wider uppercase whitespace-nowrap">Corregedoria-Geral da Justiça</span>
            </span>
          </button>
          <nav className="hidden xl:flex items-center gap-1">
            {nav.map(n => (
              <button key={n.id} onClick={() => go(n.id)}
                className={`px-3 py-2 rounded-md text-sm whitespace-nowrap transition-colors ${tab === n.id ? 'bg-white/10 text-white' : 'text-white/70 hover:text-white hover:bg-white/5'}`}>
                {n.label}
              </button>
            ))}
            <button onClick={() => go('admin')}
              className={`ml-1 px-3 py-2 rounded-md text-sm whitespace-nowrap flex items-center gap-1.5 border transition-colors ${tab === 'admin' ? 'bg-white text-navy border-white' : 'border-white/25 text-white/80 hover:bg-white/10'}`}>
              <ShieldCheck className="w-4 h-4" /> Administração
            </button>
          </nav>
          <button className="xl:hidden p-2" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="xl:hidden border-t border-white/10 px-5 py-2 flex flex-col">
            {[...nav, { id: 'admin' as Tab, label: 'Administração' }].map(n => (
              <button key={n.id} onClick={() => go(n.id)} className="text-left py-3 text-sm text-white/85 border-b border-white/5 last:border-0">{n.label}</button>
            ))}
          </div>
        )}
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-5 py-10 sm:py-14">
        <ErrorBoundary key={tab}>
        {tab === 'home' && (
          <section className="max-w-3xl mx-auto">
            {edition ? (
              <>
                <div className="flex items-center gap-3 mb-5">
                  <Badge tone={open ? 'ok' : regState === 'not_yet' ? 'warn' : 'neutral'}>{{ open: 'Inscrições abertas', not_yet: 'Inscrições ainda não abertas', ended: 'Prazo de inscrições encerrado', paused: 'Inscrições suspensas', closed: 'Inscrições encerradas' }[regState]}</Badge>
                  <span className="text-xs text-muted">Prazo: {formatDate(edition.openingDate)} a {formatDate(edition.closingDate)}</span>
                </div>
                <h1 className="text-4xl sm:text-5xl font-semibold text-navy leading-[1.1] mb-5">{edition.title}</h1>
                <p className="text-muted text-lg leading-relaxed max-w-2xl mb-10">{edition.description}</p>
              </>
            ) : (
              <>
                <h1 className="text-4xl font-semibold text-navy mb-5">Mutirão de Julgamento</h1>
                <p className="text-muted text-lg mb-10">Não há edição com inscrições vigentes no momento.</p>
              </>
            )}
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { t: 'magistrate' as Tab, icon: UserCheck, title: 'Sou magistrado(a)', desc: 'Inscrever-me como voluntário(a).' },
                { t: 'unit' as Tab, icon: Building2, title: 'Represento uma unidade', desc: 'Solicitar apoio do mutirão.' },
                { t: 'status' as Tab, icon: Search, title: 'Consultar status', desc: 'Acompanhar uma inscrição.' },
              ].map(c => (
                <button key={c.t} onClick={() => go(c.t)} className="card p-5 text-left hover:border-navy/40 transition-colors group">
                  <c.icon className="w-5 h-5 text-bronze mb-4" />
                  <div className="font-serif font-semibold text-navy">{c.title}</div>
                  <div className="text-sm text-muted mt-1">{c.desc}</div>
                  <ArrowRight className="w-4 h-4 text-muted mt-4 group-hover:translate-x-0.5 transition-transform" />
                </button>
              ))}
            </div>
          </section>
        )}

        {tab === 'magistrate' && (
          <PageCard icon={UserCheck} title="Inscrição de magistrado voluntário"
            subtitle={edition ? `${edition.title}. Informe seus dados institucionais e áreas de preferência.` : 'Sem edição vigente.'}>
            {(
              <div className="space-y-5">
                {!open && <Notice tone="danger">{regMessage}</Notice>}
                {magOk && <Notice tone="ok"><strong>Inscrição realizada.</strong> Status inicial: Aguardando Conferência. Acompanhe em “Consultar Status”.</Notice>}
                {formError && <Notice tone="danger">{formError}</Notice>}
                <RecordNotice />
                <MagistrateForm withDeclaration disabled={!open} busy={busy} submitLabel="Concluir inscrição" onSubmit={submitPublic('/magistrates', setMagOk)} />
              </div>
            )}
          </PageCard>
        )}

        {tab === 'unit' && (
          <PageCard icon={Building2} title="Inscrição de unidade judicial"
            subtitle={edition ? `${edition.title}. Cadastre a unidade e indique o tipo de auxílio necessário.` : 'Sem edição vigente.'}>
            {(
              <div className="space-y-5">
                {!open && <Notice tone="danger">{regMessage}</Notice>}
                {unitOk && <Notice tone="ok"><strong>Unidade cadastrada.</strong> Ela passará pela análise da coordenação antes de ser vinculada a um magistrado.</Notice>}
                {formError && <Notice tone="danger">{formError}</Notice>}
                <RecordNotice />
                <UnitForm withHoneypot disabled={!open} busy={busy} submitLabel="Concluir inscrição da unidade" onSubmit={submitPublic('/units', setUnitOk)} />
              </div>
            )}
          </PageCard>
        )}

        {tab === 'panel' && (() => {
          const fold = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
          const q = fold(panelQuery.trim());
          const allRows = panel.rows ?? [];
          // Áreas existentes no painel (agrupadas sem distinguir acento/caixa), com a quantidade de designações
          const areaMap = new Map<string, { label: string; count: number }>();
          allRows.forEach(r => { const k = fold(r.area.trim()); const cur = areaMap.get(k); if (cur) cur.count++; else areaMap.set(k, { label: r.area.trim(), count: 1 }); });
          const areas = [...areaMap.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, 'pt-BR'));
          const selected = panelAreas.filter(k => areaMap.has(k));
          const toggleArea = (k: string) => setPanelAreas(selected.includes(k) ? selected.filter(x => x !== k) : [...selected, k]);
          const rows = allRows.filter(r => (selected.length === 0 || selected.includes(fold(r.area.trim()))) && (!q || fold(`${r.name} ${r.area} ${r.unit}`).includes(q)));
          return (
            <section className="card max-w-4xl mx-auto p-7 sm:p-10">
              <div className="mb-6 pb-6 border-b border-line">
                <LayoutList className="w-5 h-5 text-bronze mb-3" />
                <h2 className="text-2xl font-semibold text-navy">Painel de vinculações</h2>
                <p className="text-sm text-muted mt-1.5 leading-relaxed">{panel.visible ? `${panel.edition}. Magistrados designados, com a área de atuação e a unidade.` : 'O painel não está disponível no momento.'}</p>
              </div>
              {panel.visible && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <input className="input max-w-sm" type="search" placeholder="Buscar por nome, área ou unidade" aria-label="Buscar no painel" value={panelQuery} onChange={e => setPanelQuery(e.target.value)} />
                    <span className="text-xs text-muted">{rows.length} de {allRows.length} designação(ões)</span>
                  </div>
                  {areas.length > 1 && (
                    <div className="mb-4" role="group" aria-label="Filtrar por área de atuação">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <span className="text-xs font-medium text-muted tracking-wide">Área de atuação</span>
                        {selected.length > 0 && <button className="text-xs text-bronze hover:underline" onClick={() => setPanelAreas([])}>Limpar filtro</button>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {areas.map(([k, a]) => {
                          const on = selected.includes(k);
                          return (
                            <button key={k} type="button" aria-pressed={on} onClick={() => toggleArea(k)}
                              className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${on ? 'bg-navy text-white border-navy' : 'bg-surface text-muted border-line hover:text-ink hover:border-slate-300'}`}>
                              {a.label} <span className={on ? 'text-white/70' : 'text-muted/70'}>({a.count})</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="border border-line rounded-md overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr><th className="th">Magistrado(a)</th><th className="th">Área de atuação</th><th className="th">Unidade</th></tr></thead>
                      <tbody className="divide-y divide-line">
                        {rows.length === 0 && <tr><td colSpan={3} className="px-4 py-10 text-center text-muted">{allRows.length === 0 ? 'Nenhuma designação publicada ainda.' : 'Nenhum resultado para o filtro escolhido.'}</td></tr>}
                        {rows.map((r, i) => (
                          <tr key={i}><td className="td font-medium">{r.name}</td><td className="td text-muted">{r.area}</td><td className="td">{r.unit}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          );
        })()}

        {tab === 'faq' && (
          <PageCard icon={HelpCircle} title="Perguntas frequentes" subtitle="Dúvidas comuns sobre as inscrições e o andamento do mutirão.">
            {faq.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma pergunta publicada no momento.</p>
            ) : (
              <div className="divide-y divide-line border-y border-line">
                {faq.map(f => {
                  const isOpen = openFaq === f.id;
                  return (
                    <div key={f.id}>
                      <button className="w-full flex items-start justify-between gap-4 py-4 text-left" aria-expanded={isOpen}
                        onClick={() => setOpenFaq(isOpen ? '' : f.id)}>
                        <span className="font-serif font-semibold text-navy leading-snug">{f.question}</span>
                        <ChevronDown className={`w-4 h-4 mt-1 shrink-0 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {isOpen && <p className="pb-5 pr-8 text-sm text-muted leading-relaxed whitespace-pre-wrap">{f.answer}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </PageCard>
        )}

        {tab === 'status' && (
          <PageCard icon={Search} title="Consultar status"
            subtitle="Informe o e-mail cadastrado para ver inscrições de magistrado e de unidades realizadas a partir de outubro/2026.">
            <form onSubmit={consult} className="flex gap-2">
              <input type="email" required placeholder="nome@tjpr.jus.br" className="input flex-1" value={email} onChange={e => setEmail(e.target.value)} />
              <button className="btn-primary" disabled={consulting}>{consulting ? 'Buscando…' : 'Consultar'}</button>
            </form>
            {consultError && <div className="mt-5"><Notice tone="danger">{consultError}</Notice></div>}
            {result && (
              <div className="mt-8 space-y-6">
                {result.magistrates.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-bronze">Inscrições de magistrado</h3>
                    {result.magistrates.map(m => (
                      <div key={m.id} className="border border-line rounded-md p-5 space-y-3">
                        <div className="flex justify-between gap-3">
                          <div>
                            <div className="font-serif font-semibold text-navy">{m.name}</div>
                            <div className="text-xs text-muted">{m.editionTitle} · {m.currentLocation}</div>
                          </div>
                          <Badge tone={magistrateTone(m.status)}>{m.status}</Badge>
                        </div>
                        <div className="text-xs text-muted">
                          1ª: <span className="text-ink">{m.firstPreference}</span> · 2ª: <span className="text-ink">{m.secondPreference || '—'}</span> · Audiências: <span className="text-ink">{m.acceptsHearings ? 'aceita' : 'não aceita'}</span>
                        </div>
                        {m.match && (
                          <div className="bg-ok-soft text-ok text-sm rounded-md px-3 py-2.5">
                            <strong>Unidade atribuída:</strong> {m.match.unit?.unitName} ({m.match.unit?.comarca}) · {m.match.assignedArea} · <strong>{m.match.workType}</strong>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {result.units.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-bronze">Unidades cadastradas</h3>
                    {result.units.map(u => (
                      <div key={u.id} className="border border-line rounded-md p-5 space-y-2">
                        <div className="flex justify-between gap-3">
                          <div>
                            <div className="font-serif font-semibold text-navy">{u.unitName}</div>
                            <div className="text-xs text-muted">{u.editionTitle} · {u.comarca} · {u.judgeName}</div>
                          </div>
                          <Badge tone={u.selection === 'Rejeitada' ? 'danger' : u.selection === 'Em análise' ? 'neutral' : u.status === 'Atendida' ? 'ok' : 'warn'}>
                            {u.selection === 'Rejeitada' ? 'Rejeitada' : u.selection === 'Em análise' ? 'Em análise' : u.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted">Áreas: <span className="text-ink">{u.areas.join(', ')}</span> · Auxílio: <span className="text-ink">{u.supportNeeded}</span></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </PageCard>
        )}

        {tab === 'admin' && <Admin onEditionsChanged={loadEdition} />}
        </ErrorBoundary>
      </main>

    </div>
  );
}

export default function App() {
  return (
    <FeedbackProvider>
      <AppInner />
    </FeedbackProvider>
  );
}
