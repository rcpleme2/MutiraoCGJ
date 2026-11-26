// Navegação da administração: menu lateral agrupado por tarefa, ajuda por tela, busca global e lista "O que fazer agora".
import { useMemo, useState } from 'react';
import { ChevronRight, HelpCircle, Menu, Search, Settings2, X } from 'lucide-react';
import { type Sub } from './shared';

export type RecView = 'panel' | 'distribution' | 'processes' | 'volunteers';
export type LinkViewId = 'panel' | 'link' | 'waiting';

export interface NavItem { key: string; label: string; sub: Sub; link?: LinkViewId; rec?: RecView; badge?: number; tone?: 'red' | 'warn'; help: string }
export interface NavGroup { label: string; items: NavItem[] }
export interface NavCounts { pendingMags: number; pendingUnits: number; unitsNoMagistrate: number; waiting: number; recPending: number; recVolunteers: number }

/** Menu agrupado por tarefa. `isAdmin`: Backup e Usuários só para administradores. */
export function buildNav(c: NavCounts, isAdmin: boolean): NavGroup[] {
  const groups: NavGroup[] = [
    { label: '', items: [{ key: 'home', label: 'Início', sub: 'overview', help: 'Resumo do mutirão e lista do que está esperando por você.' }] },
    { label: 'Mutirão normal', items: [
      { key: 'magistrates', label: 'Magistrados', sub: 'magistrates', badge: c.pendingMags, tone: 'warn', help: 'Inscrições de magistrados voluntários. Primeiro passo: aprovar ou rejeitar as que aguardam conferência.' },
      { key: 'units', label: 'Unidades', sub: 'units', badge: c.pendingUnits, tone: 'warn', help: 'Unidades que pediram apoio. Escolha as que farão parte do mutirão; as demais podem ser rejeitadas com motivo.' },
      { key: 'link-panel', label: 'Vinculações vigentes', sub: 'matches', link: 'panel', help: 'Quem atua em qual unidade hoje, com histórico, alteração de vara e desistências.' },
      { key: 'link-link', label: 'Vincular unidades', sub: 'matches', link: 'link', badge: c.unitsNoMagistrate, tone: 'red', help: 'Para cada unidade escolhida, defina quantos magistrados serão alocados e selecione quem vai atuar.' },
      { key: 'link-waiting', label: 'Aguardando vinculação', sub: 'matches', link: 'waiting', badge: c.waiting, tone: 'warn', help: 'Magistrados aprovados que ainda não têm unidade, e todas as unidades inscritas, para escolher e vincular.' },
      { key: 'editions', label: 'Janelas de inscrição', sub: 'editions', help: 'Períodos de inscrição do mutirão: datas de abertura e encerramento e a janela vigente no portal.' },
      { key: 'titulares', label: 'Magistrados - situação peculiar', sub: 'titulares', help: 'Magistrados voluntários que também representam uma unidade escolhida e vinculada. Há relatório em PDF e XLSX.' },
    ] },
    { label: 'Turma Recursal', items: [
      { key: 'rec-panel', label: 'Prazo e painel', sub: 'recursal', rec: 'panel', help: 'Defina o prazo de inscrição e acompanhe os totais e a situação de cada Turma.' },
      { key: 'rec-processes', label: 'Processos', sub: 'recursal', rec: 'processes', badge: c.recPending, tone: 'warn', help: 'Processos enviados pelos magistrados, com a Turma de origem e o relator designado. Exporta em tabela.' },
      { key: 'rec-volunteers', label: 'Voluntários', sub: 'recursal', rec: 'volunteers', badge: c.recVolunteers, tone: 'warn', help: 'Magistrados que receberão processos. Aprove, ajuste as Turmas em que atuam ou migre alguém do mutirão normal.' },
      { key: 'rec-distribution', label: 'Distribuição', sub: 'recursal', rec: 'distribution', help: 'Atribua processos aos relatores. O relator nunca pode atuar na Turma do processo.' },
    ] },
    { label: 'Cadastros e qualidade', items: [
      { key: 'catalog', label: 'Comarcas e unidades', sub: 'catalog', help: 'Lista oficial de comarcas e unidades usada nos formulários e no batimento de dados.' },
      { key: 'standardize', label: 'Padronizar nomes', sub: 'standardize', help: 'Corrige grafias de nomes e unidades para evitar duplicidades.' },
    ] },
    { label: 'Conteúdo', items: [{ key: 'faq', label: 'Perguntas frequentes', sub: 'faq', help: 'Perguntas e respostas publicadas no portal.' }] },
    { label: 'Sistema', items: [
      { key: 'log', label: 'Registro de atividades', sub: 'log', help: 'Histórico de tudo que foi feito no sistema, com data, autor e origem.' },
      ...(isAdmin ? [
        { key: 'backup', label: 'Backup', sub: 'backup' as Sub, help: 'Cópia de segurança dos dados e restauração.' },
        { key: 'users', label: 'Usuários', sub: 'users' as Sub, help: 'Quem acessa a administração e com qual perfil.' },
      ] : []),
    ] },
  ];
  return groups;
}

export interface SearchHit { label: string; detail: string; item: string; unitId?: string }

