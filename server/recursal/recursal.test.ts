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

test('Prazo de inscrição: fechado sem prazo, abre e encerra por data; voluntário sem declaração nem máximo', async () => {
  const express = (await import('express')).default;
  const { register } = await import('../routes/recursal.ts');
  const app = express(); app.use(express.json()); register(app);
  const server = app.listen(0); const port = (server.address() as any).port; const url = `http://localhost:${port}/api/recursal`;
  const send = (m: string, p: string, body: object) => fetch(url + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const vol = { name: 'Ana', email: 'ana2@tjpr.jus.br', turmas: [1, 2] };
  const fmt = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 16); // horário de Brasília
  try {
    S.recursalWindow = null; S.recursalVolunteers = [];
    assert.equal((await (await fetch(url + '/window')).json()).state, 'not_set');
    assert.equal((await send('POST', '/volunteers', vol)).status, 403);
    const day = 86400_000;
    assert.equal((await send('PUT', '/window', { openingDate: fmt(new Date(Date.now() + day)), closingDate: fmt(new Date(Date.now() + 2 * day)) })).status, 200);
    assert.equal((await (await fetch(url + '/window')).json()).state, 'not_yet');
    assert.equal((await send('POST', '/volunteers', vol)).status, 403);
    assert.equal((await send('PUT', '/window', { openingDate: fmt(new Date(Date.now() + 2 * day)), closingDate: fmt(new Date(Date.now() + day)) })).status, 400);
    await send('PUT', '/window', { openingDate: fmt(new Date(Date.now() - day)), closingDate: fmt(new Date(Date.now() + day)) });
    assert.equal((await (await fetch(url + '/window')).json()).state, 'open');
    assert.equal((await send('POST', '/volunteers', vol)).status, 201); // sem declaração e sem máximo de processos
    assert.equal(S.recursalVolunteers[0].capacity, undefined);
    await send('PUT', '/window', { openingDate: fmt(new Date(Date.now() - 2 * day)), closingDate: fmt(new Date(Date.now() - day)) });
    assert.equal((await (await fetch(url + '/window')).json()).state, 'ended');
    assert.equal((await send('POST', '/processes', { submitterName: 'X', submitterEmail: 'x@tjpr.jus.br', rows: [['1', '1']] })).status, 403);
  } finally { S.recursalWindow = null; server.close(); }
});

