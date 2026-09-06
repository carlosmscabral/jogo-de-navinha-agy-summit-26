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
#                                      # junto (ver Passo 11/11 abaixo, corrigido em 2026-08-24)
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
# Segundo serviço Cloud Run, MESMA imagem do primeiro, com CARDGEN_ENABLED=1 (Passo 9/11).
# Nome e service account próprios porque 'vibe-cabral' é um sandbox compartilhado — nada aqui
# pode reivindicar um recurso padrão do projeto.
CARDGEN_SERVICE_NAME="${CARDGEN_SERVICE_NAME:-jogo-navinha-cardgen}"
CARDGEN_SA_NAME="${CARDGEN_SA_NAME:-jogo-navinha-cardgen}"
CARDGEN_SA_EMAIL="${CARDGEN_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
CARDGEN_TRIGGER_NAME="${CARDGEN_TRIGGER_NAME:-jogo-navinha-cardgen-trigger}"

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
echo "-- 1/11: Habilitando APIs necessárias (idempotente) --"
gcloud services enable \
  firestore.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firebasehosting.googleapis.com \
  eventarc.googleapis.com \
  pubsub.googleapis.com \
  --project="$PROJECT_ID"

echo ""
echo "-- 2/11: Banco Firestore nomeado '$FIRESTORE_DATABASE' --"
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
echo "-- 3/11: Regras e índices do Firestore --"
# --project sobrescreve .firebaserc — funciona mesmo sem esse arquivo existir localmente,
# o que é o que torna este passo reproduzível para outro projeto sem editar nada versionado.
firebase deploy --project="$PROJECT_ID" --only "firestore:$FIRESTORE_DATABASE"

# `companies/catalog` é a fonte única do catálogo de empresas: é o que a canonicalização na
# nuvem consulta e o que `GET /v1/companies` serve aos dois estandes. Sem semear, o documento só
# nasce no primeiro "Salvar" do painel — e até lá a tela abre com uma lista VAZIA, que um clique
# descuidado transforma no catálogo de verdade das duas estações. O script NUNCA sobrescreve um
# catálogo existente e não vazio; um deploy que apagasse as empresas cadastradas pelo operador na
# véspera seria pior que um deploy que não semeia.
PROJECT_ID="$PROJECT_ID" node "$(dirname "$0")/seed-company-catalog.mjs" --database "$FIRESTORE_DATABASE"

echo ""
echo "-- 4/11: Service account do Cloud Run --"
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
echo "-- 5/11: Segredos (Secret Manager) --"
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
echo "-- 6/11: App Web do Firebase (config do SDK cliente: telão e tela Rankings do admin-app) --"
# Achado ao vivo, 2026-08-24: a tela Rankings do admin-app lê `company_rankings` direto do
# Firestore pelo SDK cliente (mesmo padrão do leaderboard-app, Tarefa C6/C7) — precisa de um
# "app Web" registrado no projeto Firebase, um tipo de recurso que nenhum passo anterior cria.
# Sem isso, o build fica com VITE_FIREBASE_PROJECT_ID etc. vazios (Vite grava esses valores no
# bundle em tempo de build, não de execução) e a tela falha com "is not configured".
#
# A API key deste config NÃO é segredo — é normal e esperado ela aparecer no bundle JS
# público; a segurança de verdade são as regras do Firestore (Passo 3), que só permitem
# leitura pública e negam toda escrita de cliente. Por isso não vai para o Secret Manager.
WEB_APP_NAME="${WEB_APP_NAME:-jogo-navinha-web}"

find_web_app_id() {
  firebase apps:list --project "$PROJECT_ID" --json 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      const apps = JSON.parse(s).result || [];
      const found = apps.find((a) => a.displayName === process.argv[1] && a.platform === "WEB");
      process.stdout.write(found ? found.appId : "");
    });
  ' "$WEB_APP_NAME"
}

WEB_APP_ID="$(find_web_app_id)"
if [ -z "$WEB_APP_ID" ]; then
  echo "Criando app Web '$WEB_APP_NAME'..."
  firebase apps:create WEB "$WEB_APP_NAME" --project "$PROJECT_ID" >/dev/null
  WEB_APP_ID="$(find_web_app_id)"
else
  echo "App Web '$WEB_APP_NAME' já existe ($WEB_APP_ID)."
fi

