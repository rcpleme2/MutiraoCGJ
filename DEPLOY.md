# Publicação no Google Cloud Run

O sistema roda em **uma única instância** (o estado fica em memória e é gravado no Firestore a cada alteração),
por isso o serviço usa `--max-instances=1`. O servidor só é publicado dentro da imagem (`server-dist/`); a pasta pública
(`dist/`) contém apenas o site.

## 1. Preparar o projeto Google Cloud (uma vez)

No [Cloud Shell](https://shell.cloud.google.com), com o projeto selecionado. Atenção: use o **ID** do projeto
(ex.: `meu-projeto-123456`), não o número:

```bash
gcloud config set project SEU_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com firestore.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com

# Firestore (modo Native), na região mais próxima (ex.: São Paulo)
gcloud firestore databases create --location=southamerica-east1
```

## 2. Conta de serviço dedicada (obrigatório)

Sem isto o serviço roda com a conta padrão do Compute Engine, que costuma ter o papel **Editor** em todo o projeto
(se o servidor for comprometido, o invasor teria acesso a quase tudo). A conta abaixo só enxerga o Firestore.

```bash
PROJECT_ID=$(gcloud config get-value project)
SA="mutirao-run@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create mutirao-run --display-name="Mutirão CGJ (Cloud Run)"
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$SA" --role="roles/datastore.user"
```

**Se o deploy automático (gatilho do Cloud Build) estiver ativo**, a conta que executa o build precisa de permissão para
"agir como" a nova conta. Veja qual é em *Cloud Build → Gatilhos → (seu gatilho) → Conta de serviço* (costuma ser
`NUMERO_DO_PROJETO-compute@developer.gserviceaccount.com` ou `NUMERO_DO_PROJETO@cloudbuild.gserviceaccount.com`) e rode:

```bash
BUILD_SA="CONTA_DO_GATILHO"   # cole o e-mail exato mostrado no gatilho
gcloud iam service-accounts add-iam-policy-binding $SA \
  --member="serviceAccount:$BUILD_SA" --role="roles/iam.serviceAccountUser"
```

Aplique a conta ao serviço já existente (não derruba o site; cria uma nova revisão):

```bash
gcloud run services update mutirao-cgj --region southamerica-east1 --service-account="$SA"
```

**Como conferir:** `gcloud run services describe mutirao-cgj --region southamerica-east1 --format='value(spec.template.spec.serviceAccountName)'`
deve mostrar `mutirao-run@...`. Depois faça uma inscrição de teste e confirme em *Firestore → Dados* que ela foi gravada
(se o Firestore recusar, o painel mostra "Falha ao gravar os dados").

## 3. Senha e chaves no Secret Manager (recomendado)

Variáveis de ambiente ficam **visíveis** para qualquer pessoa com acesso de leitura ao serviço (console ou
`gcloud run services describe`) e podem aparecer em históricos de comandos. No Secret Manager o serviço guarda apenas uma
referência. Use `printf` (e não `echo`) para não gravar uma quebra de linha no fim do valor:

```bash
printf '%s' 'SENHA-FORTE-AQUI' | gcloud secrets create mutirao-admin-password --data-file=-
printf '%s' 'CHAVE-DO-GEMINI'  | gcloud secrets create mutirao-gemini-key --data-file=-    # opcional

for s in mutirao-admin-password mutirao-gemini-key; do
  gcloud secrets add-iam-policy-binding $s --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor"
done

gcloud run services update mutirao-cgj --region southamerica-east1 \
  --remove-env-vars=ADMIN_PASSWORD,GEMINI_API_KEY \
  --update-secrets=ADMIN_PASSWORD=mutirao-admin-password:latest,GEMINI_API_KEY=mutirao-gemini-key:latest
```

Para trocar a senha: `printf '%s' 'NOVA' | gcloud secrets versions add mutirao-admin-password --data-file=-` e publique
uma nova revisão (`gcloud run services update mutirao-cgj --region southamerica-east1 --update-env-vars=REFRESH=$(date +%s)`).
A senha **só** é definida por `ADMIN_PASSWORD`; o painel não permite alterá-la.

## 4. Publicar

```bash
gcloud run deploy mutirao-cgj --source . --region southamerica-east1 \
  --allow-unauthenticated --max-instances=1 --service-account="$SA" \
  --set-secrets=ADMIN_PASSWORD=mutirao-admin-password:latest
```

Ao final, o comando mostra a URL pública. Atualizações: o gatilho de deploy automático publica a cada commit na `main`
(ou rode o mesmo comando manualmente). Os dados ficam no Firestore e não se perdem.

> **Cuidado ao publicar durante as inscrições.** Na troca de versão, a revisão antiga e a nova coexistem por alguns
> segundos; o que a antiga gravar nesse intervalo só aparece para a nova após um reinício. Evite publicar em horário de
> pico ou nos dias de inscrição, e proteja a `main` (exigir pull request) para que nada entre em produção sem querer.

## 5. Primeiro acesso ao painel (verificação em duas etapas)

No primeiro acesso após a publicação, informe a senha: o painel mostra um **QR code**. Escaneie com um aplicativo
autenticador (Google Authenticator, Microsoft Authenticator etc.) e digite o código de 6 dígitos. A partir daí, todo acesso
exige senha + código. **Quem tiver a senha primeiro cadastra o autenticador**, então faça esse primeiro acesso logo
após publicar.

Perdeu o celular? Defina `RESET_ADMIN_2FA=true` (`gcloud run services update ... --update-env-vars=RESET_ADMIN_2FA=true`),
entre novamente (será pedido novo cadastro) e **remova a variável** em seguida.

## 6. Conferir que o Firestore não está aberto ao público

As *regras de segurança* do Firestore não afetam este sistema (ele acessa o banco com a conta de serviço), mas um banco em
"modo de teste" permitiria que qualquer pessoa que descubra o ID do projeto leia e grave os dados sem passar pelo site.
Teste de fora, sem credenciais — o resultado correto é **negado**:

```bash
PROJECT_ID=$(gcloud config get-value project)
curl -s "https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/mutirao_magistrates?pageSize=1"
```

- Correto: resposta com `"code": 403` / `"PERMISSION_DENIED"` (ou 401).
- **Errado:** se aparecer `"documents": [...]`, o banco está aberto. Corrija em *Firebase Console → Firestore → Regras* para
  `rules_version = '2'; service cloud.firestore { match /databases/{db}/documents { match /{doc=**} { allow read, write: if false; } } }`
  e publique as regras.

## 7. Variáveis de ambiente

| Variável | Para quê | Padrão |
|---|---|---|
| `ADMIN_PASSWORD` | Senha do painel (use Secret Manager) | aleatória a cada início (aparece no log) |
| `GEMINI_API_KEY` | Sugestões por IA (opcional; use Secret Manager) | — |
| `ALLOWED_EMAIL_DOMAINS` | Domínios de e-mail aceitos nas inscrições (lista por vírgula; subdomínios valem; vazio = sem restrição) | `tjpr.jus.br` |
| `SIGNUP_MAX_PER_IP` | Inscrições concluídas por IP a cada 10 min | `30` |
| `SIGNUP_MAX_ERRORS_PER_IP` | Tentativas com erro por IP a cada 10 min | `120` |
| `SIGNUP_MAX_GLOBAL_PER_HOUR` | Inscrições concluídas por hora, no total | `600` |
| `RESET_ADMIN_2FA` | `true` redefine o autenticador (remova depois) | — |
| `SEED_DEMO` | `true` carrega dados fictícios na primeira execução | — |

Exemplo: `gcloud run services update mutirao-cgj --region southamerica-east1 --update-env-vars=SIGNUP_MAX_PER_IP=100`.

## 8. Regras de funcionamento

- **Painel de vinculações (restrito à administração):** *Administração → Painel de vinculações*. Tabela única com as vinculações do
  sistema e as importadas de planilha (colunas **Nome / Área / Designado Para**); desfazer uma vinculação a remove do painel.
  Cada linha tem o botão *Desistência* (pede o número do SEI e move o magistrado para a relação de desistentes). O botão
  *Exportar relatório em PDF* gera designações vigentes (total e por área) e desistentes com o SEI. Publicamente, só a
  *Consulta pelo nome completo* (em Consultar Status) informa se há vinculação ativa ou revogada por desistência.
- **Inscrições:** os campos de escolha do magistrado (1ª e 2ª escolha e aceite de audiências) e as áreas da unidade começam
  sem seleção; todos são obrigatórios (o servidor também valida).

- **Prazo de inscrições:** vale a chave "Inscrições públicas habilitadas" **e** a janela de datas da edição, em horário de
  Brasília (o último minuto de encerramento é incluído). Fora da janela os formulários ficam visíveis, porém bloqueados, com
  a data correta. O cadastro manual pelo painel não é limitado pela janela.
- **Registro de atividades:** nunca é apagado do Firestore (a tela mostra as 5.000 mais recentes). Ações administrativas,
  acessos e falhas de autenticação também vão ao *Cloud Logging* (`gcloud logging read 'jsonPayload.audit.category="Acesso"'`).
- **Cache:** respostas da API não são armazenadas pelo navegador.

## Rodar localmente
```bash
npm install
ADMIN_PASSWORD=minha-senha npm run dev      # usa data/state.json; o primeiro acesso cadastra o 2FA
```
