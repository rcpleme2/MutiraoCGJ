// Rotas da lista oficial de comarcas e unidades (editável).
import express from 'express';
import { catalogById, CATALOG, COMARCAS, slug } from '../../src/catalogo-tjpr';
import { applyCatalog, cascadeUnit, detachUnit, findComarca, linkedTo, materializeCatalog, readUnit, uniqueId, usageOf } from '../catalog.ts';
import { log, S } from '../state.ts';
import { fold, upper } from '../util.ts';

export function register(app: express.Express) {
  // Lista vigente: pública, usada nos formulários de inscrição
  app.get('/api/catalog', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ comarcas: COMARCAS, units: CATALOG.map(({ id, comarca, unitName, separator }) => ({ id, comarca, unitName, separator })) });
  });
  app.get('/api/catalog/usage', (_req, res) => {
    const out: Record<string, ReturnType<typeof usageOf>> = {};
    for (const c of CATALOG) { const u = usageOf(c); if (u.linked.length || u.registrations || u.lotacao) out[c.id] = u; }
    res.json(out);
  });
  app.post('/api/catalog/comarcas', (req, res) => {
    const name = upper(String(req.body?.name ?? '')).slice(0, 120);
    if (name.length < 2) return res.status(400).json({ error: 'Informe o nome da comarca.' });
    materializeCatalog();
    if (findComarca(name)) return res.status(409).json({ error: 'Esta comarca já existe.' });
    S.catalogComarcas.push({ id: uniqueId(slug(name), new Set(S.catalogComarcas.map((c) => c.id))), name });
    applyCatalog();
    log(null, 'Administração', 'Conteúdo', `Comarca incluída na lista oficial: ${name}.`);
    res.status(201).json({ success: true });
  });
  app.put('/api/catalog/comarcas/:name', (req, res) => {
    materializeCatalog();
    const c = findComarca(req.params.name);
    if (!c) return res.status(404).json({ error: 'Comarca não encontrada.' });
    const name = upper(String(req.body?.name ?? '')).slice(0, 120);
    if (name.length < 2) return res.status(400).json({ error: 'Informe o novo nome da comarca.' });
    const other = findComarca(name);
    if (other && other !== c) return res.status(409).json({ error: 'Já existe uma comarca com este nome.' });
    const oldName = c.name;
    const olds = S.catalogUnits.filter((u) => u.comarca === oldName).map((u) => ({ ...catalogById(u.id)! }));
    c.name = name;
    S.catalogUnits.forEach((u) => { if (u.comarca === oldName) u.comarca = name; });
    applyCatalog();
    let changed = 0;
    for (const o of olds) changed += cascadeUnit(o, S.catalogUnits.find((u) => u.id === o.id)!);
    // Inscrições digitadas ("Outra") que citam a comarca antiga
    for (const u of S.units) if (!u.catalogId && fold(u.comarca ?? '') === fold(oldName)) { u.comarca = name; changed++; }
    for (const m of S.magistrates) if (m.locationComarca && fold(m.locationComarca) === fold(oldName)) { m.locationComarca = name; }
    log(null, 'Administração', 'Conteúdo', `Comarca renomeada na lista oficial: ${oldName} → ${name} (${olds.length} unidade(s); ${changed} registro(s) atualizados).`);
    res.json({ success: true, changed });
  });
  app.delete('/api/catalog/comarcas/:name', (req, res) => {
    materializeCatalog();
    const c = findComarca(req.params.name);
    if (!c) return res.status(404).json({ error: 'Comarca não encontrada.' });
    const list = CATALOG.filter((u) => u.comarca === c.name);
    const blocked = list.map((u) => ({ u, names: linkedTo(u) })).filter((x) => x.names.length);
    if (blocked.length) {
      return res.status(409).json({ error: `Não é possível apagar: há magistrado(s) vinculado(s) em ${blocked.length} unidade(s) desta comarca (${blocked.slice(0, 3).map((x) => `${x.u.unitName}: ${x.names.join(', ')}`).join('; ')}${blocked.length > 3 ? '…' : ''}).` });
    }
    list.forEach(detachUnit);
    S.catalogUnits = S.catalogUnits.filter((u) => u.comarca !== c.name);
    S.catalogComarcas = S.catalogComarcas.filter((x) => x !== c);
    applyCatalog();
    log(null, 'Administração', 'Conteúdo', `Comarca apagada da lista oficial: ${c.name} (com ${list.length} unidade(s)).`);
    res.json({ success: true });
  });
  app.post('/api/catalog/units', (req, res) => {
    materializeCatalog();
    const r = readUnit(req.body);
    if ('error' in r) return res.status(400).json(r);
    const id = uniqueId(`${slug(r.value.comarca)}--${slug(r.value.unitName)}`, new Set(S.catalogUnits.map((u) => u.id)));
    S.catalogUnits.push({ id, ...r.value });
    applyCatalog();
    log(null, 'Administração', 'Conteúdo', `Unidade incluída na lista oficial: ${catalogById(id)?.label}.`);
    res.status(201).json({ success: true, id });
  });
  app.put('/api/catalog/units/:id', (req, res) => {
    materializeCatalog();
    const rec = S.catalogUnits.find((u) => u.id === req.params.id);
    const old = catalogById(req.params.id);
    if (!rec || !old) return res.status(404).json({ error: 'Unidade não encontrada.' });
    const r = readUnit({ comarca: req.body?.comarca ?? rec.comarca, unitName: req.body?.unitName ?? rec.unitName, separator: req.body?.separator ?? rec.separator }, rec.id);
    if ('error' in r) return res.status(400).json(r);
    const before = { ...old };
    Object.assign(rec, r.value);
    applyCatalog();
    const changed = cascadeUnit(before, rec);
    log(null, 'Administração', 'Conteúdo', `Unidade alterada na lista oficial: ${before.label} → ${catalogById(rec.id)?.label} (${changed} registro(s) atualizados).`);
    res.json({ success: true, changed });
  });
  app.delete('/api/catalog/units/:id', (req, res) => {
    materializeCatalog();
    const c = catalogById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Unidade não encontrada.' });
    const names = linkedTo(c);
    if (names.length) return res.status(409).json({ error: `Não é possível apagar: ${names.length === 1 ? 'há magistrado vinculado' : `há ${names.length} magistrados vinculados`} a esta unidade (${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}). Altere ou desfaça a vinculação antes.` });
    detachUnit(c);
    S.catalogUnits = S.catalogUnits.filter((u) => u.id !== c.id);
    applyCatalog();
    log(null, 'Administração', 'Conteúdo', `Unidade apagada da lista oficial: ${c.label}.`);
    res.json({ success: true });
  });
}
