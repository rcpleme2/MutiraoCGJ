// Rota do registro de atividades.
import express from 'express';
import { S } from '../state.ts';

export function register(app: express.Express) {
  app.get('/api/log', (req, res) => {
    const edition = (req.query.edition as string) || '';
    const list = edition
      ? S.activityLog.filter((l) => l.editionId === edition || l.editionId === null)
      : S.activityLog;
    res.json(list.slice(0, 500));
  });
}
