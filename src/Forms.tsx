import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { Field } from './ui';
import { Magistrate, Unit, PREFERENCE_AREAS, SUPPORT_OPTIONS, SupportNeeded } from './types';

const Segmented = ({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) => (
  <div className={`grid grid-cols-1 gap-2 ${options.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`} role="radiogroup">
    {options.map(o => (
      <button
        type="button"
        key={o.value}
        role="radio"
        aria-checked={value === o.value}
        onClick={() => onChange(o.value)}
        className={`text-left px-3 py-2.5 rounded-md border text-sm transition-colors ${
          value === o.value ? 'border-navy bg-navy/5 text-navy font-medium' : 'border-line bg-surface text-muted hover:border-slate-300'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export function MagistrateForm({
  onSubmit,
  submitLabel,
  withStatus,
  withDeclaration,
  initial,
  busy,
}: {
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
  submitLabel: string;
  withStatus?: boolean;
  withDeclaration?: boolean;
  initial?: Magistrate;
  busy?: boolean;
}) {
  const empty = {
    name: '', email: '', currentLocation: '',
    firstPreference: PREFERENCE_AREAS[0], secondPreference: PREFERENCE_AREAS[1],
    acceptsHearings: 'sim', status: 'Aprovado',
  };
  const [f, setF] = useState(initial ? {
    name: initial.name, email: initial.email, currentLocation: initial.currentLocation,
    firstPreference: initial.firstPreference, secondPreference: initial.secondPreference,
    acceptsHearings: initial.acceptsHearings ? 'sim' : 'nao', status: initial.status as string,
  } : empty);
  const [declared, setDeclared] = useState(false);
  const [website, setWebsite] = useState('');
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <form
      className="space-y-5"
      onSubmit={async e => {
        e.preventDefault();
        const ok = await onSubmit({ ...f, acceptsHearings: f.acceptsHearings === 'sim', ...(withDeclaration ? { declaration: declared, website } : {}) });
        if (ok && !initial) { setF(empty); setDeclared(false); }
      }}
    >
      <Field label="Nome completo do(a) magistrado(a)">
        <input required className="input" value={f.name} onChange={set('name')} />
      </Field>
      <Field label="E-mail institucional">
        <input required type="email" className="input" value={f.email} onChange={set('email')} />
      </Field>
      <Field label="Lotação atual (vara / comarca)">
        <input required className="input" value={f.currentLocation} onChange={set('currentLocation')} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="1ª escolha (área)">
          <select className="input" value={f.firstPreference}
            onChange={e => setF({ ...f, firstPreference: e.target.value, secondPreference: f.secondPreference === e.target.value ? '' : f.secondPreference })}>
            {PREFERENCE_AREAS.map(a => <option key={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="2ª escolha (área)">
          <select className="input" value={f.secondPreference} onChange={set('secondPreference')}>
            <option value="">Nenhuma</option>
            {PREFERENCE_AREAS.filter(a => a !== f.firstPreference).map(a => <option key={a}>{a}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Aceita realizar audiências?">
        <Segmented
          value={f.acceptsHearings}
          onChange={v => setF({ ...f, acceptsHearings: v })}
          options={[
            { value: 'sim', label: 'Sim, aceito realizar audiências' },
            { value: 'nao', label: 'Não, apenas sentenças' },
          ]}
        />
      </Field>
      {withStatus && (
        <Field label="Status inicial">
          <select className="input" value={f.status} onChange={set('status')}>
            <option>Aguardando Conferência</option>
            <option>Aprovado</option>
            {initial && <option>Lista de Espera</option>}
            {initial?.status === 'Atribuído' && <option>Atribuído</option>}
            {initial?.status === 'Rejeitado' && <option>Rejeitado</option>}
          </select>
          {initial?.status === 'Atribuído' && <p className="text-xs text-muted mt-1.5">Magistrado vinculado a uma unidade: para alterar o status, desfaça antes a vinculação.</p>}
        </Field>
      )}
      {withDeclaration && (
        <label className="flex items-start gap-3 rounded-md border border-line bg-paper px-4 py-3.5 cursor-pointer">
          <input type="checkbox" required className="mt-1 shrink-0" checked={declared}
            onInvalid={e => e.currentTarget.setCustomValidity('Marque a declaração de regularidade para concluir a inscrição.')}
            onChange={e => { e.currentTarget.setCustomValidity(''); setDeclared(e.target.checked); }} />
          <span className="text-sm leading-relaxed">
            <strong className="text-navy">Declaração de regularidade.</strong> Declaro que:
            <span className="block mt-1.5 text-muted">
              (i) não possuo processo concluso há mais de 120 dias;<br />
              (ii) não sofri sanção disciplinar nos últimos dois anos; e<br />
              (iii) não respondo a processo administrativo em andamento.
            </span>
          </span>
        </label>
      )}
      <p className="text-xs text-muted leading-relaxed border-l-2 border-bronze/50 pl-3">
        A preferência indicada será atendida na medida do possível, considerando a disponibilidade de unidades e o interesse público.
      </p>
      {withDeclaration && (
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>Não preencha este campo<input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label>
      </div>
      )}
      <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? 'Processando…' : submitLabel}</button>
    </form>
  );
}

export function UnitForm({
  onSubmit,
  submitLabel,
  initial,
  withStatus,
  withHoneypot,
  busy,
}: {
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
  submitLabel: string;
  initial?: Unit;
  withStatus?: boolean;
  withHoneypot?: boolean;
  busy?: boolean;
}) {
  const [website, setWebsite] = useState('');
  const empty = {
    unitName: '', judgeName: '', email: '', comarca: '',
    areas: [PREFERENCE_AREAS[0]] as string[],
    supportNeeded: 'Sentença' as SupportNeeded,
    description: '',
  };
  const [f, setF] = useState(initial ? {
    unitName: initial.unitName, judgeName: initial.judgeName, email: initial.email, comarca: initial.comarca,
    areas: initial.areas, supportNeeded: initial.supportNeeded, description: initial.description,
    status: initial.status,
  } : { ...empty, status: 'Pendente' });
  const text = (k: 'unitName' | 'judgeName' | 'email' | 'comarca' | 'description') =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const toggleArea = (area: string) => {
    const has = f.areas.includes(area);
    if (has && f.areas.length === 1) return;
    setF({ ...f, areas: has ? f.areas.filter(a => a !== area) : [...f.areas, area] });
  };

  return (
    <form
      className="space-y-5"
      onSubmit={async e => {
        e.preventDefault();
        if ((await onSubmit({ ...f, ...(withHoneypot ? { website } : {}) })) && !initial) setF({ ...empty, status: 'Pendente' });
      }}
    >
      <Field label="Comarca">
        <input required className="input" value={f.comarca} onChange={text('comarca')} />
      </Field>
      <Field label="Unidade judicial">
        <input required className="input" value={f.unitName} onChange={text('unitName')} />
      </Field>
      <Field label="Juiz(a) titular / responsável">
        <input required className="input" value={f.judgeName} onChange={text('judgeName')} />
      </Field>
      <Field label="E-mail do responsável pela inscrição">
        <input required type="email" className="input" value={f.email} onChange={text('email')} />
      </Field>
      <Field label="Áreas a serem atendidas (uma ou mais)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PREFERENCE_AREAS.map(area => {
            const on = f.areas.includes(area);
            return (
              <button
                type="button"
                key={area}
                role="checkbox"
                aria-checked={on}
                onClick={() => toggleArea(area)}
                className={`flex items-center gap-2.5 text-left px-3 py-2.5 rounded-md border text-sm transition-colors ${
                  on ? 'border-navy bg-navy/5 text-navy font-medium' : 'border-line bg-surface text-muted hover:border-slate-300'
                }`}
              >
                <span className={`w-4 h-4 rounded-sm border flex items-center justify-center shrink-0 ${on ? 'bg-navy border-navy' : 'border-slate-300'}`}>
                  {on && <Check className="w-3 h-3 text-white" />}
                </span>
                {area}
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Necessita de auxílio para">
        <Segmented
          value={f.supportNeeded}
          onChange={v => setF({ ...f, supportNeeded: v as SupportNeeded })}
          options={SUPPORT_OPTIONS.map(o => ({ value: o, label: o === 'Audiência e Sentença' ? 'Audiência e sentença' : o === 'Audiência' ? 'Audiências' : 'Sentenças' }))}
        />
      </Field>
      <Field label="Justificativa / detalhes da demanda">
        <textarea rows={3} className="input" value={f.description} onChange={text('description')} />
      </Field>
      {withStatus && initial && (
        <Field label="Status">
          {initial.status === 'Atendida' ? (
            <p className="text-sm text-muted">Atendida (vinculada a um magistrado). Para alterar, desfaça antes a vinculação.</p>
          ) : (
            <select className="input" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
              <option>Pendente</option>
              <option>Em Andamento</option>
            </select>
          )}
        </Field>
      )}
      <p className="text-xs text-muted leading-relaxed border-l-2 border-bronze/50 pl-3">
        A preferência será atendida na medida do possível, de acordo com a opção dos inscritos.
      </p>
      {withHoneypot && (
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>Não preencha este campo<input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label>
      </div>
      )}
      <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? 'Processando…' : submitLabel}</button>
    </form>
  );
}
