// Lista oficial de comarcas e unidades (edição pelo painel).
import React, { useCallback, useEffect, useState } from 'react';
import { CATALOG, COMARCAS, unitsOfComarca, type CatalogUnit } from '../catalogo-tjpr';
import { api, reloadCatalog } from '../api';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { Badge, Field, Modal } from '../ui';
import { type RunFn } from './shared';
import { SmartTable, Toolbar } from './table';

export const SEPARATORS = ['DE', 'DA', 'DO', 'DOS', 'DAS', '–'];

export type CatalogUsage = Record<string, { linked: string[]; registrations: number; lotacao: number }>;

/** Lista oficial de comarcas e unidades: incluir, renomear e apagar (alterações refletem nos registros já feitos). */
export function CatalogAdmin({ run, confirm, readOnly, onChanged }: { run: RunFn; confirm: (m: string, label?: string) => Promise<boolean>; readOnly: boolean; onChanged: () => void }) {
  const [comarca, setComarca] = useState(COMARCAS[0] ?? '');
  const [q, setQ] = useState('');
  const [usage, setUsage] = useState<CatalogUsage>({});
  const [editing, setEditing] = useState<null | { id?: string; comarca: string; unitName: string; separator: string }>(null);
  const [comarcaForm, setComarcaForm] = useState<null | { old?: string; name: string }>(null);
  const loadUsage = useCallback(async () => { const r = await run(() => api<CatalogUsage>('/catalog/usage')); if (r) setUsage(r); }, [run]);
  useEffect(() => { loadUsage(); }, []);
  const after = async (ok: unknown, nextComarca?: string) => {
    if (!ok) return false;
    await reloadCatalog().catch(() => {});
    if (nextComarca !== undefined) setComarca(nextComarca);
    await loadUsage(); onChanged();
    return true;
  };
  const term = q.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const rows: CatalogUnit[] = term
    ? CATALOG.filter(u => u.label.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().includes(term))
    : unitsOfComarca(comarca);
  const use = (u: CatalogUnit) => usage[u.id];
  const enc = encodeURIComponent;

  const saveUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const body = { comarca: editing.comarca, unitName: editing.unitName, separator: editing.separator };
    const ok = editing.id
      ? await run(() => api<{ changed: number }>(`/catalog/units/${enc(editing.id!)}`, { method: 'PUT', json: body }), 'Unidade alterada. As inscrições, lotações e o painel foram atualizados.')
      : await run(() => api(`/catalog/units`, { method: 'POST', json: body }), 'Unidade incluída.');
    if (await after(ok, term ? undefined : editing.comarca)) setEditing(null);
  };
  const saveComarca = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comarcaForm) return;
    const name = comarcaForm.name.trim().toLocaleUpperCase('pt-BR');
    const ok = comarcaForm.old
      ? await run(() => api(`/catalog/comarcas/${enc(comarcaForm.old!)}`, { method: 'PUT', json: { name } }), 'Comarca renomeada. As unidades e os registros foram atualizados.')
      : await run(() => api(`/catalog/comarcas`, { method: 'POST', json: { name } }), 'Comarca incluída.');
    if (await after(ok, name)) setComarcaForm(null);
  };
  const removeUnit = async (u: CatalogUnit) => {
    const x = use(u);
    if (x?.linked.length) return void (await confirm(`Não é possível apagar ${u.label}: há magistrado(s) vinculado(s) (${x.linked.join(', ')}). Altere ou desfaça a vinculação antes.`, 'Entendi'));
    const extra = x && (x.registrations || x.lotacao) ? ` ${x.registrations} inscrição(ões) de unidade e ${x.lotacao} lotação(ões) de magistrado mantêm o nome, mas deixam de estar ligadas à lista.` : '';
    if (await confirm(`Apagar ${u.label} da lista oficial?${extra}`, 'Apagar')) await after(await run(() => api(`/catalog/units/${enc(u.id)}`, { method: 'DELETE' }), 'Unidade apagada.'));
  };
  const removeComarca = async () => {
    const list = unitsOfComarca(comarca);
    const linked = list.filter(u => use(u)?.linked.length);
    if (linked.length) return void (await confirm(`Não é possível apagar a comarca ${comarca}: há magistrado(s) vinculado(s) em ${linked.map(u => u.unitName).join('; ')}.`, 'Entendi'));
    if (await confirm(`Apagar a comarca ${comarca} e suas ${list.length} unidade(s) da lista oficial?`, 'Apagar')) {
      await after(await run(() => api(`/catalog/comarcas/${enc(comarca)}`, { method: 'DELETE' }), 'Comarca apagada.'), COMARCAS.find(c => c !== comarca) ?? '');
    }
  };

  return (
    <div className="space-y-5">
      <Toolbar title="Comarcas e unidades">
        {!readOnly && <button className="btn-secondary btn-sm" onClick={() => setComarcaForm({ name: '' })}><Plus className="w-4 h-4" /> Nova comarca</button>}
        {!readOnly && <button className="btn-primary btn-sm" onClick={() => setEditing({ comarca: comarca || COMARCAS[0] || '', unitName: '', separator: 'DE' })}><Plus className="w-4 h-4" /> Nova unidade</button>}
      </Toolbar>
      <p className="text-sm text-muted -mt-2">
        Lista oficial usada nos formulários de inscrição, na padronização de nomes e nos relatórios ({COMARCAS.length} comarcas, {CATALOG.length} unidades).
        Ao renomear, as inscrições, lotações e o painel de vinculações passam a mostrar o novo nome. Unidades com magistrado vinculado não podem ser apagadas.
      </p>
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <Field label="Comarca">
          <select className="input !w-auto min-w-[16rem]" value={comarca} onChange={e => { setComarca(e.target.value); setQ(''); }} disabled={!!term}>
            {COMARCAS.map(c => <option key={c} value={c}>{c} ({unitsOfComarca(c).length})</option>)}
          </select>
        </Field>
        {!readOnly && comarca && !term && <>
          <button className="btn-secondary btn-sm" onClick={() => setComarcaForm({ old: comarca, name: comarca })}><Pencil className="w-4 h-4" /> Renomear comarca</button>
          <button className="btn-danger btn-sm" onClick={removeComarca}><Trash2 className="w-4 h-4" /> Apagar comarca</button>
        </>}
        <Field label="Buscar unidade em todas as comarcas">
          <input className="input min-w-[16rem]" value={q} onChange={e => setQ(e.target.value)} placeholder="Ex.: vara criminal londrina" />
        </Field>
      </div>
      <SmartTable id="catalogo" picker={false} rows={rows} rowKey={u => u.id} empty={term ? 'Nenhuma unidade encontrada.' : 'Nenhuma unidade cadastrada nesta comarca.'}
        defaultSort={{ key: 'name', dir: 'asc' }} cols={[
        { id: 'name', label: 'Unidade', sort: u => u.unitName, render: u => <><div className="font-medium">{u.unitName}</div><div className="text-xs text-muted">{u.label}</div></> },
        { id: 'comarca', label: 'Comarca', sort: u => u.comarca, tdClass: 'whitespace-nowrap', render: u => u.comarca },
        { id: 'use', label: 'Uso', sort: u => (use(u)?.linked.length ?? 0) * 1000 + (use(u)?.registrations ?? 0) + (use(u)?.lotacao ?? 0), tdClass: 'text-xs', render: u => {
          const x = use(u);
          if (!x) return <span className="text-muted">—</span>;
          return <div className="space-y-0.5">
            {x.linked.length > 0 && <div><Badge tone="ok">{x.linked.length} vinculado(s)</Badge></div>}
            {x.registrations > 0 && <div className="text-muted">{x.registrations} inscrição(ões) de unidade</div>}
            {x.lotacao > 0 && <div className="text-muted">{x.lotacao} lotação(ões)</div>}
          </div>;
        } },
        ...(readOnly ? [] : [{ id: 'actions', label: '', align: 'right' as const, tdClass: 'whitespace-nowrap space-x-1', render: (u: CatalogUnit) => <>
          <button className="btn-secondary btn-sm" onClick={() => setEditing({ id: u.id, comarca: u.comarca, unitName: u.unitName, separator: u.separator })}><Pencil className="w-4 h-4" /> Editar</button>
          <button className="btn-danger btn-sm" disabled={!!use(u)?.linked.length} title={use(u)?.linked.length ? 'Há magistrado vinculado a esta unidade' : undefined} onClick={() => removeUnit(u)}><Trash2 className="w-4 h-4" /> Apagar</button>
        </> }]),
      ]} />
      {editing && (
        <Modal title={editing.id ? 'Editar unidade' : 'Nova unidade'} onClose={() => setEditing(null)}>
          <form onSubmit={saveUnit} className="space-y-4">
            <Field label="Comarca">
              <select className="input" value={editing.comarca} onChange={e => setEditing({ ...editing, comarca: e.target.value })}>
                {COMARCAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Nome da unidade (sem a comarca)">
              <input className="input" required minLength={3} maxLength={300} autoFocus value={editing.unitName} onChange={e => setEditing({ ...editing, unitName: e.target.value.toLocaleUpperCase('pt-BR') })} />
            </Field>
            <Field label="Ligação entre unidade e comarca">
              <select className="input !w-auto" value={editing.separator} onChange={e => setEditing({ ...editing, separator: e.target.value })}>
                {SEPARATORS.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            <p className="text-sm text-muted">Nome oficial: <strong className="text-ink">{`${editing.unitName.trim() || '…'} ${editing.separator} ${editing.comarca}`}</strong></p>
            {editing.id && <p className="rounded-md border border-line bg-paper px-3 py-2 text-xs text-muted">As inscrições de unidade, as lotações de magistrados e os nomes do painel (desistências e alterações de vara) que usam esta unidade serão atualizados.</p>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancelar</button><button className="btn-primary">Salvar</button></div>
          </form>
        </Modal>
      )}
      {comarcaForm && (
        <Modal title={comarcaForm.old ? `Renomear a comarca ${comarcaForm.old}` : 'Nova comarca'} onClose={() => setComarcaForm(null)}>
          <form onSubmit={saveComarca} className="space-y-4">
            <Field label="Nome da comarca">
              <input className="input" required minLength={2} maxLength={120} autoFocus value={comarcaForm.name} onChange={e => setComarcaForm({ ...comarcaForm, name: e.target.value.toLocaleUpperCase('pt-BR') })} />
            </Field>
            {comarcaForm.old && <p className="rounded-md border border-line bg-paper px-3 py-2 text-xs text-muted">O nome oficial de todas as unidades desta comarca e os registros que as usam serão atualizados.</p>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setComarcaForm(null)}>Cancelar</button><button className="btn-primary">Salvar</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
