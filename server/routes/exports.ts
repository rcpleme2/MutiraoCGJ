// Rotas de exportação (CSV e planilhas XLSX).
import express from 'express';
import XLSX from 'xlsx';
import { scopeOf } from '../editions.ts';
import { saveState } from '../persistence.ts';
import { log, S } from '../state.ts';
import { hearingPeriodLabel } from '../types.ts';
import { csvCell } from '../util.ts';

export function register(app: express.Express) {
  // Planilha das unidades escolhidas para o mutirão que ainda não têm magistrado: Comarca, Unidade, Juiz(a) responsável.
  app.get('/api/export/xlsx/unlinked-units', async (req, res) => {
    const scope = scopeOf(req);
    if (!scope) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });

    const linked = new Set(S.matches.map((m) => m.unitId));
    const header = ['Comarca', 'Unidade', 'Juiz(a) responsável'];
    const data = S.units
      .filter((u) => scope.has(u) && u.selection === 'Escolhida' && !linked.has(u.id))
      .sort((x, y) => x.comarca.localeCompare(y.comarca, 'pt-BR') || x.unitName.localeCompare(y.unitName, 'pt-BR'))
      .map((u) => ({ 'Comarca': u.comarca, 'Unidade': u.unitName, 'Juiz(a) responsável': u.judgeName }));

    const sheet = XLSX.utils.json_to_sheet(data, { header });
    sheet['!cols'] = [{ wch: 24 }, { wch: 60 }, { wch: 32 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sem magistrado');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    log(scope.edition?.id ?? null, 'Administração', 'Exportação', `Planilha de unidades sem magistrado (XLSX) exportada: ${data.length} unidade(s).`);
    if (!(await saveState())) return res.status(503).json({ error: 'Não foi possível registrar a exportação. Tente novamente.' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=unidades-sem-magistrado-${Date.now()}.xlsx`);
    res.send(buffer);
  });
  app.get('/api/export/xlsx/matches', async (req, res) => {
    const scope = scopeOf(req);
    if (!scope) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });

    const data = S.matches
      .filter(scope.has)
      .map((mt) => ({
        'Nome': S.magistrates.find((m) => m.id === mt.magistrateId)?.name || 'Magistrado Removido',
        'Área': mt.assignedArea,
        'Modalidade': mt.workType,
        'Comarca': S.units.find((u) => u.id === mt.unitId)?.comarca || '',
        'Unidade': S.units.find((u) => u.id === mt.unitId)?.unitName || 'Unidade Removida',
      }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), 'Vinculacoes');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    log(scope.edition?.id ?? null, 'Administração', 'Exportação', 'Planilha de vinculações (XLSX) exportada.');
    if (!(await saveState())) return res.status(503).json({ error: 'Não foi possível registrar a exportação. Tente novamente.' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=vinculacoes-${Date.now()}.xlsx`);
    res.send(buffer);
  });
  app.get('/api/export/csv', async (req, res) => {
    const scope = scopeOf(req);
    if (!scope) return res.status(404).json({ error: 'Janela de inscrição não encontrada.' });

    const type = (req.query.type as string) || 'all';
    let csv = `﻿Janela de inscrição: ${scope.title}\n\n`;

    if (type === 'magistrates' || type === 'all') {
      csv += '=== MAGISTRADOS VOLUNTARIOS ===\n';
      csv += 'ID,Nome,Email,Lotacao Atual,1ª Preferencia,2ª Preferencia,Aceita Audiencia,Periodo Audiencias,IP,Declaracao,Status,Motivo Rejeicao,Data Inscr.\n';
      S.magistrates.filter(scope.has).forEach((m) => {
        csv += [m.id, m.name, m.email, m.currentLocation, m.firstPreference, m.secondPreference, m.acceptsHearings ? 'Sim' : 'Nao', hearingPeriodLabel(m.hearingPeriod), m.registeredIp ?? '', m.declaration ? 'Sim' : '', m.status, m.rejectionReason ?? '', m.createdAt].map(csvCell).join(',') + '\n';
      });
      csv += '\n\n';
    }

    if (type === 'units' || type === 'all') {
      csv += '=== UNIDADES JUDICIAIS ===\n';
      csv += 'ID,Unidade,Juiz(a) Responsavel,Email,Comarca,Areas,Auxilio Necessario,Periodo Audiencias,Vagas,IP,Triagem,Status,Motivo Rejeicao,Data Inscr.\n';
      S.units.filter(scope.has).forEach((u) => {
        csv += [u.id, u.unitName, u.judgeName, u.email, u.comarca, u.areas.join(' | '), u.supportNeeded, hearingPeriodLabel(u.hearingPeriod), u.slots, u.registeredIp ?? '', u.selection, u.status, u.rejectionReason ?? '', u.createdAt].map(csvCell).join(',') + '\n';
      });
      csv += '\n\n';
    }

    if (type === 'matches' || type === 'all') {
      csv += '=== VINCULACOES REALIZADAS ===\n';
      csv += 'ID Vinculo,Magistrado,Unidade,Area Atribuida,Modalidade,Status,Data\n';
      S.matches.filter(scope.has).forEach((mt) => {
        const mag = S.magistrates.find((m) => m.id === mt.magistrateId);
        const un = S.units.find((u) => u.id === mt.unitId);
        csv += [mt.id, mag?.name || mt.magistrateId, un?.unitName || mt.unitId, mt.assignedArea, mt.workType, mt.status, mt.createdAt].map(csvCell).join(',') + '\n';
      });
      csv += '\n\n';
    }

    if (type === 'log' || type === 'all') {
      csv += '=== REGISTRO DE ATIVIDADES ===\n';
      csv += 'Data/Hora,Responsavel,Categoria,IP,Descricao\n';
      S.activityLog.filter((l) => scope.all || l.editionId === scope.edition!.id || l.editionId === null).forEach((l) => {
        csv += [l.timestamp, l.actor, l.category, l.ip ?? '', l.description].map(csvCell).join(',') + '\n';
      });
    }

    log(scope.edition?.id ?? null, 'Administração', 'Exportação', `Exportação CSV (${type}).`);
    if (!(await saveState())) return res.status(503).json({ error: 'Não foi possível registrar a exportação. Tente novamente.' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=mutirao-${type}-${Date.now()}.csv`);
    res.send(csv);
  });
}
