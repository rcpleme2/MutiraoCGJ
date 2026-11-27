// Magistrados - situação peculiar: voluntários que também representam uma unidade escolhida e vinculada.
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api, download } from '../api';
import { Badge, EmptyRow } from '../ui';
import { Toolbar } from './table';

interface Row {
  name: string; email: string; status: string; group: 'ativo' | 'inativo' | 'outros';
  represents: { unit: string; selection: string; status: string; designatedHere: { name: string; area: string; workType: string; since: string | null }[] }[];
  designated: { unit: string; area: string; workType: string; since: string | null }[];
}
const dmy = (ymd: string) => ymd.split('-').reverse().join('/');

function Section({ title, hint, tone, rows }: { title: string; hint: string; tone: 'ok' | 'neutral' | 'warn'; rows: Row[] }) {
  return (
    <section className="card overflow-hidden" aria-label={title}>
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-line">
        <h4 className="font-semibold text-navy">{title} <span className="text-muted font-normal">({rows.length})</span></h4>
        <span className="text-xs text-muted">{hint}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th className="th">Magistrado(a)</th><th className="th">Unidade que representa</th><th className="th">Magistrado designado para a unidade</th><th className="th">Unidade em que está designado(a)</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow cols={4}>Nenhum magistrado nesta situação.</EmptyRow> : rows.map((r) => (
              <tr key={r.name}>
                <td className="td align-top"><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.email}</div>{r.group === 'outros' && <div className="mt-1"><Badge tone={tone}>{r.status}</Badge></div>}</td>
                <td className="td align-top space-y-2">{r.represents.map((u, i) => <div key={i}>{u.unit}<div className="text-[11px] text-bronze">{u.selection}{u.selection === 'Escolhida' ? ` · ${u.status}` : ''}</div></div>)}</td>
                <td className="td align-top space-y-2">{r.represents.map((u, i) => <div key={i}>{u.designatedHere.length === 0 ? <span className="text-muted">Sem magistrado designado</span> : u.designatedHere.map((d, k) => <div key={k}><span className="font-medium">{d.name}</span><div className="text-[11px] text-muted">{d.area}{d.workType ? ` · ${d.workType}` : ''}{d.since ? ` · desde ${dmy(d.since)}` : ''}</div></div>)}{r.represents.length > 1 && <div className="text-[11px] text-bronze">{u.unit}</div>}</div>)}</td>
                <td className="td align-top space-y-2">{r.designated.length === 0 ? <span className="text-muted">Aguardando vinculação (sem designação)</span> : r.designated.map((d, i) => <div key={i}>{d.unit}<div className="text-[11px] text-muted">{d.area}{d.workType ? ` · ${d.workType}` : ''}{d.since ? ` · desde ${dmy(d.since)}` : ''}</div></div>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TitularesAdmin({ scopeQuery }: { scopeQuery: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { setRows(null); api<Row[]>(`/titulares-voluntarios?${scopeQuery}`).then(setRows).catch(() => setRows([])); }, [scopeQuery]);
  const by = (g: Row['group']) => (rows ?? []).filter(r => r.group === g);
  return (
    <div className="space-y-5">
      <Toolbar title={`Magistrados - situação peculiar${rows ? ` (${rows.length})` : ''}`}>
        <button className="btn-secondary btn-sm" onClick={() => download(`/titulares-voluntarios/export.xlsx?${scopeQuery}`, 'titulares-voluntarios.xlsx').catch(() => {})}><Download className="w-4 h-4" /> Relatório XLSX</button>
        <button className="btn-secondary btn-sm" onClick={() => download(`/titulares-voluntarios/export.pdf?${scopeQuery}`, 'titulares-voluntarios.pdf').catch(() => {})}><Download className="w-4 h-4" /> Relatório PDF</button>
      </Toolbar>
      <p className="text-sm text-muted">
        Magistrados com inscrição como voluntários (rejeitadas ou excluídas não entram) que representam uma unidade <strong className="text-ink">escolhida e com magistrado vinculado atualmente</strong>,
        separados em <strong className="text-ink">ativos</strong> (inscrição atribuída) e <strong className="text-ink">inativos</strong> (desistentes).
      </p>
      {rows === null ? <div className="card p-8 text-sm text-muted">Carregando…</div> : (
        <>
          <Section title="Ativos" hint="Inscrição com situação Atribuído" tone="ok" rows={by('ativo')} />
          <Section title="Inativos" hint="Inscrição com situação Desistente" tone="neutral" rows={by('inativo')} />
          {by('outros').length > 0 && <Section title="Outras situações" hint="Aprovados ou aguardando vinculação, ainda sem designação" tone="warn" rows={by('outros')} />}
        </>
      )}
    </div>
  );
}
