# Relatório de acessibilidade — parte pública do sistema Mutirão de Julgamento

Data da análise: 06/10/2026 · Versão analisada: `main` (commit `390240f`) · Escopo: telas públicas (sem login)

---

## 1. Resumo executivo

**Conclusão: a parte pública não atende plenamente aos requisitos de acessibilidade (WCAG 2.1 nível AA / eMAG 3.1).**

A base é boa: a página reflui corretamente até 320 px, respeita o espaçamento de texto, declara o idioma (`pt-BR`), permite zoom, não usa temporizadores que expulsem o usuário e é operável por teclado em sua maior parte. Mas há falhas relevantes justamente nos pontos mais usados — **os formulários de inscrição** — e na **estrutura de navegação** da página de tela única.

| Indicador | Resultado |
|---|---|
| Violações automáticas (axe-core 4.14, regras WCAG 2.0/2.1/2.2 A e AA + boas práticas) | **3 regras violadas**: `label` (crítica, 12 campos), `select-name` (crítica, 4 campos), `page-has-heading-one` (moderada, 4 telas) |
| Achados no total (automáticos + testes manuais, que ferramentas automáticas não detectam) | **19** (5 de prioridade P1, 7 de prioridade P2 e 7 de prioridade P3 — ver seção 4) |
| Critérios de sucesso WCAG com falha (total, automáticos + manuais) | ao menos 14 (1.3.1, 1.3.5, 1.4.1, 1.4.3, 1.4.11, 2.4.1, 2.4.2, 2.4.6, 2.4.7, 3.3.1, 3.3.2, 3.3.3, 4.1.2, 4.1.3) e 1 da WCAG 2.2 (2.5.8) |
| Impacto principal | Uma pessoa que usa leitor de tela **não consegue saber o nome dos campos** do formulário de inscrição. Usuários de teclado e de baixa visão enfrentam foco e bordas pouco visíveis. |
| Esforço estimado para chegar ao nível AA | cerca de **3 a 5 dias de desenvolvimento** + 1 a 2 dias de validação com tecnologias assistivas (estimativa, ver seção 6) |

Nenhum dos problemas exige redesenho: são correções localizadas em quatro arquivos (`src/ui.tsx`, `src/Forms.tsx`, `src/App.tsx`, `src/index.css`) e em `index.html`.

---

## 2. Escopo e metodologia

**Telas avaliadas** (largura 1366 px e 360 px): Início, Inscrição de Magistrados, Inscrição de Unidades, Consultar Status (consulta por e-mail e por nome) e Perguntas Frequentes, incluindo o menu móvel, os estados de erro/sucesso e a navegação por teclado.
**Fora do escopo:** a área administrativa (restrita) e o PDF de relatório.

**Técnicas aplicadas**

