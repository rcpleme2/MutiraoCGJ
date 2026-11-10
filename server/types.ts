// Tipos e constantes do domínio (edições/janelas, magistrados, unidades, vinculações, registros).

export type MagistrateStatus = 'Aguardando Conferência' | 'Aprovado' | 'Lista de Espera' | 'Atribuído' | 'Rejeitado' | 'Desistente' | 'Excluído';
export interface Edition {
  id: string;
  title: string;
  description: string;
  openingDate: string;
  closingDate: string;
  isRegistrationOpen: boolean;
  status: 'Em andamento' | 'Encerrada';
  createdAt: string;
  /** Edição "Vinculações iniciais": guarda as designações já existentes; aceita registros com dados em branco */
  isInitial?: boolean;
  /** Início da atuação dos magistrados vinculados nesta edição (AAAA-MM-DD); vale para as vinculações sem data própria */
  startDate?: string;
}
export interface Magistrate {
  id: string;
  editionId: string;
  name: string;
  /** Nome como foi digitado, quando difere da grafia padrão (MAIÚSCULAS, sem tratamento) */
  nameAsTyped?: string;
  email: string;
  currentLocation: string;
  /** Lotação escolhida no catálogo oficial (ausente = digitada em "Outra" ou registro antigo) */
  locationCatalogId?: string;
  /** Comarca da lotação (sempre da lista oficial quando informada) */
  locationComarca?: string;
  firstPreference: string;
  secondPreference: string;
  acceptsHearings: boolean;
  /** Período em que pode auxiliar nas audiências (só quando aceita audiências) */
  hearingPeriod?: HearingPeriod;
  registeredIp?: string;
  /** Declaração de regularidade (120 dias / sanção / processo administrativo) aceita na inscrição pública */
  declaration?: boolean;
  rejectionReason?: string;
  rejectedAt?: string;
  /** Exclusão (lógica) pela coordenação, com justificativa obrigatória; o motivo nunca é exibido ao público */
  exclusionReason?: string;
  exclusionSei?: string;
  excludedAt?: string;
  excludedBy?: string;
  statusBeforeExclusion?: MagistrateStatus;
  /** Designações que o magistrado tinha quando foi excluído (as vinculações são desfeitas na exclusão) */
  excludedFrom?: { editionId: string; area: string; unit: string; workType?: string; /** início da atuação, se diferente do da edição */ startDate?: string }[];
  createdAt: string;
  status: MagistrateStatus;
}
export type UnitSelection = 'Em análise' | 'Escolhida' | 'Rejeitada';
/** Período das audiências, comum a magistrados e unidades ("período do expediente" = tarde) */
export type HearingPeriod = 'Manhã' | 'Tarde' | 'Indiferente';
export const HEARING_PERIODS: HearingPeriod[] = ['Manhã', 'Tarde', 'Indiferente'];
/** Aceita também "Expediente" (gravado antes da unificação) como tarde */
export const asHearingPeriod = (v: unknown): HearingPeriod | '' | null =>
  v == null || v === '' ? '' : v === 'Expediente' ? 'Tarde' : HEARING_PERIODS.includes(v as HearingPeriod) ? (v as HearingPeriod) : null;
export const hearingPeriodLabel = (p?: string) => (p === 'Manhã' ? 'Manhã' : p === 'Tarde' ? 'Tarde (expediente)' : p === 'Indiferente' ? 'Indiferente (manhã ou tarde)' : '');
export type WorkType = 'Audiência' | 'Sentença' | 'Audiência e Sentença';
export const WORK_TYPES: WorkType[] = ['Audiência', 'Sentença', 'Audiência e Sentença'];
 // auxílio pedido pela unidade
