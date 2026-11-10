// Backup: exportação, restauração e backup automático diário.
import { useEffect, useState } from 'react';
import { EmptyRow, Notice, formatDateTime, useFeedback } from '../ui';
import { api, download } from '../api';
import { Download, RotateCcw } from 'lucide-react';
import { type RunFn } from './shared';
import { Toolbar } from './table';

/* ---------- Backup e restauração ---------- */
export function BackupAdmin({ run, confirm, onRestored }: { run: RunFn; confirm: (m: string, label?: string) => Promise<boolean>; onRestored: () => void }) {
  const [summary, setSummary] = useState<null | { name: string; data: any; counts: string }>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useFeedback();

  const useData = (name: string, data: any) => {
    if (data?.app !== 'mutirao-cgj' || !Array.isArray(data.editions)) { toast('O arquivo escolhido não é um backup válido deste sistema.', 'danger'); return; }
    const n = (k: string) => (Array.isArray(data[k]) ? data[k].length : 0);
    setSummary({ name, data, counts: `${n('editions')} edição(ões), ${n('magistrates')} magistrado(s), ${n('units')} unidade(s), ${n('matches')} vinculação(ões), ${n('withdrawals')} desistência(s)` });
  };
  const pick = async (file?: File | null) => {
    setSummary(null);
    if (!file) return;
    try { useData(file.name, JSON.parse(await file.text())); }
    catch { toast('O arquivo escolhido não é um backup válido deste sistema.', 'danger'); }
  };
  // Backup automático diário (Cloud Storage)
  const [auto, setAuto] = useState<{ configured: boolean; destination: string | null; last: { at: string; ok: boolean; name?: string; size?: number; error?: string } | null } | null>(null);
  const [autoList, setAutoList] = useState<{ name: string; size: number; updated: string }[]>([]);
  useEffect(() => {
    api<typeof auto>('/backup/auto/status').then(st => { setAuto(st); if (st?.configured) api<typeof autoList>('/backup/auto/list').then(setAutoList).catch(() => {}); }).catch(() => {});
  }, []);
  const fileName = (n: string) => n.replace(/^backups\//, '');
  const loadAuto = async (name: string) => {
    const data = await run(() => api<any>(`/backup/auto/file?name=${encodeURIComponent(name)}`));
    if (data) { setSummary(null); useData(fileName(name), data); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
  };
  const restore = async () => {
    if (!summary) return;
    if (!(await confirm(`Restaurar o backup "${summary.name}" (${summary.counts})? Os dados atuais de edições, magistrados, unidades, vinculações, desistências e perguntas frequentes serão SUBSTITUÍDOS. Faça um backup dos dados atuais antes, se necessário.`, 'Restaurar backup'))) return;
    setBusy(true);
    const r = await run(() => api('/backup/restore', { method: 'POST', json: { confirm: 'RESTAURAR', data: summary.data } }), 'Backup restaurado.');
    setBusy(false);
    if (r) { setSummary(null); setText(String(Date.now())); onRestored(); }
  };

  return (
    <div className="space-y-6">
      <Toolbar title="Backup e restauração" />
      <div className="card p-5 space-y-3">
        <h4 className="font-semibold text-navy">Exportar backup</h4>
        <p className="text-sm text-muted">Salva em um único arquivo (.json) todas as edições, magistrados, unidades, vinculações, desistências, perguntas frequentes e o registro de atividades.
          O arquivo contém dados pessoais (nomes, e-mails e IPs): guarde-o em local seguro. Não inclui a senha nem o segredo do aplicativo autenticador.</p>
        <button className="btn-primary btn-sm" onClick={() => run(() => download('/backup', 'backup-mutirao.json'))}><Download className="w-4 h-4" /> Exportar backup</button>
      </div>
      <div className="card p-5 space-y-3">
        <h4 className="font-semibold text-navy">Backup automático diário</h4>
        {!auto ? <p className="text-sm text-muted">Carregando…</p> : !auto.configured ? (
          <Notice tone="danger">Backup automático não configurado. Siga a seção "Backup automático diário" do DEPLOY.md (bucket do Cloud Storage + Cloud Scheduler, dentro da cota gratuita).</Notice>
        ) : (
          <>
            <p className="text-sm text-muted">Uma cópia por dia em <span className="font-mono text-ink">{auto.destination}</span>, guardada por 60 dias.
              {auto.last && <> Último: <strong className={auto.last.ok ? 'text-ok' : 'text-danger'}>{formatDateTime(auto.last.at)} — {auto.last.ok ? 'concluído' : `falhou (${auto.last.error})`}</strong>.</>}</p>
            <div className="max-h-72 overflow-auto border border-line rounded-md">
              <table className="w-full text-sm">
                <thead className="sticky top-0"><tr><th className="th">Cópia</th><th className="th text-right">Tamanho</th><th className="th w-48"></th></tr></thead>
                <tbody className="divide-y divide-line">
                  {autoList.length === 0 && <EmptyRow cols={3}>Nenhuma cópia ainda.</EmptyRow>}
                  {autoList.map(f => (
                    <tr key={f.name}>
                      <td className="px-4 py-2 font-mono text-xs">{fileName(f.name)}</td>
                      <td className="px-4 py-2 text-right text-xs text-muted">{Math.round(f.size / 1024)} KB</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap space-x-1">
                        <button className="btn-secondary btn-sm" onClick={() => run(() => download(`/backup/auto/file?name=${encodeURIComponent(f.name)}`, fileName(f.name)))}><Download className="w-3.5 h-3.5" /> Baixar</button>
                        <button className="btn-secondary btn-sm" onClick={() => loadAuto(f.name)}><RotateCcw className="w-3.5 h-3.5" /> Restaurar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <div className="card p-5 space-y-3">
        <h4 className="font-semibold text-navy">Restaurar a partir de um backup</h4>
        <Notice tone="danger">A restauração <strong>substitui</strong> os dados atuais pelos do arquivo. O registro de atividades é preservado e recebe uma entrada sobre a restauração.</Notice>
        <input key={text} type="file" accept=".json,application/json" className="text-sm" aria-label="Arquivo de backup" onChange={e => pick(e.target.files?.[0])} />
        {summary && (
          <div className="rounded-md border border-line bg-paper p-4 space-y-3 text-sm">
            <div><strong className="text-ink">{summary.name}</strong>{summary.data.exportedAt && <span className="text-muted"> · gerado em {formatDateTime(summary.data.exportedAt)}</span>}</div>
            <div className="text-muted">Contém: {summary.counts}.</div>
            <button className="btn-danger !bg-danger-soft" disabled={busy} onClick={restore}><RotateCcw className="w-4 h-4" /> Restaurar este backup</button>
          </div>
        )}
      </div>
    </div>
  );
}