sdk_config_field() {
  firebase apps:sdkconfig WEB "$WEB_APP_ID" --project "$PROJECT_ID" --json 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      process.stdout.write(JSON.parse(s).result.sdkConfig[process.argv[1]] || "");
    });
  ' "$1"
}
export VITE_FIREBASE_API_KEY="$(sdk_config_field apiKey)"
export VITE_FIREBASE_AUTH_DOMAIN="$(sdk_config_field authDomain)"
export VITE_FIREBASE_PROJECT_ID="$(sdk_config_field projectId)"
export VITE_FIREBASE_STORAGE_BUCKET="$(sdk_config_field storageBucket)"
export VITE_FIREBASE_MESSAGING_SENDER_ID="$(sdk_config_field messagingSenderId)"
export VITE_FIREBASE_APP_ID="$(sdk_config_field appId)"

echo ""
echo "-- 7/11: Build local (shared, admin-app, leaderboard-app, vendorização do cloud-api) --"
# As VITE_FIREBASE_* exportadas acima precisam estar no ambiente ANTES dos builds do
# admin-app e do leaderboard-app — o Vite grava esses valores no bundle nesse momento, não
# depois. É por isso que o telão é construído AQUI e não por `npm run build` na raiz: só este
# script sabe as seis variáveis. Um telão construído sem elas sobe, mas nasce sem nuvem — o
# selo fica em "SEM SINAL" para sempre e nada explica por quê.
npm run build --workspace=packages/shared
npm run build --workspace=packages/admin-app
npm run build --workspace=packages/leaderboard-app
npm run vendor --workspace=packages/cloud-api

echo ""
echo "-- 8/11: Deploy do Cloud Run --"
# CORRIGIDO ao vivo, 2026-08-24: era --no-allow-unauthenticated. Isso está ERRADO para esta
# arquitetura — com o Cloud Run exigindo autenticação própria (IAM da plataforma), toda
# requisição sem identidade Google é recusada com 403 ANTES de chegar ao código do serviço,
# inclusive o token Bearer do estande (Tarefa C3) e a senha HTTP Basic do painel (Tarefa C10).
# As duas camadas de autenticação deste projeto são de APLICAÇÃO, de propósito — só funcionam
# se a plataforma deixar o tráfego passar. --allow-unauthenticated é o correto aqui: o serviço
# fica alcançável na rede, e o código (`isAuthorized`/`isAdminAuthorized`) decide quem entra.
# MIN_INSTANCES / CPU_THROTTLING, acrescentados em 2026-08-24 depois da bateria de moderação:
# o default do Cloud Run é escalar para zero, e num estande isso é o pior caso possível. O
# tráfego aqui é esparso por natureza — um visitante a cada poucos minutos —, então o container
# morre ENTRE visitantes e cada pessoa paga um cold start inteiro: boot do Node, construção
# preguiçosa do cliente Vertex (packages/cloud-api/src/vertex.ts) e o primeiro token ADC, tudo
# somado ao tempo do modelo. A bateria de 100 callsigns mostrou isso na primeira linha: o caso
# CYBER_ACE, o primeiro da rodada, levou 8289ms e estourou o teto — o maior valor da rodada
# inteira, num nome perfeitamente inocente. Com teto de 8s e falha fechada, um cold start não
# deixa o visitante esperando: faz ele perder o codinome.
#
# --no-cpu-throttling (CPU sempre alocada) tem dois motivos. Um é latência: sem ele a instância
# ociosa acorda com CPU limitada e a primeira requisição depois de uma pausa fica mais lenta. O
# outro é medição: o log de resposta tardia em moderation-l2.ts roda DEPOIS de a resposta já ter
# sido enviada, e com CPU estrangulada esse callback fica na fila até a próxima requisição —
# reportando um tempo inflado pelo estrangulamento em vez do tempo real do modelo.
#
# Custo: uma instância acesa 24/7 é da ordem de US$ 15-20/mês. Para dois dias de evento é
# irrelevante, mas o serviço não precisa ficar assim entre os testes — exporte MIN_INSTANCES=0
# fora do evento e o comportamento volta ao default de escalar para zero.
MIN_INSTANCES="${MIN_INSTANCES:-1}"
CPU_THROTTLING_FLAG="--no-cpu-throttling"
if [ "$MIN_INSTANCES" -eq 0 ]; then
  # Sem instância mínima, CPU sempre alocada não faria sentido (não há instância para manter
  # acesa) e o gcloud recusa a combinação em algumas versões.
  CPU_THROTTLING_FLAG="--cpu-throttling"
fi

gcloud run deploy "$SERVICE_NAME" \
  --source packages/cloud-api \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --service-account "$SERVICE_ACCOUNT_EMAIL" \
  --set-secrets "BOOTH_INGEST_TOKEN=${BOOTH_TOKEN_SECRET}:latest" \
  --set-secrets "ADMIN_PANEL_PASSWORD=${ADMIN_PASSWORD_SECRET}:latest" \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},VERTEX_LOCATION=${VERTEX_LOCATION}" \
  --min-instances "$MIN_INSTANCES" \
  "$CPU_THROTTLING_FLAG" \
  --allow-unauthenticated

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')"

