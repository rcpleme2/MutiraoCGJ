// Rotas de duplicidades de magistrados (mesma pessoa identificada pelo nome).
import express from 'express';
import { editionById } from '../editions.ts';
import { log, S } from '../state.ts';
import { type Magistrate } from '../types.ts';
import { canonicalPersonName, cleanCell, personKey } from '../util.ts';

export const NAME_STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
export const nameWords = (k: string) => k.split(' ').filter((w) => w && !NAME_STOP.has(w));
export function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++) { const tmp = prev[j]; prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1)); diag = tmp; }
  }
  return prev[b.length];
}
/** Pares de nomes diferentes que provavelmente são a mesma pessoa (abreviação, nome do meio omitido ou erro de digitação). */
export function similarNamePairs() {
  const byKey = new Map<string, Magistrate[]>();
  for (const m of S.magistrates) { const k = personKey(m.name); if (k) byKey.set(k, [...(byKey.get(k) ?? []), m]); }
  const keys = [...byKey.keys()];
  const out: { a: string; b: string; reason: string }[] = [];
  const dismissed = new Set(S.dupDismissed);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const [a, b] = [keys[i], keys[j]];
    const wa = nameWords(a), wb = nameWords(b);
    if (wa.length < 2 || wb.length < 2) continue;
    const sameEnds = wa[0] === wb[0] && wa[wa.length - 1] === wb[wb.length - 1];
    let reason = '';
    if (sameEnds) {
      const [small, big] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
      // "JOÃO SILVA" ⊂ "JOÃO CARLOS DA SILVA"; abreviações ("J." ↔ "JOÃO") também valem
      if (small.every((w) => big.some((x) => x === w || (w.length === 1 && x.startsWith(w)) || (x.length === 1 && w.startsWith(x))))) reason = 'nome abreviado ou com parte omitida';
    }
    if (!reason && (wa[0] === wb[0] || wa[wa.length - 1] === wb[wb.length - 1]) && a.length > 10 && editDistance(a, b) <= 2) reason = 'grafia quase igual (possível erro de digitação)';
    if (reason && !dismissed.has([a, b].sort().join('|'))) out.push({ a, b, reason });
  }
  const describe = (k: string) => ({ key: k, name: byKey.get(k)![0].name, records: byKey.get(k)!.map((m) => ({ id: m.id, edition: editionById(m.editionId)?.title ?? '', status: m.status, email: m.email })) });
  return out.map((p) => ({ a: describe(p.a), b: describe(p.b), reason: p.reason }));
}

export function register(app: express.Express) {
  app.get('/api/duplicates', (_req, res) => res.json(similarNamePairs()));
  /** "É a mesma pessoa": todos os registros passam a usar a grafia escolhida; e-mail e lotação que faltem são completados. */
  app.post('/api/duplicates/merge', (req, res) => {
    const keys: string[] = Array.isArray(req.body?.keys) ? req.body.keys.filter((k: unknown) => typeof k === 'string') : [];
    const chosen = typeof req.body?.name === 'string' ? canonicalPersonName(cleanCell(req.body.name)) : '';
    if (keys.length < 2 || !chosen) return res.status(400).json({ error: 'Indique os nomes e a grafia a adotar.' });
    const group = S.magistrates.filter((m) => keys.includes(personKey(m.name)));
    if (group.length === 0) return res.status(404).json({ error: 'Registros não encontrados.' });
    const donor = [...group].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const email = donor.find((m) => m.email)?.email ?? '';
    const loc = donor.find((m) => m.locationCatalogId) ?? donor.find((m) => m.currentLocation);
    const oldNames = [...new Set(group.map((m) => m.name))];
    for (const m of group) {
      if (m.name !== chosen && !m.nameAsTyped) m.nameAsTyped = m.name;
      m.name = chosen;
      if (!m.email && email) m.email = email;
      if (!m.currentLocation && loc) { m.currentLocation = loc.currentLocation; m.locationCatalogId = loc.locationCatalogId; m.locationComarca = loc.locationComarca; }
    }
    S.withdrawals.filter((w) => keys.includes(personKey(w.name))).forEach((w) => { w.name = chosen; });
    S.transfers.filter((t) => keys.includes(personKey(t.name))).forEach((t) => { t.name = chosen; });
    log(null, 'Administração', 'Magistrado', `Mesma pessoa: ${oldNames.map((n) => `"${n}"`).join(', ')} unificados como "${chosen}" (${group.length} registro(s)).`);
    res.json({ success: true, count: group.length });
  });
  app.post('/api/duplicates/dismiss', (req, res) => {
    const keys: string[] = Array.isArray(req.body?.keys) ? req.body.keys.filter((k: unknown) => typeof k === 'string') : [];
    if (keys.length !== 2) return res.status(400).json({ error: 'Par inválido.' });
    const k = [...keys].sort().join('|');
    if (!S.dupDismissed.includes(k)) S.dupDismissed.push(k);
    log(null, 'Administração', 'Magistrado', `Nomes parecidos marcados como pessoas diferentes: ${keys.join(' × ')}.`);
    res.json({ success: true });
  });
}