test('Migração para a Turma Recursal e cruzamento de titulares voluntários', async () => {
  const express = (await import('express')).default;
  const { register } = await import('../routes/recursal.ts');
  const { register: registerTit } = await import('../routes/titulares.ts');
  const { panelRows, actingPeriods } = await import('../links.ts');
  const app = express(); app.use(express.json()); register(app); registerTit(app);
  const server = app.listen(0); const port = (server.address() as any).port; const base = `http://localhost:${port}/api`;
  const post = (p: string, body: object) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    S.editions = [{ id: 'e1', title: 'Janela 1', description: '', openingDate: '2026-01-01T00:00', closingDate: '2026-12-31T00:00', isRegistrationOpen: true, status: 'Em andamento', createdAt: '', startDate: '2026-02-01' } as any];
    S.activeEditionId = 'e1';
    S.units = [{ id: 'u1', editionId: 'e1', unitName: '1ª Vara Cível', judgeName: 'Dra. Ana Lima', email: 'vara@x', comarca: 'Curitiba', separator: 'de', areas: [], supportNeeded: '', createdAt: '', status: 'Atendida', selection: 'Escolhida', slots: 1 } as any,
      { id: 'u2', editionId: 'e1', unitName: '2ª Vara Cível', judgeName: 'Dr. Outro Nome', email: 'v2@x', comarca: 'Curitiba', separator: 'de', areas: [], supportNeeded: '', createdAt: '', status: 'Pendente', selection: 'Em análise', slots: 1 } as any];
    S.magistrates = [{ id: 'm1', editionId: 'e1', name: 'ANA LIMA', email: 'ana@tjpr.jus.br', status: 'Atribuído', createdAt: '' } as any];
    S.magistrates.push({ id: 'm0', editionId: 'e1', name: 'FULANO TAL', email: 'f@tjpr.jus.br', status: 'Atribuído', createdAt: '' } as any);
    S.matches = [{ id: 'mt1', editionId: 'e1', magistrateId: 'm1', unitId: 'u2', assignedArea: 'Cível e Fazenda Pública', workType: 'Sentenças', status: 'Vinculado', createdAt: '' } as any];
    S.withdrawals = []; S.recursalVolunteers = [];
    // u1 (escolhida) ainda sem magistrado vinculado: não entra
    assert.equal((await (await fetch(base + '/titulares-voluntarios?edition=all')).json()).length, 0);
    S.matches.push({ id: 'mt0', editionId: 'e1', magistrateId: 'm0', unitId: 'u1', assignedArea: 'Cível e Fazenda Pública', workType: 'Sentenças', status: 'Vinculado', createdAt: '' } as any);
    // inscrição rejeitada não entra no batimento
    S.magistrates[0].status = 'Rejeitado';
    assert.equal((await (await fetch(base + '/titulares-voluntarios?edition=all')).json()).length, 0);
    S.magistrates[0].status = 'Atribuído';
    const tit = await (await fetch(base + '/titulares-voluntarios?edition=all')).json();
    assert.equal(tit.length, 1);
    assert.match(tit[0].represents[0].unit, /1ª Vara Cível/); assert.equal(tit[0].represents[0].by, 'responsável'); // lotação em branco: usa o responsável
    assert.equal(tit[0].represents[0].designatedHere[0].name, 'FULANO TAL'); // magistrado designado para a unidade do titular
    const xl = await fetch(base + '/titulares-voluntarios/export.xlsx?edition=all'); assert.equal(xl.status, 200);
    assert.match(xl.headers.get('content-type') ?? '', /spreadsheetml/); assert.ok((await xl.arrayBuffer()).byteLength > 1000);
    const pdf = await fetch(base + '/titulares-voluntarios/export.pdf?edition=all'); assert.equal(pdf.status, 200);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    // lotação preenchida tem prioridade: aponta a 1ª Vara Cível de Curitiba, ainda que o responsável cadastrado seja outro
    S.units[0].judgeName = 'Outra Pessoa';
    assert.equal((await (await fetch(base + '/titulares-voluntarios?edition=all')).json()).length, 0); // sem lotação e sem responsável igual
    S.magistrates[0].currentLocation = '1ª Vara Cível de Curitiba';
    const byLot = await (await fetch(base + '/titulares-voluntarios?edition=all')).json();
    assert.equal(byLot.length, 1); assert.equal(byLot[0].represents[0].by, 'lotação');
    // lotação preenchida que não bate com nenhuma unidade: não cai no responsável
    S.units[0].judgeName = 'Dra. Ana Lima'; S.magistrates[0].currentLocation = 'Vara de Outro Lugar de Londrina';
    assert.equal((await (await fetch(base + '/titulares-voluntarios?edition=all')).json()).length, 0);
    S.magistrates[0].currentLocation = ''; 
    assert.match(tit[0].designated[0].unit, /2ª Vara Cível/);
    assert.equal((await post('/recursal/migrate', { name: 'ANA LIMA', endDate: '2026-12-31', startDate: '2026-12-31', turmas: [1] })).status, 400); // início deve ser posterior
    assert.equal((await post('/recursal/migrate', { name: 'ANA LIMA', endDate: '2026-12-31', startDate: '2027-01-15', turmas: [] })).status, 400);
    assert.equal((await post('/recursal/migrate', { name: 'ANA LIMA', endDate: '2026-12-31', startDate: '2027-01-15', turmas: [1] })).status, 201);
    assert.equal(panelRows().filter((r) => r.name === 'ANA LIMA').length, 0); // vínculo normal encerrado
    const per = actingPeriods().find((p) => p.name === 'ANA LIMA');
    assert.equal(per?.end, '2026-12-31'); assert.equal(per?.endReason, 'Migração para a Turma Recursal');
    const v = S.recursalVolunteers[0];
    assert.equal(v.status, 'Aprovado'); assert.equal(v.startDate, '2027-01-15'); assert.deepEqual(v.turmas, [1]);
    // antes do início, a regra bloqueia designação
    assert.match(blockReason({ turma: 3 }, v)!, /começa em 15\/01\/2027/);
    assert.equal((await post('/recursal/migrate', { name: 'ANA LIMA', endDate: '2026-12-31', startDate: '2027-01-15', turmas: [1] })).status, 404); // já não tem vínculo vigente
  } finally { server.close(); }
});

