#!/usr/bin/env bash
# Provisiona e publica a Fase C inteira num projeto GCP: APIs, banco Firestore nomeado,
# regras/índices, service account, segredos, e o Cloud Run com o admin-app vendorizado.
# Idempotente: rodar de novo sobre um projeto já provisionado só atualiza o que mudou.
#
# Todas as variáveis abaixo têm default para `vibe-cabral`, mas podem ser sobrescritas —
# é o que torna este script reproduzível para "deploy eventual em outro projeto no
# futuro" (o pedido original que motivou este arquivo, 2026-08-24).
#
# Uso:
#   ./scripts/deploy.sh                # provisiona vibe-cabral, pede confirmação
#   ./scripts/deploy.sh --yes          # sem confirmação (CI, automação)
#   ./scripts/deploy.sh --with-iap     # recusa com explicação — IAP no Cloud Run é por
#                                      # serviço inteiro, e bloquearia a ingestão do estande
#                                      # junto (ver Passo 8/8 abaixo, corrigido em 2026-08-24)
#   PROJECT_ID=outro-projeto ./scripts/deploy.sh   # outro projeto GCP
#
# O serviço sobe com --allow-unauthenticated de propósito: as duas credenciais deste
# projeto (o token Bearer do estande, a senha HTTP Basic do painel) são autenticação de
# APLICAÇÃO — só funcionam se a plataforma deixar o tráfego chegar ao código.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vibe-cabral}"
REGION="${REGION:-southamerica-east1}"
VERTEX_LOCATION="${VERTEX_LOCATION:-global}"
FIRESTORE_DATABASE="${FIRESTORE_DATABASE:-jogo-navinha}"
SERVICE_NAME="${SERVICE_NAME:-jogo-navinha-api}"
SERVICE_ACCOUNT_NAME="${SERVICE_ACCOUNT_NAME:-jogo-navinha-api}"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
BOOTH_TOKEN_SECRET="${BOOTH_TOKEN_SECRET:-booth-ingest-token}"
ADMIN_PASSWORD_SECRET="${ADMIN_PASSWORD_SECRET:-admin-panel-password}"

SKIP_CONFIRM=0
WITH_IAP=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) SKIP_CONFIRM=1 ;;
    --with-iap) WITH_IAP=1 ;;
    *) echo "Argumento desconhecido: $arg" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "== Deploy da Fase C =="
echo "Projeto:        $PROJECT_ID"
echo "Região:         $REGION (Cloud Run + Firestore)"
echo "Vertex AI:      $VERTEX_LOCATION"
echo "Banco Firestore: $FIRESTORE_DATABASE (nomeado, nunca o (default) — Spec 08 §6.3)"
echo "Serviço:        $SERVICE_NAME"
echo ""

if [ "$SKIP_CONFIRM" -ne 1 ]; then
  read -r -p "Confirma provisionar/atualizar recursos reais no projeto '$PROJECT_ID'? (s/N) " reply
  case "$reply" in
    [sS]|[yY]) ;;
    *) echo "Abortado." ; exit 1 ;;
  esac
fi

command -v gcloud >/dev/null 2>&1 || { echo "gcloud não encontrado no PATH." >&2; exit 1; }
command -v firebase >/dev/null 2>&1 || { echo "firebase (firebase-tools) não encontrado no PATH." >&2; exit 1; }

gcloud config set project "$PROJECT_ID" >/dev/null

echo ""
echo "-- 1/8: Habilitando APIs necessárias (idempotente) --"
gcloud services enable \
  firestore.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project="$PROJECT_ID"

echo ""
echo "-- 2/8: Banco Firestore nomeado '$FIRESTORE_DATABASE' --"
if gcloud firestore databases describe --database="$FIRESTORE_DATABASE" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Já existe — não mexe no que já está lá (o (default) do projeto continua intocado)."
else
  echo "Criando (Native mode, região $REGION)..."
  gcloud firestore databases create \
    --database="$FIRESTORE_DATABASE" \
    --location="$REGION" \
    --type=firestore-native \
    --project="$PROJECT_ID"
fi

echo ""
echo "-- 3/8: Regras e índices do Firestore --"
# --project sobrescreve .firebaserc — funciona mesmo sem esse arquivo existir localmente,
# o que é o que torna este passo reproduzível para outro projeto sem editar nada versionado.
firebase deploy --project="$PROJECT_ID" --only "firestore:$FIRESTORE_DATABASE"

echo ""
echo "-- 4/8: Service account do Cloud Run --"
if gcloud iam service-accounts describe "$SERVICE_ACCOUNT_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Já existe: $SERVICE_ACCOUNT_EMAIL"
else
  echo "Criando: $SERVICE_ACCOUNT_EMAIL"
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
    --display-name="Jogo de Navinha — API de ingestão (Fase C)" \
    --project="$PROJECT_ID"
fi
echo "Concedendo papéis (add-iam-policy-binding é idempotente — não duplica)..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/datastore.user" \
  --condition=None >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/aiplatform.user" \
  --condition=None >/dev/null

