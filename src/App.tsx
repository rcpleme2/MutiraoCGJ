import React, { useEffect, useState } from 'react';
import { Scale, UserCheck, Building2, ShieldCheck, Search, ArrowRight, Menu, X } from 'lucide-react';
import { api } from './api';
import { Edition, Magistrate, Unit } from './types';
import { Badge, FeedbackProvider, Notice, formatDate, magistrateTone } from './ui';
import { MagistrateForm, UnitForm } from './Forms';
import Admin from './Admin';

type Tab = 'home' | 'magistrate' | 'unit' | 'status' | 'admin';

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

function IpNotice({ ip }: { ip: string }) {
  return (
    <div className="rounded-md border border-line bg-paper px-4 py-3 text-xs text-muted leading-relaxed">
      <strong className="text-ink">Aviso:</strong> seu endereço IP{ip ? <> (<span className="font-mono text-ink">{ip}</span>)</> : ''} e a data e hora desta inscrição serão registrados.
      O uso inadequado da ferramenta, inclusive a inserção de informações falsas ou em nome de terceiros, poderá gerar responsabilização.
    </div>
  );
}

function AppInner() {
  const [tab, setTab] = useState<Tab>('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [loadError, setLoadError] = useState(false);

  const loadEdition = () =>
    api<Edition | null>('/settings').then(setEdition).catch(() => setLoadError(true));
  const [ip, setIp] = useState('');
  useEffect(() => { loadEdition(); api<{ ip: string }>('/whoami').then(r => setIp(r.ip)).catch(() => {}); }, []);

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
      setResult(await api(`/status?email=${encodeURIComponent(email)}`));
    } catch (err: any) {
      setConsultError(err.message);
    } finally {
      setConsulting(false);
    }
  };

  const go = (t: Tab) => { setTab(t); setMenuOpen(false); setFormError(''); setMagOk(false); setUnitOk(false); };

  if (loadError) return <div className="min-h-screen flex items-center justify-center text-muted">Não foi possível carregar o sistema.</div>;

  const open = edition?.isRegistrationOpen && edition.status === 'Em andamento';

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-navy text-white sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <button onClick={() => go('home')} className="flex items-center gap-3 text-left">
            <Scale className="w-5 h-5 text-bronze-soft" />
            <span className="font-serif text-[17px] font-semibold tracking-tight leading-tight">
              Mutirão de Julgamento
              <span className="block text-[11px] font-sans font-normal text-white/60 tracking-wider uppercase">Corregedoria-Geral da Justiça</span>
            </span>
          </button>
          <nav className="hidden md:flex items-center gap-1">
            {NAV.map(n => (
              <button key={n.id} onClick={() => go(n.id)}
                className={`px-3.5 py-2 rounded-md text-sm transition-colors ${tab === n.id ? 'bg-white/10 text-white' : 'text-white/70 hover:text-white hover:bg-white/5'}`}>
                {n.label}
              </button>
            ))}
            <button onClick={() => go('admin')}
              className={`ml-2 px-3.5 py-2 rounded-md text-sm flex items-center gap-1.5 border transition-colors ${tab === 'admin' ? 'bg-white text-navy border-white' : 'border-white/25 text-white/80 hover:bg-white/10'}`}>
              <ShieldCheck className="w-4 h-4" /> Administração
            </button>
          </nav>
          <button className="md:hidden p-2" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden border-t border-white/10 px-5 py-2 flex flex-col">
            {[...NAV, { id: 'admin' as Tab, label: 'Administração' }].map(n => (
              <button key={n.id} onClick={() => go(n.id)} className="text-left py-3 text-sm text-white/85 border-b border-white/5 last:border-0">{n.label}</button>
            ))}
          </div>
        )}
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-5 py-10 sm:py-14">
        {tab === 'home' && (
          <section className="max-w-3xl mx-auto">
            {edition ? (
              <>
                <div className="flex items-center gap-3 mb-5">
                  <Badge tone={open ? 'ok' : 'neutral'}>{open ? 'Inscrições abertas' : 'Inscrições encerradas'}</Badge>
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
            {!open ? <Notice tone="danger">As inscrições não estão abertas no momento.</Notice> : (
              <div className="space-y-5">
                {magOk && <Notice tone="ok"><strong>Inscrição realizada.</strong> Status inicial: Aguardando Conferência. Acompanhe em “Consultar Status”.</Notice>}
                {formError && <Notice tone="danger">{formError}</Notice>}
                <IpNotice ip={ip} />
                <MagistrateForm withDeclaration busy={busy} submitLabel="Concluir inscrição" onSubmit={submitPublic('/magistrates', setMagOk)} />
              </div>
            )}
          </PageCard>
        )}

        {tab === 'unit' && (
          <PageCard icon={Building2} title="Inscrição de unidade judicial"
            subtitle={edition ? `${edition.title}. Cadastre a unidade e indique o tipo de auxílio necessário.` : 'Sem edição vigente.'}>
            {!open ? <Notice tone="danger">As inscrições não estão abertas no momento.</Notice> : (
              <div className="space-y-5">
                {unitOk && <Notice tone="ok"><strong>Unidade cadastrada.</strong> Ela já está disponível para vinculação.</Notice>}
                {formError && <Notice tone="danger">{formError}</Notice>}
                <IpNotice ip={ip} />
                <UnitForm busy={busy} submitLabel="Concluir inscrição da unidade" onSubmit={submitPublic('/units', setUnitOk)} />
              </div>
            )}
          </PageCard>
        )}

        {tab === 'status' && (
          <PageCard icon={Search} title="Consultar status"
            subtitle="Informe o e-mail cadastrado para ver inscrições de magistrado e de unidades, em todas as edições.">
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
                        {m.status === 'Rejeitado' && (
                          <div className="bg-danger-soft text-danger text-sm rounded-md px-3 py-2.5">
                            <strong>Inscrição rejeitada.</strong> Motivo: {m.rejectionReason || 'não informado.'}
                          </div>
                        )}
                        {m.match && (
                          <div className="bg-ok-soft text-ok text-sm rounded-md px-3 py-2.5">
                            <strong>Unidade atribuída:</strong> {m.match.unit?.unitName} ({m.match.unit?.comarca}) · {m.match.assignedArea}
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
                          <Badge tone={u.status === 'Atendida' ? 'ok' : 'warn'}>{u.status}</Badge>
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
