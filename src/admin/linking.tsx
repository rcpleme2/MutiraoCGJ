// Vinculação de magistrados às unidades escolhidas: elegíveis, vagas e tipo de atuação.
import { Magistrate, Match, Unit, WorkType, WORK_TYPES, hearingPeriodLabel, periodsClash } from '../types';
import { useState } from 'react';
import { Badge } from '../ui';
import { Check } from 'lucide-react';
import { unitLabel } from './shared';

/* ---------- Regras de elegibilidade e modalidade da vinculação ---------- */
export interface Eligible { m: Magistrate; area: string; rank: 0 | 1 | 2 }

/**
 * Magistrados que podem ser vinculados à unidade, separados em "mesma área" (1ª/2ª preferência) e "outras áreas".
 * `current` é a vinculação em edição (o magistrado dela continua na lista); quem está vinculado em qualquer
 * outro lugar, inclusive nesta mesma unidade, não é oferecido.
 */
/** Qual preferência do magistrado a área da vinculação atende */
export const prefLabel = (m: Magistrate | undefined, area: string) => {
  const eq = (a?: string) => !!a && a.trim().toLowerCase() === area.trim().toLowerCase();
  return !m ? '' : eq(m.firstPreference) ? '1ª preferência atendida' : eq(m.secondPreference) ? '2ª preferência atendida' : 'fora das preferências';
};

export function eligibleFor(unit: Unit, magistrates: Magistrate[], matches: Match[], current?: Match) {
  const taken = new Set(matches.filter(x => x.id !== current?.id).map(x => x.magistrateId));
  const list: Eligible[] = magistrates
    .filter(m => m.status !== 'Rejeitado' && m.status !== 'Desistente' && m.status !== 'Excluído' && !taken.has(m.id) // de qualquer janela de inscrição
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
export const defaultWorkType = (unit: Unit, mag: Magistrate): WorkType =>
  unit.supportNeeded === 'Audiência' || unit.supportNeeded === 'Sentença'
    ? unit.supportNeeded
    : mag.acceptsHearings ? 'Audiência' : 'Sentença';

 // unidade pediu os dois: audiências só se o magistrado aceita

export const workTypeTone = (w: WorkType) => (w === 'Sentença' ? 'neutral' : w === 'Audiência' ? 'info' : 'ok') as 'neutral' | 'info' | 'ok';

export const unitMatchesOf = (unit: Unit, matches: Match[]) =>
  matches.filter(m => m.unitId === unit.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

export function WorkTypeSelect({ value, onChange }: { value: WorkType; onChange: (v: WorkType) => void }) {
  return (
    <select className="input !py-2 text-sm" value={value} onChange={e => onChange(e.target.value as WorkType)} aria-label="Atuação do magistrado">
      {value === 'Audiência e Sentença' && <option value={value}>Audiência e sentença (antigo)</option>}
      {WORK_TYPES.map(w => <option key={w} value={w}>{w === 'Audiência' ? 'Para audiências' : 'Para sentença'}</option>)}
    </select>
  );
}

export function WorkTypeWarnings({ unit, mag, workType }: { unit: Unit; mag?: Magistrate; workType: WorkType }) {
  const hearings = workType !== 'Sentença';
  return (
    <>
      {mag && hearings && !mag.acceptsHearings && <p className="text-[11px] text-warn mt-1.5">Este magistrado informou que não aceita realizar audiências.</p>}
      {mag && hearings && mag.acceptsHearings && periodsClash(mag.hearingPeriod, unit.hearingPeriod) && <p className="text-[11px] text-warn mt-1.5">Período das audiências diferente: o magistrado pode auxiliar <strong>{hearingPeriodLabel(mag.hearingPeriod).toLowerCase()}</strong> e a unidade pretende o auxílio <strong>{hearingPeriodLabel(unit.hearingPeriod).toLowerCase()}</strong>.</p>}
      {workType !== unit.supportNeeded && <p className="text-[11px] text-muted mt-1.5">A unidade pediu auxílio para <strong>{unit.supportNeeded.toLowerCase()}</strong>; esta vinculação cobre {workType.toLowerCase()}.</p>}
    </>
  );
}

/** Quantos magistrados serão alocados na unidade (vagas). Reduzir abaixo do número de vinculados é recusado pelo servidor. */
export function SlotsControl({ unit, linked, onChange, compact, bare }: { unit: Unit; linked: number; onChange: (n: number) => void; compact?: boolean; bare?: boolean }) {
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
export function UnitDetail({ unit, magistrates, matches, busy, onLink, onUnlink }: {
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
        <div className="text-xs text-muted mt-3">Auxílio solicitado: <span className="text-ink">{unit.supportNeeded}</span>{unit.hearingPeriod && <> · Audiências: <span className="text-ink">{hearingPeriodLabel(unit.hearingPeriod).toLowerCase()}</span></>} · Responsável: <span className="text-ink">{unit.judgeName}</span></div>
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
                  <span><strong>{mag?.name || 'magistrado removido'}</strong> · {match.assignedArea} · <strong>{match.workType}</strong> · {prefLabel(mag, match.assignedArea)}</span>
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
                    {m.acceptsHearings && m.hearingPeriod && <Badge tone={periodsClash(m.hearingPeriod, unit.hearingPeriod) ? 'warn' : 'neutral'}>Audiências: {hearingPeriodLabel(m.hearingPeriod).toLowerCase()}</Badge>}
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

export type SaveLink = (unit: Unit, magistrateId: string, area: string, workType: WorkType, match?: Match) => void;

/* ---------- Uma vaga da unidade: magistrado vinculado ou a vincular ---------- */
export function LinkSlot({ unit, magistrates, matches, match, busy, onSave, onUnlink }: {
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
    `${e.m.name}${e.rank ? ` — ${e.rank}ª preferência` : ''}${e.m.acceptsHearings ? (e.m.hearingPeriod && unit.hearingPeriod ? ` — audiências: ${hearingPeriodLabel(e.m.hearingPeriod).toLowerCase()}${periodsClash(e.m.hearingPeriod, unit.hearingPeriod) ? ' (período diferente)' : ''}` : '') : ' — não aceita audiências'}`;

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
      {sel && sel.rank > 0 && <p className="text-[11px] text-ok mt-1.5">Atende a {sel.rank}ª preferência do magistrado: {sel.area}.</p>}
      {sel && sel.rank === 0 && <p className="text-[11px] text-warn mt-1.5">Área fora das preferências do magistrado; será registrada como {sel.area}.</p>}
    </div>
  );
}

/* ---------- Linha da aba Vinculações: uma unidade escolhida e suas vagas ---------- */
export function UnitLinkRow({ unit, magistrates, matches, busy, onSave, onUnlink, onSlots }: {
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
            {unit.hearingPeriod && <Badge tone="neutral">Audiências: {hearingPeriodLabel(unit.hearingPeriod).toLowerCase()}</Badge>}
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
