// Rota do painel oferta × demanda.
import express from 'express';
import { canonicalComarca, fullUnitName } from '../../src/catalogo-tjpr';
import { resolveEdition } from '../editions.ts';
import { linkedCount, sameComarcaAs } from '../links.ts';
import { S } from '../state.ts';

export function register(app: express.Express) {
  app.get('/api/dashboard', (req, res) => {
    const all = req.query.edition === 'all';
    const edition = all ? undefined : resolveEdition(req);
    if (!all && !edition) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    const inScope = (x: { editionId: string }) => all || x.editionId === edition!.id;
    const us = S.units.filter(inScope), ms = S.magistrates.filter(inScope), mts = S.matches.filter(inScope);
    const chosen = us.filter((u) => u.selection === 'Escolhida');
    const linkedMag = new Set(S.matches.map((m) => m.magistrateId));
    const available = ms.filter((m) => (m.status === 'Aprovado' || m.status === 'Lista de Espera') && !linkedMag.has(m.id));
    // Quantos juízes faltam e para qual área: cada vaga aberta de unidade escolhida é casada (emparelhamento máximo) com um magistrado disponível
    // que tenha a área da unidade entre as preferências (de qualquer janela de inscrição) e fora da comarca em que atua. Vaga sem par = juiz que falta.
    const slots = chosen.flatMap((u) => Array.from({ length: Math.max(0, (u.slots || 1) - linkedCount(u.id)) }, () => u));
    const edges = slots.map((u) => available.map((m, j) => (!sameComarcaAs(m, u) && (u.areas.includes(m.firstPreference) || (!!m.secondPreference && u.areas.includes(m.secondPreference))) ? j : -1)).filter((j) => j >= 0));
    const slotOf = new Array<number>(available.length).fill(-1);
    const tryFill = (i: number, seen: Set<number>): boolean => {
      for (const j of edges[i]) {
        if (seen.has(j)) continue;
        seen.add(j);
        if (slotOf[j] < 0 || tryFill(slotOf[j], seen)) { slotOf[j] = i; return true; }
      }
      return false;
    };
    slots.forEach((_, i) => tryFill(i, new Set()));
    const covered = new Set(slotOf.filter((i) => i >= 0));
    const areaRow = new Map<string, { area: string; units: Set<string>; openSlots: number; covered: number; missing: number; spare: number }>();
    const rowOf = (area: string) => { let r = areaRow.get(area); if (!r) { r = { area, units: new Set(), openSlots: 0, covered: 0, missing: 0, spare: 0 }; areaRow.set(area, r); } return r; };
    slots.forEach((u, i) => { const r = rowOf(u.areas.join(' / ') || '(sem área)'); r.units.add(u.id); r.openSlots++; if (covered.has(i)) r.covered++; else r.missing++; });
    available.forEach((m, j) => { if (slotOf[j] < 0 && m.firstPreference) rowOf(m.firstPreference).spare++; });
    const byArea = [...areaRow.values()].map((r) => ({ ...r, units: r.units.size })).sort((x, y) => y.missing - x.missing || x.area.localeCompare(y.area, 'pt-BR'));
    const missingTotal = slots.length - covered.size;
    const comarcas = new Map<string, { comarca: string; pending: number; partial: number; attended: number }>();
    for (const u of chosen) {
      const c = canonicalComarca(u.comarca) ?? (u.comarca || '(sem comarca)');
      const row = comarcas.get(c) ?? { comarca: c, pending: 0, partial: 0, attended: 0 };
      if (u.status === 'Pendente') row.pending++; else if (u.status === 'Atendida') row.attended++; else row.partial++;
      comarcas.set(c, row);
    }
    // Alertas
    const ownPlace = mts.flatMap((mt) => {
      const mag = S.magistrates.find((m) => m.id === mt.magistrateId), un = S.units.find((u) => u.id === mt.unitId);
      if (!mag || !un) return [];
      const sameUnit = !!mag.locationCatalogId && mag.locationCatalogId === un.catalogId;
      const magComarca = canonicalComarca(mag.locationComarca), unComarca = canonicalComarca(un.comarca);
      const sameComarca = !!magComarca && magComarca === unComarca;
      return sameUnit || sameComarca ? [{ name: mag.name, unit: fullUnitName(un), kind: sameUnit ? 'na própria vara' : 'na própria comarca' }] : [];
    });
    const DAY = 86_400_000;
    const waitingLong = available.filter((m) => Date.now() - Date.parse(m.createdAt) > 15 * DAY)
      .map((m) => ({ name: m.name, days: Math.floor((Date.now() - Date.parse(m.createdAt)) / DAY), area: m.firstPreference }))
      .sort((a, b) => b.days - a.days);
    const unitsWithout = chosen.filter((u) => linkedCount(u.id) === 0).map((u) => ({ unit: fullUnitName(u), areas: u.areas.join(', '), since: u.createdAt }));
    res.json({
      totals: { units: us.length, chosen: chosen.length, openSlots: slots.length, available: available.length, matches: mts.length, covered: covered.size, missing: missingTotal, spare: available.length - covered.size, pendingUnits: us.filter((u) => u.selection === 'Em análise').length },
      byArea, byComarca: [...comarcas.values()].sort((a, b) => b.pending - a.pending || a.comarca.localeCompare(b.comarca, 'pt-BR')),
      alerts: {
        ownPlace, waitingLong, unitsWithout,
        toStandardize: { units: us.filter((u) => !u.catalogId).length, locations: ms.filter((m) => m.currentLocation && !m.locationCatalogId).length },
      },
    });
  });
}
