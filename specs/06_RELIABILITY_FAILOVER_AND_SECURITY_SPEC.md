# Spec 06: Resilience, Offline Mode, Edge Cases & Runbooks

> **Status:** ESPECIFICAÇÃO REFINADA & BLINDADA  
> **Objetivo:** Definir os mecanismos de tolerância a falhas, os presets de fallback instantâneo, o buffer offline idempotente em SQLite, a segurança de processos e o runbook operacional do estande com scripts de inicialização, autoteste e reset de emergência.

---

## 1. Modos de Contingência & Fallbacks (Zero Downtime)

### 1.1. Timeout do Antigravity CLI e Presets de Emergência (<50ms)
- [ ] **Timeout Rígido:** Se o AGY não emitir o `ship_spec.json` em até **15 segundos**, o daemon aborta o processo (`kill -9 -PGID`) e injeta um dos 3 presets de emergência:
  1. *Interceptor Neon:* Velocidade $360\text{px/s}$, HP 3, Canhão `laser` contínuo, cor Ciano `#00f3ff`.
  2. *Vanguard Fortress:* Velocidade $220\text{px/s}$, HP 5, 2 Escudos, Canhão `plasma` e arma secundária `homing_missiles`, cor Dourado `#ffd700`.
  3. *Plasma Striker:* Velocidade $300\text{px/s}$, HP 3, Canhão `vulcan_spread` e `emp_burst`, cor Roxo Neon `#8b00ff`.
- [ ] **Transição Transparente:** O HUD da engine exibe: "*Sistemas autocalibrados no modo padrão!*", mantendo a experiência do visitante contínua e sem mensagens de erro.

### 1.2. Queda de Conectividade com a Internet (Offline Mode Idempotente)
- [ ] **Buffer Local em SQLite (`local_matches_buffer`):**
  - Toda partida concluída é persistida imediatamente na tabela local do SQLite.
  - O daemon possui um worker de sincronização com backoff exponencial que envia as partidas pendentes para o Firestore assim que o link for restabelecido.
  - Como o `match_id` é único, a gravação é **100% idempotente** e nunca duplica scores ou votos corporativos.
- [ ] **Leaderboard Offline:**
  - O placar da TV no Display 2 consome o cache local do daemon caso o Firestore fique inacessível.

---

## 2. Segurança, Sanitização & Shell Lockdown

### 2.1. Contenção do Terminal `xterm.js`
- [ ] O processo PTY do terminal roda com flags que impedem escape de shell:
  - Wrapper com `trap '' SIGINT SIGTSTP` para ignorar tentativas acidentais de cancelamento (`Ctrl+C` ou `Ctrl+Z`).
  - Encerramento automático do PTY assim que o `ship_spec.json` é gravado ou o timeout é atingido.

### 2.2. Moderação de Conteúdo no Cadastro
- [ ] **Camada 1 (Regex Síncrono Local):** Filtra instantaneamente termos ofensivos e caracteres inválidos no Callsign.
- [ ] **Camada 2 (Gemini 1.5 Flash):** Validação semântica assíncrona para barrar codinomes impróprios ou spam de teclado.

---

## 3. Scripts de Operação do Host Linux (Booth Runbook)

### 3.1. `setup_monitors.sh` (Configuração Dual-Head)
```bash
#!/bin/bash
# Configura Display 1 (Jogador - DP-1) e Display 2 (TV - HDMI-1)
xrandr --output DP-1 --mode 1920x1080 --rate 144 --primary \
       --output HDMI-1 --mode 3840x2160 --rate 60 --right-of DP-1
```

### 3.2. `launch_kiosks.sh` (Lançamento dos Navegadores em Modo Kiosk)
```bash
#!/bin/bash
# Inicia Player Station no Display 1
google-chrome --kiosk --noerrdialogs --disable-infobars \
  --autoplay-policy=no-user-gesture-required \
  --user-data-dir=/tmp/chrome_player \
  --window-position=0,0 http://localhost:3000/player &

# Inicia Leaderboard TV no Display 2
google-chrome --kiosk --noerrdialogs --disable-infobars \
  --user-data-dir=/tmp/chrome_leaderboard \
  --window-position=1920,0 http://localhost:3000/leaderboard &
```

### 3.3. `reset_booth.sh` (Script de Emergência do Staff)
```bash
#!/bin/bash
# Força reset limpo de todos os processos e sessão
pkill -f "node-pty" || true
pkill -f "weapons-arsenal" || true
pkill -f "hull-propulsion" || true
pkill -f "cybernetics-shields" || true
rm -rf /tmp/booth_session/*
curl -s http://localhost:3000/api/session/reset
echo "Booth restaurado com sucesso!"
```

### 3.4. `self_test.sh` (Suíte de Autoteste Matinal)
- [ ] Valida:
  1. Conexão e resposta dos 3 servidores MCP locais Stdio ($< 10$ms).
  2. Execução do AGY CLI com Fast Grill-Me e geração válida do `ship_spec.json`.
  3. Leitura e escrita no Firestore e tabela SQLite.
  4. Carregamento dos Sound Sprites no Howler.js.
  5. Resolução e taxas dos monitores Dual-Head.

---

## 4. Critérios de Aceitação Deste Módulo
- [ ] O sistema roda 8 horas ininterruptas sem travamento de tela ou acúmulo de processos no host.
- [ ] O acionamento de emergência via script ou hotkey `Ctrl+Shift+F12` recupera a tela inicial em $< 1$s.
- [ ] O funcionamento offline garante que nenhuma pontuação seja perdida durante quedas de internet.
