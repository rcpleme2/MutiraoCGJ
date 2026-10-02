# Publicação no Google Cloud Run

O sistema roda em **uma única instância** (o estado fica em memória e é gravado no Firestore
a cada alteração). Por isso o deploy usa `--max-instances=1`.

## 1. Preparar o projeto Google Cloud (uma vez)

No [Cloud Shell](https://shell.cloud.google.com) (ou `gcloud` local), com seu projeto selecionado:

```bash
gcloud config set project SEU_PROJETO
gcloud services enable run.googleapis.com cloudbuild.googleapis.com firestore.googleapis.com artifactregistry.googleapis.com

# Banco Firestore (modo Native). Escolha a região mais próxima, ex.: southamerica-east1 (São Paulo)
gcloud firestore databases create --location=southamerica-east1
```

## 2. Publicar

Na pasta do projeto (clone do GitHub):

```bash
gcloud run deploy mutirao-cgj \
  --source . \
  --region southamerica-east1 \
  --allow-unauthenticated \
  --max-instances=1 \
  --set-env-vars ADMIN_PASSWORD='defina-uma-senha-forte' \
  --set-env-vars GEMINI_API_KEY='opcional-so-se-usar-IA'
```

Ao final, o comando mostra a URL pública (`https://mutirao-cgj-xxxx.a.run.app`).

- A conta de serviço padrão do Cloud Run já tem acesso ao Firestore do mesmo projeto.
- Para guardar a senha no Secret Manager em vez de variável de ambiente, use
  `--set-secrets ADMIN_PASSWORD=NOME_DO_SECRET:latest`.
- Atualizações: rode o mesmo comando novamente. Os dados ficam no Firestore e não se perdem.
- Dados de demonstração: na primeira execução a base começa vazia (só a edição padrão).
  Para incluir os dados fictícios, adicione `--set-env-vars SEED_DEMO=true` na primeira vez.

## Segurança: conta de serviço dedicada (recomendado)
Por padrão o Cloud Run usa a conta de serviço do Compute Engine, que costuma ter o papel **Editor** no projeto
(acesso a quase tudo). Crie uma conta própria que só acessa o Firestore:

```bash
PROJECT_ID=$(gcloud config get-value project)
gcloud iam service-accounts create mutirao-run --display-name="Mutirão CGJ (Cloud Run)"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:mutirao-run@$PROJECT_ID.iam.gserviceaccount.com" --role="roles/datastore.user"

gcloud run deploy mutirao-cgj --source . --region southamerica-east1 \
  --service-account="mutirao-run@$PROJECT_ID.iam.gserviceaccount.com"
```

Depois da primeira publicação, faça uma inscrição de teste e confira que o **IP gravado** (aba Magistrados/Unidades do painel)
é o seu IP real; se aparecer um IP do Google, ajuste `trust proxy` em `server.ts`.
Defina também um **alerta de orçamento** (Faturamento → Orçamentos) para se proteger de uso abusivo.

## Limite de inscrições por IP
Para frear spam, cada IP pode concluir até **30 inscrições a cada 10 minutos** (e 600 por hora no total). Só contam as inscrições
efetivamente criadas: erros de preenchimento não consomem o limite. Como servidores do tribunal podem sair pelo mesmo IP,
o valor é ajustável sem alterar o código:

```bash
gcloud run services update mutirao-cgj --region southamerica-east1 \
  --update-env-vars SIGNUP_MAX_PER_IP=100,SIGNUP_MAX_GLOBAL_PER_HOUR=1500
```

## Atualizar o site depois de mudanças no código
Com as mudanças já na branch `main` do GitHub, no Cloud Shell:

```bash
cd ~/MutiraoCGJ            # pasta do clone (se não existir: git clone https://github.com/rcpleme2/MutiraoCGJ)
git pull origin main
gcloud run deploy mutirao-cgj --source . --region southamerica-east1
```

Não é preciso repetir `--set-env-vars`: senha, chave do Gemini e demais variáveis ficam guardadas no serviço.
Os dados ficam no Firestore e não são afetados. Se o serviço pedir o projeto, rode antes
`gcloud config set project SEU_PROJECT_ID`.

## 3. Deploy automático a cada push (opcional)

Console do Cloud Run → serviço → **Configurar implantação contínua** → conectar o repositório
do GitHub e a branch `main`.

## Custos e limites
Cloud Run e Firestore têm cota gratuita mensal suficiente para este uso, mas é necessário
ter faturamento ativo no projeto (cartão). Defina um **alerta de orçamento** em Faturamento → Orçamentos.
A primeira visita após um período ocioso demora alguns segundos (instância inicia do zero)
e a sessão de administrador pode precisar de novo login.

## Rodar localmente
```bash
npm install
ADMIN_PASSWORD=minha-senha npm run dev      # usa data/state.json
```
