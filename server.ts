import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize Gemini SDK if API key is present
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    })
  : null;

interface Magistrate {
  id: string;
  name: string;
  email: string;
  currentLocation: string;
  firstPreference: string;
  secondPreference: string;
  createdAt: string;
  status: 'Aguardando Conferência' | 'Aprovado' | 'Lista de Espera' | 'Atribuído';
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
  status: 'Pendente' | 'Atendida' | 'Em Andamento';
}

interface Match {
  id: string;
  magistrateId: string;
  unitId: string;
  assignedArea: string;
  status: 'Vinculado' | 'Concluído';
  createdAt: string;
}

interface Settings {
  title: string;
  openingDate: string;
  closingDate: string;
  adminPassword: string;
  isRegistrationOpen: boolean;
  description: string;
}

let settings: Settings = {
  title: 'Mutirão de Julgamento TJPR - 2026',
  openingDate: '2026-04-01T08:00',
  closingDate: '2026-05-15T23:59',
  adminPassword: 'leafar37',
  isRegistrationOpen: true,
  description: 'Mutirão focado na redução do acervo processual e cumprimento das metas do CNJ em unidades de todo o estado.',
};

let magistrates: Magistrate[] = [
  {
    id: 'mag-1',
    name: 'Dra. Ana Paula Silveira',
    email: 'ana.silveira@tjp.jus.br',
    currentLocation: '1ª Vara Cível da Comarca de Curitiba',
    firstPreference: 'Cível e Fazenda Pública',
    secondPreference: 'Família e Infância',
    createdAt: '2026-04-02T10:15:00Z',
    status: 'Aprovado',
  },
  {
    id: 'mag-2',
    name: 'Dr. Carlos Eduardo Mendes',
    email: 'carlos.mendes@tjp.jus.br',
    currentLocation: '3ª Vara Criminal da Comarca de Londrina',
    firstPreference: 'Crime',
    secondPreference: 'Juizado Cível, Crime e Fazenda Pública',
    createdAt: '2026-04-03T14:20:00Z',
    status: 'Aguardando Conferência',
  },
  {
    id: 'mag-3',
    name: 'Dra. Beatriz de Souza Lima',
    email: 'beatriz.lima@tjp.jus.br',
    currentLocation: '2ª Vara de Família e Sucessões de Maringá',
    firstPreference: 'Família e Infância',
    secondPreference: 'Cível e Fazenda Pública',
    createdAt: '2026-04-04T09:30:00Z',
    status: 'Atribuído',
  },
];

let units: Unit[] = [
  {
    id: 'unit-1',
    unitName: 'Vara do Juizado Especial Cível e Criminal - Comarca de Cascavel',
    judgeName: 'Dr. Roberto Sampaio',
    email: 'cascavel.jecc@tjp.jus.br',
    comarca: 'Cascavel',
    areas: ['Juizado Cível, Crime e Fazenda Pública', 'Crime'],
    description: 'Acervo elevado de processos conclusos para sentença há mais de 100 dias.',
    createdAt: '2026-04-02T11:00:00Z',
    status: 'Pendente',
  },
  {
    id: 'unit-2',
    unitName: '2ª Vara Cível da Comarca de Ponta Grossa',
    judgeName: 'Dra. Fernanda Vasconcelos',
    email: 'pg.2civel@tjp.jus.br',
    comarca: 'Ponta Grossa',
    areas: ['Cível e Fazenda Pública'],
    description: 'Demanda reprimida em execuções fiscais e ações de cobrança.',
    createdAt: '2026-04-03T16:45:00Z',
    status: 'Pendente',
  },
  {
    id: 'unit-3',
    unitName: 'Vara da Infância e da Juventude - Comarca de Maringá',
    judgeName: 'Dr. Lucas Ribeiro',
    email: 'beatriz.lima@tjp.jus.br',
    comarca: 'Maringá',
    areas: ['Família e Infância'],
    description: 'Necessidade de mutirão em audiências concentradas e medidas protetivas.',
    createdAt: '2026-04-04T11:10:00Z',
    status: 'Atendida',
  },
];

