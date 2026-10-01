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