test('Desistência: última data de atuação editável; segue vinculado até a data e depois é encerrado', async () => {
  const express = (await import('express')).default;
  const { register: regPanel } = await import('../routes/panel.ts');
  const { panelRows, actingPeriods, finalizeDueWithdrawals } = await import('../links.ts');
  const app = express(); app.use(express.json()); regPanel(app);
  const server = app.listen(0); const base = `http://localhost:${(server.address() as any).port}/api`;
  const send = (m: string, p: string, b?: object) => fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const ymd = (d: number) => new Date(Date.now() + d * 86400_000 - 3 * 3600_000).toISOString().slice(0, 10);
  const reset = () => {
    S.editions = [{ id: 'e1', title: 'J1', openingDate: '', closingDate: '', isRegistrationOpen: true, status: 'Em andamento', createdAt: '', startDate: '2026-02-01' } as any];
    S.units = [{ id: 'u1', editionId: 'e1', unitName: 'Vara 1', judgeName: 'X', email: 'a', comarca: 'C', separator: 'de', areas: [], supportNeeded: '', createdAt: '', status: 'Atendida', selection: 'Escolhida', slots: 1 } as any];
    S.magistrates = [{ id: 'm1', editionId: 'e1', name: 'ANA LIMA', email: 'a@x', status: 'Atribuído', createdAt: '2026-01-01T00:00:00Z' } as any];
    S.matches = [{ id: 'mt1', editionId: 'e1', magistrateId: 'm1', unitId: 'u1', assignedArea: 'Cível', workType: 'Sentença', status: 'Vinculado', createdAt: '' } as any];
    S.withdrawals = []; S.transfers = [];
  };
  try {
    reset();
    const end = ymd(10);
    assert.equal((await send('POST', '/panel/withdrawals', { name: 'ANA LIMA', sei: '00.123/2026', requestDate: ymd(0), endDate: end })).status, 201);
    assert.equal(panelRows().length, 1); assert.equal(panelRows()[0].leavingUntil, end); // segue vinculada
    assert.equal(S.magistrates[0].status, 'Atribuído');
    const per = actingPeriods(); assert.equal(per.length, 1); assert.equal(per[0].end, end); assert.equal(per[0].endReason, 'Desistência');
    assert.equal((await send('POST', '/panel/withdrawals', { name: 'ANA LIMA', sei: '00.123/2026', requestDate: ymd(0) })).status, 409);
    finalizeDueWithdrawals(); assert.equal(panelRows().length, 1); // ainda não venceu
    const wd = S.withdrawals[0];
    assert.equal((await send('PUT', `/panel/withdrawals/${wd.id}`, { sei: wd.sei, requestDate: wd.requestDate, endDate: ymd(-1) })).status, 200); // data passada: encerra já
    assert.equal(panelRows().length, 0); assert.equal(S.magistrates[0].status, 'Desistente'); assert.equal(S.withdrawals[0].scheduled, false);
    // data passada no registro: sai na hora (comportamento anterior)
    reset();
    assert.equal((await send('POST', '/panel/withdrawals', { name: 'ANA LIMA', sei: '00.123/2026', requestDate: ymd(-40), endDate: ymd(-20) })).status, 201);
    assert.equal(panelRows().length, 0);
    // sem data de última atuação: padrão = fim do mês do pedido
    reset();
    assert.equal((await send('POST', '/panel/withdrawals', { name: 'ANA LIMA', sei: '00.123/2026', requestDate: ymd(0) })).status, 201);
    assert.ok(S.withdrawals[0].endDate && S.withdrawals[0].endDate >= ymd(0)); assert.equal(panelRows().length, 1);
  } finally { server.close(); }
});

