// Estado em memória do sistema, dados iniciais de demonstração, geração de ids e registro de atividades.
import { type CatalogRecord } from '../src/catalogo-tjpr';
import { AsyncLocalStorage } from 'async_hooks';
import { type AdminUser, type ChangeRequest, type Edition, type FaqItem, type LogCategory, type LogEntry, type Magistrate, type Match, type PanelEntry, type Transfer, type Unit, type Withdrawal } from './types.ts';

/** Estado do sistema em memória (gravado no Firestore ou em data/state.json pela persistência) */
export interface State {
  admins: AdminUser[];
  editions: Edition[];
  activeEditionId: string;
  magistrates: Magistrate[];
  units: Unit[];
  matches: Match[];
  faq: FaqItem[];
  panelEntries: PanelEntry[];
  withdrawals: Withdrawal[];
  transfers: Transfer[];
  changeRequests: ChangeRequest[];
  dupDismissed: string[];
  catalogUnits: CatalogRecord[];
  catalogComarcas: { id: string; name: string }[];
  lastAutoBackup: { at: string; ok: boolean; name?: string; size?: number; error?: string } | null;
  adminTotpSecret: string | null;
  activityLog: LogEntry[];
  sharedHiddenTabs: string[];
}
export const S = {} as State;
S.admins = [];
S.editions = [
  {
    id: 'ed-1',
    title: 'Mutirão de Julgamento TJPR - 2026',
    description: 'Mutirão focado na redução do acervo processual e cumprimento das metas do CNJ em unidades de todo o estado.',
    openingDate: '2026-04-01T08:00',
    closingDate: '2026-05-15T23:59',
    isRegistrationOpen: true,
    status: 'Em andamento',
    createdAt: '2026-03-20T09:00:00Z',
  },
];
S.activeEditionId = 'ed-1';
S.magistrates = [
  {
    id: 'mag-1',
    editionId: 'ed-1',
    name: 'Dra. Ana Paula Silveira',
    email: 'ana.silveira@tjp.jus.br',
    currentLocation: '1ª Vara Cível da Comarca de Curitiba',
    firstPreference: 'Cível e Fazenda Pública',
    secondPreference: 'Família e Infância',
    acceptsHearings: true,
    createdAt: '2026-04-02T10:15:00Z',
    status: 'Aprovado',
  },
  {
    id: 'mag-2',
    editionId: 'ed-1',
    name: 'Dr. Carlos Eduardo Mendes',
    email: 'carlos.mendes@tjp.jus.br',
    currentLocation: '3ª Vara Criminal da Comarca de Londrina',
    firstPreference: 'Crime',
    secondPreference: 'Juizado Cível, Crime e Fazenda Pública',
    acceptsHearings: false,
    createdAt: '2026-04-03T14:20:00Z',
    status: 'Aguardando Conferência',
  },
  {
    id: 'mag-3',
    editionId: 'ed-1',
    name: 'Dra. Beatriz de Souza Lima',
    email: 'beatriz.lima@tjp.jus.br',
    currentLocation: '2ª Vara de Família e Sucessões de Maringá',
    firstPreference: 'Família e Infância',
    secondPreference: 'Cível e Fazenda Pública',
    acceptsHearings: true,
    createdAt: '2026-04-04T09:30:00Z',
    status: 'Atribuído',
  },
];
S.units = [
  {
    id: 'unit-1',
    editionId: 'ed-1',
    unitName: 'Vara do Juizado Especial Cível e Criminal - Comarca de Cascavel',
    judgeName: 'Dr. Roberto Sampaio',
    email: 'cascavel.jecc@tjp.jus.br',
    comarca: 'Cascavel',
    separator: 'de',
    areas: ['Juizado Cível, Crime e Fazenda Pública', 'Crime'],
    supportNeeded: 'Audiência e Sentença',
    description: 'Acervo elevado de processos conclusos para sentença há mais de 100 dias.',
    createdAt: '2026-04-02T11:00:00Z',
    status: 'Pendente',
    selection: 'Escolhida',
    slots: 1,
  },
  {
    id: 'unit-2',
    editionId: 'ed-1',
    unitName: '2ª Vara Cível da Comarca de Ponta Grossa',
    judgeName: 'Dra. Fernanda Vasconcelos',
    email: 'pg.2civel@tjp.jus.br',
    comarca: 'Ponta Grossa',
    separator: 'de',
    areas: ['Cível e Fazenda Pública'],
    supportNeeded: 'Sentença',
    description: 'Demanda reprimida em execuções fiscais e ações de cobrança.',
    createdAt: '2026-04-03T16:45:00Z',
    status: 'Pendente',
    selection: 'Escolhida',
    slots: 1,
  },
  {
    id: 'unit-3',
    editionId: 'ed-1',
    unitName: 'Vara da Infância e da Juventude - Comarca de Maringá',
    judgeName: 'Dr. Lucas Ribeiro',
    email: 'beatriz.lima@tjp.jus.br',
    comarca: 'Maringá',
    separator: 'de',
    areas: ['Família e Infância'],
    supportNeeded: 'Audiência',
    description: 'Necessidade de mutirão em audiências concentradas e medidas protetivas.',
    createdAt: '2026-04-04T11:10:00Z',
    status: 'Atendida',
    selection: 'Escolhida',
    slots: 1,
  },
];
S.matches = [
  {
    id: 'match-1',
    editionId: 'ed-1',
    magistrateId: 'mag-3',
    unitId: 'unit-3',
    assignedArea: 'Família e Infância',
    workType: 'Audiência',
    status: 'Vinculado',
    createdAt: '2026-04-04T14:00:00Z',
  },
];
S.faq = [];
S.panelEntries = [];
S.withdrawals = [];
S.transfers = [];
S.changeRequests = [];
/** Pares de nomes parecidos que a administração indicou NÃO serem a mesma pessoa (chave "nomeA|nomeB") */
S.dupDismissed = [];
/** Lista oficial de comarcas e unidades, editável pelo painel. Vazia = ainda não editada: vale a lista embutida. */
S.catalogUnits = [];
S.catalogComarcas = [];
/** Resultado do último backup automático (exibido na aba Backup e no painel) */
S.lastAutoBackup = null;
/** Autenticação em dois fatores (TOTP) do administrador; o segredo é gravado junto do estado. */
S.adminTotpSecret = null;
/** Contexto da requisição em andamento (IP), para que todo registro de atividade carregue a origem. */
export const reqCtx = new AsyncLocalStorage<{ ip: string; user?: string }>();
S.activityLog = [
  {
    id: 'log-seed-1',
    editionId: 'ed-1',
    timestamp: '2026-03-20T09:00:00Z',
    actor: 'Sistema',
    category: 'Edição',
    description: 'Edição "Mutirão de Julgamento TJPR - 2026" criada.',
  },
];
export let idCounter = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now()}-${(idCounter++).toString(36)}`;
export function log(
  editionId: string | null,
  actor: LogEntry['actor'],
  category: LogCategory,
  description: string,
) {
  const ip = reqCtx.getStore()?.ip;
  const by = actor === 'Administração' ? reqCtx.getStore()?.user : undefined;
  S.activityLog.unshift({
    id: newId('log'),
    editionId,
    timestamp: new Date().toISOString(),
    actor,
    category,
    description,
    ...(ip ? { ip } : {}),
    ...(by ? { by } : {}),
  });
  if (S.activityLog.length > 5000) S.activityLog.length = 5000; // corte só na memória; o Firestore mantém o histórico
  // Cópia estruturada no Cloud Logging (imutável para o aplicativo) das ações administrativas e de acesso
  if (actor === 'Administração' || category === 'Acesso') {
    console.log(JSON.stringify({ severity: 'NOTICE', message: description, audit: { category, actor, by: by ?? null, ip: ip ?? null, editionId } }));
  }
}
/** Abas escondidas por quem entra com a senha compartilhada (sem usuário individual) */
S.sharedHiddenTabs = [];
