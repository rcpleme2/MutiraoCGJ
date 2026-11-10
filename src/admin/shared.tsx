// Tipos e auxiliares comuns às telas da administração.
import { fullUnitName } from '../catalogo-tjpr';
import { Unit } from '../types';

export type Sub = 'overview' | 'editions' | 'magistrates' | 'units' | 'matches' | 'faq' | 'log' | 'backup' | 'standardize' | 'catalog' | 'users';

export const toLocalInput = (iso: string) => iso.slice(0, 16);

/** "Nome da unidade" + separador + "comarca" (ex.: 1ª VARA CÍVEL DE CURITIBA), sem repetir a comarca. */
export const unitLabel = (u: { unitName: string; comarca?: string; separator?: string }) => fullUnitName(u);

export const SELECTION_ORDER: Record<string, number> = { 'Em análise': 0, 'Escolhida': 1, 'Rejeitada': 2 };

export const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

export const readPref = <V,>(key: string, fallback: V): V => { try { const v = localStorage.getItem(key); return v ? { ...fallback as any, ...JSON.parse(v) } : fallback; } catch { return fallback; } };

export const writePref = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* armazenamento indisponível */ } };

/** Nome da vara na lista de escolha; com o mesmo nome em mais de uma janela de inscrição, indica a janela */
export const unitOption = (u: Unit, list: Unit[]) => (list.some(x => x.id !== u.id && x.unitName === u.unitName) ? `${u.unitName} — ${u.editionTitle ?? ''}` : u.unitName);

/* ---------- Painel de vinculações (restrito): tabela única, desistências e relatório em PDF ---------- */
export type RunFn = <T,>(fn: () => Promise<T>, okMessage?: string) => Promise<T | undefined>;

export const dmy = (ymd: string) => ymd.split('-').reverse().join('/');

/** Desistência: a atuação vai até o último dia do mês do pedido */
export const monthEnd = (ymd: string) => new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0)).toISOString().slice(0, 10);