export function AdminSidebar({ groups, activeKey, hidden, onGo, onCustomize, search }: {
  groups: NavGroup[]; activeKey: string; hidden: string[]; onGo: (key: string) => void; onCustomize: () => void; search: (q: string) => SearchHit[];
}) {
  const [open, setOpen] = useState(false); // menu recolhido em telas estreitas
  const [q, setQ] = useState('');
  const hits = useMemo(() => (q.trim().length >= 2 ? search(q.trim()).slice(0, 8) : []), [q, search]);
  const active = groups.flatMap(g => g.items).find(i => i.key === activeKey);
  const go = (k: string) => { onGo(k); setOpen(false); setQ(''); };
  return (
    <aside className="lg:sticky lg:top-20 self-start mb-4 lg:mb-0">
      <button type="button" className="lg:hidden btn-secondary w-full justify-between flex items-center" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="flex items-center gap-2">{open ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />} Menu · {active?.label}</span>
      </button>
      <nav aria-label="Menu da administração" className={`${open ? 'block' : 'hidden'} lg:block card p-2 mt-2 lg:mt-0 max-h-[calc(100vh-7rem)] overflow-y-auto`}>
        <div className="relative p-1.5">
          <Search className="w-4 h-4 text-muted absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input type="search" aria-label="Buscar magistrado, unidade ou processo" placeholder="Buscar em tudo…" className="input !pl-9 !py-1.5 text-sm" value={q} onChange={e => setQ(e.target.value)} />
          {hits.length > 0 && (
            <ul className="absolute z-20 left-1.5 right-1.5 top-full mt-1 bg-surface border border-line rounded-md shadow-lg max-h-72 overflow-auto" role="listbox">
              {hits.map((h, i) => (
                <li key={i}><button type="button" className="w-full text-left px-3 py-2 hover:bg-paper text-sm" onClick={() => { onGo(h.item + (h.unitId ? `|${h.unitId}` : '')); setQ(''); setOpen(false); }}>
                  <div className="font-medium truncate">{h.label}</div><div className="text-[11px] text-muted truncate">{h.detail}</div></button></li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && hits.length === 0 && <div className="absolute z-20 left-1.5 right-1.5 top-full mt-1 bg-surface border border-line rounded-md p-3 text-xs text-muted">Nada encontrado.</div>}
        </div>
        {groups.map(g => {
          const items = g.items.filter(i => !hidden.includes(i.sub));
          if (items.length === 0) return null;
          return (
            <div key={g.label || 'top'}>
              {g.label && <div className="px-3 pt-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">{g.label}</div>}
              {items.map(i => (
                <button key={i.key} type="button" onClick={() => go(i.key)} aria-current={activeKey === i.key ? 'page' : undefined}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors ${activeKey === i.key ? 'bg-bronze-soft text-navy font-semibold' : 'text-ink hover:bg-paper'}`}>
                  <span className="flex-1 min-w-0 truncate">{i.label}</span>
                  {!!i.badge && <span className={`text-[11px] tabular-nums rounded-full px-2 py-0.5 ${i.tone === 'red' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'}`} aria-label={`${i.badge} pendente(s)`}>{i.badge}</span>}
                </button>
              ))}
            </div>
          );
        })}
        <div className="border-t border-line mt-2 pt-1">
          <button type="button" className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted hover:text-ink" onClick={onCustomize}><Settings2 className="w-4 h-4" /> Personalizar menu</button>
        </div>
      </nav>
    </aside>
  );
}

/** Trilha "Grupo › Tela" e linha de ajuda recolhível (a escolha de recolher fica no navegador) */
export function ScreenHeader({ group, item, hiddenHelp, onToggleHelp }: { group: string; item: NavItem; hiddenHelp: boolean; onToggleHelp: () => void }) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted flex items-center gap-1">{group && <>{group}<ChevronRight className="w-3 h-3" /></>}<strong className="text-ink font-medium">{item.label}</strong></div>
      {hiddenHelp ? (
        <button type="button" className="text-xs text-bronze hover:underline inline-flex items-center gap-1" onClick={onToggleHelp}><HelpCircle className="w-3.5 h-3.5" /> Para que serve esta tela?</button>
      ) : (
        <div className="bg-bronze-soft rounded-md px-4 py-2.5 text-sm flex items-start gap-3" role="note">
          <HelpCircle className="w-4 h-4 text-bronze mt-0.5 shrink-0" />
          <p className="flex-1"><strong className="text-bronze">Para que serve:</strong> {item.help}</p>
          <button type="button" className="text-xs text-muted hover:text-ink shrink-0" onClick={onToggleHelp}>Ocultar</button>
        </div>
      )}
    </div>
  );
}

export interface Todo { tone: 'red' | 'warn' | 'ok'; title: string; where: string; key: string }
export function TodoList({ todos, onGo }: { todos: Todo[]; onGo: (key: string) => void }) {
  const open = todos.filter(t => t.tone !== 'ok');
  return (
    <section aria-label="O que fazer agora" className="space-y-3">
      <h2 className="text-xl font-serif font-semibold text-navy">{open.length ? `O que fazer agora (${open.length})` : 'Nada pendente no momento'}</h2>
      <div className="grid gap-2">
        {todos.map((t, i) => (
          <button key={i} type="button" onClick={() => onGo(t.key)} className="card p-3.5 flex items-center gap-3 text-left hover:border-navy/40 transition-colors">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${t.tone === 'red' ? 'bg-danger' : t.tone === 'warn' ? 'bg-warn' : 'bg-ok'}`} aria-hidden="true" />
            <span className="flex-1 min-w-0"><span className="block font-medium">{t.title}</span><span className="block text-xs text-muted">{t.where}</span></span>
            <span className="text-xs text-bronze whitespace-nowrap">{t.tone === 'ok' ? 'Ver' : 'Abrir'} →</span>
          </button>
        ))}
      </div>
    </section>
  );
}
