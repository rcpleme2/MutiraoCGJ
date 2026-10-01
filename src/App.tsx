import React, { useState, useEffect } from 'react';
import {
  Scale,
  UserCheck,
  Building2,
  ShieldCheck,
  FileSpreadsheet,
  Calendar,
  CheckCircle2,
  Trash2,
  Link as LinkIcon,
  Sparkles,
  Lock,
  Unlock,
  AlertCircle,
  ArrowRight,
  Clock,
  Search,
  Check,
  Plus,
  X,
  FileDown,
  Edit2
} from 'lucide-react';

interface Settings {
  title: string;
  openingDate: string;
  closingDate: string;
  adminPassword: string;
  isRegistrationOpen: boolean;
  description: string;
}

interface Magistrate {
  id: string;
  name: string;
  email: string;
  currentLocation: string;
  firstPreference: string;
  secondPreference: string;
  createdAt: string;
  status: 'Aguardando Conferência' | 'Aprovado' | 'Lista de Espera' | 'Atribuído';
  match?: Match | null;
}

interface Unit {
  id: string;
  unitName: string;
  judgeName: string;
  email: string;
  comarca: string;
  areas: string[];
  description: string;
  createdAt: string;
  status: string;
}

interface Match {
  id: string;
  magistrateId: string;
  unitId: string;
  assignedArea: string;
  status: string;
  createdAt: string;
  unit?: Unit | null;
}