test('Importação de lotações: conferência antes, só vazias ou também preenchidas', async () => {
  const express = (await import('express')).default;
  const XLSX = (await import('xlsx')).default;
  const { register } = await import('../routes/lotacao.ts');
  const app = express(); app.use(express.json({ limit: '8mb' })); register(app);
  const server = app.listen(0); const base = `http://localhost:${(server.address() as any).port}/api`;
  const sheet = XLSX.utils.aoa_to_sheet([['Nome Pessoa', 'Comarca', 'Unidade'],
    ['Abelar Baptista Pereira Filho', 'LONDRINA', '6ª VARA CÍVEL DE LONDRINA'],
    ['Adriana Benini', 'CURITIBA', '25ª VARA CÍVEL E EMPRESARIAL REGIONAL DE CURITIBA'],
    ['Pessoa Sem Inscricao', 'MARINGÁ', '4º JUIZADO ESPECIAL CÍVEL E CRIMINAL DE MARINGÁ'],
    ['Adriana Benini', 'CURITIBA', '1ª VARA CÍVEL DE CURITIBA']]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, sheet, 'p');
  const file = { name: 'lotacoes.xlsx', base64: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }).toString('base64') };
  const call = async (mode: string, apply: boolean) => (await fetch(base + '/magistrates/import-lotacao?edition=all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file, mode, apply }) })).json();
  try {
    S.editions = [{ id: 'e1', title: 'J1', openingDate: '', closingDate: '', isRegistrationOpen: true, status: 'Em andamento', createdAt: '' } as any];
    S.activeEditionId = 'e1';
    S.magistrates = [
      { id: 'a', editionId: 'e1', name: 'ABELAR BAPTISTA PEREIRA FILHO', email: 'a@x', currentLocation: '', status: 'Aprovado', createdAt: '' } as any,
      { id: 'b', editionId: 'e1', name: 'ADRIANA BENINI', email: 'b@x', currentLocation: 'Vara qualquer de Curitiba', status: 'Aprovado', createdAt: '' } as any,
    ];
    S.activityLog = [];
    let r = await call('empty', false);
    assert.equal(r.applied, false); assert.equal(r.summary.preencher, 1); assert.equal(r.summary.ignorada, 1); assert.equal(r.summary.nao_encontrado, 1); assert.equal(r.summary.duplicada, 1);
    assert.equal(S.magistrates[0].currentLocation, ''); // conferência não grava
    r = await call('empty', true);
    assert.equal(r.changed, 1); assert.match(S.magistrates[0].currentLocation, /6ª VARA CÍVEL DE LONDRINA/i); assert.ok(S.magistrates[0].locationCatalogId);
    assert.equal(S.magistrates[1].currentLocation, 'Vara qualquer de Curitiba'); // preenchida: mantida
    r = await call('all', false); assert.equal(r.summary.atualizar, 1);
    r = await call('all', true);
    assert.equal(r.changed, 1); assert.match(S.magistrates[1].currentLocation, /25ª VARA CÍVEL E EMPRESARIAL REGIONAL DE CURITIBA/i);
    assert.ok(S.activityLog.some((l) => /Lotação de ADRIANA BENINI alterada/.test(l.description)));
  } finally { server.close(); }
});

test('Alteração agendada: a unidade anterior continua vigente no painel, ao lado da nova', async () => {
  const express = (await import('express')).default;
  const { register } = await import('../routes/matches.ts');
  const { register: regPanel } = await import('../routes/panel.ts');
  const { panelRows, panelRowsAll, actingPeriods } = await import('../links.ts');
  const app = express(); app.use(express.json()); register(app); regPanel(app);
  const server = app.listen(0); const base = `http://localhost:${(server.address() as any).port}/api`;
  const send = (m: string, p: string, b?: object) => fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const ymd = (d: number) => new Date(Date.now() + d * 86400_000 - 3 * 3600_000).toISOString().slice(0, 10);
  const unit = (id: string, name: string) => ({ id, editionId: 'e1', unitName: name, judgeName: 'X', email: 'a', comarca: 'C', separator: 'de', areas: ['Cível'], supportNeeded: '', createdAt: '', status: 'Pendente', selection: 'Escolhida', slots: 1 } as any);
  try {
    S.editions = [{ id: 'e1', title: 'J1', openingDate: '', closingDate: '', isRegistrationOpen: true, status: 'Em andamento', createdAt: '', startDate: '2026-02-01' } as any];
    S.units = [unit('u1', 'Vara 1'), unit('u2', 'Vara 2')];
    S.magistrates = [{ id: 'm1', editionId: 'e1', name: 'ANA LIMA', email: 'a@x', status: 'Atribuído', createdAt: '' } as any];
    S.matches = [{ id: 'mt1', editionId: 'e1', magistrateId: 'm1', unitId: 'u1', assignedArea: 'Cível', workType: 'Sentença', status: 'Vinculado', createdAt: '' } as any];
    S.withdrawals = []; S.transfers = [];
    const when = ymd(20);
    assert.equal((await send('PUT', '/matches/mt1', { unitId: 'u2', effectiveDate: when })).status, 200);
    assert.equal(panelRows().length, 1); // uma vinculação, já na nova unidade
    const all = panelRowsAll();
    assert.equal(all.length, 2); // a anterior segue vigente até a véspera
    const old = all.find((r) => r.readOnly)!;
    assert.match(old.unit, /Vara 1/); assert.equal(old.leavingUntil, ymd(19)); assert.match(old.changeTo!.unit, /Vara 2/);
    const admin = await (await send('GET', '/panel/admin')).json();
    assert.equal(admin.rows.length, 2); assert.ok(admin.rows.some((r: any) => r.readOnly && /Vara 1/.test(r.unit)));
    assert.equal(actingPeriods().filter((p) => p.name === 'ANA LIMA').length, 2);
  } finally { server.close(); }
});