echo ""
echo "-- 5/8: Segredos (Secret Manager) --"
# Só cria se ainda não existir — nunca sobrescreve um segredo que o operador já configurou
# (rotacionar é uma decisão separada, deliberada, não um efeito colateral de rodar este script
# de novo). Gerados aqui, mostrados uma única vez: guarde-os, não há como reler o valor depois.
#
# A concessão de roles/secretmanager.secretAccessor roda SEMPRE, mesmo quando o segredo já
# existia — corrigido depois de descobrir ao vivo (primeiro deploy real, 2026-08-24) que só
# criar o segredo não basta: sem o papel no próprio segredo, o Cloud Run recusa a revisão com
# "Permission denied on secret ... at the secret, project or higher level." add-iam-policy-
# binding é idempotente, então rodar de novo sobre um segredo que já tinha o papel não duplica
# nada — é seguro reexecutar este passo em qualquer estado.
create_secret_if_missing() {
  local name="$1"
  if gcloud secrets describe "$name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "Segredo '$name' já existe — mantido como está."
  else
    local value
    value="$(openssl rand -base64 32)"
    echo "Criando segredo '$name'..."
    printf '%s' "$value" | gcloud secrets create "$name" \
      --data-file=- \
      --replication-policy=automatic \
      --project="$PROJECT_ID"
    echo "  Valor gerado (guarde agora, não será mostrado de novo): $value"
  fi
  gcloud secrets add-iam-policy-binding "$name" \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" \
    --project="$PROJECT_ID" >/dev/null
}
create_secret_if_missing "$BOOTH_TOKEN_SECRET"
create_secret_if_missing "$ADMIN_PASSWORD_SECRET"

echo ""
echo "-- 6/8: Build local (shared, admin-app, vendorização do cloud-api) --"
npm run build --workspace=packages/shared
npm run build --workspace=packages/admin-app
npm run vendor --workspace=packages/cloud-api

echo ""
echo "-- 7/8: Deploy do Cloud Run --"
# CORRIGIDO ao vivo, 2026-08-24: era --no-allow-unauthenticated. Isso está ERRADO para esta
# arquitetura — com o Cloud Run exigindo autenticação própria (IAM da plataforma), toda
# requisição sem identidade Google é recusada com 403 ANTES de chegar ao código do serviço,
# inclusive o token Bearer do estande (Tarefa C3) e a senha HTTP Basic do painel (Tarefa C10).
# As duas camadas de autenticação deste projeto são de APLICAÇÃO, de propósito — só funcionam
# se a plataforma deixar o tráfego passar. --allow-unauthenticated é o correto aqui: o serviço
# fica alcançável na rede, e o código (`isAuthorized`/`isAdminAuthorized`) decide quem entra.
gcloud run deploy "$SERVICE_NAME" \
  --source packages/cloud-api \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --service-account "$SERVICE_ACCOUNT_EMAIL" \
  --set-secrets "BOOTH_INGEST_TOKEN=${BOOTH_TOKEN_SECRET}:latest" \
  --set-secrets "ADMIN_PANEL_PASSWORD=${ADMIN_PASSWORD_SECRET}:latest" \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},VERTEX_LOCATION=${VERTEX_LOCATION}" \
  --allow-unauthenticated

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')"

echo ""
echo "-- 8/8: IAP --"
if [ "$WITH_IAP" -eq 1 ]; then
  echo "ERRO: --with-iap foi pedido, mas IAP no Cloud Run é POR SERVIÇO, não por rota."
  echo "Ligá-lo aqui bloquearia '/v1/matches' também — o estande, que só carrega o token"
  echo "Bearer da Tarefa C3 e nenhuma identidade Google, tomaria o MESMO 403 que motivou"
  echo "esta correção. Isso não é uma limitação deste script: é uma limitação do IAP em"
  echo "Cloud Run (confirmado na documentação oficial, 2026-08-24) — não existe forma de"
  echo "isentar '/v1/matches' do IAP num único serviço."
  echo ""
  echo "Para usar IAP de verdade, o painel precisaria de um SEGUNDO serviço Cloud Run,"
  echo "separado do de ingestão — decisão de arquitetura fora do escopo deste script."
  echo "Recusando ligar o IAP. Rode sem --with-iap; a senha HTTP Basic é a única camada"
  echo "de autenticação do painel nesta topologia de serviço único, e é suficiente desde"
  echo "que 'ADMIN_PANEL_PASSWORD' seja um valor forte (gerado por este script) e o serviço"
  echo "não seja anunciado publicamente."
  exit 1
else
  echo "IAP não é usado nesta topologia de serviço único (ver Tarefa C10, corrigido em"
  echo "2026-08-24): protegeria '/v1/admin/*' mas bloquearia '/v1/matches' junto, já que o"
  echo "IAP do Cloud Run é por serviço inteiro, não por rota. A senha HTTP Basic"
  echo "(ADMIN_PANEL_PASSWORD) é a única camada de autenticação do painel aqui, por desenho."
fi

echo ""
echo "== Deploy concluído =="
echo "URL do serviço: $SERVICE_URL"
echo "Painel de admin: $SERVICE_URL/admin"
echo ""
echo "Configurar no estande (packages/daemon/.env ou variável de ambiente):"
echo "  BOOTH_CLOUD_API_BASE=$SERVICE_URL"
echo "  BOOTH_INGEST_TOKEN=<valor do segredo '$BOOTH_TOKEN_SECRET' — gcloud secrets versions access latest --secret=$BOOTH_TOKEN_SECRET>"
