#!/usr/bin/env bash
# Desfaz o que deploy.sh criou: Cloud Run, segredos, service account, e (só se pedido
# explicitamente) o próprio banco Firestore. Existe para reproducibilidade — testar em
# um projeto descartável, limpar, testar de novo — e para desmontar antes de mover o
# provisionamento para outro projeto.
#
# NUNCA desabilita as APIs do projeto: outras coisas podem depender delas, e desabilitar
# API não é uma operação que se desfaça sozinha.
#
# Uso:
#   ./scripts/undeploy.sh                    # remove Cloud Run, segredos, service account
#   ./scripts/undeploy.sh --delete-database  # também apaga o banco Firestore (destrutivo,
#                                             # pede confirmação reforçada — ver abaixo)
#   ./scripts/undeploy.sh --yes              # sem a confirmação inicial (mas o banco
#                                             # continua exigindo a confirmação reforçada)
set -uo pipefail  # sem -e: cada remoção é melhor-esforço, um recurso já ausente não é erro

# Espelha o deploy.sh: tudo aqui é relativo à raiz do repositório, inclusive a leitura de
# firebase.json que decide QUAL site do Hosting despublicar.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROJECT_ID="${PROJECT_ID:-vibe-cabral}"
REGION="${REGION:-southamerica-east1}"
FIRESTORE_DATABASE="${FIRESTORE_DATABASE:-jogo-navinha}"
SERVICE_NAME="${SERVICE_NAME:-jogo-navinha-api}"
SERVICE_ACCOUNT_NAME="${SERVICE_ACCOUNT_NAME:-jogo-navinha-api}"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
BOOTH_TOKEN_SECRET="${BOOTH_TOKEN_SECRET:-booth-ingest-token}"
ADMIN_PASSWORD_SECRET="${ADMIN_PASSWORD_SECRET:-admin-panel-password}"

SKIP_CONFIRM=0
DELETE_DATABASE=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) SKIP_CONFIRM=1 ;;
    --delete-database) DELETE_DATABASE=1 ;;
    *) echo "Argumento desconhecido: $arg" >&2; exit 2 ;;
  esac
done

echo "== Undeploy da Fase C =="
echo "Projeto:  $PROJECT_ID"
echo "Remove:   Cloud Run '$SERVICE_NAME', segredos '$BOOTH_TOKEN_SECRET'/'$ADMIN_PASSWORD_SECRET', service account '$SERVICE_ACCOUNT_EMAIL'"
echo "Despublica: só o site do telão nomeado em firebase.json — nunca o site padrão do projeto."
if [ "$DELETE_DATABASE" -eq 1 ]; then
  echo "Remove também: o banco Firestore '$FIRESTORE_DATABASE' inteiro — TODOS OS DADOS."
fi
echo ""

if [ "$SKIP_CONFIRM" -ne 1 ]; then
  read -r -p "Confirma remover estes recursos de '$PROJECT_ID'? (s/N) " reply
  case "$reply" in
    [sS]|[yY]) ;;
    *) echo "Abortado." ; exit 1 ;;
  esac
fi

command -v gcloud >/dev/null 2>&1 || { echo "gcloud não encontrado no PATH." >&2; exit 1; }
command -v firebase >/dev/null 2>&1 || { echo "firebase (firebase-tools) não encontrado no PATH." >&2; exit 1; }

gcloud config set project "$PROJECT_ID" >/dev/null

echo ""
echo "-- Removendo o serviço Cloud Run --"
gcloud run services delete "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --quiet \
  && echo "Removido." || echo "Já não existia, ou falhou (ver mensagem acima) — seguindo."

echo ""
echo "-- Despublicando o telão (Firebase Hosting) --"
# O `--site` NÃO é opcional: sem ele, `hosting:disable` age sobre o site PADRÃO do projeto
# (`<project-id>.web.app`), que pode hospedar outra aplicação sua — e derrubá-la. Só o site
# dedicado ao telão, nomeado em firebase.json, é nosso para mexer.
#
# `hosting:disable` tira o site do ar sem apagar o site nem o histórico de releases: o endereço
# passa a responder uma página "Site Not Found" e um `deploy --only hosting` futuro republica
# tudo. É o suficiente — o telão é conteúdo estático público, sem custo perceptível e sem dado
# nenhum dentro. Para sumir com o site de vez: `firebase hosting:sites:delete <site>`.
HOSTING_SITE="$(node -e "process.stdout.write(require('./firebase.json').hosting.site)" 2>/dev/null)"
if [ -n "$HOSTING_SITE" ]; then
  firebase hosting:disable --site "$HOSTING_SITE" --project "$PROJECT_ID" --force \
    && echo "Telão ('$HOSTING_SITE') fora do ar." || echo "Já estava fora, ou falhou (ver mensagem acima) — seguindo."
else
  echo "Não consegui ler 'hosting.site' de firebase.json — pulando, para não arriscar"
  echo "desabilitar o site padrão do projeto, que pode ser de outra aplicação."
fi

echo ""
echo "-- Removendo segredos --"
for secret in "$BOOTH_TOKEN_SECRET" "$ADMIN_PASSWORD_SECRET"; do
  gcloud secrets delete "$secret" --project "$PROJECT_ID" --quiet \
    && echo "Removido: $secret" || echo "Já não existia, ou falhou: $secret — seguindo."
done

echo ""
echo "-- Removendo a service account --"
gcloud iam service-accounts delete "$SERVICE_ACCOUNT_EMAIL" --project "$PROJECT_ID" --quiet \
  && echo "Removida." || echo "Já não existia, ou falhou — seguindo."

echo ""
if [ "$DELETE_DATABASE" -eq 1 ]; then
  echo "-- Removendo o banco Firestore '$FIRESTORE_DATABASE' --"
  echo "Isto apaga TODA partida, ranking e piloto já gravados neste banco. Não há como desfazer."
  echo "Mesma barreira do painel de admin (Tarefa C9): digite EXCLUIR para confirmar."
  read -r -p "> " confirm_word
  if [ "$confirm_word" = "EXCLUIR" ]; then
    gcloud firestore databases delete --database="$FIRESTORE_DATABASE" --project="$PROJECT_ID" --quiet \
      && echo "Banco '$FIRESTORE_DATABASE' removido." || echo "Falhou ao remover o banco — ver mensagem acima."
  else
    echo "Palavra não confere — o banco NÃO foi tocado."
  fi
else
  echo "-- Banco Firestore '$FIRESTORE_DATABASE' preservado (use --delete-database para apagar) --"
fi

echo ""
echo "-- APIs do projeto: deixadas ligadas de propósito --"
echo "(desabilitar API pode afetar outras coisas no projeto; não é o papel deste script)"

echo ""
echo "== Undeploy concluído =="
