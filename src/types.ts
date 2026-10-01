export type MagistrateStatus = 'Aguardando Conferência' | 'Aprovado' | 'Lista de Espera' | 'Atribuído';

export type SupportNeeded = 'Audiência' | 'Sentença' | 'Audiência e Sentença';
export const SUPPORT_OPTIONS: SupportNeeded[] = ['Audiência', 'Sentença', 'Audiência e Sentença'];

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
  createdAt: string;
  status: MagistrateStatus;
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
  editionTitle?: string;
}

export interface Match {
  id: string;
  editionId: string;
  magistrateId: string;
  unitId: string;
  assignedArea: string;
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
}

export const PREFERENCE_AREAS = [
  'Cível e Fazenda Pública',
  'Crime',
  'Família e Infância',
  'Juizado Cível, Crime e Fazenda Pública',
];
