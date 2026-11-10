// Usuários administrativos e perfis de acesso.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Field, Modal, formatDateTime } from '../ui';
import { Plus } from 'lucide-react';
import { type RunFn } from './shared';
import { SmartTable, Toolbar } from './table';

/* ---------- Usuários administrativos (perfil Administrador) ---------- */
export type Role = 'admin' | 'gestor' | 'consulta';

export const ROLE_NAMES: Record<Role, string> = { admin: 'Administrador', gestor: 'Gestor', consulta: 'Consulta' };

export interface AdminUserView { id: string; name: string; email: string; role: Role; active: boolean; hasTotp: boolean; createdAt: string; lastLoginAt?: string }

export function UsersAdmin({ run, confirm }: { run: RunFn; confirm: (m: string, label?: string) => Promise<boolean> }) {
  const [list, setList] = useState<AdminUserView[]>([]);
  const [f, setF] = useState({ name: '', email: '', role: 'gestor' as Role, password: '' });
  const [pwFor, setPwFor] = useState<AdminUserView | null>(null);
  const [pw, setPw] = useState('');
  const load = useCallback(async () => { const r = await run(() => api<AdminUserView[]>('/admin/users')); if (r) setList(r); }, [run]);
  useEffect(() => { load(); }, []);
  const update = async (u: AdminUserView, body: object, msg: string) => { if (await run(() => api(`/admin/users/${u.id}`, { method: 'PUT', json: body }), msg)) await load(); };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => api('/admin/users', { method: 'POST', json: f }), 'Usuário criado.')) { setF({ name: '', email: '', role: 'gestor', password: '' }); await load(); }
  };
  return (
    <div className="space-y-6">
      <Toolbar title="Usuários administrativos" />
      <p className="text-sm text-muted -mt-2">
        Cada pessoa entra com o próprio e-mail, senha e aplicativo autenticador, e o Registro mostra quem fez cada ação.
        <strong className="text-ink"> Administrador</strong>: tudo, inclusive usuários, backup e exclusões em lote · <strong className="text-ink">Gestor</strong>: operação do mutirão · <strong className="text-ink">Consulta</strong>: somente leitura.
        Com ao menos um Administrador cadastrado, a senha compartilhada deixa de funcionar.
      </p>
      <SmartTable id="usuarios" picker={false} rows={list} rowKey={u => u.id} empty="Nenhum usuário cadastrado: o acesso ainda é pela senha compartilhada." defaultSort={{ key: 'name', dir: 'asc' }}
        rowClass={u => (u.active ? '' : 'opacity-60')} cols={[
        { id: 'name', label: 'Nome / e-mail', sort: u => u.name, render: u => <><div className="font-medium">{u.name}</div><div className="text-xs text-muted">{u.email}</div></> },
        { id: 'role', label: 'Perfil', sort: u => ROLE_NAMES[u.role], render: u => (
          <select className="input !py-1.5 !w-auto text-sm" value={u.role} onChange={e => update(u, { role: e.target.value }, 'Perfil alterado.')} aria-label="Perfil">
            {(Object.keys(ROLE_NAMES) as Role[]).map(r => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
          </select>
        ) },
        { id: 'active', label: 'Situação', sort: u => (u.active ? 0 : 1), render: u => <><Badge tone={u.active ? 'ok' : 'neutral'}>{u.active ? 'Ativo' : 'Desativado'}</Badge>{!u.hasTotp && u.active && <div className="text-[11px] text-warn mt-1">Autenticador a cadastrar no próximo acesso</div>}</> },
        { id: 'last', label: 'Último acesso', sort: u => u.lastLoginAt ?? '', tdClass: 'text-xs text-muted whitespace-nowrap', render: u => (u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—') },
        { id: 'actions', label: '', align: 'right', tdClass: 'whitespace-nowrap space-x-1', render: u => <>
          <button className="btn-secondary btn-sm" onClick={() => { setPwFor(u); setPw(''); }}>Redefinir senha</button>
          {u.hasTotp && <button className="btn-secondary btn-sm" onClick={async () => { if (await confirm(`Redefinir o autenticador de ${u.name}? No próximo acesso será pedido novo cadastro do aplicativo.`, 'Redefinir')) await update(u, { resetTotp: true }, 'Autenticador redefinido.'); }}>Redefinir 2FA</button>}
          <button className={`btn-sm ${u.active ? 'btn-danger' : 'btn-secondary'}`} onClick={async () => { if (await confirm(`${u.active ? 'Desativar' : 'Reativar'} ${u.name}?`, u.active ? 'Desativar' : 'Reativar')) await update(u, { active: !u.active }, u.active ? 'Usuário desativado.' : 'Usuário reativado.'); }}>{u.active ? 'Desativar' : 'Reativar'}</button>
        </> },
      ]} />
      <form onSubmit={create} className="card p-5 space-y-4">
        <h4 className="font-semibold text-navy">Novo usuário</h4>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Nome"><input className="input" required maxLength={120} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="E-mail"><input className="input" type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Perfil">
            <select className="input" value={f.role} onChange={e => setF({ ...f, role: e.target.value as Role })}>
              {(Object.keys(ROLE_NAMES) as Role[]).map(r => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
            </select>
          </Field>
          <Field label="Senha inicial (mín. 10 caracteres; informe à pessoa por canal seguro)"><input className="input" type="text" required minLength={10} autoComplete="new-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></Field>
        </div>
        <button className="btn-primary btn-sm"><Plus className="w-4 h-4" /> Criar usuário</button>
      </form>
      {pwFor && (
        <Modal title={`Nova senha para ${pwFor.name}`} onClose={() => setPwFor(null)}>
          <form onSubmit={async e => { e.preventDefault(); await update(pwFor, { password: pw }, 'Senha redefinida.'); setPwFor(null); }} className="space-y-4">
            <Field label="Nova senha (mín. 10 caracteres)"><input className="input" type="text" required minLength={10} autoFocus value={pw} onChange={e => setPw(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setPwFor(null)}>Cancelar</button><button className="btn-primary">Salvar</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
