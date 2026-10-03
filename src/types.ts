export type MagistrateStatus = 'Aguardando Conferência' | 'Aprovado' | 'Lista de Espera' | 'Atribuído' | 'Rejeitado' | 'Desistente';

export type SupportNeeded = 'Audiência' | 'Sentença' | 'Audiência e Sentença';
export const SUPPORT_OPTIONS: SupportNeeded[] = ['Audiência', 'Sentença', 'Audiência e Sentença'];

export type UnitSelection = 'Em análise' | 'Escolhida' | 'Rejeitada';
export type WorkType = 'Audiência' | 'Sentença' | 'Audiência e Sentença';
export const WORK_TYPES: WorkType[] = ['Audiência', 'Sentença', 'Audiência e Sentença'];

export interface EditionStats {
  magistrates: number;
  units: number;
  matches: number;
  waiting: number;
  pendingUnits: number;
}

export interface Edition {
  id: string;
  title: string;
  description: string;
  openingDate: string;
  closingDate: string;
  isRegistrationOpen: boolean;
  status: 'Em andamento' | 'Encerrada';
  createdAt: string;
  isActive: boolean;
  isInitial?: boolean;
  /** Situação real das inscrições (servidor): chave manual + janela de datas em horário de Brasília */
  registration?: { state: 'open' | 'not_yet' | 'ended' | 'paused' | 'closed'; message: string };
  stats?: EditionStats;
}

export interface Magistrate {
  id: string;
  editionId: string;
  name: string;
  email: string;
  currentLocation: string;
  firstPreference: string;
  secondPreference: string;
  acceptsHearings: boolean;
  registeredIp?: string;
  declaration?: boolean;
  rejectionReason?: string;
  rejectedAt?: string;
  createdAt: string;
  status: MagistrateStatus;
  /** Já desistiu antes (mesmo nome): indicação para análise do pedido de nova inscrição */
  priorWithdrawal?: { sei: string; requestDate?: string };
  editionTitle?: string;
  match?: (Match & { unit?: Unit | null }) | null;
}

export interface Unit {
  id: string;
  editionId: string;
  unitName: string;
  judgeName: string;
  email: string;
  comarca: string;
  areas: string[];
  supportNeeded: SupportNeeded;
  description: string;
  registeredIp?: string;
  createdAt: string;
  status: string;
  selection: UnitSelection;
  slots: number;
  rejectionReason?: string;
  rejectedAt?: string;
  editionTitle?: string;
}

export interface Match {
  id: string;
  editionId: string;
  magistrateId: string;
  unitId: string;
  assignedArea: string;
  workType: WorkType;
  exceptionReason?: string;
  status: string;
  createdAt: string;
}

export interface LogEntry {
  id: string;
  editionId: string | null;
  timestamp: string;
  actor: 'Administração' | 'Público' | 'Sistema';
  category: string;
  description: string;
  ip?: string;
}

export const PREFERENCE_AREAS = [
  'Cível e Fazenda Pública',
  'Crime',
  'Família e Infância',
  'Juizado Cível, Crime e Fazenda Pública',
];

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  order?: number;
  published?: boolean;
  updatedAt?: string;
}

export interface PanelRow { id: string; editionId: string; editionTitle: string; magistrateId: string; name: string; area: string; unit: string; comarca?: string; workType?: string }
export interface Withdrawal { id: string; editionId: string; name: string; area: string; unit: string; sei: string; requestDate?: string; endedAt?: string; createdAt: string }
