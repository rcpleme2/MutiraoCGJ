// Rotas de padronização de nomes (conciliação com a lista oficial de comarcas e unidades).
import express from 'express';
import { catalogById, canonicalComarca, fullUnitName } from '../../src/catalogo-tjpr';
import { suggestCatalog } from '../../src/catalogo-match';
import { mergeCatalogDuplicates, namesToFix } from '../catalog.ts';
import { editionById } from '../editions.ts';
import { linkedCount } from '../links.ts';
import { log, S } from '../state.ts';
import { freeText, norm } from '../util.ts';

export function register(app: express.Express) {
  /** Unidades (todas as edições) e lotações de magistrados fora do catálogo, agrupadas pelo texto, com sugestões. */
  app.get('/api/standardize', (_req, res) => {
    const groupBy = <T,>(items: T[], key: (x: T) => string) => {
      const m = new Map<string, T[]>(); for (const x of items) { const k = key(x); m.set(k, [...(m.get(k) ?? []), x]); } return m;
    };
    const unitGroups = [...groupBy(S.units.filter((u) => !u.catalogId && u.unitName), (u) => `${norm(u.unitName)}|${norm(canonicalComarca(u.comarca) ?? u.comarca)}`).values()].map((list) => {
      const u = list[0];
      const label = fullUnitName(u);
      return {
        key: list.map((x) => x.id).join(','), label, comarca: canonicalComarca(u.comarca) ?? u.comarca, ids: list.map((x) => x.id),
        editions: [...new Set(list.map((x) => editionById(x.editionId)?.title ?? ''))],
        links: list.reduce((n, x) => n + linkedCount(x.id), 0),
        suggestions: suggestCatalog(label, canonicalComarca(u.comarca)),
      };
    });
    const locGroups = [...groupBy(S.magistrates.filter((m) => !m.locationCatalogId && m.currentLocation ), (m) => `${norm(m.currentLocation)}|${norm(m.locationComarca ?? '')}`).values()].map((list) => {
      const m = list[0];
      return {
        key: list.map((x) => x.id).join(','), label: m.currentLocation, comarca: m.locationComarca ?? '', ids: list.map((x) => x.id),
        names: list.map((x) => x.name), suggestions: suggestCatalog(m.currentLocation, canonicalComarca(m.locationComarca)),
      };
    });
    const byLinks = (a: { links: number; label: string }, b: { links: number; label: string }) => b.links - a.links || a.label.localeCompare(b.label, 'pt-BR');
    res.json({ units: unitGroups.sort(byLinks), locations: locGroups.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')) });
  });
  app.get('/api/standardize/names', (_req, res) => {
    const list = namesToFix();
    res.json({ count: list.length, sample: list.slice(0, 15).map(({ kind, from, to }) => ({ kind, from, to })) });
  });
  app.post('/api/standardize/names', (_req, res) => {
    const list = namesToFix();
    list.forEach((x) => x.apply());
    if (list.length) log(null, 'Administração', 'Magistrado', `Nomes de magistrados padronizados em MAIÚSCULAS: ${list.length} registro(s).`);
    res.json({ success: true, count: list.length });
  });
  app.post('/api/standardize/apply', (req, res) => {
    const items: { kind?: unknown; ids?: unknown; catalogId?: unknown; note?: unknown }[] = Array.isArray(req.body?.items) ? req.body.items : [req.body];
    if (items.length === 0 || items.length > 2000) return res.status(400).json({ error: 'Nada a aplicar.' });
    let unitsDone = 0, locsDone = 0, merged = 0;
    for (const it of items) {
      const cat = catalogById(it.catalogId);
      const ids = Array.isArray(it.ids) ? it.ids.filter((x): x is string => typeof x === 'string') : [];
      if (!cat || !ids.length || (it.kind !== 'unit' && it.kind !== 'location')) return res.status(400).json({ error: 'Escolha uma unidade da lista oficial.' });
      const note = typeof it.note === 'string' ? freeText(it.note, 300) : '';
      if (it.kind === 'location') {
        for (const m of S.magistrates.filter((x) => ids.includes(x.id))) {
          const before = m.currentLocation;
          m.locationCatalogId = cat.id; m.locationComarca = cat.comarca; m.currentLocation = cat.label; locsDone++;
          log(m.editionId, 'Administração', 'Magistrado', `Lotação de ${m.name} padronizada: "${before}" → "${cat.label}".`);
        }
        continue;
      }
      for (const u of S.units.filter((x) => ids.includes(x.id))) {
        const before = fullUnitName(u);
        u.catalogId = cat.id; u.unitName = cat.unitName; u.comarca = cat.comarca; u.separator = cat.separator; unitsDone++;
        if (note) S.matches.filter((m) => m.unitId === u.id).forEach((m) => { m.note = note; });
        log(u.editionId, 'Administração', 'Unidade', `Unidade padronizada: "${before}" → "${cat.label}"${note ? ` (observação: ${note})` : ''}.`);
      }
      // Fusão: na mesma edição fica uma unidade por item do catálogo (a mais antiga)
      const editionsTouched = new Set(S.units.filter((x) => ids.includes(x.id)).map((x) => x.editionId));
      for (const edId of editionsTouched) merged += mergeCatalogDuplicates(edId, cat.id);
    }
    res.json({ success: true, units: unitsDone, locations: locsDone, merged });
  });
}