echo ""
echo "-- 9/11: Serviço 'cardgen' e o gatilho Eventarc (cartão SVG da nave) --"
# O que este passo monta: a criação de um documento em matches/{match_id} dispara um gatilho
# Eventarc que chama POST /internal/cardgen no serviço '$CARDGEN_SERVICE_NAME', que relê o
# documento, renderiza o SVG da nave e grava de volta. NADA disto está no caminho síncrono de
# POST /v1/matches — o estande considera a partida sincronizada sem esperar cartão nenhum.
#
# Mesma IMAGEM do serviço público, papel diferente: só a env var CARDGEN_ENABLED=1 separa os
# dois, e é ela que faz o processo montar apenas /v1/health e /internal/cardgen (o painel e a
# ingestão não existem lá — provado por packages/cloud-api/src/cardgen-routes.test.ts).
# Reaproveitar a imagem exata do Passo 8, em vez de um segundo `--source`, evita um build do
# Cloud Build inteiro e garante que "mesma imagem" seja literalmente verdade, não coincidência.
CARDGEN_IMAGE="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format='value(spec.template.spec.containers[0].image)')"
if [ -z "$CARDGEN_IMAGE" ]; then
  echo "ERRO: não consegui ler a imagem do serviço '$SERVICE_NAME' recém-publicado." >&2
  echo "Sem ela não dá para publicar o cardgen com a MESMA imagem. Rode o Passo 8 de novo." >&2
  exit 1
fi

# Service account PRÓPRIA, com um papel só: roles/datastore.user. Reusar a do serviço público
# daria ao cardgen acesso ao Vertex AI e aos dois segredos, que ele não usa para nada.
if gcloud iam service-accounts describe "$CARDGEN_SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Service account já existe: $CARDGEN_SA_EMAIL"
else
  echo "Criando: $CARDGEN_SA_EMAIL"
  gcloud iam service-accounts create "$CARDGEN_SA_NAME" \
    --display-name="Jogo de Navinha — geração do cartão SVG da nave" \
    --project="$PROJECT_ID"
fi
# datastore.user: ler a partida e gravar os dois campos do cartão.
# eventarc.eventReceiver + run.invoker: a MESMA SA é a identidade do gatilho, e é ela que
# chama o serviço — que sobe com --no-allow-unauthenticated, então sem run.invoker o gatilho
# recebe 403 em toda entrega e o sintoma é "o cartão nunca aparece", sem erro visível.
for role in roles/datastore.user roles/eventarc.eventReceiver roles/run.invoker; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${CARDGEN_SA_EMAIL}" \
    --role="$role" \
    --condition=None >/dev/null
done

# Pré-requisito fácil de perder: o agente de serviço do Pub/Sub precisa poder cunhar tokens em
# nome da SA acima para assinar as entregas. Sem isto, `eventarc triggers create` falha com uma
# mensagem obscura sobre permissão do serviço, que não menciona nem o Pub/Sub nem este papel.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --condition=None >/dev/null

# --min-instances 0 e --cpu-throttling são o OPOSTO do Passo 8, pelo motivo oposto: lá um cold
# start custa o codinome do visitante; aqui ninguém está esperando. O consumo do cartão é "bem
# depois do jogo jogado", então ele pode chegar 5 segundos ou 5 minutos depois.
# --no-allow-unauthenticated: só a SA do gatilho alcança este serviço.
gcloud run deploy "$CARDGEN_SERVICE_NAME" \
  --image "$CARDGEN_IMAGE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --service-account "$CARDGEN_SA_EMAIL" \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},CARDGEN_ENABLED=1" \
  --min-instances 0 \
  --cpu-throttling \
  --no-allow-unauthenticated