1. **Varredura automática** com axe-core 4.14 (Chromium), tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` e `best-practice`, em todas as telas, nas duas larguras.
2. **Navegação só por teclado** (Tab / Shift+Tab / setas): ordem, foco visível (estilos calculados e capturas de tela), comportamento dos grupos de opções e do menu.
3. **Contraste calculado** a partir dos *design tokens* de `src/index.css` (texto: 4,5:1; componentes e foco: 3:1).
4. **Reflow** (largura 320 px ≈ zoom de 400 %), **espaçamento de texto** (WCAG 1.4.12), **cores forçadas** (modo de alto contraste do Windows), **tamanho de alvos**, **títulos e marcos** do documento.
5. **Leitura do código-fonte** dos componentes públicos.

**Limitações:** não foram usados leitores de tela reais (NVDA, JAWS, VoiceOver, TalkBack), nem testes com pessoas usuárias, nem outros navegadores além do Chromium. As conclusões sobre leitores de tela vêm da árvore de acessibilidade e do código; devem ser confirmadas na fase de validação (seção 6). Ferramentas automáticas detectam apenas parte dos problemas; este relatório não é uma certificação.

**Referencial:** WCAG 2.1 AA (com verificação de dois critérios da 2.2), eMAG 3.1 (Modelo de Acessibilidade em Governo Eletrônico), Lei Brasileira de Inclusão (Lei 13.146/2015, art. 63) e as diretrizes do Poder Judiciário sobre acessibilidade (Resolução CNJ 401/2021 — conferir o texto vigente e eventual norma interna do TJPR).

---

## 3. O que já está adequado

- Idioma da página declarado (`lang="pt-BR"`) e *viewport* sem bloqueio de zoom.
- **Reflow:** sem rolagem horizontal em 320 px em nenhuma tela (1.4.10).
- **Espaçamento de texto:** nenhum conteúdo é cortado ou sobreposto ao aplicar os valores da WCAG 1.4.12.
- Contraste do texto corrente: texto principal 14,1:1; texto secundário 4,9:1 a 5,4:1; texto claro sobre o azul do cabeçalho 6,1:1 a 14,3:1.
- Marcos básicos (`header`, `nav`, `main`) e um único `nav`.
- Mensagens de erro de consulta com `role="alert"` e resultado da consulta por nome com `role="status"`.
- Formulários **não** têm limite de tempo; a atualização periódica da edição não apaga o que a pessoa já digitou.
- Ícones decorativos não são anunciados (a ferramenta automática não apontou ícones sem nome).
- O campo-isca anti-robô está oculto da árvore de acessibilidade e fora da ordem de tabulação.
- Botões nativos (`<button>`) com foco por teclado nos cartões, no menu e no FAQ (`aria-expanded` presente).

---

## 4. Achados

Prioridade: **P1** = barreira que impede ou dificulta a conclusão da tarefa; **P2** = falha de critério AA com contorno possível; **P3** = melhoria / boa prática.

### P1 — Corrigir primeiro

**A1. Rótulos de campos não estão associados aos campos** — WCAG 1.3.1, 3.3.2, 4.1.2 (axe: `label` crítica, 12 ocorrências; `select-name` crítica, 4 ocorrências)
- *Evidência:* em `Field` (`src/ui.tsx`) o `<label>` é irmão do campo, sem `for`/`id`. Em todos os campos de “Inscrição de Magistrados” e “Inscrição de Unidades”, o rótulo existe visualmente, mas o leitor de tela anuncia apenas “campo de edição” / “caixa de combinação”, sem nome. Clicar no rótulo também não leva o foco ao campo.
- *Correção:* gerar um `id` por campo (`useId`) e ligar `htmlFor` ↔ `id` dentro de `Field`; para grupos, ver A2.

**A2. Grupos de opções não são acessíveis** — WCAG 1.3.1, 2.1.1, 4.1.2
- *Evidência:* “Aceita realizar audiências?” (magistrado) e “Auxílio necessário” (unidade) são `<button role="radio">`; “Áreas a serem atendidas” são `<button role="checkbox">`. O `radiogroup` não tem nome; todas as opções são paradas de tabulação e **as setas não mudam a seleção** (teste: ↓ não altera `aria-checked`), o que contraria o padrão WAI-ARIA de grupo de rádio. A pergunta (rótulo visual) não é lida junto com cada opção.
- *Correção:* usar `<fieldset>` + `<legend>` com `<input type="radio">` / `<input type="checkbox">` nativos, estilizados com CSS (o comportamento de teclado e os nomes vêm de graça).

**A3. Erros de preenchimento não são identificados nem associados ao campo** — WCAG 3.3.1, 3.3.3, 4.1.3
- *Evidência:* ao enviar com campos vazios, só aparece a bolha nativa do navegador (“Please fill out this field”, no idioma do navegador, e não em português do sistema); nenhum campo recebe `aria-invalid` (0 de 7 inválidos). O erro local (“Preencha a 1ª escolha e informe se aceita audiências”) é texto solto, sem ligação com os campos. Mensagens do servidor (ex.: e-mail já cadastrado) e a de sucesso aparecem **no topo** do formulário, longe do botão, sem rolagem nem foco.
- *Correção:* validar no próprio sistema (`noValidate`), exibir um **resumo de erros** em português com foco programático e links para os campos, `aria-invalid="true"` + `aria-describedby` com a mensagem de cada campo; ao concluir, mover o foco/rolagem para a confirmação.

**A4. Foco do teclado pouco visível** — WCAG 2.4.7 (e 1.4.11)
- *Evidência* (capturas): nos campos o foco é apenas a troca de uma borda de 1 px para azul-marinho (o anel `ring-navy/10` tem contraste de 1,2:1 e o `outline` é removido); no botão “Concluir inscrição” o anel é claro sobre fundo azul-marinho/branco e praticamente some; nas opções de rádio/checkbox é o contorno padrão fino.
- *Correção:* regra global `:focus-visible { outline: 3px solid <cor 3:1+>; outline-offset: 2px }` em todos os controles (inclusive do cabeçalho, com cor clara sobre o azul).

**A5. Navegação da página de tela única sem os recursos básicos** — WCAG 2.4.1, 2.4.2, 2.4.6, 1.3.1, 4.1.2
- *Evidência:* (a) **o título da aba é sempre o mesmo** (“Sistema de Gestão de Mutirões de Julgamento | SJP”) em todas as telas; (b) **só a tela Início tem `<h1>`**; as demais têm apenas `<h2>` (axe `page-has-heading-one`); (c) **não há link “Ir para o conteúdo”**; (d) **o item ativo do menu não é indicado** a leitores de tela (`aria-current` ausente); (e) ao trocar de tela, o foco permanece no botão do menu e nada é anunciado; (f) o menu usa `<button>`, não `<a>`: não há endereço por tela, o botão “Voltar” do navegador sai do sistema e não é possível favoritar nem compartilhar uma tela; (g) sem `<footer>`.
- *Correção:* *hash routing* (`#/inscricao-magistrado`) com `<a href>`; `document.title` por tela; `<h1>` em cada tela; link de salto; `aria-current="page"`; após a troca, focar o `<h1>` (`tabIndex={-1}`); acrescentar rodapé com contato e declaração de acessibilidade (A12).

