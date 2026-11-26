// Cruzamento (mutirão normal): magistrados voluntários que representam uma unidade inscrita.
// A unidade que o magistrado representa é identificada primeiro pelo campo Lotação da inscrição (aba Magistrados);
// se a lotação estiver em branco, pelo campo Responsável pela unidade no cadastro das unidades.
// Só entram unidades com pedido escolhido e com magistrado vinculado atualmente; inscrições rejeitadas ou excluídas ficam de fora.
import express from 'express';
import { canonicalComarca } from '../../src/catalogo-tjpr';
import { resolveCatalog } from '../../src/catalogo-match';
import { unitResolver, sameUnit } from '../catalog.ts';
import { scopeOf } from '../editions.ts';
import { panelRows, unitLabel } from '../links.ts';
import { S } from '../state.ts';
import { magistrateStatusLabel, norm, personKey } from '../util.ts';

export function register(app: express.Express) {
  app.get('/api/titulares-voluntarios', (req, res) => {
    const scope = scopeOf(req);
    if (!scope) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    const linkedUnits = new Set(S.matches.map((m) => m.unitId));
    const units = S.units.filter((u) => scope.has(u) && u.selection === 'Escolhida' && linkedUnits.has(u.id));
    const resolve = unitResolver();
    const rows = panelRows();
    const out = new Map<string, any>();
    for (const m of S.magistrates) {
      if (!scope.has(m) || m.status === 'Excluído' || m.status === 'Rejeitado') continue;
      const key = personKey(m.name);
      if (!key) continue;
      const lotacao = m.currentLocation?.trim() ?? '';
      let found: { unit: typeof units[number]; by: 'lotação' | 'responsável' }[] = [];
      if (lotacao) {
        // Lotação preenchida: compara com a unidade (pelo catálogo oficial; sem ele, pelo nome completo)
        const id = m.locationCatalogId ?? resolveCatalog(lotacao, canonicalComarca(m.locationComarca))?.id;
        const mine = { id, full: norm(lotacao) };
        found = units.filter((u) => sameUnit(mine, resolve(u))).map((unit) => ({ unit, by: 'lotação' as const }));
      } else {
        // Lotação em branco: responsável pela unidade no cadastro
        found = units.filter((u) => u.judgeName?.trim() && personKey(u.judgeName) === key).map((unit) => ({ unit, by: 'responsável' as const }));
      }
      if (found.length === 0) continue;
      const e = out.get(key) ?? {
        name: m.name, email: m.email, status: magistrateStatusLabel(m.status), represents: [] as any[],
        designated: rows.filter((r) => personKey(r.name) === key).map((r) => ({ unit: unitLabel(r), area: r.area, workType: r.workType ?? '', since: r.since ?? null, edition: r.editionTitle })),
      };
      for (const { unit: u, by } of found) {
        e.represents.push({ unit: unitLabel({ unit: u.unitName, comarca: u.comarca, separator: u.separator }), edition: S.editions.find((x) => x.id === u.editionId)?.title ?? '', selection: u.selection, status: u.status, by });
      }
      out.set(key, e);
    }
    res.json([...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
  });
}
