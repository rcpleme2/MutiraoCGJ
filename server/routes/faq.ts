// Rotas das perguntas frequentes (públicas e gestão).
import express from 'express';
import { log, newId, S } from '../state.ts';
import { type FaqItem } from '../types.ts';

export const faqSorted = () => [...S.faq].sort((a, b) => a.order - b.order);
export const faqInput = (b: any) => ({
  question: String(b?.question ?? '').trim(),
  answer: String(b?.answer ?? '').trim(),
});
export const faqInvalid = (q: { question: string; answer: string }) =>
  !q.question || !q.answer ? 'Preencha a pergunta e a resposta.'
    : q.question.length > 300 ? 'A pergunta pode ter no máximo 300 caracteres.'
    : q.answer.length > 4000 ? 'A resposta pode ter no máximo 4000 caracteres.' : '';

export function register(app: express.Express) {
  // Público: apenas as publicadas
  app.get('/api/faq', (_req, res) => {
    res.json(faqSorted().filter((f) => f.published).map(({ id, question, answer }) => ({ id, question, answer })));
  });
  // Administração: todas, inclusive não publicadas
  app.get('/api/faq/all', (_req, res) => res.json(faqSorted()));
  app.post('/api/faq', (req, res) => {
    const input = faqInput(req.body);
    const err = faqInvalid(input);
    if (err) return res.status(400).json({ error: err });
    const item: FaqItem = {
      id: newId('faq'), ...input,
      order: S.faq.reduce((mx, f) => Math.max(mx, f.order), 0) + 1,
      published: req.body?.published !== false,
      updatedAt: new Date().toISOString(),
    };
    S.faq.push(item);
    log(null, 'Administração', 'Conteúdo', `Pergunta frequente criada: "${item.question}".`);
    res.status(201).json({ success: true, item });
  });
  app.put('/api/faq/:id', (req, res) => {
    const item = S.faq.find((f) => f.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Pergunta não encontrada.' });
    const input = faqInput({ question: req.body?.question ?? item.question, answer: req.body?.answer ?? item.answer });
    const err = faqInvalid(input);
    if (err) return res.status(400).json({ error: err });
    item.question = input.question;
    item.answer = input.answer;
    if (typeof req.body?.published === 'boolean') item.published = req.body.published;
    item.updatedAt = new Date().toISOString();
    log(null, 'Administração', 'Conteúdo', `Pergunta frequente editada: "${item.question}"${item.published ? '' : ' (não publicada)'}.`);
    res.json({ success: true, item });
  });
  app.post('/api/faq/:id/move', (req, res) => {
    const ordered = faqSorted();
    const i = ordered.findIndex((f) => f.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: 'Pergunta não encontrada.' });
    const j = req.body?.direction === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < ordered.length) {
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      ordered.forEach((f, n) => { f.order = n + 1; });
    }
    res.json({ success: true });
  });
  app.delete('/api/faq/:id', (req, res) => {
    const item = S.faq.find((f) => f.id === req.params.id);
    if (item) log(null, 'Administração', 'Conteúdo', `Pergunta frequente excluída: "${item.question}".`);
    S.faq = S.faq.filter((f) => f.id !== req.params.id);
    res.json({ success: true });
  });
}
