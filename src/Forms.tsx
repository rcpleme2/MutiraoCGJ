import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { Field } from './ui';
import { PREFERENCE_AREAS, SUPPORT_OPTIONS, SupportNeeded } from './types';

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
  busy,
}: {
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
  submitLabel: string;
  withStatus?: boolean;
  busy?: boolean;
}) {
  const empty = {
    name: '', email: '', currentLocation: '',
    firstPreference: PREFERENCE_AREAS[0], secondPreference: PREFERENCE_AREAS[1],
    acceptsHearings: 'sim', status: 'Aprovado',
  };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <form
      className="space-y-5"
      onSubmit={async e => {
        e.preventDefault();
        const ok = await onSubmit({ ...f, acceptsHearings: f.acceptsHearings === 'sim' });
        if (ok) setF(empty);
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
          <select className="input" value={f.firstPreference} onChange={set('firstPreference')}>
            {PREFERENCE_AREAS.map(a => <option key={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="2ª escolha (área)">
          <select className="input" value={f.secondPreference} onChange={set('secondPreference')}>
            {PREFERENCE_AREAS.map(a => <option key={a}>{a}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Aceita realizar audiências?">
        <Segmented
          value={f.acceptsHearings}
          onChange={v => setF({ ...f, acceptsHearings: v })}
          options={[
            { value: 'sim', label: 'Sim, aceito realizar audiências' },
            { value: 'nao', label: 'Não, apenas sentenças / decisões' },
          ]}
        />
      </Field>
      {withStatus && (
        <Field label="Status inicial">
          <select className="input" value={f.status} onChange={set('status')}>
            <option>Aguardando Conferência</option>
            <option>Aprovado</option>
          </select>
        </Field>
      )}
      <p className="text-xs text-muted leading-relaxed border-l-2 border-bronze/50 pl-3">
        A preferência indicada será atendida na medida do possível, considerando a disponibilidade de unidades e o interesse público.
      </p>
      <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? 'Processando…' : submitLabel}</button>
    </form>
  );
}

export function UnitForm({
  onSubmit,
  submitLabel,
  busy,
}: {
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
  submitLabel: string;
  busy?: boolean;
}) {
  const empty = {
    unitName: '', judgeName: '', email: '', comarca: '',
    areas: [PREFERENCE_AREAS[0]] as string[],
    supportNeeded: 'Sentença' as SupportNeeded,
    description: '',
  };
  const [f, setF] = useState(empty);
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
        if (await onSubmit({ ...f })) setF(empty);
      }}
    >
      <Field label="Unidade judicial (vara / juizado)">
        <input required className="input" value={f.unitName} onChange={text('unitName')} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Juiz(a) titular / responsável">
          <input required className="input" value={f.judgeName} onChange={text('judgeName')} />
        </Field>
        <Field label="Comarca / cidade">
          <input required className="input" value={f.comarca} onChange={text('comarca')} />
        </Field>
      </div>
      <Field label="E-mail oficial da unidade">
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
      <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? 'Processando…' : submitLabel}</button>
    </form>
  );
}