### P2 — Corrigir na sequência

**A6. Contraste insuficiente em componentes e textos** — WCAG 1.4.3, 1.4.11

| Elemento | Contraste medido | Mínimo |
|---|---|---|
| Borda dos campos (`#e2ded4` sobre branco) | **1,34:1** | 3:1 |
| Borda das opções de rádio/checkbox | **1,34:1 / 1,48:1** | 3:1 |
| Texto de *placeholder* (`slate-400` sobre branco) | **2,56:1** | 4,5:1 |
| Selo “info” (bronze `#8a6d3b` sobre `#f1ebdd`, 11 px) | **4,08:1** | 4,5:1 |
| Texto bronze sobre o fundo da página (`#f6f4ef`) | **4,41:1** | 4,5:1 |
| Anel de foco dos campos (azul-marinho a 10 %) | **1,21:1** | 3:1 |

*Correção:* escurecer a borda dos controles (ex.: `#767676`/`#6b7686` ≥ 3:1), *placeholder* ≥ 4,5:1 (ou eliminá-lo, já que haverá rótulo visível), escurecer o bronze de texto para ≥ 4,5:1 e revisar o selo “info”.

**A7. Obrigatoriedade só é “dita” pelo navegador** — WCAG 3.3.2
- *Evidência:* 5 campos `required`, mas nenhum rótulo indica obrigatório (0 asteriscos/“obrigatório”), e não há `aria-required`.
- *Correção:* indicar “(obrigatório)” ou “*” com legenda no início do formulário, e/ou marcar “(opcional)” nos demais (já existe em “2ª escolha — opcional”).

**A8. Sem `autocomplete` nos campos de identificação** — WCAG 1.3.5
- *Evidência:* nome, e-mail e lotação sem `autocomplete` (0 de 3).
- *Correção:* `autoComplete="name"` e `autoComplete="email"` (nome do magistrado, e-mail do magistrado e do responsável pela unidade; também em “Consultar status”).

**A9. Menu móvel sem estado e sem controle de teclado** — WCAG 4.1.2, 2.1.1
- *Evidência:* o botão “Menu” não tem `aria-expanded` nem `aria-controls`; o menu não fecha com `Esc`; ao abrir, o foco não vai para o primeiro item; o alvo mede 36×36 px.
- *Correção:* `aria-expanded`, `aria-controls`, fechar com `Esc` e devolver o foco ao botão; ampliar o alvo para ≥ 44 px.

**A10. Resultados dinâmicos nem sempre são anunciados** — WCAG 4.1.3
- *Evidência:* o resultado da consulta por **e-mail** (cartões de inscrição) é inserido sem região de anúncio; o resultado por nome usa `role="status"` e o erro, `role="alert"` (corretos). A mensagem de **inscrições encerradas** usa `role="alert"` (interrompe a leitura, embora seja informativa).
- *Correção:* envolver os resultados em região `aria-live="polite"` e mover o foco para o título dos resultados; trocar o aviso de prazo encerrado para `role="status"` com tom neutro.

