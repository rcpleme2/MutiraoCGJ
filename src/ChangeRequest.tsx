import React, { useState } from 'react';
import { api } from './api';
import { PREFERENCE_AREAS, WORK_TYPES, ChangeRequestPublic } from './types';
import { Badge, Field, Notice, formatDate } from './ui';

type Kind = 'magistrado' | 'unidade';
interface MagItem { id: string; name: string; unit: string; area: string; workType: string; editionTitle: string; pending: boolean }
interface UnitItem { id: string; unit: string; areas: string[]; slots: number; linked: number; editionTitle: string; pending: boolean }
type Item = MagItem | UnitItem;

const workLabel = (w: string) => (w === 'Audiência' ? 'Audiências' : w || '—');
const statusTone = (s: string) => (s === 'Deferido' ? 'ok' : s === 'Indeferido' ? 'danger' : 'warn');

/** Pedido de alteração pelo portal: só para quem já está vinculado (magistrado) ou unidade com magistrado vinculado. */
export default function ChangeRequestPage() {
  const [kind, setKind] = useState<Kind>('magistrado');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [found, setFound] = useState<{ items: Item[]; requests: ChangeRequestPublic[] } | null>(null);
  const [picked, setPicked] = useState<Item | null>(null);
  const [area, setArea] = useState('');
  const [workType, setWorkType] = useState('');
  const [areas, setAreas] = useState<string[]>([]);
  const [extraSlots, setExtraSlots] = useState(0);
  const [justification, setJustification] = useState('');
  const [notes, setNotes] = useState('');
  const [website, setWebsite] = useState('');
  const [protocol, setProtocol] = useState('');

  const reset = () => { setFound(null); setPicked(null); setError(''); setProtocol(''); };
  const lookup = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true); setError(''); setPicked(null);
    try { setFound(await api('/requests/lookup', { method: 'POST', json: { kind, query } })); }
    catch (err: any) { setError(err.message); setFound(null); }
    finally { setBusy(false); }
  };
  const pick = (it: Item) => {
    setPicked(it); setProtocol(''); setError(''); setJustification(''); setNotes(''); setExtraSlots(0);
    if ('workType' in it) { setArea(it.area); setWorkType(it.workType); } else setAreas(it.areas.filter(a => PREFERENCE_AREAS.includes(a)));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    setBusy(true); setError('');
    const payload = 'workType' in picked
      ? { kind, id: picked.id, area, workType, justification, notes, website }
      : { kind, id: picked.id, areas, extraSlots, justification, notes, website };
    try {
      const r = await api<{ protocol: string }>('/requests', { method: 'POST', json: payload });
      setProtocol(r.protocol); setPicked(null);
      await lookup();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Quem faz o pedido">
        {([['magistrado', 'Sou magistrado(a) vinculado(a)'], ['unidade', 'Represento uma unidade atendida']] as [Kind, string][]).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setQuery(''); reset(); }}
            className={`px-3 py-2.5 rounded-md text-sm border transition-colors ${kind === k ? 'bg-navy text-white border-navy' : 'bg-surface text-muted border-line hover:text-ink'}`}>{label}</button>
        ))}
      </div>

      <form onSubmit={lookup} className="space-y-2">
        <label className="text-sm text-muted block" htmlFor="req-query">
          {kind === 'magistrado' ? 'Informe o e-mail cadastrado ou o nome completo.' : 'Informe o e-mail cadastrado da unidade ou o nome da vara (com a comarca).'}
        </label>
        <div className="flex gap-2">
          <input id="req-query" required className="input flex-1" value={query} onChange={e => { setQuery(e.target.value); reset(); }}
            placeholder={kind === 'magistrado' ? 'nome@tjpr.jus.br ou nome completo' : 'unidade@tjpr.jus.br ou ex.: 1ª Vara Cível de Londrina'} />
          <button className="btn-primary" disabled={busy}>{busy && !picked ? 'Buscando…' : 'Buscar'}</button>
        </div>
      </form>

      {error && <Notice tone="danger">{error}</Notice>}
      {protocol && <Notice tone="ok"><strong>Pedido enviado. Protocolo {protocol}.</strong> A alteração depende de análise da coordenação; acompanhe a situação nesta página.</Notice>}

      {found && (
        <div className="space-y-3">
          {found.items.length === 0 ? (
            <div className="rounded-md px-4 py-3 text-sm bg-paper text-muted border border-line">
              {kind === 'magistrado' ? 'Não há designação vigente para o e-mail ou nome informado. Só quem já está vinculado pode pedir alteração.' : 'Não há unidade com magistrado vinculado para o que foi informado.'}
            </div>
          ) : (
            <>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-bronze">{kind === 'magistrado' ? 'Designações vigentes' : 'Unidades atendidas'}</h3>
              {found.items.map(it => (
                <div key={it.id} className={`border rounded-md p-4 space-y-2 ${picked?.id === it.id ? 'border-navy' : 'border-line'}`}>
                  <div className="flex justify-between gap-3">
                    <div>
                      <div className="font-serif font-semibold text-navy">{it.unit}</div>
                      <div className="text-xs text-muted">
                        {'workType' in it ? <>{it.name} · Área: <span className="text-ink">{it.area}</span> · Tipo: <span className="text-ink">{workLabel(it.workType)}</span></>
                          : <>Áreas: <span className="text-ink">{it.areas.join(', ') || '—'}</span> · Magistrados: <span className="text-ink">{it.linked} vinculado(s) de {it.slots}</span></>}
                        {' · '}{it.editionTitle}
                      </div>
                    </div>
                    <div className="shrink-0 self-start">
                      {it.pending ? <Badge tone="warn">Pedido pendente</Badge>
                        : picked?.id !== it.id && <button type="button" className="btn-secondary btn-sm" onClick={() => pick(it)}>Pedir alteração</button>}
                    </div>
                  </div>

                  {picked?.id === it.id && (
                    <form onSubmit={submit} className="space-y-4 pt-3 border-t border-line">
                      {'workType' in it ? (
                        <div className="grid sm:grid-cols-2 gap-4">
                          <Field label="Área de atuação pretendida">
                            <select className="input" value={area} onChange={e => setArea(e.target.value)}>
                              {!PREFERENCE_AREAS.includes(it.area) && <option value={it.area}>{it.area} (atual)</option>}
                              {PREFERENCE_AREAS.map(a => <option key={a} value={a}>{a}{a === it.area ? ' (atual)' : ''}</option>)}
                            </select>
                          </Field>
                          <Field label="Tipo de atuação pretendido">
                            <select className="input" value={workType} onChange={e => setWorkType(e.target.value)}>
                              {WORK_TYPES.map(w => <option key={w} value={w}>{workLabel(w)}{w === it.workType ? ' (atual)' : ''}</option>)}
                            </select>
                          </Field>
                        </div>
                      ) : (
                        <>
                          <fieldset>
                            <legend className="text-xs font-medium text-muted mb-2">Áreas pretendidas</legend>
                            <div className="grid sm:grid-cols-2 gap-2">
                              {PREFERENCE_AREAS.map(a => (
                                <label key={a} className="flex items-center gap-2 text-sm">
                                  <input type="checkbox" checked={areas.includes(a)} onChange={e => setAreas(e.target.checked ? [...areas, a] : areas.filter(x => x !== a))} /> {a}
                                </label>
                              ))}
                            </div>
                          </fieldset>
                          <Field label="Quantos magistrados a mais (0 = manter)">
                            <input className="input max-w-[8rem]" type="number" min={0} max={20} value={extraSlots} onChange={e => setExtraSlots(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} />
                          </Field>
                        </>
                      )}
                      <Field label="Justificativa">
                        <textarea required rows={3} maxLength={4000} className="input" value={justification} onChange={e => setJustification(e.target.value)} />
                      </Field>
                      <Field label="Observações (opcional)">
                        <textarea rows={2} maxLength={4000} className="input" value={notes} onChange={e => setNotes(e.target.value)} />
                      </Field>
                      <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={website} onChange={e => setWebsite(e.target.value)} name="website" />
                      <p className="text-xs text-muted">O pedido será analisado pela coordenação. A área, o tipo, a vara e a data de início da alteração são definidos na análise.</p>
                      <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost" onClick={() => setPicked(null)}>Cancelar</button>
                        <button className="btn-primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar pedido'}</button>
                      </div>
                    </form>
                  )}
                </div>
              ))}
            </>
          )}

          {found.requests.length > 0 && (
            <div className="space-y-2 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-bronze">Pedidos feitos</h3>
              {found.requests.map(r => (
                <div key={r.protocol} className="rounded-md border border-line px-4 py-3 text-sm space-y-1">
                  <div className="flex justify-between gap-3">
                    <div><strong className="text-ink">{r.protocol}</strong> <span className="text-xs text-muted">· {formatDate(r.createdAt)} · {r.unit}</span></div>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </div>
                  <div className="text-xs text-muted">Pedido: <span className="text-ink">{r.summary}</span></div>
                  {r.status === 'Deferido' && r.outcome && <div className="text-xs text-ok">Alteração deferida: {r.outcome}</div>}
                  {r.decisionReason && <div className={`text-xs ${r.status === 'Indeferido' ? 'text-danger' : 'text-muted'}`}>{r.status === 'Indeferido' ? 'Motivo' : 'Observação'}: {r.decisionReason}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
