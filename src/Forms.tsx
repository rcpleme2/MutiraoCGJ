import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { Field } from './ui';
import { Magistrate, Unit, PREFERENCE_AREAS, SUPPORT_OPTIONS, SupportNeeded } from './types';
import { COMARCAS, CATALOG_SEPARATOR, canonicalComarca, catalogById, fullUnitName, unitsOfComarca } from './catalogo-tjpr';

/* ---------- Comarca → unidade (catálogo oficial), com a opção "Outra" ---------- */
const OTHER = '__outra';
interface Place { comarca: string; unitSel: string; other: string; separator: string }

const foldName = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Estado inicial a partir do que está gravado: unidade do catálogo, ou comarca + nome livre ("Outra"). */
function initialPlace(catalogId?: string, comarca?: string, name?: string, separator?: string): Place {
  const cat = catalogById(catalogId);
  if (cat) return { comarca: cat.comarca, unitSel: cat.id, other: '', separator: cat.separator };
  const c = canonicalComarca(comarca) ?? (comarca || '');
  const n = (name || '').trim();
  if (!n) return { comarca: c, unitSel: '', other: '', separator: separator || CATALOG_SEPARATOR };
  // Registro antigo cujo nome coincide com o catálogo: já vem selecionado
  const hit = canonicalComarca(c) ? unitsOfComarca(c).find(u => foldName(u.unitName) === foldName(n) || foldName(u.label) === foldName(n)) : undefined;
  if (hit) return { comarca: hit.comarca, unitSel: hit.id, other: '', separator: hit.separator };
  return { comarca: c, unitSel: OTHER, other: n, separator: separator || CATALOG_SEPARATOR };
}

/** Converte a escolha em campos para a API (o servidor completa nome, comarca e separador pelo catálogo). */
const placePayload = (p: Place) => p.unitSel && p.unitSel !== OTHER
  ? { catalogId: p.unitSel, comarca: p.comarca, name: '' }
  : { catalogId: '', comarca: p.comarca, name: p.other };

const placeLabel = (p: Place) => {
  const cat = catalogById(p.unitSel);
  if (cat) return cat.label;
  return p.unitSel === OTHER && p.other.trim() ? fullUnitName({ unitName: p.other.trim().toLocaleUpperCase('pt-BR'), comarca: p.comarca, separator: p.separator }) : '';
};