**A11. Modo de alto contraste (cores forçadas)** — WCAG 1.4.1
- *Evidência* (captura com `forced-colors: active`): a opção selecionada de rádio/checkbox só se distingue pela cor da borda/fundo, que o sistema operacional substitui; sobra apenas diferença de peso de fonte (500 × 400).
- *Correção:* com controles nativos (A2) o indicador passa a ser do navegador; para o visual personalizado, usar também um marcador não dependente de cor (ícone de “check”) e `forced-color-adjust`/`@media (forced-colors: active)`.

**A12. Alvos de toque pequenos** — WCAG 2.5.8 (WCAG 2.2, AA)
- *Evidência:* a caixa da “Declaração de regularidade” mede **13×13 px**; o botão do título (“Mutirão de Julgamento”) mede 194×21 px; o botão do menu móvel, 36×36 px.
- *Correção:* caixas de seleção de 24 px ou mais (ideal 44 px de área clicável), botão do título com altura ≥ 44 px.

### P3 — Melhorias recomendadas

**A13. Campos de “Consultar status” sem rótulo visível** — WCAG 3.3.2 (boa prática): o e-mail usa só *placeholder* e o nome só `aria-label`; incluir `<label>` visível (também melhora 2.5.3, rótulo no nome).

**A14. Tamanho de letra reduzido** — rótulos de campo em 12 px, selos em 11 px e textos auxiliares em 12 px. Não reprova um critério isoladamente, mas prejudica a leitura; recomenda-se 14 px ou mais para rótulos e 12–13 px apenas para texto de apoio.

**A15. FAQ** — acrescentar `aria-controls` ligando cada pergunta à sua resposta (hoje há `aria-expanded`).

**A16. Declaração de acessibilidade e canal de contato ausentes** — práticas do eMAG e do governo digital: página/rodapé com a declaração de conformidade, limitações conhecidas e meio de contato para relatar barreiras.

**A17. Tradução em Libras (VLibras)** — não há. É recomendada nos sítios públicos; exige liberar `vlibras.gov.br` na política de segurança (CSP `script-src`/`connect-src` hoje restritos a `'self'`), decisão de segurança a ser tomada com a equipe.

**A18. Mensagem de falha de carregamento** (“Não foi possível carregar o sistema.”) é um texto simples, sem `role="alert"` e sem botão “Tentar novamente”.

**A19. Campo-isca (anti-robô)** — está oculto corretamente, mas deve ser revalidado com leitor de tela após a refatoração dos formulários.

---

## 5. Mapa dos critérios WCAG afetados

| Critério | Nível | Situação | Achados |
|---|---|---|---|
| 1.3.1 Informações e relações | A | **Falha** | A1, A2, A5 |
| 1.3.5 Finalidade dos campos | AA | **Falha** | A8 |
| 1.4.1 Uso da cor | A | **Falha (cores forçadas)** | A11 |
| 1.4.3 Contraste (mínimo) | AA | **Falha parcial** | A6 |
| 1.4.10 Reflow / 1.4.12 Espaçamento do texto | AA | Atende | — |
| 1.4.11 Contraste de não texto | AA | **Falha** | A4, A6 |
| 2.1.1 Teclado | A | **Falha parcial** (setas nos grupos; menu) | A2, A9 |
| 2.4.1 Blocos de salto | A | **Falha** | A5 |
| 2.4.2 Título da página | A | **Falha** | A5 |
| 2.4.6 Cabeçalhos e rótulos | AA | **Falha parcial** | A5, A13 |
| 2.4.7 Foco visível | AA | **Falha parcial** (fraco) | A4 |
| 2.5.8 Tamanho do alvo (2.2) | AA | **Falha parcial** | A12 |
| 3.3.1 Identificação do erro | A | **Falha** | A3 |
| 3.3.2 Rótulos ou instruções | A | **Falha** | A1, A7, A13 |
| 3.3.3 Sugestão de correção | AA | **Falha parcial** | A3 |
| 4.1.2 Nome, função, valor | A | **Falha** | A1, A2, A9 |
| 4.1.3 Mensagens de status | AA | **Falha parcial** | A3, A10 |

---

## 6. Plano de atuação