const PREFERENCE_AREAS = [
  'Cível e Fazenda Pública',
  'Crime',
  'Família e Infância',
  'Juizado Cível, Crime e Fazenda Pública',
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'magistrate' | 'unit' | 'status' | 'admin'>('home');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [magistrates, setMagistrates] = useState<Magistrate[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [waitingList, setWaitingList] = useState<Magistrate[]>([]);

  // Status Check state
  const [consultEmail, setConsultEmail] = useState('');
  const [consultResult, setConsultResult] = useState<{ magistrates: Magistrate[]; units: Unit[] } | null>(null);
  const [consultLoading, setConsultLoading] = useState(false);
  const [consultError, setConsultError] = useState('');

  // Admin state
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminSubTab, setAdminSubTab] = useState<'overview' | 'magistrates' | 'units' | 'matches' | 'waiting' | 'settings'>('overview');

  // Manual creation & editing modals in admin
  const [showAddMagModal, setShowAddMagModal] = useState(false);
  const [showAddUnitModal, setShowAddUnitModal] = useState(false);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);

  // Manual Match Form state
  const [matchForm, setMatchForm] = useState({
    magistrateId: '',
    unitId: '',
    assignedArea: PREFERENCE_AREAS[0],
  });

  // Manual Magistrate Form state
  const [manualMag, setManualMag] = useState({
    name: '',
    email: '',
    currentLocation: '',
    firstPreference: PREFERENCE_AREAS[0],
    secondPreference: PREFERENCE_AREAS[1],
    status: 'Aprovado' as any,
  });

  // Manual Unit Form state
  const [manualUnit, setManualUnit] = useState({
    unitName: '',
    judgeName: '',
    email: '',
    comarca: '',
    areas: [PREFERENCE_AREAS[0]],
    description: '',
  });

  // Magistrate Form state
  const [magForm, setMagForm] = useState({
    name: '',
    email: '',
    currentLocation: '',
    firstPreference: PREFERENCE_AREAS[0],
    secondPreference: PREFERENCE_AREAS[1],
  });
  const [magSuccess, setMagSuccess] = useState(false);
  const [magError, setMagError] = useState('');
  const [isSubmittingMag, setIsSubmittingMag] = useState(false);

  // Unit Form state
  const [unitForm, setUnitForm] = useState({
    unitName: '',
    judgeName: '',
    email: '',
    comarca: '',
    areas: [PREFERENCE_AREAS[0]],
    description: '',
  });
  const [unitSuccess, setUnitSuccess] = useState(false);
  const [unitError, setUnitError] = useState('');
  const [isSubmittingUnit, setIsSubmittingUnit] = useState(false);

  // AI Recommendations state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRecommendations, setAiRecommendations] = useState<any[]>([]);

  // Settings Edit state
  const [settingsForm, setSettingsForm] = useState<Settings | null>(null);
  const [settingsSavedMessage, setSettingsSavedMessage] = useState(false);

  // Load all data
  const loadData = async () => {
    try {
      const [setRes, magRes, unitRes, matchRes, waitRes] = await Promise.all([
        fetch('/api/settings').then(r => r.json()),
        fetch('/api/magistrates').then(r => r.json()),
        fetch('/api/units').then(r => r.json()),
        fetch('/api/matches').then(r => r.json()),
        fetch('/api/waiting-list').then(r => r.json()),
      ]);
      setSettings(setRes);
      setSettingsForm(setRes);
      setMagistrates(magRes);
      setUnits(unitRes);
      setMatches(matchRes);
      setWaitingList(waitRes);
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Handle Dual Status Consultation
  const handleConsultStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    setConsultError('');
    setConsultResult(null);
    setConsultLoading(true);

    try {
      const res = await fetch(`/api/status?email=${encodeURIComponent(consultEmail)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Nenhum cadastro encontrado.');
      setConsultResult(data);
    } catch (err: any) {
      setConsultError(err.message);
    } finally {
      setConsultLoading(false);
    }
  };

  // Handle Magistrate Approval by Admin
  const approveMagistrate = async (id: string) => {
    try {
      const res = await fetch(`/api/magistrates/${id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        loadData();
        alert('Magistrado aprovado com sucesso!');
      }
    } catch (err) {
      alert('Erro ao aprovar magistrado.');
    }
  };

  // Handle Manual Match Submit (Create or Update)
  const handleMatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingMatchId ? `/api/matches/${editingMatchId}` : '/api/matches';
      const method = editingMatchId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(matchForm),
      });
      const data = await res.json();
      if (res.ok) {
        setShowMatchModal(false);
        setEditingMatchId(null);
        setMatchForm({ magistrateId: '', unitId: '', assignedArea: PREFERENCE_AREAS[0] });
        loadData();
        alert(editingMatchId ? 'Vinculação alterada com sucesso!' : 'Vinculação manual realizada com sucesso!');
      } else {
        alert(data.error || 'Erro ao salvar vinculação.');
      }
    } catch (err) {
      alert('Erro ao salvar vinculação.');
    }
  };

  // Handle Magistrate Submission
  const handleMagSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMagError('');
    setIsSubmittingMag(true);

    try {
      const res = await fetch('/api/magistrates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(magForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao registrar magistrado.');

      setMagSuccess(true);
      setMagForm({
        name: '',
        email: '',
        currentLocation: '',
        firstPreference: PREFERENCE_AREAS[0],
        secondPreference: PREFERENCE_AREAS[1],
      });
      loadData();
    } catch (err: any) {
      setMagError(err.message);
    } finally {
      setIsSubmittingMag(false);
    }
  };

  // Handle Manual Magistrate Addition from Admin
  const handleManualMagSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/magistrates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualMag),
      });
      const data = await res.json();
      if (res.ok) {
        setShowAddMagModal(false);
        setManualMag({
          name: '',
          email: '',
          currentLocation: '',
          firstPreference: PREFERENCE_AREAS[0],
          secondPreference: PREFERENCE_AREAS[1],
          status: 'Aprovado',
        });
        loadData();
        alert('Magistrado incluído com sucesso!');
      } else {
        alert(data.error || 'Erro ao incluir magistrado.');
      }
    } catch (err) {
      alert('Erro ao incluir magistrado.');
    }
  };

  // Handle Manual Unit Addition from Admin
  const handleManualUnitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualUnit),
      });
      const data = await res.json();
      if (res.ok) {
        setShowAddUnitModal(false);
        setManualUnit({
          unitName: '',
          judgeName: '',
          email: '',
          comarca: '',
          areas: [PREFERENCE_AREAS[0]],
          description: '',
        });
        loadData();
        alert('Unidade incluída com sucesso!');
      } else {
        alert(data.error || 'Erro ao incluir unidade.');
      }
    } catch (err) {
      alert('Erro ao incluir unidade.');
    }
  };

  // Handle Unit Submission
  const handleUnitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnitError('');
    setIsSubmittingUnit(true);

    try {
      const res = await fetch('/api/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(unitForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao registrar unidade.');

      setUnitSuccess(true);
      setUnitForm({
        unitName: '',
        judgeName: '',
        email: '',
        comarca: '',
        areas: [PREFERENCE_AREAS[0]],
        description: '',
      });
      loadData();
    } catch (err: any) {
      setUnitError(err.message);
    } finally {
      setIsSubmittingUnit(false);
    }
  };

  // Admin Login
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPasswordInput }),
      });
      const data = await res.json();
      if (data.success) {
        setIsAdminAuthenticated(true);
      } else {
        alert('Senha incorreta.');
      }
    } catch (err) {
      alert('Erro ao autenticar.');
    }
  };

  // Run Auto-Matching
  const runAutoMatching = async () => {
    try {
      const res = await fetch('/api/matches/auto', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert(`${data.newMatchesCount} nova(s) vinculação(ões) automática(s) realizada(s) com sucesso!`);
        loadData();
      }
    } catch (err) {
      alert('Erro ao executar vinculação automática.');
    }
  };

  // Fetch AI Recommendations
  const fetchAiRecommendations = async () => {
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/match-recommendations', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setAiRecommendations(data.recommendations || []);
      }
    } catch (err) {
      alert('Erro ao gerar recomendações com IA.');
    } finally {
      setAiLoading(false);
    }
  };

  // Delete records with detailed logs
  const deleteRecord = async (endpoint: string, id: string) => {
    console.log('[CLIENT] deleteRecord triggered:', endpoint, id);
    try {
      const res = await fetch(`/api/${endpoint}/${id}`, { method: 'DELETE' });
      const data = await res.json();
      console.log('[CLIENT] delete response:', res.status, data);
      if (res.ok && data.success) {
        if (endpoint === 'magistrates') {
          setMagistrates(prev => prev.filter(m => m.id !== id));
          setWaitingList(prev => prev.filter(m => m.id !== id));
        } else if (endpoint === 'units') {
          setUnits(prev => prev.filter(u => u.id !== id));
        } else if (endpoint === 'matches') {
          setMatches(prev => prev.filter(mt => mt.id !== id));
        }
        loadData();
      } else {
        alert(data.error || 'Erro ao excluir registro.');
      }
    } catch (err) {
      console.error('[CLIENT] deleteRecord error:', err);
      alert('Erro de rede ao excluir registro.');
    }
  };

  // Save Settings
  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsForm) return;
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm),
      });
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
        setSettingsSavedMessage(true);
        setTimeout(() => setSettingsSavedMessage(false), 3000);
      }
    } catch (err) {
      alert('Erro ao salvar configurações.');
    }
  };

  if (!settings) {
    return (
      <div className="min-h-screen bg-[#0b2545] flex items-center justify-center text-slate-100">
        <div className="flex items-center space-x-3">
          <div className="w-6 h-6 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin"></div>
          <span className="font-medium tracking-wide">Carregando Sistema de Mutirões...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b2545] text-slate-100 flex flex-col font-sans selection:bg-[#d4af37] selection:text-slate-950">
      {/* Header institucional TJPR */}
      <header className="bg-[#071930] border-b border-[#1b3a60] sticky top-0 z-50 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-4 cursor-pointer" onClick={() => setActiveTab('home')}>
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#133b5c] to-[#071930] flex items-center justify-center border border-[#d4af37]/40 shadow-inner">
              <Scale className="w-6 h-6 text-[#d4af37]" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white font-serif">{settings.title}</h1>
            </div>
          </div>

          <nav className="hidden md:flex items-center space-x-1">
            <button
              onClick={() => setActiveTab('home')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'home' ? 'bg-[#1b3a60] text-[#d4af37] border border-[#d4af37]/30' : 'text-slate-300 hover:bg-[#133b5c]/60'
              }`}
            >
              Início
            </button>
            <button
              onClick={() => setActiveTab('magistrate')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'magistrate' ? 'bg-[#1b3a60] text-[#d4af37] border border-[#d4af37]/30' : 'text-slate-300 hover:bg-[#133b5c]/60'
              }`}
            >
              Inscrição Magistrados
            </button>
            <button
              onClick={() => setActiveTab('unit')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'unit' ? 'bg-[#1b3a60] text-[#d4af37] border border-[#d4af37]/30' : 'text-slate-300 hover:bg-[#133b5c]/60'
              }`}
            >
              Inscrição Unidades
            </button>
            <button
              onClick={() => setActiveTab('status')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'status' ? 'bg-[#1b3a60] text-[#d4af37] border border-[#d4af37]/30' : 'text-slate-300 hover:bg-[#133b5c]/60'
              }`}
            >
              Consultar Status
            </button>
            <button
              onClick={() => setActiveTab('admin')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center space-x-1.5 ${
                activeTab === 'admin' ? 'bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/40' : 'text-[#d4af37]/90 hover:bg-[#133b5c]/60'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Área Administrativa</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {activeTab === 'home' && (
          <div className="space-y-12 max-w-4xl mx-auto">
            {/* Hero Section */}
            <div className="relative rounded-2xl bg-gradient-to-r from-[#133b5c] via-[#0f304f] to-[#0b2545] border border-[#234870] p-8 sm:p-14 shadow-2xl overflow-hidden">
              <div className="absolute right-0 top-0 w-96 h-96 bg-[#d4af37]/10 rounded-full blur-3xl pointer-events-none"></div>
              <div className="relative z-10 text-center sm:text-left">
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#d4af37]/15 border border-[#d4af37]/35 text-[#d4af37] text-xs font-semibold mb-6">
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    {settings.isRegistrationOpen ? 'Inscrições Abertas' : 'Inscrições Encerradas'} • Prazo até{' '}
                    {new Date(settings.closingDate).toLocaleDateString('pt-BR')}
                  </span>
                </div>
                <h2 className="text-3xl sm:text-5xl font-serif font-bold text-white mb-6 tracking-tight">
                  {settings.title}
                </h2>
                <p className="text-slate-300 text-base sm:text-lg mb-10 leading-relaxed max-w-2xl">
                  {settings.description}
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center sm:justify-start">
                  <button
                    onClick={() => setActiveTab('magistrate')}
                    className="px-8 py-4 rounded-xl bg-[#d4af37] hover:bg-[#c29d2f] text-slate-950 font-bold shadow-lg shadow-[#d4af37]/20 transition-all flex items-center justify-center space-x-2"
                  >
                    <UserCheck className="w-5 h-5" />
                    <span>Cadastrar Magistrado Voluntário</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setActiveTab('unit')}
                    className="px-8 py-4 rounded-xl bg-[#1b3a60] hover:bg-[#234870] border border-[#2f5582] text-white font-medium transition-all flex items-center justify-center space-x-2"
                  >
                    <Building2 className="w-5 h-5 text-[#d4af37]" />
                    <span>Inscrever Unidade Judicial</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('status')}
                    className="px-8 py-4 rounded-xl bg-[#071930] hover:bg-[#133b5c] border border-[#1b3a60] text-slate-200 font-medium transition-all flex items-center justify-center space-x-2"
                  >
                    <Search className="w-5 h-5 text-[#d4af37]" />
                    <span>Consultar Status</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'magistrate' && (
          <div className="max-w-2xl mx-auto bg-[#0f304f] border border-[#1b3a60] rounded-2xl p-8 sm:p-10 shadow-xl">
            <div className="mb-8">
              <div className="w-12 h-12 rounded-xl bg-[#1b3a60] text-[#d4af37] flex items-center justify-center mb-4 border border-[#d4af37]/30">
                <UserCheck className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-serif font-bold text-white">Inscrição de Magistrado Voluntário</h2>
              <p className="text-slate-300 text-sm mt-1">
                Preencha seus dados institucionais e indique suas duas áreas de preferência em ordem de prioridade.
              </p>
            </div>

            {magSuccess && (
              <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center space-x-3">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <div className="text-sm">
                  <strong>Inscrição realizada com sucesso!</strong> Seu status inicial é <em>Aguardando Conferência</em>. Você pode acompanhá-lo na aba "Consultar Status".
                </div>
              </div>
            )}

            {magError && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 flex items-center space-x-3">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <div className="text-sm">{magError}</div>
              </div>
            )}

            <form onSubmit={handleMagSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Nome Completo do(a) Magistrado(a)</label>
                <input
                  type="text"
                  required
                  value={magForm.name}
                  onChange={e => setMagForm({ ...magForm, name: e.target.value })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">E-mail Institucional</label>
                <input
                  type="email"
                  required
                  value={magForm.email}
                  onChange={e => setMagForm({ ...magForm, email: e.target.value })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Lotação Atual (Vara / Comarca)</label>
                <input
                  type="text"
                  required
                  value={magForm.currentLocation}
                  onChange={e => setMagForm({ ...magForm, currentLocation: e.target.value })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                />
              </div>

              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-[#071930] border border-[#1b3a60] text-xs text-slate-300 leading-relaxed">
                  <strong>Aviso:</strong> A preferência indicada será atendida na medida do possível, considerando a disponibilidade de unidades e o interesse público, não sendo possível garantir que esta opção será efetivamente atendida.
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">1ª Escolha (Área de Preferência)</label>
                    <select
                      value={magForm.firstPreference}
                      onChange={e => setMagForm({ ...magForm, firstPreference: e.target.value })}
                      className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                    >
                      {PREFERENCE_AREAS.map((area, i) => (
                        <option key={i} value={area}>
                          {area}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">2ª Escolha (Área de Preferência)</label>
                    <select
                      value={magForm.secondPreference}
                      onChange={e => setMagForm({ ...magForm, secondPreference: e.target.value })}
                      className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                    >
                      {PREFERENCE_AREAS.map((area, i) => (
                        <option key={i} value={area}>
                          {area}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmittingMag}
                className="w-full py-4 rounded-xl bg-[#d4af37] hover:bg-[#c29d2f] text-slate-950 font-bold shadow-lg transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                {isSubmittingMag ? (
                  <>
                    <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                    <span>Processando Inscrição...</span>
                  </>
                ) : (
                  <>
                    <UserCheck className="w-5 h-5" />
                    <span>Concluir Inscrição de Magistrado</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'unit' && (
          <div className="max-w-2xl mx-auto bg-[#0f304f] border border-[#1b3a60] rounded-2xl p-8 sm:p-10 shadow-xl">
            <div className="mb-8">
              <div className="w-12 h-12 rounded-xl bg-[#1b3a60] text-[#d4af37] flex items-center justify-center mb-4 border border-[#d4af37]/30">
                <Building2 className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-serif font-bold text-white">Inscrição de Unidade Judicial</h2>
              <p className="text-slate-300 text-sm mt-1">
                Cadastre a unidade para atendimento pelo mutirão, selecionando uma ou mais áreas e informando os detalhes.
              </p>
            </div>

            {unitSuccess && (
              <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center space-x-3">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <div className="text-sm">
                  <strong>Unidade cadastrada com sucesso!</strong> Sua unidade já está disponível para consulta e vinculação.
                </div>
              </div>
            )}

            {unitError && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 flex items-center space-x-3">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <div className="text-sm">{unitError}</div>
              </div>
            )}

            <form onSubmit={handleUnitSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Nome da Unidade Judicial (Vara / Juizado)</label>
                <input
                  type="text"
                  required
                  value={unitForm.unitName}
                  onChange={e => setUnitForm({ ...unitForm, unitName: e.target.value })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Juiz(a) Titular / Responsável</label>
                  <input
                    type="text"
                    required
                    value={unitForm.judgeName}
                    onChange={e => setUnitForm({ ...unitForm, judgeName: e.target.value })}
                    className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Comarca / Cidade</label>
                  <input
                    type="text"
                    required
                    value={unitForm.comarca}
                    onChange={e => setUnitForm({ ...unitForm, comarca: e.target.value })}
                    className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">E-mail Oficial da Unidade</label>
                <input
                  type="email"
                  required
                  value={unitForm.email}
                  onChange={e => setUnitForm({ ...unitForm, email: e.target.value })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Áreas a Serem Atendidas (Múltipla Escolha)</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                  {PREFERENCE_AREAS.map((area, i) => {
                    const isSelected = unitForm.areas.includes(area);
                    return (
                      <div
                        key={i}
                        onClick={() => {
                          const current = [...unitForm.areas];
                          if (isSelected) {
                            if (current.length === 1) return;
                            setUnitForm({ ...unitForm, areas: current.filter(a => a !== area) });
                          } else {
                            setUnitForm({ ...unitForm, areas: [...current, area] });
                          }
                        }}
                        className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center space-x-3 ${
                          isSelected ? 'bg-[#1b3a60] border-[#d4af37] text-white' : 'bg-[#071930] border-[#1b3a60] text-slate-400 hover:border-slate-600'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded flex items-center justify-center border ${isSelected ? 'bg-[#d4af37] border-[#d4af37] text-slate-950 font-bold' : 'border-[#1b3a60]'}`}>
                          {isSelected && <CheckCircle2 className="w-3 h-3 text-slate-950" />}
                        </div>
                        <span className="text-xs font-medium">{area}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Breve Justificativa / Detalhes da Demanda</label>
                <textarea
                  rows={3}
                  value={unitForm.description}
                  onChange={e => setUnitForm({ ...unitForm, description: e.target.value })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                ></textarea>
              </div>

              <button
                type="submit"
                disabled={isSubmittingUnit}
                className="w-full py-4 rounded-xl bg-[#1b3a60] hover:bg-[#234870] border border-[#2f5582] text-white font-medium shadow-lg transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                {isSubmittingUnit ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Cadastrando Unidade...</span>
                  </>
                ) : (
                  <>
                    <Building2 className="w-5 h-5 text-[#d4af37]" />
                    <span>Concluir Inscrição de Unidade Judicial</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'status' && (
          <div className="max-w-2xl mx-auto bg-[#0f304f] border border-[#1b3a60] rounded-2xl p-8 sm:p-10 shadow-xl">
            <div className="mb-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-[#1b3a60] text-[#d4af37] flex items-center justify-center mx-auto mb-4 border border-[#d4af37]/30">
                <Search className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-serif font-bold text-white">Consultar Status por E-mail</h2>
              <p className="text-slate-300 text-sm mt-1">
                Informe o seu e-mail para consultar tanto as inscrições de magistrado quanto as unidades judiciais vinculadas a este endereço.
              </p>
            </div>

            <form onSubmit={handleConsultStatus} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">E-mail Cadastrado</label>
                <div className="flex gap-3">
                  <input
                    type="email"
                    required
                    placeholder="seu.email@tjp.jus.br"
                    value={consultEmail}
                    onChange={e => setConsultEmail(e.target.value)}
                    className="flex-1 bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                  />
                  <button
                    type="submit"
                    disabled={consultLoading}
                    className="px-6 py-3 rounded-xl bg-[#d4af37] hover:bg-[#c29d2f] text-slate-950 font-bold transition-all disabled:opacity-50"
                  >
                    {consultLoading ? 'Buscando...' : 'Consultar'}
                  </button>
                </div>
              </div>
            </form>

            {consultError && (
              <div className="mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 flex items-center space-x-3">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <div className="text-sm">{consultError}</div>
              </div>
            )}

            {consultResult && (
              <div className="mt-8 space-y-6">
                {/* Magistrates found */}
                {consultResult.magistrates && consultResult.magistrates.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-[#d4af37] uppercase tracking-wider">Inscrições de Magistrado</h3>
                    {consultResult.magistrates.map(mag => (
                      <div key={mag.id} className="bg-[#071930] p-6 rounded-xl border border-[#1b3a60] space-y-4">
                        <div className="flex items-center justify-between border-b border-[#1b3a60] pb-3">
                          <div>
                            <h4 className="font-serif font-bold text-white text-base">{mag.name}</h4>
                            <p className="text-xs text-slate-400">{mag.currentLocation}</p>
                          </div>
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-semibold ${
                              mag.status === 'Atribuído'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                : mag.status === 'Aprovado' || mag.status === 'Lista de Espera'
                                ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/30'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {mag.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                          <div className="bg-[#0f304f] p-3 rounded-lg border border-[#1b3a60]">
                            <span className="text-slate-400 block mb-1">1ª Preferência</span>
                            <span className="font-semibold text-[#d4af37]">{mag.firstPreference}</span>
                          </div>
                          <div className="bg-[#0f304f] p-3 rounded-lg border border-[#1b3a60]">
                            <span className="text-slate-400 block mb-1">2ª Preferência</span>
                            <span className="font-semibold text-slate-300">{mag.secondPreference || 'Nenhuma'}</span>
                          </div>
                        </div>

                        {mag.match && (
                          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs space-y-1">
                            <div className="font-bold">Unidade Atribuída:</div>
                            <div>{mag.match.unit?.unitName} ({mag.match.unit?.comarca})</div>
                            <div className="text-slate-300">Área: {mag.match.assignedArea}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Units found */}
                {consultResult.units && consultResult.units.length > 0 && (
                  <div className="space-y-4 pt-4">
                    <h3 className="text-sm font-semibold text-[#d4af37] uppercase tracking-wider">Unidades Judiciais Cadastradas</h3>
                    {consultResult.units.map(unit => (
                      <div key={unit.id} className="bg-[#071930] p-6 rounded-xl border border-[#1b3a60] space-y-3">
                        <div className="flex items-center justify-between border-b border-[#1b3a60] pb-3">
                          <div>
                            <h4 className="font-serif font-bold text-white text-base">{unit.unitName}</h4>
                            <p className="text-xs text-slate-400">{unit.comarca} • Resp: {unit.judgeName}</p>
                          </div>
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-semibold ${
                              unit.status === 'Atendida' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                            }`}
                          >
                            {unit.status}
                          </span>
                        </div>
                        <div className="text-xs text-slate-300">
                          <strong>Áreas pretendidas:</strong> {unit.areas.join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'admin' && !isAdminAuthenticated && (
          <div className="max-w-md mx-auto bg-[#0f304f] border border-[#1b3a60] rounded-2xl p-8 sm:p-10 shadow-2xl mt-12">
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-2xl bg-[#d4af37]/15 text-[#d4af37] flex items-center justify-center mx-auto mb-4 border border-[#d4af37]/35">
                <Lock className="w-7 h-7" />
              </div>
              <h2 className="text-2xl font-serif font-bold text-white">Área Administrativa</h2>
              <p className="text-slate-300 text-sm mt-1">Acesso restrito à coordenação do mutirão.</p>
            </div>

            <form onSubmit={handleAdminLogin} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Senha de Acesso</label>
                <input
                  type="password"
                  required
                  value={adminPasswordInput}
                  onChange={e => setAdminPasswordInput(e.target.value)}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                />
              </div>

              <button
                type="submit"
                className="w-full py-4 rounded-xl bg-[#d4af37] hover:bg-[#c29d2f] text-slate-950 font-bold shadow-lg transition-all flex items-center justify-center space-x-2"
              >
                <Unlock className="w-5 h-5" />
                <span>Entrar no Painel</span>
              </button>
            </form>
          </div>
        )}

        {activeTab === 'admin' && isAdminAuthenticated && (
          <div className="space-y-8">
            {/* Admin Header & Sub-tabs */}
            <div className="bg-[#0f304f] border border-[#1b3a60] rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl">
              <div>
                <h2 className="text-2xl font-serif font-bold text-white flex items-center space-x-2">
                  <ShieldCheck className="w-6 h-6 text-[#d4af37]" />
                  <span>Painel de Gestão Administrativa</span>
                </h2>
                <p className="text-slate-300 text-sm mt-1">Gerencie prazos, inscrições, validações, alocações e exportação de dados.</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <a
                  href="/api/export/csv?type=all"
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium flex items-center space-x-2 shadow-md transition-all"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Exportar Consolidado (CSV)</span>
                </a>
                <button
                  onClick={() => setIsAdminAuthenticated(false)}
                  className="px-4 py-2.5 rounded-xl bg-[#1b3a60] hover:bg-[#234870] text-slate-200 text-sm font-medium flex items-center space-x-2 transition-all"
                >
                  <Lock className="w-4 h-4" />
                  <span>Sair</span>
                </button>
              </div>
            </div>

            {/* Sub-navigation */}
            <div className="flex space-x-2 border-b border-[#1b3a60] pb-2 overflow-x-auto">
              {[
                { id: 'overview', label: 'Visão Geral' },
                { id: 'magistrates', label: `Magistrados (${magistrates.length})` },
                { id: 'units', label: `Unidades (${units.length})` },
                { id: 'matches', label: `Vinculações (${matches.length})` },
                { id: 'waiting', label: `Lista de Espera (${waitingList.length})` },
                { id: 'settings', label: 'Configurações e Prazos' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setAdminSubTab(tab.id as any)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                    adminSubTab === tab.id ? 'bg-[#1b3a60] text-[#d4af37] border border-[#d4af37]/40' : 'text-slate-300 hover:bg-[#133b5c] hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Sub-tab: Overview */}
            {adminSubTab === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-[#0f304f] border border-[#1b3a60] rounded-xl p-6 shadow-md">
                    <h4 className="text-sm font-medium text-slate-300 mb-2">Status das Inscrições</h4>
                    <div className="text-2xl font-bold text-white mb-2">
                      {settings.isRegistrationOpen ? (
                        <span className="text-emerald-400 flex items-center space-x-2">
                          <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse"></span>
                          <span>Abertas</span>
                        </span>
                      ) : (
                        <span className="text-red-400">Encerradas</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">Encerramento em: {new Date(settings.closingDate).toLocaleString('pt-BR')}</p>
                  </div>

                  <div className="bg-[#0f304f] border border-[#1b3a60] rounded-xl p-6 shadow-md">
                    <h4 className="text-sm font-medium text-slate-300 mb-2">Alocação Automática</h4>
                    <p className="text-xs text-slate-400 mb-4">Vincule automaticamente magistrados aprovados priorizando 1ª e 2ª preferência.</p>
                    <button
                      onClick={runAutoMatching}
                      className="px-4 py-2.5 rounded-lg bg-[#d4af37] hover:bg-[#c29d2f] text-slate-950 text-xs font-bold flex items-center space-x-2 transition-all shadow"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>Executar Vinculação Automática</span>
                    </button>
                  </div>

                  <div className="bg-[#0f304f] border border-[#1b3a60] rounded-xl p-6 shadow-md">
                    <h4 className="text-sm font-medium text-slate-300 mb-2">Recomendação Inteligente (IA)</h4>
                    <p className="text-xs text-slate-400 mb-4">Utilize inteligência artificial para sugerir alocações estratégicas.</p>
                    <button
                      onClick={fetchAiRecommendations}
                      disabled={aiLoading}
                      className="px-4 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center space-x-2 transition-all disabled:opacity-50"
                    >
                      {aiLoading ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      <span>Gerar Recomendações com IA</span>
                    </button>
                  </div>
                </div>

                {aiRecommendations.length > 0 && (
                  <div className="bg-purple-950/40 border border-purple-500/30 rounded-xl p-6 shadow-xl">
                    <h4 className="text-lg font-serif font-bold text-purple-300 mb-4 flex items-center space-x-2">
                      <Sparkles className="w-5 h-5" />
                      <span>Sugestões da IA para Alocação</span>
                    </h4>
                    <div className="space-y-4">
                      {aiRecommendations.map((rec, idx) => {
                        const mag = magistrates.find(m => m.id === rec.magistrateId || m.name.includes(rec.magistrateName));
                        const unit = units.find(u => u.id === rec.unitId || u.unitName.includes(rec.unitName));
                        return (
                          <div key={idx} className="p-4 rounded-lg bg-[#071930] border border-purple-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div>
                              <div className="text-sm font-semibold text-white">
                                {rec.magistrateName || mag?.name || 'Magistrado'} → {rec.unitName || unit?.unitName || 'Unidade'}
                              </div>
                              <div className="text-xs text-purple-300 mt-1">Área: {rec.assignedArea}</div>
                              <p className="text-xs text-slate-400 mt-2">{rec.justification}</p>
                            </div>
                            {mag && unit && (
                              <button
                                onClick={async () => {
                                  await fetch('/api/matches', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ magistrateId: mag.id, unitId: unit.id, assignedArea: rec.assignedArea }),
                                  });
                                  loadData();
                                  alert('Vinculação efetivada!');
                                }}
                                className="px-3 py-2 rounded-lg bg-[#1b3a60] hover:bg-[#234870] text-[#d4af37] border border-[#d4af37]/40 text-xs font-medium shrink-0"
                              >
                                Efetivar Vinculação
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Sub-tab: Magistrates */}
            {adminSubTab === 'magistrates' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center bg-[#0f304f] border border-[#1b3a60] p-4 rounded-xl shadow-md">
                  <h3 className="font-serif font-bold text-white text-lg">Magistrados Voluntários</h3>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setShowAddMagModal(true)}
                      className="px-4 py-2 rounded-lg bg-[#d4af37] hover:bg-[#c29d2f] text-slate-950 font-bold text-xs flex items-center space-x-1.5 transition-all shadow"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Cadastrar Magistrado Manualmente</span>
                    </button>
                    <a
                      href="/api/export/csv?type=magistrates"
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 rounded-lg bg-[#1b3a60] hover:bg-[#234870] text-slate-200 text-xs font-medium flex items-center space-x-1.5"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Exportar CSV</span>
                    </a>
                  </div>
                </div>

                <div className="bg-[#0f304f] border border-[#1b3a60] rounded-xl overflow-hidden shadow-xl">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-[#071930] text-slate-400 border-b border-[#1b3a60] text-xs uppercase tracking-wider">
                          <th className="p-4">Magistrado(a)</th>
                          <th className="p-4">Lotação Atual</th>
                          <th className="p-4">Preferências</th>
                          <th className="p-4">Status</th>
                          <th className="p-4 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1b3a60]">
                        {magistrates.map(m => (
                          <tr key={m.id} className="hover:bg-[#133b5c]/40">
                            <td className="p-4">
                              <div className="font-medium text-white">{m.name}</div>
                              <div className="text-xs text-slate-400">{m.email}</div>
                            </td>
                            <td className="p-4 text-slate-300">{m.currentLocation}</td>
                            <td className="p-4">
                              <div className="text-[#d4af37] text-xs font-semibold">1ª: {m.firstPreference}</div>
                              <div className="text-slate-400 text-xs">2ª: {m.secondPreference || 'Nenhuma'}</div>
                            </td>
                            <td className="p-4">
                              <span
                                className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                                  m.status === 'Atribuído'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                    : m.status === 'Aprovado' || m.status === 'Lista de Espera'
                                    ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/30'
                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                }`}
                              >
                                {m.status}
                              </span>
                            </td>
                            <td className="p-4 text-right space-x-2">
                              {m.status === 'Aguardando Conferência' && (
                                <button
                                  onClick={() => approveMagistrate(m.id)}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-all inline-flex items-center space-x-1"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Aprovar</span>
                                </button>
                              )}
                              <button
                                onClick={() => deleteRecord('magistrates', m.id)}
                                className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all inline-block cursor-pointer"
                                title="Excluir magistrado"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Sub-tab: Units */}
            {adminSubTab === 'units' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center bg-[#0f304f] border border-[#1b3a60] p-4 rounded-xl shadow-md">
                  <h3 className="font-serif font-bold text-white text-lg">Unidades Judiciais</h3>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setShowAddUnitModal(true)}
                      className="px-4 py-2 rounded-lg bg-[#d4af37] hover:bg-[#c29d2f] text-slate-950 font-bold text-xs flex items-center space-x-1.5 transition-all shadow"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Cadastrar Unidade Manualmente</span>
                    </button>
                    <a
                      href="/api/export/csv?type=units"
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 rounded-lg bg-[#1b3a60] hover:bg-[#234870] text-slate-200 text-xs font-medium flex items-center space-x-1.5"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Exportar CSV</span>
                    </a>
                  </div>
                </div>

                <div className="bg-[#0f304f] border border-[#1b3a60] rounded-xl overflow-hidden shadow-xl">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-[#071930] text-slate-400 border-b border-[#1b3a60] text-xs uppercase tracking-wider">
                          <th className="p-4">Unidade / Comarca</th>
                          <th className="p-4">Juiz(a) Responsável</th>
                          <th className="p-4">Áreas Pretendidas</th>
                          <th className="p-4">Status</th>
                          <th className="p-4 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1b3a60]">
                        {units.map(u => (
                          <tr key={u.id} className="hover:bg-[#133b5c]/40">
                            <td className="p-4">
                              <div className="font-medium text-white">{u.unitName}</div>
                              <div className="text-xs text-slate-400">{u.comarca} • {u.email}</div>
                            </td>
                            <td className="p-4 text-slate-300">{u.judgeName}</td>
                            <td className="p-4">
                              <div className="flex flex-wrap gap-1">
                                {u.areas.map((a, i) => (
                                  <span key={i} className="px-2 py-0.5 rounded-full bg-[#1b3a60] text-[#d4af37] border border-[#d4af37]/30 text-xs">
                                    {a}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="p-4">
                              <span
                                className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                                  u.status === 'Atendida' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                                }`}
                              >
                                {u.status}
                              </span>
                            </td>
                            <td className="p-4 text-right">
                              <button
                                onClick={() => deleteRecord('units', u.id)}
                                className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all cursor-pointer"
                                title="Excluir unidade"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Sub-tab: Matches */}
            {adminSubTab === 'matches' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center bg-[#0f304f] border border-[#1b3a60] p-4 rounded-xl shadow-md">
                  <h3 className="font-serif font-bold text-white text-lg">Vinculações (Magistrados x Unidades)</h3>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => {
                        setEditingMatchId(null);
                        setMatchForm({ magistrateId: '', unitId: '', assignedArea: PREFERENCE_AREAS[0] });
                        setShowMatchModal(true);
                      }}
                      className="px-4 py-2 rounded-lg bg-[#d4af37] hover:bg-[#c29d2f] text-slate-950 font-bold text-xs flex items-center space-x-1.5 transition-all shadow"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Nova Vinculação Manual</span>
                    </button>
                    <a
                      href="/api/export/xlsx/matches"
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center space-x-1.5 shadow-md"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      <span>Exportar XSLX (Nome, Área, Unidade)</span>
                    </a>
                  </div>
                </div>

                <div className="bg-[#0f304f] border border-[#1b3a60] rounded-xl overflow-hidden shadow-xl">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-[#071930] text-slate-400 border-b border-[#1b3a60] text-xs uppercase tracking-wider">
                          <th className="p-4">Magistrado Voluntário</th>
                          <th className="p-4">Unidade Judicial Alocada</th>
                          <th className="p-4">Área Atribuída</th>
                          <th className="p-4 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1b3a60]">
                        {matches.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="p-8 text-center text-slate-400">
                              Nenhuma vinculação realizada até o momento. Utilize a vinculação automática, IA ou manual.
                            </td>
                          </tr>
                        ) : (
                          matches.map(mt => {
                            const mag = magistrates.find(m => m.id === mt.magistrateId);
                            const unit = units.find(u => u.id === mt.unitId);
                            return (
                              <tr key={mt.id} className="hover:bg-[#133b5c]/40">
                                <td className="p-4">
                                  <div className="font-medium text-white">{mag?.name || 'Magistrado Removido'}</div>
                                  <div className="text-xs text-slate-400">{mag?.email}</div>
                                </td>
                                <td className="p-4">
                                  <div className="font-medium text-white">{unit?.unitName || 'Unidade Removida'}</div>
                                  <div className="text-xs text-slate-400">{unit?.comarca}</div>
                                </td>
                                <td className="p-4 text-[#d4af37] font-medium">{mt.assignedArea}</td>
                                <td className="p-4 text-right space-x-2">
                                  <button
                                    onClick={() => {
                                      setEditingMatchId(mt.id);
                                      setMatchForm({
                                        magistrateId: mt.magistrateId,
                                        unitId: mt.unitId,
                                        assignedArea: mt.assignedArea,
                                      });
                                      setShowMatchModal(true);
                                    }}
                                    className="p-2 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 transition-all inline-block cursor-pointer"
                                    title="Alterar vinculação"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => deleteRecord('matches', mt.id)}
                                    className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all inline-block cursor-pointer"
                                    title="Excluir vinculação"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Sub-tab: Waiting List */}
            {adminSubTab === 'waiting' && (
              <div className="bg-[#0f304f] border border-[#1b3a60] rounded-xl overflow-hidden shadow-xl">
                <div className="p-4 border-b border-[#1b3a60]">
                  <h3 className="font-serif font-bold text-white">Magistrados em Lista de Espera de Atribuição</h3>
                  <p className="text-xs text-slate-400 mt-1">Magistrados aprovados cuja 1ª e 2ª preferências ainda não foram atendidas pelas unidades disponíveis.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-[#071930] text-slate-400 border-b border-[#1b3a60] text-xs uppercase tracking-wider">
                        <th className="p-4">Magistrado(a)</th>
                        <th className="p-4">Lotação Atual</th>
                        <th className="p-4">1ª Preferência</th>
                        <th className="p-4">2ª Preferência</th>
                        <th className="p-4">Data Inscrição</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1b3a60]">
                      {waitingList.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-slate-400">
                            Nenhum magistrado na lista de espera.
                          </td>
                        </tr>
                      ) : (
                        waitingList.map(m => (
                          <tr key={m.id} className="hover:bg-[#133b5c]/40">
                            <td className="p-4">
                              <div className="font-medium text-white">{m.name}</div>
                              <div className="text-xs text-slate-400">{m.email}</div>
                            </td>
                            <td className="p-4 text-slate-300">{m.currentLocation}</td>
                            <td className="p-4 text-[#d4af37] font-medium">{m.firstPreference}</td>
                            <td className="p-4 text-slate-300">{m.secondPreference || 'Nenhuma'}</td>
                            <td className="p-4 text-slate-400 text-xs">{new Date(m.createdAt).toLocaleString('pt-BR')}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Sub-tab: Settings */}
            {adminSubTab === 'settings' && settingsForm && (
              <div className="max-w-xl mx-auto bg-[#0f304f] border border-[#1b3a60] rounded-xl p-8 shadow-xl">
                <h3 className="text-xl font-serif font-bold text-white mb-6">Configurações Gerais e Prazos</h3>

                {settingsSavedMessage && (
                  <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center space-x-3">
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <span className="text-sm">Configurações salvas com sucesso!</span>
                  </div>
                )}

                <form onSubmit={saveSettings} className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Título do Mutirão</label>
                    <input
                      type="text"
                      value={settingsForm.title}
                      onChange={e => setSettingsForm({ ...settingsForm, title: e.target.value })}
                      className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Descrição / Resumo</label>
                    <textarea
                      rows={3}
                      value={settingsForm.description}
                      onChange={e => setSettingsForm({ ...settingsForm, description: e.target.value })}
                      className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                    ></textarea>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Data/Hora de Abertura</label>
                      <input
                        type="datetime-local"
                        value={settingsForm.openingDate.slice(0, 16)}
                        onChange={e => setSettingsForm({ ...settingsForm, openingDate: e.target.value })}
                        className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Data/Hora de Encerramento</label>
                      <input
                        type="datetime-local"
                        value={settingsForm.closingDate.slice(0, 16)}
                        onChange={e => setSettingsForm({ ...settingsForm, closingDate: e.target.value })}
                        className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Nova Senha Administrativa</label>
                    <input
                      type="password"
                      value={adminPasswordInput}
                      onChange={e => {
                        setAdminPasswordInput(e.target.value);
                        setSettingsForm({ ...settingsForm, adminPassword: e.target.value });
                      }}
                      className="w-full bg-[#071930] border border-[#1b3a60] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#d4af37]"
                    />
                  </div>

                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      id="isRegOpen"
                      checked={settingsForm.isRegistrationOpen}
                      onChange={e => setSettingsForm({ ...settingsForm, isRegistrationOpen: e.target.checked })}
                      className="w-5 h-5 rounded bg-[#071930] border-[#1b3a60] text-[#d4af37] focus:ring-0"
                    />
                    <label htmlFor="isRegOpen" className="text-sm font-medium text-slate-300">
                      Inscrições Ativas (Visíveis e aceitando cadastros)
                    </label>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-4 rounded-xl bg-[#d4af37] hover:bg-[#c29d2f] text-slate-950 font-bold shadow-lg transition-all"
                  >
                    Salvar Alterações
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Manual Match Modal (Create / Edit) */}
      {showMatchModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4">
          <div className="bg-[#0f304f] border border-[#1b3a60] rounded-2xl p-6 sm:p-8 max-w-lg w-full shadow-2xl relative">
            <button
              onClick={() => setShowMatchModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-serif font-bold text-white mb-6">
              {editingMatchId ? 'Alterar Vinculação' : 'Nova Vinculação Manual'}
            </h3>
            <form onSubmit={handleMatchSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Magistrado Voluntário (Aprovado)</label>
                <select
                  required
                  value={matchForm.magistrateId}
                  onChange={e => setMatchForm({ ...matchForm, magistrateId: e.target.value })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]"
                >
                  <option value="">Selecione o magistrado...</option>
                  {magistrates
                    .filter(m => m.status !== 'Atribuído')
                    .map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.currentLocation} - {m.status})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Unidade Judicial</label>
                <select
                  required
                  value={matchForm.unitId}
                  onChange={e => setMatchForm({ ...matchForm, unitId: e.target.value })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]"
                >
                  <option value="">Selecione a unidade...</option>
                  {units.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.unitName} ({u.comarca})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Área Atribuída</label>
                <select
                  value={matchForm.assignedArea}
                  onChange={e => setMatchForm({ ...matchForm, assignedArea: e.target.value })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]"
                >
                  {PREFERENCE_AREAS.map((a, i) => (
                    <option key={i} value={a}>{a}</option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-lg bg-[#d4af37] hover:bg-[#c29d2f] text-slate-950 font-bold text-sm transition-all mt-4"
              >
                {editingMatchId ? 'Salvar Alteração' : 'Efetivar Vinculação'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Manual Magistrate Modal */}
      {showAddMagModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4">
          <div className="bg-[#0f304f] border border-[#1b3a60] rounded-2xl p-6 sm:p-8 max-w-lg w-full shadow-2xl relative">
            <button
              onClick={() => setShowAddMagModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-serif font-bold text-white mb-6">Cadastrar Magistrado Manualmente</h3>
            <form onSubmit={handleManualMagSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={manualMag.name}
                  onChange={e => setManualMag({ ...manualMag, name: e.target.value })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">E-mail Institucional</label>
                <input
                  type="email"
                  required
                  value={manualMag.email}
                  onChange={e => setManualMag({ ...manualMag, email: e.target.value })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Lotação Atual</label>
                <input
                  type="text"
                  required
                  value={manualMag.currentLocation}
                  onChange={e => setManualMag({ ...manualMag, currentLocation: e.target.value })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">1ª Preferência</label>
                  <select
                    value={manualMag.firstPreference}
                    onChange={e => setManualMag({ ...manualMag, firstPreference: e.target.value })}
                    className="w-full bg-[#071930] border border-[#1b3a60] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]"
                  >
                    {PREFERENCE_AREAS.map((a, i) => (
                      <option key={i} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">2ª Preferência</label>
                  <select
                    value={manualMag.secondPreference}
                    onChange={e => setManualMag({ ...manualMag, secondPreference: e.target.value })}
                    className="w-full bg-[#071930] border border-[#1b3a60] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]"
                  >
                    {PREFERENCE_AREAS.map((a, i) => (
                      <option key={i} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Status Inicial</label>
                <select
                  value={manualMag.status}
                  onChange={e => setManualMag({ ...manualMag, status: e.target.value as any })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]"
                >
                  <option value="Aguardando Conferência">Aguardando Conferência</option>
                  <option value="Aprovado">Aprovado</option>
                </select>
              </div>
              <button
                type="submit"
                className="w-full py-3 rounded-lg bg-[#d4af37] hover:bg-[#c29d2f] text-slate-950 font-bold text-sm transition-all mt-4"
              >
                Salvar Magistrado
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Manual Unit Modal */}
      {showAddUnitModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4">
          <div className="bg-[#0f304f] border border-[#1b3a60] rounded-2xl p-6 sm:p-8 max-w-lg w-full shadow-2xl relative">
            <button
              onClick={() => setShowAddUnitModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-serif font-bold text-white mb-6">Cadastrar Unidade Judicial Manualmente</h3>
            <form onSubmit={handleManualUnitSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Nome da Unidade Judicial</label>
                <input
                  type="text"
                  required
                  value={manualUnit.unitName}
                  onChange={e => setManualUnit({ ...manualUnit, unitName: e.target.value })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Juiz(a) Responsável</label>
                  <input
                    type="text"
                    required
                    value={manualUnit.judgeName}
                    onChange={e => setManualUnit({ ...manualUnit, judgeName: e.target.value })}
                    className="w-full bg-[#071930] border border-[#1b3a60] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Comarca</label>
                  <input
                    type="text"
                    required
                    value={manualUnit.comarca}
                    onChange={e => setManualUnit({ ...manualUnit, comarca: e.target.value })}
                    className="w-full bg-[#071930] border border-[#1b3a60] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">E-mail Oficial</label>
                <input
                  type="email"
                  required
                  value={manualUnit.email}
                  onChange={e => setManualUnit({ ...manualUnit, email: e.target.value })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Áreas Pretendidas</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {PREFERENCE_AREAS.map((area, i) => {
                    const isSelected = manualUnit.areas.includes(area);
                    return (
                      <div
                        key={i}
                        onClick={() => {
                          const current = [...manualUnit.areas];
                          if (isSelected) {
                            if (current.length === 1) return;
                            setManualUnit({ ...manualUnit, areas: current.filter(a => a !== area) });
                          } else {
                            setManualUnit({ ...manualUnit, areas: [...current, area] });
                          }
                        }}
                        className={`p-2 rounded-lg border cursor-pointer text-xs flex items-center space-x-2 ${
                          isSelected ? 'bg-[#1b3a60] border-[#d4af37] text-white' : 'bg-[#071930] border-[#1b3a60] text-slate-400'
                        }`}
                      >
                        <div className={`w-3 h-3 rounded flex items-center justify-center border ${isSelected ? 'bg-[#d4af37] text-slate-950 font-bold' : 'border-[#1b3a60]'}`}>
                          {isSelected && <CheckCircle2 className="w-2.5 h-2.5 text-slate-950" />}
                        </div>
                        <span className="truncate">{area}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Justificativa / Demanda</label>
                <textarea
                  rows={2}
                  value={manualUnit.description}
                  onChange={e => setManualUnit({ ...manualUnit, description: e.target.value })}
                  className="w-full bg-[#071930] border border-[#1b3a60] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]"
                ></textarea>
              </div>
              <button
                type="submit"
                className="w-full py-3 rounded-lg bg-[#d4af37] hover:bg-[#c29d2f] text-slate-950 font-bold text-sm transition-all mt-4"
              >
                Salvar Unidade Judicial
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