let matches: Match[] = [
  {
    id: 'match-1',
    magistrateId: 'mag-3',
    unitId: 'unit-3',
    assignedArea: 'Família e Infância',
    status: 'Vinculado',
    createdAt: '2026-04-04T14:00:00Z',
  },
];

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Routes
  app.get('/api/settings', (req, res) => {
    res.json(settings);
  });

  app.post('/api/settings', (req, res) => {
    const { title, openingDate, closingDate, adminPassword, isRegistrationOpen, description } = req.body;
    settings = {
      title: title || settings.title,
      openingDate: openingDate || settings.openingDate,
      closingDate: closingDate || settings.closingDate,
      adminPassword: adminPassword !== undefined && adminPassword !== '' ? adminPassword : settings.adminPassword,
      isRegistrationOpen: isRegistrationOpen !== undefined ? isRegistrationOpen : settings.isRegistrationOpen,
      description: description || settings.description,
    };
    res.json({ success: true, settings });
  });

  app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === settings.adminPassword) {
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, message: 'Senha administrativa incorreta.' });
    }
  });

  // Magistrates endpoints
  app.get('/api/magistrates', (req, res) => {
    res.json(magistrates);
  });

  app.get('/api/status', (req, res) => {
    const emailQuery = (req.query.email as string || '').trim().toLowerCase();
    if (!emailQuery) {
      return res.status(400).json({ error: 'Informe o e-mail cadastrado.' });
    }

    const matchedMagistrates = magistrates.filter(m => m.email.toLowerCase() === emailQuery);
    const matchedUnits = units.filter(u => u.email.toLowerCase() === emailQuery);

    if (matchedMagistrates.length === 0 && matchedUnits.length === 0) {
      return res.status(404).json({ error: 'Nenhum cadastro encontrado com este e-mail.' });
    }

    const magistrateDetails = matchedMagistrates.map(mag => {
      const match = matches.find(m => m.magistrateId === mag.id);
      const assignedUnit = match ? units.find(u => u.id === match.unitId) || null : null;
      return {
        ...mag,
        match: match ? { ...match, unit: assignedUnit } : null,
      };
    });

    res.json({
      magistrates: magistrateDetails,
      units: matchedUnits,
    });
  });

  app.post('/api/magistrates', (req, res) => {
    const { name, email, currentLocation, firstPreference, secondPreference, status } = req.body;
    if (!name || !email || !currentLocation || !firstPreference) {
      return res.status(400).json({ error: 'Preencha todos os campos obrigatórios do magistrado.' });
    }

    const newMag: Magistrate = {
      id: `mag-${Date.now()}`,
      name,
      email,
      currentLocation,
      firstPreference,
      secondPreference: secondPreference || '',
      createdAt: new Date().toISOString(),
      status: status || 'Aguardando Conferência',
    };

    magistrates.unshift(newMag);
    res.status(201).json({ success: true, magistrate: newMag });
  });

  app.post('/api/magistrates/:id/approve', (req, res) => {
    const { id } = req.params;
    const mag = magistrates.find(m => m.id === id);
    if (!mag) {
      return res.status(404).json({ error: 'Magistrado não encontrado.' });
    }

    const isMatched = matches.some(m => m.magistrateId === id);
    mag.status = isMatched ? 'Atribuído' : 'Lista de Espera';
    res.json({ success: true, magistrate: mag });
  });

  app.delete('/api/magistrates/:id', (req, res) => {
    const { id } = req.params;
    console.log('[SERVER] DELETE /api/magistrates/:id called with id:', id);
    magistrates = magistrates.filter((m) => m.id !== id);
    matches = matches.filter((m) => m.magistrateId !== id);
    res.json({ success: true, id });
  });

  // Units endpoints
  app.get('/api/units', (req, res) => {
    res.json(units);
  });

  app.post('/api/units', (req, res) => {
    const { unitName, judgeName, email, comarca, areas, description } = req.body;
    if (!unitName || !judgeName || !email || !comarca || !areas || !areas.length) {
      return res.status(400).json({ error: 'Preencha todos os campos obrigatórios da unidade judicial.' });
    }

    const newUnit: Unit = {
      id: `unit-${Date.now()}`,
      unitName,
      judgeName,
      email,
      comarca,
      areas,
      description: description || '',
      createdAt: new Date().toISOString(),
      status: 'Pendente',
    };

    units.unshift(newUnit);
    res.status(201).json({ success: true, unit: newUnit });
  });

  app.delete('/api/units/:id', (req, res) => {
    const { id } = req.params;
    console.log('[SERVER] DELETE /api/units/:id called with id:', id);
    units = units.filter((u) => u.id !== id);
    matches = matches.filter((m) => m.unitId !== id);
    res.json({ success: true, id });
  });

  // Matches endpoints
  app.get('/api/matches', (req, res) => {
    res.json(matches);
  });

  app.post('/api/matches', (req, res) => {
    const { magistrateId, unitId, assignedArea } = req.body;
    if (!magistrateId || !unitId || !assignedArea) {
      return res.status(400).json({ error: 'Magistrado, Unidade e Área são obrigatórios para a vinculação.' });
    }

    // If magistrate already had a match elsewhere, clear old match's unit status
    const existingMatch = matches.find(m => m.magistrateId === magistrateId);
    if (existingMatch) {
      const oldUnit = units.find(u => u.id === existingMatch.unitId);
      if (oldUnit) oldUnit.status = 'Pendente';
      matches = matches.filter(m => m.id !== existingMatch.id);
    }

    const mag = magistrates.find(m => m.id === magistrateId);
    if (mag) {
      mag.status = 'Atribuído';
    }

    const newMatch: Match = {
      id: `match-${Date.now()}`,
      magistrateId,
      unitId,
      assignedArea,
      status: 'Vinculado',
      createdAt: new Date().toISOString(),
    };

    matches.unshift(newMatch);

    const unit = units.find((u) => u.id === unitId);
    if (unit) {
      unit.status = 'Atendida';
    }

    res.status(201).json({ success: true, match: newMatch });
  });

  // Put / Update match (alterar vinculação)
  app.put('/api/matches/:id', (req, res) => {
    const { id } = req.params;
    const { magistrateId, unitId, assignedArea } = req.body;
    
    const match = matches.find(m => m.id === id);
    if (!match) {
      return res.status(404).json({ error: 'Vinculação não encontrada.' });
    }

    // Reset old unit status
    const oldUnit = units.find(u => u.id === match.unitId);
    if (oldUnit) oldUnit.status = 'Pendente';
    const oldMag = magistrates.find(m => m.id === match.magistrateId);
    if (oldMag) oldMag.status = 'Lista de Espera';

    match.magistrateId = magistrateId || match.magistrateId;
    match.unitId = unitId || match.unitId;
    match.assignedArea = assignedArea || match.assignedArea;

    const newMag = magistrates.find(m => m.id === match.magistrateId);
    if (newMag) newMag.status = 'Atribuído';

    const newUnit = units.find(u => u.id === match.unitId);
    if (newUnit) newUnit.status = 'Atendida';

    res.json({ success: true, match });
  });

  app.delete('/api/matches/:id', (req, res) => {
    const { id } = req.params;
    console.log('[SERVER] DELETE /api/matches/:id called with id:', id);
    const match = matches.find((m) => m.id === id);
    if (match) {
      const unit = units.find((u) => u.id === match.unitId);
      if (unit) {
        unit.status = 'Pendente';
      }
      const mag = magistrates.find((m) => m.id === match.magistrateId);
      if (mag) {
        mag.status = 'Lista de Espera';
      }
    }
    matches = matches.filter((m) => m.id !== id);
    res.json({ success: true, id });
  });

  // Auto-matching algorithm
  app.post('/api/matches/auto', (req, res) => {
    let newMatchesCount = 0;
    const assignedMagIds = new Set(matches.map((m) => m.magistrateId));
    const assignedUnitIds = new Set(matches.map((m) => m.unitId));

    const eligibleMags = magistrates.filter(m => m.status !== 'Atribuído' && !assignedMagIds.has(m.id));

    // PASS 1: Prioritize 1st preference
    for (const mag of eligibleMags) {
      if (assignedMagIds.has(mag.id)) continue;
      const targetUnit = units.find((u) => !assignedUnitIds.has(u.id) && u.areas.includes(mag.firstPreference));
      if (targetUnit) {
        matches.push({
          id: `match-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          magistrateId: mag.id,
          unitId: targetUnit.id,
          assignedArea: mag.firstPreference,
          status: 'Vinculado',
          createdAt: new Date().toISOString(),
        });
        assignedMagIds.add(mag.id);
        assignedUnitIds.add(targetUnit.id);
        targetUnit.status = 'Atendida';
        mag.status = 'Atribuído';
        newMatchesCount++;
      }
    }

    // PASS 2: Try 2nd preference
    const eligibleMags2 = magistrates.filter(m => m.status !== 'Atribuído' && !assignedMagIds.has(m.id));
    for (const mag of eligibleMags2) {
      if (!mag.secondPreference || assignedMagIds.has(mag.id)) continue;
      const targetUnit = units.find((u) => !assignedUnitIds.has(u.id) && u.areas.includes(mag.secondPreference));
      if (targetUnit) {
        matches.push({
          id: `match-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          magistrateId: mag.id,
          unitId: targetUnit.id,
          assignedArea: mag.secondPreference,
          status: 'Vinculado',
          createdAt: new Date().toISOString(),
        });
        assignedMagIds.add(mag.id);
        assignedUnitIds.add(targetUnit.id);
        targetUnit.status = 'Atendida';
        mag.status = 'Atribuído';
        newMatchesCount++;
      }
    }

    res.json({ success: true, newMatchesCount, matches });
  });

  app.get('/api/waiting-list', (req, res) => {
    const assignedMagIds = new Set(matches.map((m) => m.magistrateId));
    const waitingMagistrates = magistrates.filter((m) => m.status !== 'Atribuído' && !assignedMagIds.has(m.id));
    res.json(waitingMagistrates);
  });

  // AI Recommendations
  app.post('/api/ai/match-recommendations', async (req, res) => {
    if (!ai) {
      return res.status(500).json({ error: 'Chave da API Gemini não configurada.' });
    }

    try {
      const unassignedMags = magistrates.filter((m) => m.status !== 'Atribuído' && !matches.some((mt) => mt.magistrateId === m.id));
      const pendingUnits = units.filter((u) => u.status === 'Pendente');

      const prompt = `
        Você é o assistente de inteligência artificial de coordenação de um Mutirão de Julgamento do Tribunal de Justiça.
        Analise os magistrados voluntários aprovados e não alocados e as unidades judiciais pendentes abaixo e sugira as melhores alocações estratégicas.

        Magistrados Disponíveis:
        ${JSON.stringify(unassignedMags, null, 2)}

        Unidades Judiciais Pendentes:
        ${JSON.stringify(pendingUnits, null, 2)}

        Responda em JSON contendo um array de recomendações com a estrutura:
        [
          {
            "magistrateId": "...",
            "unitId": "...",
            "assignedArea": "...",
            "justification": "..."
          }
        ]
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const result = JSON.parse(response.text || '[]');
      res.json({ success: true, recommendations: result });
    } catch (err: any) {
      console.error('Gemini AI error:', err);
      res.status(500).json({ error: err.message || 'Erro ao gerar recomendações com IA.' });
    }
  });

  // XLSX Export for matches: Nome, Área, Unidade
  app.get('/api/export/xlsx/matches', (req, res) => {
    const data = matches.map((mt) => {
      const mag = magistrates.find((m) => m.id === mt.magistrateId);
      const un = units.find((u) => u.id === mt.unitId);
      return {
        'Nome': mag?.name || 'Magistrado Removido',
        'Área': mt.assignedArea,
        'Unidade': un?.unitName || 'Unidade Removida',
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Vinculacoes');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=vinculacoes-mutirao-${Date.now()}.xlsx`);
    res.send(buffer);
  });

  // CSV Export
  app.get('/api/export/csv', (req, res) => {
    const type = req.query.type || 'all';
    let csvContent = '\uFEFF';

    if (type === 'magistrates' || type === 'all') {
      csvContent += '=== MAGISTRADOS VOLUNTARIOS ===\n';
      csvContent += 'ID,Nome,Email,Lotacao Atual,1ª Preferencia,2ª Preferencia,Status,Data Inscr.\n';
      magistrates.forEach((m) => {
        csvContent += `"${m.id}","${m.name}","${m.email}","${m.currentLocation}","${m.firstPreference}","${m.secondPreference || ''}","${m.status}","${m.createdAt}"\n`;
      });
      csvContent += '\n\n';
    }

    if (type === 'units' || type === 'all') {
      csvContent += '=== UNIDADES JUDICIAIS ===\n';
      csvContent += 'ID,Unidade,Juiz(a) Responsavel,Email,Comarca,Areas,Status,Data Inscr.\n';
      units.forEach((u) => {
        csvContent += `"${u.id}","${u.unitName}","${u.judgeName}","${u.email}","${u.comarca}","${u.areas.join(' | ')}","${u.status}","${u.createdAt}"\n`;
      });
      csvContent += '\n\n';
    }

    if (type === 'matches' || type === 'all') {
      csvContent += '=== VINCULACOES REALIZADAS ===\n';
      csvContent += 'ID Vinculo,Magistrado,Unidade,Area Atribuida,Status,Data\n';
      matches.forEach((mt) => {
        const mag = magistrates.find((m) => m.id === mt.magistrateId);
        const un = units.find((u) => u.id === mt.unitId);
        csvContent += `"${mt.id}","${mag?.name || mt.magistrateId}","${un?.unitName || mt.unitId}","${mt.assignedArea}","${mt.status}","${mt.createdAt}"\n`;
      });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=mutirao-export-${type}-${Date.now()}.csv`);
    res.send(csvContent);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer();
