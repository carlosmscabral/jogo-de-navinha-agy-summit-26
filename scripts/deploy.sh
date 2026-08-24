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
#   ./scripts/deploy.sh --with-iap     # também tenta ligar o IAP (ver aviso abaixo)
#   PROJECT_ID=outro-projeto ./scripts/deploy.sh   # outro projeto GCP
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
# Sem --allow-unauthenticated: o serviço nunca fica público sem o IAP configurado por cima
# (ver Passo 8 e o README do cloud-api, seção "Autenticação do painel de admin").
gcloud run deploy "$SERVICE_NAME" \
  --source packages/cloud-api \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --service-account "$SERVICE_ACCOUNT_EMAIL" \
  --set-secrets "BOOTH_INGEST_TOKEN=${BOOTH_TOKEN_SECRET}:latest" \
  --set-secrets "ADMIN_PANEL_PASSWORD=${ADMIN_PASSWORD_SECRET}:latest" \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},VERTEX_LOCATION=${VERTEX_LOCATION}" \
  --no-allow-unauthenticated

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')"

echo ""
echo "-- 8/8: IAP --"
if [ "$WITH_IAP" -eq 1 ]; then
  echo "Tentando ligar o IAP via CLI (--with-iap)..."
  echo "AVISO: a própria Google recomenda usar o Console na PRIMEIRA vez que o IAP é ligado"
  echo "num projeto, porque a tela de consentimento OAuth ('brand') precisa existir antes, e"
  echo "criá-la por CLI é mais frágil que pelo Console. Se o comando abaixo falhar por causa"
  echo "disso, ligue o IAP uma vez pelo Console (Segurança > Identity-Aware Proxy) e rode este"
  echo "script de novo sem --with-iap nas próximas vezes — os passos 1-7 continuam idempotentes."
  gcloud run services update "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --iap
  gcloud beta services identity create --service=iap.googleapis.com --project="$PROJECT_ID" >/dev/null 2>&1 || true
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  gcloud run services add-iam-policy-binding "$SERVICE_NAME" \
    --region "$REGION" --project "$PROJECT_ID" \
    --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-iap.iam.gserviceaccount.com" \
    --role="roles/run.invoker"
  echo ""
  echo "IAP ligado. Falta autorizar cada operador do painel individualmente:"
  echo "  gcloud beta iap web add-iam-policy-binding --resource-type=cloud-run \\"
  echo "    --service=$SERVICE_NAME --region=$REGION --project=$PROJECT_ID \\"
  echo "    --member=user:EMAIL_DO_OPERADOR --role=roles/iap.httpsResourceAccessor"
else
  echo "Não solicitado (rode com --with-iap para tentar, ou configure pelo Console)."
  echo "IMPORTANTE: sem IAP na frente, '$SERVICE_URL/admin' e '/v1/admin/*' ficam protegidos"
  echo "só pela senha HTTP Basic (ADMIN_PANEL_PASSWORD) — funciona, mas não é a topologia final"
  echo "decidida na Tarefa C10. Não deixe rodando assim durante o evento."
fi

echo ""
echo "== Deploy concluído =="
echo "URL do serviço: $SERVICE_URL"
echo "Painel de admin: $SERVICE_URL/admin"
echo ""
echo "Configurar no estande (packages/daemon/.env ou variável de ambiente):"
echo "  BOOTH_CLOUD_API_BASE=$SERVICE_URL"
echo "  BOOTH_INGEST_TOKEN=<valor do segredo '$BOOTH_TOKEN_SECRET' — gcloud secrets versions access latest --secret=$BOOTH_TOKEN_SECRET>"
