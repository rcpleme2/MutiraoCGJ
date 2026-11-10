// Limitador de requisições por chave (IP, inscrições, consultas).

// Limite de inscrições públicas por IP a cada 10 minutos. Vários servidores do tribunal podem sair pelo
// mesmo IP, então o valor é ajustável sem alterar o código: defina SIGNUP_MAX_PER_IP no Cloud Run.
export const SIGNUP_MAX_PER_IP = Math.max(1, Number(process.env.SIGNUP_MAX_PER_IP) || 30);
// Inscrições com erro (validação, duplicidade etc.) têm limite próprio, mais folgado, para frear sondagem de e-mails.
export const SIGNUP_MAX_ERRORS_PER_IP = Math.max(1, Number(process.env.SIGNUP_MAX_ERRORS_PER_IP) || 120);
export const SIGNUP_MAX_GLOBAL_PER_HOUR = Math.max(1, Number(process.env.SIGNUP_MAX_GLOBAL_PER_HOUR) || 600);
// Limitador simples por IP (tentativas de login e consultas por e-mail)
export const hits = new Map<string, number[]>();
export const rateLimited = (key: string, max: number, windowMs: number) => {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
};
/** Devolve a "vaga" reservada por rateLimited (usado quando a requisição não resultou em inscrição). */
export const refund = (key: string) => { hits.get(key)?.pop(); };
