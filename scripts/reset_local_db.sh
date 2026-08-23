#!/usr/bin/env bash
# Apaga o buffer SQLite local do estande (packages/daemon/src/services/sqlite-buffer.ts,
# `local_matches` etc.) e deixa o daemon reseedar um banco novo, vazio, no próximo start.
#
# Existe por causa da Tarefa C8: `local_matches` ganhou colunas novas
# (company_raw, company_confidence, score_breakdown_json, needs_company_review) via
# `CREATE TABLE IF NOT EXISTS`, sem migração -- um banco criado antes dessa tarefa mantém o
# schema antigo para sempre, porque "IF NOT EXISTS" não altera uma tabela já existente.
# "Apagar e deixar reseedar" é mais seguro do que escrever uma migração às pressas para dados
# de teste que ninguém precisa preservar.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Mesma resolução de SQLiteBufferService.defaultDbPath() (packages/daemon/src/services/sqlite-buffer.ts):
# BOOTH_DB_PATH tem prioridade; sem ela, o default é packages/daemon/data/booth_buffer.sqlite
# a partir da raiz do pacote daemon (documentado em USER_GUIDE.md).
if [ -n "${BOOTH_DB_PATH:-}" ]; then
  DB="$BOOTH_DB_PATH"
else
  DB="$SCRIPT_DIR/../packages/daemon/data/booth_buffer.sqlite"
fi

if [ ! -e "$DB" ]; then
  echo "Nada para apagar -- $DB não existe."
  exit 0
fi

read -p "Apagar TUDO em $DB? (s/N) " CONFIRM

case "$CONFIRM" in
  s|S|sim|Sim|SIM|y|Y|yes|Yes|YES)
    rm -f "$DB"
    echo "Banco removido: $DB"
    echo "Reinicie o daemon (npm run start:daemon) para recriá-lo do zero, já com o schema novo."
    ;;
  *)
    echo "Abortado -- nada foi apagado."
    exit 1
    ;;
esac
