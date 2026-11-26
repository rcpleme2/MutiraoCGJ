// Cruzamento: responsáveis por unidades inscritas que também são magistrados voluntários.
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api, download } from '../api';
import { Badge, EmptyRow } from '../ui';
import { Toolbar } from './table';

interface Row { name: string; email: string; status: string; represents: { unit: string; edition: string; selection: string; status: string; by: 'lotação' | 'responsável'; designatedHere: { name: string; area: string; workType: string; since: string | null }[] }[]; designated: { unit: string; area: string; workType: string; since: string | null; edition: string }[] }

export function TitularesAdmin({ scopeQuery }: { scopeQuery: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { setRows(null); api<Row[]>(`/titulares-voluntarios?${scopeQuery}`).then(setRows).catch(() => setRows([])); }, [scopeQuery]);
  return (
    <div>
      <Toolbar title={`Responsáveis por unidade que também são voluntários${rows ? ` (${rows.length})` : ''}`}>
        <button className="btn-secondary btn-sm" onClick={() => download(`/titulares-voluntarios/export.xlsx?${scopeQuery}`, 'titulares-voluntarios.xlsx').catch(() => {})}><Download className="w-4 h-4" /> Relatório XLSX</button>
        <button className="btn-secondary btn-sm" onClick={() => download(`/titulares-voluntarios/export.pdf?${scopeQuery}`, 'titulares-voluntarios.pdf').catch(() => {})}><Download className="w-4 h-4" /> Relatório PDF</button>
      </Toolbar>
      <p className="text-sm text-muted mb-4">
        Magistrados com inscrição como voluntários (rejeitadas ou excluídas não entram) que representam uma unidade <strong className="text-ink">escolhida e com magistrado vinculado atualmente</strong>.
        A unidade é identificada primeiro pelo campo <strong className="text-ink">Lotação</strong> da inscrição (aba Magistrados) e, se a lotação estiver em branco, pelo <strong className="text-ink">responsável pela unidade</strong> no cadastro (comparação pelo nome).
      </p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th className="th">Magistrado(a)</th><th className="th">Unidade que representa</th><th className="th">Magistrado designado para a unidade</th><th className="th">Unidade em que está designado(a)</th></tr></thead>
          <tbody>
            {rows === null ? <EmptyRow cols={4}>Carregando…</EmptyRow> : rows.length === 0 ? <EmptyRow cols={4}>Nenhum responsável por unidade consta também como voluntário.</EmptyRow> : rows.map((r) => (
              <tr key={r.name}>
                <td className="td align-top"><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.email}</div><div className="mt-1"><Badge tone="neutral">{r.status}</Badge></div></td>
                <td className="td align-top space-y-2">{r.represents.map((u, i) => <div key={i}>{u.unit}<div className="text-[11px] text-bronze">{u.edition} · {u.selection}{u.selection === 'Escolhida' ? ` · ${u.status}` : ''} · pela {u.by}</div></div>)}</td>
                <td className="td align-top space-y-2">{r.represents.map((u, i) => <div key={i}>{u.designatedHere.length === 0 ? <span className="text-muted">Sem magistrado designado</span> : u.designatedHere.map((d, k) => <div key={k}><span className="font-medium">{d.name}</span><div className="text-[11px] text-muted">{d.area}{d.workType ? ` · ${d.workType}` : ''}{d.since ? ` · desde ${d.since.split('-').reverse().join('/')}` : ''}</div></div>)}{r.represents.length > 1 && <div className="text-[11px] text-bronze">{u.unit}</div>}</div>)}</td>
                <td className="td align-top space-y-2">{r.designated.length === 0 ? <span className="text-muted">Aguardando vinculação (sem designação)</span> : r.designated.map((d, i) => <div key={i}>{d.unit}<div className="text-[11px] text-muted">{d.area}{d.workType ? ` · ${d.workType}` : ''}{d.since ? ` · desde ${d.since.split('-').reverse().join('/')}` : ''}</div></div>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
