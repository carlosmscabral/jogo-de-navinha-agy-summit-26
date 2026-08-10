#!/usr/bin/env bash
# Job control: cada job em background vira líder do próprio process group,
# de modo que $! é também o PGID e o daemon pode matar a árvore inteira.
set -m

# O visitante não recebe um shell: Ctrl+C e Ctrl+Z não interrompem o supervisor.
trap '' SIGINT SIGTSTP

# ==============================================================================
# Google Cloud Summit 2026 // AGY Space Shooter Booth Terminal Supervisor
# Runs continuously on Screen 2 (Terminal Station).
# Automatically manages AGY CLI sessions and resets with the Web Cockpit.
# ==============================================================================

SESSION_DIR="/tmp/booth_session"
FLAG_FILE="$SESSION_DIR/.session_active"
PID_FILE="$SESSION_DIR/.agy_pid"
DAEMON_URL="http://localhost:3000/api/session/status"

# ANSI Color Palette (Aerospace Flight Deck)
AMBER="\033[38;2;255;158;11m"
COBALT="\033[38;2;56;189;248m"
GREEN="\033[38;2;16;185;129m"
SLATE="\033[38;2;148;163;184m"
DARK="\033[38;2;100;116;139m"
WHITE="\033[1;37m"
BOLD="\033[1m"
RESET="\033[0m"

# Ensure session dir exists
mkdir -p "$SESSION_DIR"

cleanup() {
  echo -e "\n${AMBER}[Supervisor Encerrado]${RESET}"
  rm -f "$PID_FILE"
  exit 0
}
trap cleanup SIGTERM

print_idle_banner() {
  clear
  echo -e "${COBALT}╔══════════════════════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${COBALT}║${BOLD}${WHITE}                 GOOGLE CLOUD SUMMIT 2026 // FORJA AGY                        ${RESET}${COBALT}║${RESET}"
  echo -e "${COBALT}║${AMBER}                     TERMINAL DE ENGENHARIA ESPACIAL (TELA 2)                 ${RESET}${COBALT}║${RESET}"
  echo -e "${COBALT}╚══════════════════════════════════════════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "${GREEN}● STATUS:${RESET} ${WHITE}ESTAÇÃO DE ENGENHARIA PRONTA${RESET}"
  echo -e "${SLATE}--------------------------------------------------------------------------------${RESET}"
  echo -e "${BOLD}${AMBER}▶ CADASTRE-SE NA TELA 1 (COCKPIT AO LADO)${RESET}"
  echo -e "${SLATE}  1. Digite seu Callsign e Empresa${RESET}"
  echo -e "${SLATE}  2. Distribua seus 100 PU nos Sliders de Energia${RESET}"
  echo -e "${SLATE}  3. Selecione os Servidores MCP e clique em 'Ir para a Forja'${RESET}"
  echo -e "${SLATE}--------------------------------------------------------------------------------${RESET}"
  echo -e "${DARK}Aguardando autorização da sessão de voo...${RESET}"
  echo ""
}

print_session_banner() {
  local callsign="$1"
  local company="$2"
  local off="$3"
  local spd="$4"
  local def="$5"
  local tch="$6"

  clear
  echo -e "${AMBER}╔══════════════════════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${AMBER}║${BOLD}${WHITE}  🚀 PILOTO CONECTADO: ${AMBER}${callsign}${WHITE} (${company})                                  ${RESET}${AMBER}║${RESET}"
  echo -e "${AMBER}║${SLATE}  ⚡ ALOCAÇÃO: Ataque: ${off} PU | Velocidade: ${spd} PU | Defesa: ${def} PU | Tech: ${tch} PU      ${RESET}${AMBER}║${RESET}"
  echo -e "${AMBER}╚══════════════════════════════════════════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "${GREEN}✓ Workspace inicializado em /tmp/booth_session${RESET}"
  echo -e "${COBALT}Iniciando Antigravity CLI com sub-agentes e MCPs carregados...${RESET}"
  echo ""
}

# Main Supervisor Loop
while true; do
  print_idle_banner

  # Wait until .session_active flag exists
  while [ ! -f "$FLAG_FILE" ]; do
    sleep 0.5
  done

  # Extract metadata from .session_active if available
  CALLSIGN="PILOTO"
  COMPANY="SUMMIT"
  OFF="35"
  SPD="35"
  DEF="15"
  TCH="15"

  if command -v jq >/dev/null 2>&1; then
    CALLSIGN=$(jq -r '.pilot.callsign // "PILOTO"' "$FLAG_FILE" 2>/dev/null)
    COMPANY=$(jq -r '.pilot.company_canonical // "SUMMIT"' "$FLAG_FILE" 2>/dev/null)
    OFF=$(jq -r '.energy_sliders.offense // "35"' "$FLAG_FILE" 2>/dev/null)
    SPD=$(jq -r '.energy_sliders.speed // "35"' "$FLAG_FILE" 2>/dev/null)
    DEF=$(jq -r '.energy_sliders.defense // "15"' "$FLAG_FILE" 2>/dev/null)
    TCH=$(jq -r '.energy_sliders.tech // "15"' "$FLAG_FILE" 2>/dev/null)
  fi

  print_session_banner "$CALLSIGN" "$COMPANY" "$OFF" "$SPD" "$DEF" "$TCH"

  cd "$SESSION_DIR" || exit 1

  # Run AGY CLI in the FOREGROUND (never backgrounded) and track its PID for
  # automatic remote reset from the Web Cockpit. Under `set -m`, a backgrounded
  # job is NOT the terminal's foreground process group; agy is an interactive
  # TUI that reads /dev/tty, so a background job gets SIGTTIN'd and freezes in
  # STAT T. Running it as a synchronous foreground subshell that `exec`s into
  # agy avoids that entirely: the subshell owns the tty as foreground pgrp,
  # `exec` swaps its image for agy while keeping the same PID (= PGID), and
  # this whole block blocks naturally until agy exits — no separate `wait`.
  # NOTE: this spawns a brand-new shell process via `bash -c` (not a `(...)`
  # subshell forked from this already-running bash). For a freshly exec'd
  # shell, plain $$ has always meant "this process's own PID" on every bash
  # version and POSIX shell — that is the classic Bourne-shell meaning of $$,
  # unrelated to $BASHPID (a Bash-4+-only builtin needed only to see a
  # subshell's *own* PID from within an existing bash session, which does not
  # apply here). This keeps the PID capture portable to Bash 3.2 (macOS's
  # default /bin/bash), unlike $BASHPID which is undefined there.
  if command -v agy >/dev/null 2>&1; then
    bash -c '
      echo "$$" > "$1"
      echo "[booth-terminal] agy em execução no process group $$" >&2
      exec agy
    ' -- "$PID_FILE"
  else
    echo -e "${AMBER}[Simulação Booth] Comando 'agy' em execução...${RESET}"
    bash -c '
      echo "$$" > "$1"
      echo "[booth-terminal] agy em execução no process group $$" >&2
      exec sleep 20
    ' -- "$PID_FILE"
  fi

  rm -f "$PID_FILE"

  echo ""
  echo -e "${COBALT}--------------------------------------------------------------------------------${RESET}"
  echo -e "${GREEN}✓ Sessão concluída. Retornando para a tela de espera em 2 segundos...${RESET}"
  sleep 2
done
