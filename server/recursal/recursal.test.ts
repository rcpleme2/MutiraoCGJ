import test from 'node:test';
import assert from 'node:assert/strict';
import { cnjCheckDigits, formatCnj, normalizeTurma, validateCnj } from './cnj.ts';
import { checkRows } from './rows.ts';
import { S } from '../state.ts';
import { blockReason, suggestDistribution } from './rules.ts';

// Gera um número CNJ válido para os testes
const mk = (seq: number, year = 2024, tr = '16') => {
  const n = String(seq).padStart(7, '0'); const rest = `${year}8${tr}0001`;
  const dv = cnjCheckDigits(n + '00' + rest);
  return n + dv + rest;
};

test('CNJ válido, com e sem pontuação', () => {
  const d = mk(1234);
  assert.equal(validateCnj(d).ok, true);
  assert.equal(validateCnj(formatCnj(d)).ok, true);
  assert.equal(validateCnj(formatCnj(d)).digits, d);
  assert.match(formatCnj(d), /^\d{7}-\d{2}\.\d{4}\.8\.16\.0001$/);
});
test('CNJ inválido: tamanho, letras, DV, ano', () => {
  assert.equal(validateCnj('12345').ok, false);
  assert.equal(validateCnj('abc').ok, false);
  const d = mk(55); const bad = d.slice(0, 7) + (d.slice(7, 9) === '00' ? '01' : '00') + d.slice(9);
  assert.match(validateCnj(bad).error!, /verificador/);
  assert.equal(validateCnj(mk(9, 1980)).ok, false);
  assert.equal(validateCnj('').ok, false);
});
test('Aviso (não erro) para fora da Justiça Estadual do PR', () => {
  const r = validateCnj(mk(7, 2024, '24')); assert.equal(r.ok, true); assert.ok(r.warning);
});
test('Turma: variações aceitas e inválidas', () => {
  for (const [v, n] of [['1', 1], ['1ª', 1], ['2a', 2], ['III', 3], ['4ª Turma', 4], ['Quinta Turma Recursal', 5], ['6ª Turma Recursal', 6]] as const) assert.equal(normalizeTurma(v), n, String(v));
  for (const v of ['7', '0', '', 'Turma X', '12']) assert.equal(normalizeTurma(v), null, v);
});
test('Conferência: duplicidade interna e contra a base; Turma obrigatória', () => {
  const a = mk(1), b = mk(2), c = mk(3);
  const r = checkRows([[a, '1ª'], [formatCnj(a), '2'], [b, ''], [c, '3'], ['123', '1'], [b, '9']], new Set([c]));
  assert.deepEqual(r.map((x) => x.state), ['valida', 'duplicada', 'invalida', 'duplicada', 'invalida', 'invalida']);
});
test('Regra de ouro: relator nunca na Turma do processo; distribuição automática a respeita', () => {
  S.recursalVolunteers = [
    { id: 'v1', name: 'A', email: 'a@x', turmas: [1, 2], status: 'Aprovado', createdAt: '' },
    { id: 'v2', name: 'B', email: 'b@x', turmas: [3], status: 'Aprovado', createdAt: '' },
    { id: 'v3', name: 'C', email: 'c@x', turmas: [4], status: 'Aguardando', createdAt: '' },
  ];
  S.recursalProcesses = [1, 2, 3, 4, 5, 6].flatMap((t) => [0, 1, 2].map((k) => ({ id: `p${t}${k}`, cnj: mk(t * 10 + k), turma: t, batchId: 'b', submitterName: '', submitterEmail: '', createdAt: '', status: 'Pendente' as const })));
  assert.ok(blockReason({ turma: 2 }, S.recursalVolunteers[0]));
  assert.ok(blockReason({ turma: 1 }, S.recursalVolunteers[0]));
  assert.equal(blockReason({ turma: 3 }, S.recursalVolunteers[0]), null);
  assert.ok(blockReason({ turma: 4 }, S.recursalVolunteers[2])); // não aprovado
  const r = suggestDistribution();
  for (const x of r.pairs) {
    const p = S.recursalProcesses.find((q) => q.id === x.processId)!; const v = S.recursalVolunteers.find((q) => q.id === x.volunteerId)!;
    assert.ok(!v.turmas.includes(p.turma), `${p.id} → ${v.name}`);
  }
  assert.equal(r.pairs.length + r.unassignable.length, 18);
});

