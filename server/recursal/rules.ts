// Regra de ouro e sugestão de distribuição: o relator NUNCA pode integrar a Turma de origem do processo.
import { todayYmd } from '../links.ts';
import { S } from '../state.ts';
import { type RecursalProcess, type RecursalVolunteer } from '../types.ts';
import { turmaLabel } from './cnj.ts';

export const loadOf = (volId: string) => S.recursalProcesses.filter((p) => p.assignedVolunteerId === volId).length;
export const hasRoom = (v: RecursalVolunteer, extra = 0) => v.capacity == null || loadOf(v.id) + extra < v.capacity;

/** Motivo de impedimento (null = pode). Não considera capacidade. */
export function blockReason(p: Pick<RecursalProcess, 'turma'>, v: RecursalVolunteer): string | null {
  if (v.status !== 'Aprovado') return 'Voluntário ainda não aprovado.';
  if (v.startDate && todayYmd() < v.startDate) return `A atuação na Turma Recursal começa em ${v.startDate.split('-').reverse().join('/')}.`;
  if (v.turmas.includes(p.turma)) return `Atua na ${turmaLabel(p.turma)}, a mesma do processo: designação vedada.`;
  return null;
}
export const canAssign = (p: Pick<RecursalProcess, 'turma'>, v: RecursalVolunteer) => blockReason(p, v) === null;

/** Distribui pendentes: cada processo vai ao apto com menor carga proporcional (determinístico). */
export function suggestDistribution(): { pairs: { processId: string; volunteerId: string }[]; unassignable: { processId: string; reason: string }[]; loads: Record<string, number> } {
  const vols = S.recursalVolunteers.filter((v) => v.status === 'Aprovado');
  const extra: Record<string, number> = {};
  const pairs: { processId: string; volunteerId: string }[] = [];
  const unassignable: { processId: string; reason: string }[] = [];
  const pending = S.recursalProcesses.filter((p) => p.status === 'Pendente')
    // os mais restritos primeiro: processos de Turmas com menos relatores aptos
    .map((p) => ({ p, n: vols.filter((v) => canAssign(p, v)).length }))
    .sort((a, b) => a.n - b.n || a.p.cnj.localeCompare(b.p.cnj)).map((x) => x.p);
  for (const p of pending) {
    const apt = vols.filter((v) => canAssign(p, v));
    if (apt.length === 0) { unassignable.push({ processId: p.id, reason: vols.length ? `Nenhum voluntário aprovado fora da ${turmaLabel(p.turma)}.` : 'Não há voluntários aprovados.' }); continue; }
    const open = apt.filter((v) => hasRoom(v, extra[v.id] ?? 0));
    if (open.length === 0) { unassignable.push({ processId: p.id, reason: 'Todos os relatores aptos atingiram a capacidade informada.' }); continue; }
    // iguala a carga em nº de processos; a capacidade informada funciona apenas como limite (hasRoom)
    const score = (v: RecursalVolunteer) => loadOf(v.id) + (extra[v.id] ?? 0);
    open.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, 'pt-BR'));
    pairs.push({ processId: p.id, volunteerId: open[0].id });
    extra[open[0].id] = (extra[open[0].id] ?? 0) + 1;
  }
  return { pairs, unassignable, loads: extra };
}