test('Excluir a unidade de destino de uma alteração agendada não deixa o magistrado sem vinculação', async () => {
  const express = (await import('express')).default;
  const { register: regMatches } = await import('../routes/matches.ts');
  const { register: regUnits } = await import('../routes/units.ts');
  const { register: regPanel } = await import('../routes/panel.ts');
  const { panelRows, orphanTransfers } = await import('../links.ts');
  const app = express(); app.use(express.json()); regMatches(app); regUnits(app); regPanel(app);
  const server = app.listen(0); const base = `http://localhost:${(server.address() as any).port}/api`;
  const send = (m: string, p: string, b?: object) => fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const ymd = (d: number) => new Date(Date.now() + d * 86400_000 - 3 * 3600_000).toISOString().slice(0, 10);
  const unit = (id: string, name: string) => ({ id, editionId: 'e1', unitName: name, judgeName: 'X', email: 'a', comarca: 'C', separator: 'de', areas: ['Cível'], supportNeeded: '', createdAt: '', status: 'Pendente', selection: 'Escolhida', slots: 1 } as any);
  const reset = () => {
    S.editions = [{ id: 'e1', title: 'J1', openingDate: '', closingDate: '', isRegistrationOpen: true, status: 'Em andamento', createdAt: '', startDate: '2026-02-01' } as any];
    S.units = [unit('u1', 'Vara 1'), unit('u2', 'Vara 2')];
    S.magistrates = [{ id: 'm1', editionId: 'e1', name: 'ANA LIMA', email: 'a@x', status: 'Atribuído', createdAt: '' } as any];
    S.matches = [{ id: 'mt1', editionId: 'e1', magistrateId: 'm1', unitId: 'u1', assignedArea: 'Cível', workType: 'Sentença', status: 'Vinculado', startDate: '2026-06-15', createdAt: '' } as any];
    S.withdrawals = []; S.transfers = [];
  };
  try {
    reset();
    assert.equal((await send('PUT', '/matches/mt1', { unitId: 'u2', effectiveDate: ymd(30) })).status, 200);
    assert.equal(S.matches[0].unitId, 'u2');
    assert.equal((await send('DELETE', '/units/u2')).status, 200); // exclui o destino
    const rows = panelRows(); assert.equal(rows.length, 1); assert.match(rows[0].unit, /Vara 1/); assert.equal(rows[0].startDate, '2026-06-15'); // voltou à anterior
    assert.equal(S.transfers.length, 0); assert.equal(S.magistrates[0].status, 'Atribuído');
    // situação já existente nos dados (destino excluído antes da correção): alteração órfã pode ser restaurada
    reset();
    await send('PUT', '/matches/mt1', { unitId: 'u2', effectiveDate: ymd(30) });
    S.matches = []; S.units = S.units.filter((u) => u.id !== 'u2'); S.magistrates[0].status = 'Lista de Espera';
    assert.equal(orphanTransfers().length, 1);
    const adm = await (await send('GET', '/panel/admin')).json(); assert.equal(adm.orphans.length, 1); assert.equal(adm.orphans[0].canRestore, true);
    assert.equal((await send('POST', `/panel/transfers/${S.transfers[0].id}/restore`)).status, 200);
    assert.equal(panelRows().length, 1); assert.equal(orphanTransfers().length, 0);
  } finally { server.close(); }
});