test('API: regra de ouro rejeitada no servidor (422), designação válida e exportação', async () => {
  const express = (await import('express')).default;
  const { register } = await import('../routes/recursal.ts');
  const app = express(); app.use(express.json()); register(app);
  const server = app.listen(0); const port = (server.address() as any).port; const url = `http://localhost:${port}/api/recursal`;
  try {
    S.recursalVolunteers = [{ id: 'v1', name: 'Ana', email: 'a@x', turmas: [3], status: 'Aprovado', createdAt: '' }];
    S.recursalProcesses = [3, 1].map((t) => ({ id: `p${t}`, cnj: mk(t), turma: t, batchId: 'b', submitterName: '', submitterEmail: '', createdAt: '', status: 'Pendente' as const }));
    const post = (p: string, body: object) => fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('/assign', { volunteerId: 'v1', processIds: ['p3'] })).status, 422);
    assert.equal(S.recursalProcesses[0].status, 'Pendente');
    assert.equal((await post('/assign', { volunteerId: 'v1', processIds: ['p3', 'p1'] })).status, 422); // um impedido barra o lote
    assert.equal((await post('/assign', { volunteerId: 'v1', processIds: ['p1'] })).status, 200);
    const patch = await fetch(url + '/volunteers/v1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turmas: [1] }) });
    assert.equal(patch.status, 422); // passaria a atuar na Turma de um processo já designado
    const csv = await (await fetch(url + '/export.csv')).text();
    assert.match(csv, /Número do processo;Turma em que tramita;Relator designado/);
    assert.match(csv, /1ª Turma Recursal";"Ana"/);
  } finally { server.close(); }
});

test('API: prévia traz carga aproximada por relator e consulta de status traz só totais', async () => {
  const express = (await import('express')).default;
  const { register } = await import('../routes/recursal.ts');
  const { register: registerMag } = await import('../routes/magistrates.ts');
  const app = express(); app.use(express.json()); register(app); registerMag(app);
  const server = app.listen(0); const port = (server.address() as any).port; const base = `http://localhost:${port}/api`;
  try {
    S.recursalVolunteers = [
      { id: 'v1', name: 'Ana', email: 'ana@tjpr.jus.br', turmas: [1], capacity: 3, status: 'Aprovado', createdAt: '' },
      { id: 'v2', name: 'Beto', email: 'beto@tjpr.jus.br', turmas: [2], status: 'Aprovado', createdAt: '' },
    ];
    S.recursalBatches = [{ id: 'b1', source: 'csv', fileName: 'x.csv', submitterName: 'Ana', submitterEmail: 'ana@tjpr.jus.br', total: 5, accepted: 4, rejected: 1, duplicates: 0, createdAt: '2026-01-01T00:00:00Z' }];
    S.recursalProcesses = [1, 2, 1, 2].map((t, i) => ({ id: `p${i}`, cnj: mk(100 + i), turma: t, batchId: 'b1', submitterName: '', submitterEmail: '', createdAt: '', status: 'Pendente' as const }));
    const prev = await (await fetch(base + '/recursal/auto-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    assert.equal(prev.loads.length, 2);
    assert.equal(prev.loads.reduce((a: number, l: any) => a + l.total, 0), 4);
    for (const l of prev.loads) assert.equal(l.total, l.current + l.add);
    const st = await fetch(base + '/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ANA@tjpr.jus.br' }) });
    assert.equal(st.status, 200);
    const j = await st.json();
    assert.equal(j.recursal.volunteer.status, 'Aprovado');
    assert.equal(j.recursal.batches[0].accepted, 4);
    assert.ok(!JSON.stringify(j.recursal).includes('cnj') && !JSON.stringify(j.recursal).includes('Beto'));
    const none = await fetch(base + '/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'zz@tjpr.jus.br' }) });
    assert.equal(none.status, 404);
  } finally { server.close(); }
});

test('Distribuição automática equilibra a carga (sem capacidade, ninguém concentra tudo)', () => {
  S.recursalVolunteers = [
    { id: 'a', name: 'A', email: 'a@x', turmas: [1], status: 'Aprovado', createdAt: '' },
    { id: 'b', name: 'B', email: 'b@x', turmas: [2], capacity: 10, status: 'Aprovado', createdAt: '' },
    { id: 'c', name: 'C', email: 'c@x', turmas: [3], status: 'Aprovado', createdAt: '' },
  ];
  S.recursalProcesses = Array.from({ length: 30 }, (_, i) => ({ id: `q${i}`, cnj: mk(500 + i), turma: 4 + (i % 3), batchId: 'b', submitterName: '', submitterEmail: '', createdAt: '', status: 'Pendente' as const }));
  const r = suggestDistribution();
  assert.equal(r.pairs.length, 30);
  for (const v of ['a', 'b', 'c']) assert.equal(r.loads[v], 10);
});