function CatalogPicker({ value, onChange, comarcaLabel, unitLabel, relaxed, withSeparator }: {
  value: Place; onChange: (p: Place) => void; comarcaLabel: string; unitLabel: string;
  /** edição "Vinculações iniciais": comarca pode ficar em branco ou fora da lista */
  relaxed?: boolean;
  /** administração: permite ajustar o separador de uma unidade digitada em "Outra" */
  withSeparator?: boolean;
}) {
  const known = !!canonicalComarca(value.comarca);
  const list = known ? unitsOfComarca(value.comarca) : [];
  const preview = placeLabel(value);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
        <Field label={comarcaLabel}>
          <select required={!relaxed} className="input" value={value.comarca}
            onChange={e => onChange({ ...value, comarca: e.target.value, unitSel: '', other: value.unitSel === OTHER ? value.other : '' })}>
            <option value="" disabled={!relaxed}>{relaxed ? '(sem comarca)' : 'Selecione a comarca…'}</option>
            {value.comarca && !known && <option value={value.comarca}>{value.comarca} (fora da lista)</option>}
            {COMARCAS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label={unitLabel}>
          <select required={!relaxed} className="input" value={value.unitSel} disabled={!value.comarca && !relaxed}
            onChange={e => onChange({ ...value, unitSel: e.target.value })}>
            <option value="" disabled>{value.comarca || relaxed ? 'Selecione a unidade…' : 'Escolha antes a comarca'}</option>
            {list.map(u => <option key={u.id} value={u.id}>{u.unitName}</option>)}
            <option value={OTHER}>Outra (digitar o nome)</option>
          </select>
        </Field>
      </div>
      {value.unitSel === OTHER && (
        <div className={`grid grid-cols-1 gap-4 ${withSeparator ? 'sm:grid-cols-[minmax(0,1fr)_7rem]' : ''}`}>
          <Field label="Nome da unidade (não encontrada na lista)">
            <input required={!relaxed} className="input" maxLength={300} value={value.other} placeholder="Ex.: 3ª VARA CÍVEL"
              onChange={e => onChange({ ...value, other: e.target.value })} />
          </Field>
          {withSeparator && (
            <Field label="Separador">
              <input className="input" maxLength={20} value={value.separator} onChange={e => onChange({ ...value, separator: e.target.value })} placeholder={CATALOG_SEPARATOR} />
            </Field>
          )}
        </div>
      )}
      {preview && <p className="text-xs text-muted -mt-1">Exibição: <strong className="text-ink">{preview}</strong>{value.unitSel === OTHER && <span className="text-warn"> · será conferida pela coordenação</span>}</p>}
    </div>
  );
}

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
  relaxed,
  disabled,
  busy,
}: {
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
  submitLabel: string;
  withStatus?: boolean;
  withDeclaration?: boolean;
  initial?: Magistrate;
  /** edição "Vinculações iniciais": e-mail, lotação, áreas e audiências podem ficar em branco */
  relaxed?: boolean;
  /** formulário visível, mas impreenchível (fora do prazo de inscrições) */
  disabled?: boolean;
  busy?: boolean;
}) {
  const empty = {
    name: '', email: '', currentLocation: '',
    firstPreference: '', secondPreference: '',
    acceptsHearings: '', status: 'Aprovado',
  };
  const [f, setF] = useState(initial ? {
    name: initial.name, email: initial.email, currentLocation: initial.currentLocation,
    firstPreference: initial.firstPreference, secondPreference: initial.secondPreference,
    acceptsHearings: initial.acceptsHearings ? 'sim' : 'nao', status: initial.status as string,
  } : empty);
  const [loc, setLoc] = useState<Place>(() => initialPlace(initial?.locationCatalogId, initial?.locationComarca, initial?.currentLocation));
  const [declared, setDeclared] = useState(false);
  const [website, setWebsite] = useState('');
  const [localError, setLocalError] = useState('');
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <form
      className="space-y-5"
      onSubmit={async e => {
        e.preventDefault();
        // Todos os campos de escolha precisam ser preenchidos (não há valor pré-selecionado)
        if (!relaxed && (!f.firstPreference || !f.acceptsHearings)) {
          setLocalError('Preencha a 1ª escolha e informe se aceita realizar audiências.');
          return;
        }
        setLocalError('');
        const lp = placePayload(loc);
        const ok = await onSubmit({ ...f, locationCatalogId: lp.catalogId, locationComarca: lp.comarca, currentLocation: lp.name, acceptsHearings: f.acceptsHearings === 'sim', ...(withDeclaration ? { declaration: declared, website } : {}) });
        if (ok && !initial) { setF(empty); setLoc(initialPlace()); setDeclared(false); }
      }}
    >
      <fieldset disabled={disabled} className="space-y-5 min-w-0">
      <Field label="Nome completo do(a) magistrado(a)">
        <input required className="input" value={f.name} onChange={set('name')} />
      </Field>
      <Field label="E-mail institucional">
        <input required={!relaxed} type="email" placeholder="nome@tjpr.jus.br" className="input" value={f.email} onChange={set('email')} />
      </Field>
      <CatalogPicker value={loc} onChange={setLoc} comarcaLabel="Comarca de lotação" unitLabel="Unidade de lotação atual" relaxed={relaxed} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="1ª escolha (área)">
          <select required={!relaxed} className="input" value={f.firstPreference}
            onChange={e => setF({ ...f, firstPreference: e.target.value, secondPreference: f.secondPreference === e.target.value ? '' : f.secondPreference })}>
            <option value="" disabled>Selecione…</option>
            {relaxed && f.firstPreference && !PREFERENCE_AREAS.includes(f.firstPreference) && <option>{f.firstPreference}</option>}
            {PREFERENCE_AREAS.map(a => <option key={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="2ª escolha (área) — opcional">
          <select className="input" value={f.secondPreference} onChange={set('secondPreference')}>
            <option value="">Nenhuma</option>
            {PREFERENCE_AREAS.filter(a => a !== f.firstPreference).map(a => <option key={a}>{a}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Aceita realizar audiências?">
        <Segmented
          value={f.acceptsHearings}
          onChange={v => { setLocalError(''); setF({ ...f, acceptsHearings: v }); }}
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
            {initial?.status === 'Desistente' && <option>Desistente</option>}
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
      {localError && <p role="alert" className="text-sm text-danger">{localError}</p>}
      {withDeclaration && (
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>Não preencha este campo<input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label>
      </div>
      )}
      <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? 'Processando…' : submitLabel}</button>
      </fieldset>
    </form>
  );
}

export function UnitForm({
  onSubmit,
  submitLabel,
  initial,
  relaxed,
  withSlots,
  withHoneypot,
  disabled,
  busy,
}: {
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
  submitLabel: string;
  initial?: Unit;
  /** edição "Vinculações iniciais": comarca, responsável e e-mail podem ficar em branco */
  relaxed?: boolean;
  /** campo "magistrados a alocar" (apenas na administração) */
  withSlots?: boolean;
  withHoneypot?: boolean;
  /** formulário visível, mas impreenchível (fora do prazo de inscrições) */
  disabled?: boolean;
  busy?: boolean;
}) {
  const [website, setWebsite] = useState('');
  const empty = {
    unitName: '', judgeName: '', email: '', comarca: '', separator: 'de',
    areas: [] as string[],
    supportNeeded: 'Sentença' as SupportNeeded,
    description: '',
    slots: 1,
  };
  const [place, setPlace] = useState<Place>(() => initialPlace(initial?.catalogId, initial?.comarca, initial?.unitName, initial?.separator));
  const [f, setF] = useState(initial ? {
    unitName: initial.unitName, judgeName: initial.judgeName, email: initial.email, comarca: initial.comarca, separator: initial.separator || 'de',
    areas: initial.areas, supportNeeded: initial.supportNeeded, description: initial.description,
    slots: initial.slots ?? 1,
  } : empty);
  const text = (k: 'unitName' | 'judgeName' | 'email' | 'comarca' | 'separator' | 'description') =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const [areasError, setAreasError] = useState('');
  const toggleArea = (area: string) => {
    const has = f.areas.includes(area);
    setAreasError('');
    setF({ ...f, areas: has ? f.areas.filter(a => a !== area) : [...f.areas, area] });
  };

  return (
    <form
      className="space-y-5"
      onSubmit={async e => {
        e.preventDefault();
        if (f.areas.length === 0) { setAreasError('Marque ao menos uma área a ser atendida.'); return; }
        const { slots, ...rest } = f;
        const pp = placePayload(place);
        const placeFields = { catalogId: pp.catalogId, comarca: pp.comarca, unitName: pp.name, separator: place.separator };
        if ((await onSubmit({ ...rest, ...placeFields, ...(withSlots ? { slots } : {}), ...(withHoneypot ? { website } : {}) })) && !initial) { setF(empty); setPlace(initialPlace()); }
      }}
    >
      <fieldset disabled={disabled} className="space-y-5 min-w-0">
      <CatalogPicker value={place} onChange={setPlace} comarcaLabel="Comarca" unitLabel="Unidade judicial" relaxed={relaxed} withSeparator={withSlots} />
      <Field label="Juiz(a) titular / responsável">
        <input required={!relaxed} className="input" value={f.judgeName} onChange={text('judgeName')} />
      </Field>
      <Field label="E-mail do responsável pela inscrição">
        <input required={!relaxed} type="email" placeholder="nome@tjpr.jus.br" className="input" value={f.email} onChange={text('email')} />
      </Field>
      <Field label="Áreas a serem atendidas (uma ou mais)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[...PREFERENCE_AREAS, ...(relaxed ? f.areas.filter(a => !PREFERENCE_AREAS.includes(a)) : [])].map(area => {
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
        {areasError && <p role="alert" className="text-sm text-danger mt-2">{areasError}</p>}
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
      {withSlots && (
        <Field label="Magistrados a alocar nesta unidade">
          <select className="input" value={f.slots} onChange={e => setF({ ...f, slots: Number(e.target.value) })}>
            {Array.from({ length: 20 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
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
      </fieldset>
    </form>
  );
}