### Fase 1 — Correções rápidas e de maior impacto (1 a 2 dias) · fecha A1, A4, A5, A6, A7, A8, A9, A12, A13

1. `Field`: associar rótulo e campo (`useId`, `htmlFor`); indicar “(obrigatório)”; `autoComplete` nos campos de identificação.
2. `index.css`: regra global de foco `:focus-visible` (3 px, alto contraste); bordas dos controles ≥ 3:1; *placeholder* ≥ 4,5:1; escurecer o bronze de texto; revisar o selo “info”.
3. `App.tsx`: link “Ir para o conteúdo”, `document.title` por tela, `<h1>` em todas as telas, `aria-current`, foco no título após a troca de tela, rodapé.
4. Menu móvel: `aria-expanded`, `aria-controls`, `Esc`, alvos ≥ 44 px.
5. “Consultar status”: rótulos visíveis.

**Critério de aceite:** axe-core sem violações em todas as telas; todos os campos com nome acessível; foco sempre visível.

### Fase 2 — Formulários e mensagens (2 a 3 dias) · fecha A2, A3, A10, A11, A15

1. Trocar os grupos `role="radio"/"checkbox"` por `fieldset` + `legend` com controles nativos (estilo visual mantido, com indicador não dependente de cor).
2. Validação própria em português: resumo de erros com foco, `aria-invalid`, `aria-describedby`; foco/rolagem para a confirmação de sucesso.
3. Regiões `aria-live` para os resultados da consulta; aviso de prazo encerrado como `role="status"`.
4. Navegação por *hash* com `<a href>` (permite “Voltar” do navegador, favoritos e compartilhamento).
5. FAQ com `aria-controls`.

**Critério de aceite:** formulário concluído integralmente só pelo teclado e com leitor de tela, com erros anunciados e associados; setas funcionando nos grupos.

### Fase 3 — Validação, governança e conformidade (1 a 2 dias + contínuo)

1. **Teste com tecnologias assistivas:** NVDA + Firefox/Chrome, VoiceOver + Safari (macOS e iOS), TalkBack + Chrome; ampliação 200 % e 400 %; modo de alto contraste; somente teclado. Idealmente com pessoas usuárias.
2. **Automatizar a verificação:** incluir axe-core + Playwright no *pipeline* de publicação (falha a publicação se surgirem violações) e um roteiro manual curto a cada mudança de interface.
3. **Publicar a declaração de acessibilidade** (rodapé), com data da avaliação, nível de conformidade, limitações conhecidas e canal de contato (A16).
4. **Decidir sobre o VLibras** (A17) com a área de segurança/TI do tribunal.
5. Repetir esta avaliação após as fases 1 e 2 e arquivar o resultado.

### Estimativa e riscos

| Fase | Esforço (dev.) | Risco |
|---|---|---|
| 1 | 1 a 2 dias | baixo |
| 2 | 2 a 3 dias | médio (troca dos grupos de opções e da validação; exige testes de regressão nos formulários) |
| 3 | 1 a 2 dias + rotina | baixo |

As estimativas são aproximadas e consideram uma pessoa desenvolvedora familiarizada com o código. O prazo de publicação do mutirão pesa a favor de executar a **Fase 1 imediatamente**: ela elimina as barreiras mais graves (campos sem nome, foco invisível, navegação sem título/cabeçalho) com mudanças pequenas e de baixo risco.

---

## 7. Anexo — evidências de verificação

- Varredura axe-core (tags WCAG 2.0/2.1/2.2 A/AA + boas práticas), 5 telas × 2 larguras: regras violadas `label` (12 nós), `select-name` (4 nós), `page-has-heading-one` (8 telas/larguras).
- Tabulação por todas as telas: foco real em todos os botões e campos (sem armadilha de teclado); estilos de foco calculados conforme a seção A4.
- Reflow a 320 px: `scrollWidth` = `clientWidth` = 320 px em todas as telas.
- Espaçamento de texto (1.4.12): nenhum elemento com corte ou sobreposição (exceto o campo-isca, invisível por definição).
- Cálculo de contraste: fórmula de luminância relativa da WCAG 2.x sobre os tokens de `src/index.css`.
- Estados verificados: formulário com campos vazios, erro parcial, formulário com inscrições encerradas, consulta com erro e com resultado, FAQ, menu móvel.
