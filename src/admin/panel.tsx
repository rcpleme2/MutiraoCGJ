// Vinculações vigentes e histórico: painel, alterações de vara/área/tipo, desistências e importação de planilha.
import { PREFERENCE_AREAS, ActingPeriod, PanelRow, Transfer, Unit, Withdrawal, WorkType, WORK_TYPES } from '../types';
import React, { useCallback, useEffect, useState } from 'react';
import { api, download } from '../api';
import { Trash2, Check, Pencil, Download, RotateCcw, StickyNote } from 'lucide-react';
import { Badge, Field, Modal, formatDate, formatDateTime } from '../ui';
import { COMARCAS, catalogById, fullUnitName, unitsOfComarca } from '../catalogo-tjpr';
import { ExcludeModal } from './forms';
import { dmy, monthEnd, type RunFn, unitOption } from './shared';
import { SmartTable, Toolbar } from './table';

export interface PanelAdminData { rows: PanelRow[]; withdrawals: Withdrawal[]; transfers: Transfer[]; periods: ActingPeriod[]; initialEdition: { id: string; title: string } }

export interface PanelPreview { total: number; duplicates: number; errorCount: number; errors: { line: number; message: string }[]; preview: { name: string; area: string; unit: string }[] }

/** Observação no estilo post-it de uma designação do painel: clique para escrever ou editar; texto vazio apaga. */
export function PostIt({ row, run, onSaved }: { row: PanelRow; run: RunFn; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.postit ?? '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const r = await run(() => api(`/panel/rows/${row.id}/postit`, { method: 'PUT', json: { text } }), text.trim() ? 'Observação salva.' : 'Observação apagada.');
    setSaving(false);
    if (r) { setEditing(false); onSaved(); }
  };
  if (editing) return (
    <div className="w-56 rounded-sm bg-amber-100 border border-amber-300 shadow-md p-2 -rotate-1">
      <textarea autoFocus rows={4} maxLength={1000} value={text} onChange={e => setText(e.target.value)} aria-label={`Observação sobre ${row.name}`}
        onKeyDown={e => { if (e.key === 'Escape') { setEditing(false); setText(row.postit ?? ''); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }}
        className="w-full bg-transparent text-xs text-amber-950 placeholder:text-amber-700/60 resize-y outline-none" placeholder="Escreva uma observação…" />
      <div className="flex justify-end gap-1 mt-1">
        <button className="text-[11px] px-2 py-0.5 rounded text-amber-900 hover:bg-amber-200" onClick={() => { setEditing(false); setText(row.postit ?? ''); }}>Cancelar</button>
        <button className="text-[11px] px-2 py-0.5 rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50" disabled={saving} onClick={save}>Salvar</button>
      </div>
    </div>
  );
  if (!row.postit) return (
    <button className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-amber-700" title="Adicionar observação" onClick={() => { setText(''); setEditing(true); }}>
      <StickyNote className="w-3.5 h-3.5" /> Observação
    </button>
  );
  return (
    <button className="block w-56 text-left rounded-sm bg-amber-100 border border-amber-300 shadow-sm hover:shadow-md p-2 -rotate-1 hover:rotate-0 transition" title="Clique para editar a observação"
      onClick={() => { setText(row.postit ?? ''); setEditing(true); }}>
      <span className="block text-xs text-amber-950 whitespace-pre-wrap break-words">{row.postit}</span>
      {row.postitUpdatedAt && <span className="block text-[10px] text-amber-700/80 mt-1">{formatDateTime(row.postitUpdatedAt)}</span>}
    </button>
  );
}

export function PanelAdmin({ run, confirm, onChanged }: {
  run: RunFn; confirm: (m: string, label?: string) => Promise<boolean>; onChanged: () => void;
}) {
  const [data, setData] = useState<PanelAdminData | null>(null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<PanelPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState<string[]>([]);
  const [onlyDup, setOnlyDup] = useState(false);
  const [dropping, setDropping] = useState<PanelRow | null>(null);
  const [editingWd, setEditingWd] = useState<Withdrawal | null>(null);
  const [excludingRow, setExcludingRow] = useState<PanelRow | null>(null);
  const [moving, setMoving] = useState<{ row: PanelRow; units: Unit[] } | null>(null);
  const [moveUnit, setMoveUnit] = useState('');
  const [moveComarca, setMoveComarca] = useState('');
  const [moveNewName, setMoveNewName] = useState('');
  const [moveArea, setMoveArea] = useState('');
  const [moveWork, setMoveWork] = useState('');
  const [moveSei, setMoveSei] = useState('');
  const [moveDate, setMoveDate] = useState('');
  const [sei, setSei] = useState('');
  const [startEdit, setStartEdit] = useState<{ row: PanelRow; date: string } | null>(null);
  const [histQuery, setHistQuery] = useState('');
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const [requestDate, setRequestDate] = useState(today());

  const load = useCallback(async () => {
    const r = await run(() => api<PanelAdminData>('/panel/admin'));
    if (r) setData(r);
  }, [run]);
  useEffect(() => { load(); }, []);

  const check = async () => {
    setBusy(true);
    const r = await run(() => api<PanelPreview & { success: boolean }>('/panel/import', { method: 'POST', json: { text, dryRun: true } }));
    setBusy(false);
    if (r) setPreview(r);
  };
  const doImport = async (ignoreErrors: boolean) => {
    setBusy(true);
    const r = await run(() => api('/panel/import', { method: 'POST', json: { text, ignoreErrors } }), 'Designações importadas.');
    setBusy(false);
    if (r) { setText(''); setPreview(null); await load(); onChanged(); }
  };
  const removeRow = async (r: PanelRow) => {
    if (!(await confirm(`Desfazer a vinculação de ${r.name} à unidade ${r.unit}? O magistrado volta à lista de espera.`, 'Desfazer vinculação'))) return;
    await run(() => api(`/panel/rows/${r.id}`, { method: 'DELETE' }), 'Vinculação desfeita.');
    await load(); onChanged();
  };
  const submitWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dropping) return;
    const r = await run(() => api('/panel/withdrawals', { method: 'POST', json: { name: dropping.name, sei, requestDate } }), 'Desistência registrada.');
    if (r) { setDropping(null); setSei(''); await load(); onChanged(); }
  };
  const submitEditWd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWd) return;
    const r = await run(() => api(`/panel/withdrawals/${editingWd.id}`, { method: 'PUT', json: { sei: editingWd.sei, requestDate: editingWd.requestDate ?? '' } }), 'Desistência atualizada.');
    if (r) { setEditingWd(null); await load(); }
  };
  const openMove = async (r: PanelRow) => {
    const list = await run(() => api<Unit[]>('/units?edition=all'));
    if (!list) return;
    setMoving({ row: r, units: list.filter(u => u.selection === 'Escolhida' && u.id !== r.unitId).sort((a, b) => a.unitName.localeCompare(b.unitName, 'pt-BR')) });
    setMoveUnit(''); setMoveComarca(''); setMoveNewName(''); setMoveArea(r.area); setMoveWork(r.workType ?? ''); setMoveSei(''); setMoveDate(today());
  };
  const submitMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moving) return;
    const body: Record<string, string> = { effectiveDate: moveDate };
    if (moveSei.trim()) body.sei = moveSei.trim();
    const cat = moveUnit.startsWith('cat:') ? catalogById(moveUnit.slice(4)) : undefined;
    if (moveNewName.trim()) body.newUnitName = moveNewName.trim(); else if (cat) body.newUnitName = fullUnitName(cat); else if (moveUnit) body.unitId = moveUnit;
    if (moveArea.trim() && moveArea.trim() !== moving.row.area.trim()) body.assignedArea = moveArea.trim();
    if (moveWork && moveWork !== moving.row.workType) body.workType = moveWork;
    const r = await run(() => api(`/matches/${moving.row.id}`, { method: 'PUT', json: body }), 'Vinculação alterada.');
    if (r) { setMoving(null); await load(); onChanged(); }
  };
  const submitStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startEdit) return;
    const r = await run(() => api(`/matches/${startEdit.row.id}`, { method: 'PUT', json: { startDate: startEdit.date } }), 'Data de início atualizada.');
    if (r) { setStartEdit(null); await load(); }
  };
  const exportPeriods = () => run(() => download('/panel/periods.xlsx', 'historico-atuacao.xlsx'));
  const undoWithdrawal = async (w: Withdrawal) => {
    if (!(await confirm(`Desfazer a desistência de ${w.name}? O magistrado volta à lista de espera; as designações anteriores não são restauradas.`, 'Desfazer desistência'))) return;
    await run(() => api(`/panel/withdrawals/${w.id}`, { method: 'DELETE' }), 'Registro de desistência desfeito.');
    await load(); onChanged();
  };
  const exportPdf = () => run(() => download('/panel/report.pdf', 'designacoes.pdf'));
  const exportXlsx = () => {
    const labels = areaFilter.map(k => areaMap.get(k)?.label).filter(Boolean) as string[];
    return run(() => download(`/panel/export.xlsx${labels.length ? `?areas=${encodeURIComponent(labels.join('|'))}` : ''}`, 'designacoes.xlsx'));
  };
  const exportPdfByArea = () => {
    const labels = areaFilter.map(k => areaMap.get(k)?.label).filter(Boolean) as string[];
    return run(() => download(`/panel/report.pdf?por=area${labels.length ? `&areas=${encodeURIComponent(labels.join('|'))}` : ''}`, 'designacoes-por-area.pdf'));
  };

  if (!data) return <div className="card p-8 text-sm text-muted">Carregando…</div>;
  const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const term = fold(query.trim());
  const areaMap = new Map<string, { label: string; count: number }>();
  data.rows.forEach(r => { const k = fold(r.area.trim()); const c = areaMap.get(k); if (c) c.count++; else areaMap.set(k, { label: r.area.trim(), count: 1 }); });
  const areas = [...areaMap.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, 'pt-BR'));
  const selected = areaFilter.filter(k => areaMap.has(k));
  const dupCount = data.rows.filter(r => r.duplicates).length;
  const rows = data.rows.filter(r => (!onlyDup || r.duplicates) && (selected.length === 0 || selected.includes(fold(r.area.trim()))) && (!term || fold(`${r.name} ${r.area} ${r.unit} ${r.comarca ?? ''} ${r.postit ?? ''}`).includes(term)));

  return (
    <div className="space-y-6">
      <Toolbar title="Vinculações vigentes e histórico">
        <button className="btn-secondary btn-sm" onClick={exportPdfByArea} title="Só as designações, um bloco por área (respeita o filtro de áreas escolhido)"><Download className="w-4 h-4" /> PDF por área de atuação</button>
        <button className="btn-secondary btn-sm" onClick={exportXlsx} title="Planilha das designações vigentes (respeita o filtro de áreas)"><Download className="w-4 h-4" /> Planilha (XLSX)</button>
        <button className="btn-secondary btn-sm" onClick={exportPdf}><Download className="w-4 h-4" /> Exportar relatório em PDF</button>
      </Toolbar>
      <p className="text-sm text-muted -mt-2">
        Relação total das vinculações vigentes do mutirão (<strong className="text-ink">todas as janelas de inscrição</strong>), de uso restrito da administração. As designações continuam valendo até que seja registrada a desistência.
        Ao desfazer uma vinculação, a linha sai daqui automaticamente. Para trocar a vara, a área ou o tipo de atuação de alguém, use "Alterar vara/área/tipo" (informa a partir de quando atua na nova unidade; a anterior fica registrada até o dia anterior).
      </p>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-line">
          <h4 className="font-semibold text-navy">Vinculações vigentes <span className="text-muted font-normal">({data.rows.length})</span></h4>
          <div className="flex flex-wrap items-center gap-2">
            {dupCount > 0 && (
              <button type="button" aria-pressed={onlyDup} onClick={() => setOnlyDup(!onlyDup)}
                className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${onlyDup ? 'bg-danger text-white border-danger' : 'bg-surface text-danger border-line hover:border-danger'}`}>
                Duplicidades ({dupCount})
              </button>
            )}
            <input className="input max-w-xs" type="search" placeholder="Buscar por nome, área ou unidade" aria-label="Buscar no painel" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        </div>
        {areas.length > 1 && (
          <div className="p-4 border-b border-line" role="group" aria-label="Filtrar por área de atuação">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-xs font-medium text-muted tracking-wide">Área de atuação</span>
              {selected.length > 0 && <button className="text-xs text-bronze hover:underline" onClick={() => setAreaFilter([])}>Limpar filtro</button>}
            </div>
            <div className="flex flex-wrap gap-2">
              {areas.map(([k, a]) => {
                const on = selected.includes(k);
                return (
                  <button key={k} type="button" aria-pressed={on} onClick={() => setAreaFilter(on ? selected.filter(x => x !== k) : [...selected, k])}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${on ? 'bg-navy text-white border-navy' : 'bg-surface text-muted border-line hover:text-ink hover:border-slate-300'}`}>
                    {a.label} <span className={on ? 'text-white/70' : 'text-muted/70'}>({a.count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <SmartTable bare id="painel" rows={rows} rowKey={r => r.id} defaultSort={{ key: 'name', dir: 'asc' }}
          empty={data.rows.length === 0 ? 'Nenhuma vinculação vigente.' : 'Nenhum resultado para o filtro escolhido.'} cols={[
            { id: 'name', label: 'Magistrado(a)', sort: r => r.name, tdClass: 'font-medium', render: r => <>
              {r.name}
              {r.duplicates && <div className="text-[11px] font-normal text-danger mt-0.5 leading-snug" title={r.duplicates.map(d => `${d.editionTitle} — ${d.unit} (${d.area})`).join('\n')}>
                ◦ Duplicidade: {r.duplicates.length + 1} vinculações vigentes
                {r.duplicates.map((d, i) => <div key={i} className="text-muted">também em {d.unit} ({d.area}) · {d.editionTitle}</div>)}
              </div>}
            </> },
            { id: 'area', label: 'Área de atuação', optional: true, filter: r => r.area, sort: r => r.area, tdClass: 'text-muted', render: r => r.area },
            { id: 'pref', label: 'Preferência atendida', optional: true, filter: r => (r.preference === 1 ? '1ª preferência' : r.preference === 2 ? '2ª preferência' : 'Fora das preferências'), sort: r => r.preference || 9, render: r => <>
              <Badge tone={r.preference === 1 ? 'ok' : r.preference === 2 ? 'info' : 'warn'}>{r.preference === 1 ? '1ª preferência' : r.preference === 2 ? '2ª preferência' : 'Fora das preferências'}</Badge>
              <div className="text-[11px] text-muted mt-1 leading-snug">1ª: {r.firstPreference || '—'}{r.secondPreference ? <><br />2ª: {r.secondPreference}</> : null}</div>
            </> },
            { id: 'unit', label: 'Unidade', filter: r => fullUnitName({ unitName: r.unit, comarca: r.comarca, separator: r.separator }), sort: r => fullUnitName({ unitName: r.unit, comarca: r.comarca, separator: r.separator }), render: r => <>
              {fullUnitName({ unitName: r.unit, comarca: r.comarca, separator: r.separator })}
              {r.note && <div className="text-xs text-muted">Obs.: {r.note}</div>}
              <button type="button" className="block text-xs text-bronze hover:underline" title="Corrigir a data de início da atuação" onClick={() => setStartEdit({ row: r, date: r.since ?? '' })}>
                {r.since ? `desde ${dmy(r.since)}` : 'início a informar'} <Pencil className="w-3 h-3 inline" />
              </button>
            </> },
            { id: 'comarca', label: 'Comarca', optional: true, hidden: true, sort: r => r.comarca ?? '', filter: r => r.comarca ?? '', tdClass: 'text-xs', render: r => r.comarca || '—' },
            { id: 'work', label: 'Atuação', optional: true, filter: r => r.workType ?? '', sort: r => r.workType ?? '', tdClass: 'text-xs', render: r => (r.workType === 'Audiência' ? 'Audiências' : r.workType === 'Sentença' ? 'Sentença' : r.workType) },
            { id: 'edition', label: 'Janela', optional: true, sort: r => r.editionTitle, filter: r => r.editionTitle, tdClass: 'text-xs text-muted', render: r => r.editionTitle },
            { id: 'postit', label: 'Observações', optional: true, sort: r => r.postit ?? '', filter: r => (r.postit ? 'Com observação' : 'Sem observação'), render: r => <PostIt key={`${r.id}:${r.postit ?? ''}`} row={r} run={run} onSaved={load} /> },
            { id: 'actions', label: '', align: 'right', render: r => (
              <div className="flex flex-wrap justify-end gap-1">
                <button className="btn-secondary btn-sm" onClick={() => openMove(r)}>Alterar vara/área/tipo</button>
                <button className="btn-secondary btn-sm" onClick={() => setExcludingRow(r)}>Excluir</button>
                <button className="btn-secondary btn-sm" onClick={() => { setDropping(r); setSei(''); setRequestDate(today()); }}>Desistência</button>
                <button className="btn-danger" title="Desfazer vinculação" aria-label="Desfazer vinculação" onClick={() => removeRow(r)}><Trash2 className="w-4 h-4" /></button>
              </div>
            ) },
          ]} />
        {rows.length > 0 && <p className="px-4 py-2.5 text-xs text-muted border-t border-line">{rows.length} de {data.rows.length} designações</p>}
      </div>

      {data.transfers.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-line"><h4 className="font-semibold text-navy">Alterações de vinculação <span className="text-muted font-normal">({data.transfers.length})</span></h4></div>
          <SmartTable bare picker={false} id="alteracoes" rows={data.transfers} rowKey={t => t.id} empty="" defaultSort={{ key: 'date', dir: 'desc' }} cols={[
            { id: 'name', label: 'Magistrado(a)', sort: t => t.name, tdClass: 'font-medium', render: t => t.name },
            { id: 'from', label: 'Vinculação anterior', sort: t => t.fromUnit, render: t => { const d = new Date(`${t.effectiveDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return <>{t.fromUnit}<div className="text-xs text-muted">{t.area} · {t.fromWorkType === 'Audiência' ? 'Audiências' : t.fromWorkType} · até {d.toISOString().slice(0, 10).split('-').reverse().join('/')}</div></>; } },
            { id: 'to', label: 'Nova vinculação', sort: t => t.toUnit, render: t => <>{t.toUnit}<div className="text-xs text-bronze">{t.toArea || t.area}{t.toArea && t.toArea.trim() !== t.area.trim() ? ' (alterada)' : ''} · {t.toWorkType === 'Audiência' ? 'Audiências' : t.toWorkType}{t.toWorkType !== t.fromWorkType ? ' (alterado)' : ''} · a partir de {t.effectiveDate.split('-').reverse().join('/')}</div>{t.sei && <div className="text-xs text-muted font-mono">SEI {t.sei}</div>}</> },
            { id: 'date', label: 'Vigência', sort: t => t.effectiveDate, tdClass: 'text-xs text-muted whitespace-nowrap', render: t => t.effectiveDate.split('-').reverse().join('/') },
          ]} />
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-line"><h4 className="font-semibold text-navy">Desistentes <span className="text-muted font-normal">({data.withdrawals.length})</span></h4></div>
        {data.withdrawals.length === 0 ? <p className="p-8 text-center text-sm text-muted">Nenhuma desistência registrada.</p> : (
          <SmartTable bare picker={false} id="desistentes" rows={data.withdrawals} rowKey={w => w.id} empty="" defaultSort={{ key: 'name', dir: 'asc' }} cols={[
            { id: 'name', label: 'Magistrado(a)', sort: w => w.name, tdClass: 'font-medium', render: w => w.name },
            { id: 'area', label: 'Área', sort: w => w.area, filter: w => w.area, tdClass: 'text-muted', render: w => w.area },
            { id: 'unit', label: 'Unidade', sort: w => w.unit, render: w => w.unit },
            { id: 'sei', label: 'SEI', sort: w => w.sei, tdClass: 'font-mono text-xs', render: w => w.sei || <span className="text-warn font-sans">A informar</span> },
            { id: 'date', label: 'Pedido em', sort: w => w.requestDate ?? '', tdClass: 'text-muted whitespace-nowrap', render: w => (w.requestDate ? w.requestDate.split('-').reverse().join('/') : <span className="text-warn">A informar</span>) },
            { id: 'until', label: 'Atuou até', sort: w => w.requestDate ?? '', tdClass: 'text-muted whitespace-nowrap', render: w => (w.requestDate ? dmy(monthEnd(w.requestDate)) : <span className="text-warn">A informar</span>) },
            { id: 'situation', label: 'Situação', sort: w => (w.endedAt ? 1 : 0), tdClass: 'text-xs', render: w => (w.endedAt ? <span className="text-warn">Apenas no período, até {formatDate(w.endedAt)}<br />(nova inscrição deferida)</span> : <span className="text-muted">Em vigor</span>) },
            { id: 'actions', label: '', align: 'right', tdClass: 'whitespace-nowrap', render: w => <><button className="btn-secondary btn-sm mr-1" onClick={() => setEditingWd({ ...w })}><Pencil className="w-3.5 h-3.5" /> Editar</button><button className="btn-secondary btn-sm" onClick={() => undoWithdrawal(w)}><RotateCcw className="w-3.5 h-3.5" /> Desfazer</button></> },
          ]} />
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-line">
          <h4 className="font-semibold text-navy">Histórico de atuação <span className="text-muted font-normal">({data.periods.length} períodos)</span></h4>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input max-w-xs" type="search" placeholder="Buscar por nome ou unidade" aria-label="Buscar no histórico" value={histQuery} onChange={e => setHistQuery(e.target.value)} />
            <button className="btn-secondary btn-sm" onClick={exportPeriods}><Download className="w-4 h-4" /> Planilha (XLSX)</button>
          </div>
        </div>
        <p className="px-4 pt-3 text-xs text-muted">Um período por magistrado e unidade. A alteração de vara/área encerra o período na véspera da nova vigência; a desistência, no último dia do mês do pedido; a exclusão, na data em que foi registrada. Sem data própria, o início é o da edição.</p>
        {(() => {
          const ht = fold(histQuery.trim());
          const list = data.periods.filter(p => !ht || fold(`${p.name} ${p.unit} ${p.area}`).includes(ht));
          return (
            <SmartTable bare id="historico" rows={list} rowKey={p => p.id} empty={data.periods.length ? 'Nenhum resultado para a busca.' : 'Nenhum período registrado.'} defaultSort={{ key: 'name', dir: 'asc' }} cols={[
              { id: 'name', label: 'Magistrado(a)', sort: p => `${p.name}|${p.start ?? ''}`, tdClass: 'font-medium', render: p => p.name },
              { id: 'unit', label: 'Unidade', sort: p => p.unit, render: p => <>{p.unit}<div className="text-xs text-muted">{p.area}{p.workType ? ` · ${p.workType === 'Audiência' ? 'Audiências' : p.workType}` : ''}</div></> },
              { id: 'edition', label: 'Janela', optional: true, sort: p => p.editionTitle, filter: p => p.editionTitle, tdClass: 'text-xs text-muted', render: p => p.editionTitle },
              { id: 'start', label: 'Início', sort: p => p.start ?? '', tdClass: 'whitespace-nowrap', render: p => (p.start ? dmy(p.start) : <span className="text-warn">A informar</span>) },
              { id: 'end', label: 'Fim', sort: p => p.end ?? (p.endReason ? '0' : '9'), tdClass: 'whitespace-nowrap', render: p => (p.end ? dmy(p.end) : p.endReason ? <span className="text-warn">A informar</span> : <Badge tone="ok">Em curso</Badge>) },
              { id: 'reason', label: 'Encerramento', filter: p => p.endReason || 'Em curso', sort: p => p.endReason, tdClass: 'text-xs', render: p => <>{p.endReason || '—'}{p.sei && <div className="text-muted font-mono">SEI {p.sei}</div>}</> },
            ]} />
          );
        })()}
      </div>

      <details className="card p-5">
        <summary className="cursor-pointer font-semibold text-navy">Importar de uma planilha</summary>
        <div className="space-y-4 mt-4">
          <p className="text-sm text-muted">
            No Excel, selecione as colunas <strong className="text-ink">Nome</strong>, <strong className="text-ink">Área</strong> e <strong className="text-ink">Designado Para</strong> (com ou sem a linha de cabeçalho),
            copie (Ctrl+C) e cole abaixo (Ctrl+V). Cada linha vira uma vinculação da janela <strong className="text-ink">{data.initialEdition.title}</strong> (e-mail, lotação e comarca ficam em branco) e pode ser ajustada na aba Vinculações.
          </p>
          <textarea rows={8} className="input font-mono text-xs" placeholder={'Nome\tÁrea\tDesignado Para\nDra. Fulana de Tal\tCrime\t1ª Vara Criminal de Curitiba'}
            value={text} onChange={e => { setText(e.target.value); setPreview(null); }} aria-label="Linhas copiadas da planilha" />
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-secondary btn-sm" disabled={!text.trim() || busy} onClick={check}>Conferir</button>
          </div>
          {preview && (
            <div className="rounded-md border border-line bg-paper p-4 space-y-3">
              <div className="text-sm">
                <strong className="text-ink">{preview.total}</strong> linha(s) válida(s)
                {preview.duplicates > 0 && <> · <span className="text-muted">{preview.duplicates} repetida(s) (ignoradas)</span></>}
                {preview.errorCount > 0 && <> · <span className="text-danger">{preview.errorCount} com problema</span></>}
              </div>
              {preview.errors.length > 0 && (
                <ul className="text-xs text-danger list-disc pl-5 space-y-0.5 max-h-32 overflow-y-auto">
                  {preview.errors.map(e => <li key={e.line}>Linha {e.line}: {e.message}</li>)}
                </ul>
              )}
              {preview.preview.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr><th className="th">Nome</th><th className="th">Área</th><th className="th">Designado para</th></tr></thead>
                    <tbody className="divide-y divide-line">{preview.preview.map((r, i) => <tr key={i}><td className="px-3 py-2">{r.name}</td><td className="px-3 py-2 text-muted">{r.area}</td><td className="px-3 py-2">{r.unit}</td></tr>)}</tbody>
                  </table>
                  {preview.total > preview.preview.length && <p className="text-[11px] text-muted mt-1.5">Mostrando as {preview.preview.length} primeiras.</p>}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {preview.errorCount === 0 && <button className="btn-primary btn-sm" disabled={busy || preview.total === 0 && preview.duplicates === 0} onClick={() => doImport(false)}><Check className="w-4 h-4" /> Importar {preview.total} linha(s)</button>}
                {preview.errorCount > 0 && preview.total > 0 && <button className="btn-primary btn-sm" disabled={busy} onClick={() => doImport(true)}><Check className="w-4 h-4" /> Importar {preview.total} válida(s), ignorando as {preview.errorCount} com problema</button>}
              </div>
            </div>
          )}
        </div>
      </details>

      {moving && (
        <Modal title="Alterar vara, área ou tipo de atuação" onClose={() => setMoving(null)}>
          <form onSubmit={submitMove} className="space-y-4">
            <p className="text-sm text-muted"><strong className="text-ink">{moving.row.name}</strong> atua hoje em <strong className="text-ink">{moving.row.unit}</strong> (área: <strong className="text-ink">{moving.row.area}</strong>; tipo: <strong className="text-ink">{moving.row.workType === 'Audiência' ? 'Audiências' : moving.row.workType || '—'}</strong>). Altere a vara, a área e/ou o tipo. A vinculação anterior ficará registrada como válida até o dia anterior à data informada.</p>
            {(() => {
              const initial = moving.row.editionId === data.initialEdition.id;
              const comarcas = initial ? COMARCAS : [...new Set(moving.units.map(u => u.comarca))].sort((x, y) => x.localeCompare(y, 'pt-BR'));
              const existing = moving.units.filter(u => u.comarca === moveComarca);
              const have = new Set(existing.map(u => u.catalogId).filter(Boolean));
              const fromCatalog = initial && moveComarca ? unitsOfComarca(moveComarca).filter(c => !have.has(c.id) && fullUnitName(c) !== moving.row.unit && c.unitName !== moving.row.unit) : [];
              return (
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Nova comarca (em branco para manter a atual)">
                    <select className="input" value={moveComarca} onChange={e => { setMoveComarca(e.target.value); setMoveUnit(''); }} disabled={!!moveNewName.trim()}>
                      <option value="">Manter a comarca atual</option>
                      {comarcas.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="Nova vara">
                    <select className="input" value={moveUnit} onChange={e => setMoveUnit(e.target.value)} disabled={!moveComarca || !!moveNewName.trim()}>
                      <option value="">{moveComarca ? 'Manter a unidade atual' : 'Escolha a comarca primeiro'}</option>
                      {existing.map(u => <option key={u.id} value={u.id}>{unitOption(u, existing)}</option>)}
                      {fromCatalog.map(c => <option key={c.id} value={`cat:${c.id}`}>{c.unitName}</option>)}
                    </select>
                  </Field>
                </div>
              );
            })()}
            {moving.row.editionId === data.initialEdition.id && (
              <Field label="Ou digite o nome da nova vara (se ainda não estiver na lista)">
                <input className="input" maxLength={300} value={moveNewName} onChange={e => setMoveNewName(e.target.value)} placeholder="Ex.: 2ª Vara Cível de Londrina (com a comarca)" />
              </Field>
            )}
            <Field label="Área de atuação">
              <select className="input" required value={moveArea} onChange={e => setMoveArea(e.target.value)}>
                {!PREFERENCE_AREAS.includes(moveArea) && moveArea && <option value={moveArea}>{moveArea} (fora da lista)</option>}
                {PREFERENCE_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Tipo de atuação">
              <select className="input" value={moveWork} onChange={e => setMoveWork(e.target.value)}>
                {moveWork && !WORK_TYPES.includes(moveWork as WorkType) && <option value={moveWork}>{moveWork}</option>}
                {WORK_TYPES.map(w => <option key={w} value={w}>{w === 'Audiência' ? 'Audiências' : w}</option>)}
              </select>
            </Field>
            <Field label="Processo SEI da alteração (opcional)">
              <input className="input" maxLength={100} value={moveSei} onChange={e => setMoveSei(e.target.value)} placeholder="0000000-00.2026.8.16.6000" />
            </Field>
            <Field label="Valerá a partir de">
              <input className="input" type="date" required value={moveDate} onChange={e => setMoveDate(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setMoving(null)}>Cancelar</button>
              <button className="btn-primary" disabled={(!moveUnit && !moveNewName.trim() && moveArea.trim() === moving.row.area.trim() && moveWork === (moving.row.workType ?? '')) || !moveArea.trim() || !moveDate}>Registrar alteração</button>
            </div>
          </form>
        </Modal>
      )}

      {startEdit && (
        <Modal title="Data de início da atuação" onClose={() => setStartEdit(null)}>
          <form onSubmit={submitStart} className="space-y-4">
            <p className="text-sm text-muted"><strong className="text-ink">{startEdit.row.name}</strong> em <strong className="text-ink">{fullUnitName({ unitName: startEdit.row.unit, comarca: startEdit.row.comarca, separator: startEdit.row.separator })}</strong>. Use para corrigir a data (ex.: substituto que começou depois). Para mudar de vara, área ou tipo, use "Alterar vara/área/tipo".</p>
            <Field label="Atua desde (em branco = início da janela de inscrição)">
              <input className="input" type="date" autoFocus value={startEdit.date} onChange={e => setStartEdit({ ...startEdit, date: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setStartEdit(null)}>Cancelar</button>
              <button className="btn-primary">Salvar</button>
            </div>
          </form>
        </Modal>
      )}

      {excludingRow && (
        <ExcludeModal name={excludingRow.name} onClose={() => setExcludingRow(null)} onSubmit={async (reason, sei) => {
          if (await run(() => api(`/magistrates/${excludingRow.magistrateId}/exclude`, { method: 'POST', json: { reason, sei } }), 'Magistrado excluído.')) { setExcludingRow(null); await load(); onChanged(); }
        }} />
      )}

      {editingWd && (
        <Modal title="Editar desistência" onClose={() => setEditingWd(null)}>
          <form onSubmit={submitEditWd} className="space-y-4">
            <p className="text-sm text-muted"><strong className="text-ink">{editingWd.name}</strong></p>
            <Field label="Número do processo SEI">
              <input className="input" autoFocus maxLength={100} value={editingWd.sei} onChange={e => setEditingWd({ ...editingWd, sei: e.target.value })} placeholder="0000000-00.2026.8.16.6000" />
            </Field>
            <Field label="Data do pedido de desistência">
              <input className="input" type="date" value={editingWd.requestDate ?? ''} onChange={e => setEditingWd({ ...editingWd, requestDate: e.target.value })} />
            </Field>
            {editingWd.requestDate && <p className="text-xs text-muted -mt-2">Atuação até <strong className="text-ink">{dmy(monthEnd(editingWd.requestDate))}</strong>.</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setEditingWd(null)}>Cancelar</button>
              <button className="btn-primary">Salvar</button>
            </div>
          </form>
        </Modal>
      )}

      {dropping && (
        <Modal title="Registrar desistência" onClose={() => setDropping(null)}>
          <form onSubmit={submitWithdrawal} className="space-y-4">
            <p className="text-sm text-muted"><strong className="text-ink">{dropping.name}</strong> deixará todas as designações vigentes e passará à relação de desistentes.</p>
            <Field label="Número do processo SEI em que consta a desistência (pode ser informado depois)">
              <input className="input" autoFocus maxLength={100} value={sei} onChange={e => setSei(e.target.value)} placeholder="0000000-00.2026.8.16.6000" />
            </Field>
            <Field label="Data do pedido de desistência (pode ser informada depois)">
              <input className="input" type="date" value={requestDate} max={today()} onChange={e => setRequestDate(e.target.value)} />
            </Field>
            {requestDate && <p className="text-xs text-muted -mt-2">A atuação fica registrada até <strong className="text-ink">{dmy(monthEnd(requestDate))}</strong> (último dia do mês do pedido).</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setDropping(null)}>Cancelar</button>
              <button className="btn-primary">Registrar desistência</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