/** Atuação do magistrado na unidade: apenas para audiências OU para sentença */
export const MATCH_WORK_TYPES: WorkType[] = ['Audiência', 'Sentença'];
export interface Unit {
  id: string;
  editionId: string;
  unitName: string;
  judgeName: string;
  email: string;
  comarca: string;
  /** Liga o nome da unidade à comarca na exibição (ex.: "de", "da", "do") */
  separator: string;
  /** Unidade do catálogo oficial (ausente = nome digitado em "Outra" ou registro antigo: "a padronizar") */
  catalogId?: string;
  areas: string[];
  supportNeeded: 'Audiência' | 'Sentença' | 'Audiência e Sentença';
  /** Período pretendido para o auxílio nas audiências (só quando o auxílio inclui audiências) */
  hearingPeriod?: HearingPeriod;
  description: string;
  registeredIp?: string;
  createdAt: string;
  /** Atendimento: Pendente (sem magistrado), Atendida (vinculada) ou Em Andamento */
  status: 'Pendente' | 'Atendida' | 'Em Andamento';
  /** Triagem da administração: só unidades "Escolhida" entram na vinculação */
  selection: UnitSelection;
  /** Quantos magistrados serão alocados nesta unidade (padrão 1; definido pela administração) */
  slots: number;
  rejectionReason?: string;
  rejectedAt?: string;
  /** Rejeitada com o pedido mantido: aguarda a criação da próxima edição para ser transportada */
  carryOver?: boolean;
  /** Edição para a qual o pedido foi transportado */
  carriedToEditionId?: string;
  /** Edição de origem, quando o pedido foi transportado de uma edição anterior */
  carriedFromEditionId?: string;
}
export interface Match {
  id: string;
  editionId: string;
  magistrateId: string;
  unitId: string;
  assignedArea: string;
  /** O que o magistrado fará na unidade: audiências, sentenças ou ambos */
  workType: WorkType;
  /** Legado: motivo informado em vinculações adicionais antes de existir o número de vagas; não é mais exigido */
  exceptionReason?: string;
  /** A partir de quando o magistrado atua nesta unidade (informado ao trocar de unidade), AAAA-MM-DD */
  startDate?: string;
  /** Observação da designação (ex.: segunda vara citada na planilha original, "acervo cível") */
  note?: string;
  /** Observação livre da administração, no estilo post-it, exibida no painel de vinculações */
  postit?: string;
  postitUpdatedAt?: string;
  status: 'Vinculado' | 'Concluído';
  createdAt: string;
}
export type LogCategory = 'Edição' | 'Magistrado' | 'Unidade' | 'Vinculação' | 'Exportação' | 'Acesso' | 'Conteúdo';
/** Pergunta frequente, mantida pela administração (conteúdo geral, não vinculado a uma edição) */
export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  order: number;
  published: boolean;
  updatedAt: string;
}
export interface LogEntry {
  id: string;
  editionId: string | null;
  timestamp: string;
  actor: 'Administração' | 'Público' | 'Sistema';
  category: LogCategory;
  description: string;
  /** IP de quem originou a ação (preenchido automaticamente nas requisições) */
  ip?: string;
  /** Usuário administrativo que fez a ação */
  by?: string;
}
export type AdminRole = 'admin' | 'gestor' | 'consulta';
export const ADMIN_ROLES: AdminRole[] = ['admin', 'gestor', 'consulta'];
export interface AdminUser {
  id: string; name: string; email: string; role: AdminRole;
  /** scrypt$<sal>$<hash> */
  passwordHash: string;
  totpSecret?: string; active: boolean; createdAt: string; lastLoginAt?: string;
  /** Abas da administração que o usuário escolheu esconder na própria tela */
  hiddenTabs?: string[];
}
export interface Session { id: string; exp: number; userId: string | null; name: string; role: AdminRole; createdAt: string; keep?: boolean }
/** Painel de vinculações (uso restrito da administração): linhas coladas de planilha (Nome / Área / Designado Para). */
export interface PanelEntry { id: string; editionId: string; name: string; area: string; unit: string; createdAt: string }
/** Desistências de participação, com o número do processo SEI em que constam. A atuação vai até o último dia do mês do pedido. */
export interface Withdrawal { id: string; editionId: string; name: string; area: string; unit: string; sei: string; /** data do pedido de desistência (AAAA-MM-DD) */ requestDate?: string; magistrateIds?: string[]; /** nova inscrição deferida: a desistência vale só até esta data */ endedAt?: string; returnedMagistrateId?: string;
  /** Designações que o magistrado tinha ao desistir, uma por unidade (registros antigos não têm: usam area/unit) */
  designations?: { editionId: string; area: string; unit: string; workType?: string; startDate?: string }[]; createdAt: string }
/** Alteração de vinculação (troca de unidade): a vinculação antiga vale até o dia anterior à data informada; a nova, a partir dela. */
export interface Transfer { id: string; editionId: string; magistrateId: string; name: string; /** início da atuação na unidade anterior, se diferente do da edição */ fromStartDate?: string; /** área de atuação anterior */ area: string; /** nova área de atuação (ausente em registros antigos: a área não mudou) */ toArea?: string; /** processo SEI da alteração (opcional) */ sei?: string; fromUnit: string; toUnit: string; fromWorkType: string; toWorkType: string; effectiveDate: string; createdAt: string }
export type Parsed<T> = { error: string } | { value: T };
/** Escopo das consultas da administração: uma janela de inscrição (?edition=id) ou todas (?edition=all). */
export interface Scope { all: boolean; edition?: Edition; title: string; has: (x: { editionId: string }) => boolean }
export type RegistrationState = 'open' | 'not_yet' | 'ended' | 'paused' | 'closed';
/** Uma designação vigente: vinculação real de qualquer edição. Vale até que seja registrada a desistência. */
export interface PanelRow { id: string; editionId: string; editionTitle: string; magistrateId: string; unitId: string; name: string; area: string; unit: string; comarca?: string; separator?: string; workType?: string; startDate?: string; /** início efetivo da atuação: o da vinculação ou, sem ele, o da edição */ since?: string; note?: string; postit?: string; postitUpdatedAt?: string; firstPreference?: string; secondPreference?: string; /** qual preferência do magistrado a designação atende (0 = nenhuma) */ preference?: 0 | 1 | 2 }
/**
 * Histórico de atuação: um período por magistrado e unidade, com início e fim.
 * - em curso: as designações vigentes (início = o da vinculação ou o da edição);
 * - encerrados por alteração de vara/área (até a véspera da nova vigência), por desistência
 *   (até o último dia do mês do pedido) ou por exclusão (até a data da exclusão).
 * Registros antigos sem data de início própria usam a vigência da alteração que levou o magistrado à unidade ou o início da edição.
 */
export interface ActingPeriod { id: string; name: string; editionId: string; editionTitle: string; area: string; unit: string; workType: string; start?: string; end?: string; endReason: '' | 'Alteração de vinculação' | 'Desistência' | 'Exclusão'; sei?: string; /** comarca pela lista oficial (designações vigentes) */ comarca?: string }
/** Mesma pessoa: mesmo nome (sem acento, caixa e tratamentos) ou mesmo e-mail informado */
export type Person = { key: string; email: string };
