#!/usr/bin/env bash
# Mata os três processos do estande (daemon, player-app, supervisor do terminal) e qualquer
# `agy`/MCP órfão, e limpa /tmp/booth_session pra um começo de verdade limpo.
#
# O supervisor (scripts/booth-terminal.sh) ignora Ctrl+C de propósito -- SIGINT/SIGTSTP tratados
# como no-op (`trap '' SIGINT SIGTSTP`), pra um visitante não conseguir derrubá-lo sem querer.
# Por isso este script mata pelo nome do processo (SIGTERM padrão, que o `trap cleanup SIGTERM`
# dele já sabe tratar), em vez de depender de Ctrl+C em cada terminal.
set -uo pipefail

echo "Matando daemon (porta 3000)..."
npm run --silent kill:daemon >/dev/null 2>&1 || true

echo "Matando player-app / leaderboard (portas 5173, 5174)..."
lsof -ti :5173 :5174 2>/dev/null | xargs -r kill -9 2>/dev/null || true

echo "Matando supervisor do terminal..."
pkill -f booth-terminal.sh 2>/dev/null || true

echo "Matando qualquer sessão agy (e MCPs filhos) órfã..."
pkill -f agy 2>/dev/null || true

echo "Limpando /tmp/booth_session..."
rm -rf /tmp/booth_session

echo ""
echo "Processos remanescentes (deveria estar vazio -- é a checagem do Bloco 7.2):"
ps -o pid,pgid,command -ax 2>/dev/null | grep -E 'agy|mcps/dist' | grep -v grep || echo "  (nenhum)"
