import React, { createContext, useCallback, useContext, useState } from 'react';
import { X, CheckCircle2, AlertCircle } from 'lucide-react';

const TONES = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  info: 'bg-bronze-soft text-bronze',
  neutral: 'bg-paper text-muted border border-line',
  danger: 'bg-danger-soft text-danger',
} as const;

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-block whitespace-nowrap px-2.5 py-1 rounded text-[11px] font-medium leading-none ${TONES[tone]}`}>{children}</span>;
}

export const magistrateTone = (s: string) =>
  s === 'Rejeitado' ? 'danger' : s === 'Atribuído' ? 'ok' : s === 'Aprovado' || s === 'Lista de Espera' ? 'info' : 'warn';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'ok' | 'danger'; children: React.ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : AlertCircle;
  return (
    <div className={`flex items-start gap-3 rounded-md px-4 py-3 text-sm ${TONES[tone]}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-navy/40 flex items-center justify-center p-4 overflow-y-auto" onMouseDown={onClose}>
      <div className="card shadow-xl w-full max-w-lg p-6 sm:p-7 relative my-8" onMouseDown={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-muted hover:text-ink" aria-label="Fechar">
          <X className="w-5 h-5" />
        </button>
        <h3 className="text-xl font-semibold text-navy mb-5 pr-6">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function EmptyRow({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-10 text-center text-sm text-muted">{children}</td>
    </tr>
  );
}

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
export const formatDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR');

/* ---- Feedback (substitui alert/confirm, que podem ser bloqueados no iframe do AI Studio) ---- */
interface Feedback {
  toast: (message: string, tone?: 'ok' | 'danger') => void;
  confirm: (message: string, confirmLabel?: string) => Promise<boolean>;
}
const FeedbackContext = createContext<Feedback>({ toast: () => {}, confirm: async () => false });
export const useFeedback = () => useContext(FeedbackContext);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; tone: 'ok' | 'danger' }[]>([]);
  const [pending, setPending] = useState<{ message: string; label: string; resolve: (v: boolean) => void } | null>(null);

  const toast = useCallback((message: string, tone: 'ok' | 'danger' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, message, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  const confirm = useCallback(
    (message: string, label = 'Confirmar') =>
      new Promise<boolean>(resolve => setPending({ message, label, resolve })),
    [],
  );

  const answer = (v: boolean) => { pending?.resolve(v); setPending(null); };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] space-y-2 max-w-sm">
        {toasts.map(t => (
          <div key={t.id} className="shadow-lg"><Notice tone={t.tone}>{t.message}</Notice></div>
        ))}
      </div>
      {pending && (
        <Modal title="Confirmação" onClose={() => answer(false)}>
          <p className="text-sm text-muted mb-6">{pending.message}</p>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => answer(false)}>Cancelar</button>
            <button className="btn-primary" onClick={() => answer(true)}>{pending.label}</button>
          </div>
        </Modal>
      )}
    </FeedbackContext.Provider>
  );
}
