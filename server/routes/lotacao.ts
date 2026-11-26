// Importação de lotações por planilha (colunas: Nome Pessoa, Comarca, Unidade): preenche ou atualiza o campo Lotação das inscrições.
import express from 'express';
import { canonicalComarca, catalogById, fullUnitName, CATALOG_SEPARATOR } from '../../src/catalogo-tjpr';
import { resolveCatalog } from '../../src/catalogo-match';
import { scopeOf } from '../editions.ts';
import { readSheetCols } from '../recursal/parse.ts';
import { log, S } from '../state.ts';
import { norm, personKey } from '../util.ts';

type Place = { currentLocation: string; locationCatalogId?: string; locationComarca?: string; official: boolean };

/** Lotação a gravar: unidade do catálogo oficial quando reconhecida; senão, comarca da lista + nome da unidade como veio na planilha. */
export function placeFrom(comarcaText: string, unitText: string): Place {
  const comarca = canonicalComarca(comarcaText);
  const cat = resolveCatalog(unitText, comarca);
  if (cat) return { currentLocation: fullUnitName(cat), locationCatalogId: cat.id, locationComarca: cat.comarca, official: true };
  const name = unitText.toLocaleUpperCase('pt-BR');
  return { currentLocation: comarca ? fullUnitName({ unitName: name, comarca, separator: CATALOG_SEPARATOR }) : name, ...(comarca ? { locationComarca: comarca } : {}), official: false };
}

export type LotRow = { line: number; name: string; comarca: string; unit: string; state: 'preencher' | 'atualizar' | 'igual' | 'ignorada' | 'nao_encontrado' | 'duplicada' | 'invalida'; current?: string; next?: string; records?: number; official?: boolean; note?: string };

export function register(app: express.Express) {
  // apply=false: só confere. apply=true: grava (mode 'empty' = só lotações em branco; 'all' = também atualiza as preenchidas).
  app.post('/api/magistrates/import-lotacao', (req, res) => {
    const scope = scopeOf(req);
    if (!scope) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });
    const mode = req.body?.mode === 'all' ? 'all' : 'empty';
    let sheet: string[][];
    try {
      if (!req.body?.file || typeof req.body.file.base64 !== 'string') return res.status(400).json({ error: 'Envie a planilha.' });
      sheet = readSheetCols(req.body.file.base64, String(req.body.file.name ?? 'arquivo'), 3);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
    if (sheet.length === 0) return res.status(400).json({ error: 'A planilha não tem nenhuma linha de dados.' });

    const byKey = new Map<string, typeof S.magistrates>();
    for (const m of S.magistrates) {
      if (!scope.has(m) || m.status === 'Excluído') continue;
      const k = personKey(m.name); if (!k) continue;
      byKey.set(k, [...(byKey.get(k) ?? []), m]);
    }
    const seen = new Set<string>();
    const rows: LotRow[] = sheet.map((r, i) => {
      const [name, comarca, unit] = r; const line = i + 2; // linha da planilha (com cabeçalho)
      const base = { line, name, comarca, unit };
      if (!name || !unit) return { ...base, state: 'invalida' as const, note: !name ? 'Nome em branco.' : 'Unidade em branco.' };
      const key = personKey(name);
      if (seen.has(key)) return { ...base, state: 'duplicada' as const, note: 'Nome repetido na planilha: vale a 1ª linha.' };
      seen.add(key);
      const recs = byKey.get(key);
      if (!recs?.length) return { ...base, state: 'nao_encontrado' as const, note: 'Sem inscrição com este nome.' };
      const place = placeFrom(comarca, unit);
      const empty = recs.filter((m) => !m.currentLocation?.trim());
      const differs = recs.filter((m) => m.currentLocation?.trim() && norm(m.currentLocation) !== norm(place.currentLocation));
      const warn = place.official ? undefined : 'Unidade não localizada no catálogo oficial: será gravada como digitada.';
      const common = { ...base, next: place.currentLocation, records: recs.length, official: place.official, ...(warn ? { note: warn } : {}) };
      if (empty.length) return { ...common, state: 'preencher' as const };
      if (differs.length) return { ...common, state: mode === 'all' ? 'atualizar' as const : 'ignorada' as const, current: differs[0].currentLocation, ...(mode === 'all' ? {} : { note: 'Já tem lotação: mantida (modo "só as vazias").' }) };
      return { ...common, state: 'igual' as const, current: recs[0].currentLocation };
    });
    const count = (s: LotRow['state']) => rows.filter((r) => r.state === s).length;
    const summary = { total: rows.length, preencher: count('preencher'), atualizar: count('atualizar'), igual: count('igual'), ignorada: count('ignorada'), nao_encontrado: count('nao_encontrado'), duplicada: count('duplicada'), invalida: count('invalida') };

    if (req.body?.apply !== true) return res.json({ summary, rows, applied: false });

    let changed = 0;
    for (const r of rows) {
      if (r.state !== 'preencher' && r.state !== 'atualizar') continue;
      const place = placeFrom(r.comarca, r.unit);
      for (const m of byKey.get(personKey(r.name)) ?? []) {
        const has = !!m.currentLocation?.trim();
        if (has && mode !== 'all') continue;
        if (has && norm(m.currentLocation) === norm(place.currentLocation) && m.locationCatalogId === place.locationCatalogId) continue;
        const before = m.currentLocation;
        m.currentLocation = place.currentLocation;
        if (place.locationCatalogId) m.locationCatalogId = place.locationCatalogId; else delete m.locationCatalogId;
        if (place.locationComarca) m.locationComarca = place.locationComarca; else delete m.locationComarca;
        changed++;
        log(m.editionId, 'Administração', 'Magistrado', `Lotação de ${m.name} ${before?.trim() ? `alterada de "${before}" para` : 'preenchida:'} "${place.currentLocation}" (importação de planilha).`);
      }
    }
    log(null, 'Administração', 'Magistrado', `Importação de lotações: ${changed} inscrição(ões) alterada(s) (modo: ${mode === 'all' ? 'preencher e atualizar' : 'só as vazias'}).`);
    res.json({ summary, rows, applied: true, changed });
  });
}