# O gatilho é criado uma vez e não muda: `describe || create` mantém a idempotência do resto do
# script. Só 'created' — a gravação de volta é um `update`, que emite 'updated' e não reentra
# aqui. Escutar 'written' fecharia um laço infinito de renderização.
#
# A localização do gatilho TEM de ser a do banco Firestore, e o banco nasce em $REGION no Passo
# 2, então as duas batem por construção. Se o Eventarc recusar gatilhos de Firestore nesta
# região, mova o gatilho (e só ele) para a região suportada mais próxima: o
# --destination-run-region continua sendo o do serviço.
#
# --event-data-content-type é OBRIGATÓRIO aqui, apesar de o `gcloud ... --help` documentar
# "application/json" como padrão. Achado ao vivo em 2026-09-06: sem a flag, o Eventarc recusa a
# criação com `invalid value for trigger.event_data_content_type: "" is not supported by this
# event type` — para eventos diretos do Firestore o campo não ganha default nenhum.
# Qual dos dois valores não importa para NÓS: `/internal/cardgen` nunca lê o corpo da requisição
# (packages/cloud-api/src/index.ts), só o cabeçalho `ce-subject`, e relê o documento no Firestore.
# Escolhido "application/protobuf", que é a codificação nativa do evento e mantém o
# `express.json()` global (index.ts:101) fora do caminho: nada de gastar CPU desserializando um
# payload que ninguém consome, nem de arriscar um 400 do parser virar retentativa infinita.
if gcloud eventarc triggers describe "$CARDGEN_TRIGGER_NAME" --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Gatilho '$CARDGEN_TRIGGER_NAME' já existe."
else
  echo "Criando o gatilho '$CARDGEN_TRIGGER_NAME'..."
  gcloud eventarc triggers create "$CARDGEN_TRIGGER_NAME" \
    --location="$REGION" \
    --destination-run-service="$CARDGEN_SERVICE_NAME" \
    --destination-run-region="$REGION" \
    --destination-run-path="/internal/cardgen" \
    --event-filters="type=google.cloud.firestore.document.v1.created" \
    --event-filters="database=$FIRESTORE_DATABASE" \
    --event-filters-path-pattern="document=matches/{matchId}" \
    --event-data-content-type="application/protobuf" \
    --service-account="$CARDGEN_SA_EMAIL" \
    --project="$PROJECT_ID"
fi

echo ""
echo "-- 10/11: Hosting do telão --"
# Decidido em 2026-08-24, no Gate M3: o telão vai para o Firebase Hosting, NÃO para dentro do
# container do Cloud Run como o admin-app. Os dois motivos:
#
#   1. O admin-app está no container porque precisa da MESMA senha HTTP Basic de `/v1/admin/*`
#      (`requireAdminAuth` roda antes do `express.static`, em src/index.ts). O telão é público —
#      postura de autenticação diferente, hospedagem diferente. Não é inconsistência.
#   2. O telão não fala com esta API: ele lê o Firestore direto, por `onSnapshot`. Dentro do
#      container, ganharia uma dependência de disponibilidade que hoje não tem — um deploy ruim
#      da API às 9h da manhã derrubaria o telão junto.
#
# O `--only hosting` é deliberado (o Passo 3 já publicou o Firestore): evita que este passo
# republique regras por acidente.
#
# SITE DEDICADO, e este ponto é o que impede um acidente caro: um projeto Firebase já nasce com
# um site padrão de mesmo nome (`<project-id>.web.app`), e `vibe-cabral.web.app` já hospeda outra
# aplicação. Publicar o telão ali a SOBRESCREVERIA. O `site` em firebase.json aponta para um site
# só nosso, e é a única fonte da verdade desse nome — lido daqui, nunca duplicado.
HOSTING_SITE="$(node -e "process.stdout.write(require('./firebase.json').hosting.site)")"

# IDs de site são únicos no mundo inteiro, não só no projeto. Se este já estiver tomado por
# outra pessoa, a criação falha: troque o `site` em firebase.json e rode de novo. (Ter mais de
# um site por projeto exige o plano Blaze — o que este projeto já é, por causa do Cloud Run.)
if firebase hosting:sites:get "$HOSTING_SITE" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Site '$HOSTING_SITE' já existe."
else
  echo "Criando o site '$HOSTING_SITE'..."
  firebase hosting:sites:create "$HOSTING_SITE" --project="$PROJECT_ID"
fi

firebase deploy --project="$PROJECT_ID" --only hosting
HOSTING_URL="https://${HOSTING_SITE}.web.app"

echo ""
echo "-- 11/11: IAP --"
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
echo "Cartão da nave: serviço '$CARDGEN_SERVICE_NAME' (interno), gatilho '$CARDGEN_TRIGGER_NAME'"
# A linha "Hosting URL" que o próprio firebase imprimiu no Passo 10 é a autoritativa: este
# endereço é o do site padrão, e ele só difere se o ID '$PROJECT_ID' já estivesse tomado.
echo "Telão (abrir na TV):  $HOSTING_URL"
echo ""
echo "Configurar no estande (packages/daemon/.env ou variável de ambiente):"
echo "  BOOTH_CLOUD_API_BASE=$SERVICE_URL"
echo "  BOOTH_INGEST_TOKEN=<valor do segredo '$BOOTH_TOKEN_SECRET' — gcloud secrets versions access latest --secret=$BOOTH_TOKEN_SECRET>"
