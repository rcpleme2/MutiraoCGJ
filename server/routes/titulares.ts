// Cruzamento (mutirão normal): responsáveis por unidades inscritas que também se inscreveram como magistrados voluntários.
import express from 'express';
import { scopeOf } from '../editions.ts';
import { panelRows, unitLabel } from '../links.ts';
import { S } from '../state.ts';
import { magistrateStatusLabel, personKey } from '../util.ts';

export function register(app: express.Express) {
  app.get('/api/titulares-voluntarios', (req, res) => {
    const scope = scopeOf(req);
    if (!scope) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    const units = S.units.filter((u) => scope.has(u) && u.judgeName?.trim());
    const rows = panelRows();
    const out = new Map<string, any>();
    for (const u of units) {
      const key = personKey(u.judgeName);
      if (!key) continue;
      const mags = S.magistrates.filter((m) => scope.has(m) && m.status !== 'Excluído' && personKey(m.name) === key);
      if (mags.length === 0) continue;
      const e = out.get(key) ?? {
        name: mags[0].name, email: mags[0].email, status: magistrateStatusLabel(mags[0].status),
        represents: [] as any[],
        designated: rows.filter((r) => personKey(r.name) === key).map((r) => ({ unit: unitLabel(r), area: r.area, workType: r.workType ?? '', since: r.since ?? null, edition: r.editionTitle })),
      };
      e.represents.push({ unit: unitLabel({ unit: u.unitName, comarca: u.comarca, separator: u.separator }), edition: S.editions.find((x) => x.id === u.editionId)?.title ?? '', selection: u.selection, status: u.status });
      out.set(key, e);
    }
    res.json([...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
  });
}
