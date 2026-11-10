// Formulários da administração: janela de inscrição, pergunta frequente e exclusão de magistrado.
import { Edition, FaqItem } from '../types';
import { useState } from 'react';
import { Field, Modal } from '../ui';
import { toLocalInput } from './shared';

/* ---------- Formulário da janela de inscrição ---------- */
export function EditionForm({ initial, onSubmit }: { initial?: Edition; onSubmit: (v: any) => Promise<void> }) {
  const [f, setF] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    openingDate: initial ? toLocalInput(initial.openingDate) : '',
    closingDate: initial ? toLocalInput(initial.closingDate) : '',
    isRegistrationOpen: initial?.isRegistrationOpen ?? true,
    activate: !initial,
    startDate: initial?.startDate ?? '',
  });
  return (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); onSubmit(f); }}>
      <Field label="Nome da janela de inscrição">
        <input required className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Ex.: Inscrições extraordinárias – novembro/2026" />
      </Field>
      <Field label="Descrição">
        <textarea rows={3} className="input" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
      </Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Abertura (horário de Brasília)"><input required type="datetime-local" className="input" value={f.openingDate} onChange={e => setF({ ...f, openingDate: e.target.value })} /></Field>
        <Field label="Encerramento (horário de Brasília)"><input required type="datetime-local" className="input" value={f.closingDate} onChange={e => setF({ ...f, closingDate: e.target.value })} /></Field>
      </div>
      <Field label="Início da atuação dos magistrados (vale para as vinculações sem data própria)">
        <input type="date" className="input" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} />
      </Field>
      {initial ? (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isRegistrationOpen} onChange={e => setF({ ...f, isRegistrationOpen: e.target.checked })} /> Inscrições públicas habilitadas <span className="text-muted">(as datas acima também precisam estar vigentes)</span></label>
      ) : (
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.activate} onChange={e => setF({ ...f, activate: e.target.checked })} />
          <span>Tornar esta a janela vigente <span className="text-muted">(as inscrições públicas passam a ser registradas nela)</span></span></label>
      )}
      <button className="btn-primary w-full">{initial ? 'Salvar alterações' : 'Criar janela'}</button>
    </form>
  );
}

/* ---------- Formulário de pergunta frequente ---------- */
export function FaqForm({ initial, onSubmit }: { initial?: FaqItem; onSubmit: (v: { question: string; answer: string; published: boolean }) => Promise<void> }) {
  const [f, setF] = useState({ question: initial?.question ?? '', answer: initial?.answer ?? '', published: initial?.published ?? true });
  return (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); onSubmit(f); }}>
      <Field label="Pergunta">
        <input required maxLength={300} className="input" value={f.question} onChange={e => setF({ ...f, question: e.target.value })} />
      </Field>
      <Field label="Resposta">
        <textarea required rows={7} maxLength={4000} className="input" value={f.answer} onChange={e => setF({ ...f, answer: e.target.value })} />
        <p className="text-[11px] text-muted mt-1">Texto simples; as quebras de linha são preservadas. {f.answer.length}/4000</p>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.published} onChange={e => setF({ ...f, published: e.target.checked })} />
        Publicada (visível na página pública)
      </label>
      <button className="btn-primary w-full">{initial ? 'Salvar alterações' : 'Adicionar pergunta'}</button>
    </form>
  );
}

/* ---------- Exclusão de magistrado (com justificativa obrigatória) ---------- */
export function ExcludeModal({ name, onClose, onSubmit }: { name: string; onClose: () => void; onSubmit: (reason: string, sei: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [sei, setSei] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Excluir magistrado" onClose={onClose}>
      <form className="space-y-4" onSubmit={async e => { e.preventDefault(); setBusy(true); await onSubmit(reason.trim(), sei.trim()); setBusy(false); }}>
        <p className="text-sm text-muted"><strong className="text-ink">{name}</strong> sairá das listas e do painel de vinculações (as vinculações são desfeitas). A exclusão fica registrada e pode ser desfeita. O motivo não aparece na consulta pública.</p>
        <Field label="Motivo da exclusão (obrigatório)">
          <textarea className="input" rows={3} required minLength={5} maxLength={1000} autoFocus value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
        <Field label="Processo SEI (opcional)">
          <input className="input" maxLength={100} value={sei} onChange={e => setSei(e.target.value)} placeholder="0000000-00.2026.8.16.6000" />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary !bg-danger" disabled={busy || reason.trim().length < 5}>Excluir</button>
        </div>
      </form>
    </Modal>
  );
}
