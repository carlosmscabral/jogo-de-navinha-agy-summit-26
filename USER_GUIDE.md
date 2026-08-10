# 🚀 JOGO DE NAVINHA AGY // GOOGLE CLOUD SUMMIT 2026
## Guia Operacional e Manual do Usuário (Estande & Desenvolvimento)

Este documento contém o guia completo de arquitetura, instalação, execução física no estande, automações operacionais, procedimentos de emergência e o roadmap para as próximas etapas (Cloud Run, Firestore e Painel de Admin).

---

## 🖥️ 1. Arquitetura do Estande (Setup de 2 Telas + TV)

No estande do **Google Cloud Summit 2026**, o jogador tem uma experiência imersiva sem troca de janelas (*zero Alt-Tab*), operando em duas telas integradas via WebSocket e IPC:

```
┌───────────────────────────────────────────────────┐    ┌───────────────────────────────────────────────────┐
│ TELA 1: COCKPIT DO JOGADOR (Web App)              │    │ TELA 2: ESTAÇÃO DA FORJA (Terminal SO)           │
│ (Monitor Principal Kiosk - http://localhost:5173) │    │ (Terminal Linux em Tela Cheia - agy CLI)          │
├───────────────────────────────────────────────────┤    ├───────────────────────────────────────────────────┤
│ 1. Cadastro do Piloto (Callsign & Empresa)        │    │ ╔═══════════════════════════════════════════════╗ │
│ 2. Briefing e Inspiração de Prompts               │    │ ║    GOOGLE CLOUD SUMMIT 2026 // FORJA AGY      ║ │
│ 3. Alocação de 100 PU nos Sliders de Energia      │    │ ║    ESTAÇÃO DE ENGENHARIA PRONTA (TELA 2)      ║ │
│ 4. Seleção de MCPs e clique em "Ir para a Forja" ─┼────┼─▶   AGUARDANDO NOVO PILOTO NA TELA 1...         ║ │
│                                                   │    │ ╚═══════════════════════════════════════════════╝ │
│                                                   │    │ 🚀 SESSÃO AUTORIZADA!                             │
│                                                   │    │    Iniciando Antigravity CLI com sub-agentes...   │
│                                                   │    │    $ agy                                          │
│ 5. Telemetria de MCPs ao Vivo (Badges & Logs) ◀───┼────┼───   (Conversa com o piloto, invoca MCPs)         │
│ 6. "NAVE PRONTA! [ESPAÇO] PARA DECOLAR"           │    │                                                   │
│ 7. Gameplay 90s (Phaser 3 vs Cyber Overlord)      │    │                                                   │
│ 8. Debriefing & Recorde (Contagem 15s) ───────────┼────┼─▶ (O Daemon encerra o processo do agy,            │
│                                                   │    │    limpa a tela e retorna ao banner de espera     │
│ 9. Retorno Automático à Tela de Atração ◀─────────┼────┼─── para o próximo jogador da fila!)               │
└───────────────────────────────────────────────────┘    └───────────────────────────────────────────────────┘

                                ┌───────────────────────────────────────────────────┐
                                │ TV VERTICAL DO ESTANDE: PLACAR PÚBLICO (Leaderboard)│
                                │ (Exibição Contínua - http://localhost:5174)       │
                                ├───────────────────────────────────────────────────┤
                                │ 🏆 Hall of Fame (Top 10 Melhores Pilotos)         │
                                │ 🏢 Batalha das Empresas (Market Share & Scores)   │
                                │ 📡 Live Ticker (Feed de Partidas em Tempo Real)   │
                                │ 📱 QR Code para Registro & Telemetria do Estande  │
                                └───────────────────────────────────────────────────┘
```

---

## 📦 2. Pré-requisitos e Instalação

### Requisitos de Sistema:
- **Sistema Operacional:** Linux (Debian, Ubuntu, gLinux), macOS ou Windows via WSL2.
- **Node.js:** Versão 20.x ou 22.x LTS (`node -v`).
- **NPM:** Versão 10.x ou superior (`npm -v`).
- **Antigravity CLI:** Utilitário `agy` instalado e autenticado no PATH.

### Passo a Passo de Instalação:

```bash
# 1. Clone o repositório
git clone https://github.com/carlosmscabral/jogo-de-navinha-agy-summit-26.git
cd jogo-de-navinha-agy-summit-26

# 2. Instale todas as dependências do monorepo
npm install

# 3. Compile todos os pacotes (Shared, MCPs, Daemon, Player App, Leaderboard)
npm run build

# 4. Execute a suíte de testes unitários e de integração
npm run test
```

---

## 🎬 3. Como Executar no Dia do Evento (4 Comandos)

Recomendamos abrir 4 abas/terminais para rodar cada componente:

### Terminal 1: Daemon Local (Ponte IPC, SQLite e WebSocket)
```bash
npm run start:daemon
```
- **Porta:** `http://localhost:3000`
- **Função:** Gerencia sessões, gera o workspace `/tmp/booth_session`, executa o file watcher nos MCPs e mantém o buffer local de partidas em SQLite.

---

### Terminal 2: Estação da Forja (Tela 2 — Terminal Dedicado)
```bash
npm run start:terminal
```
- **Localização:** Posicione este terminal em **Tela Cheia (F11)** no monitor da direita (Tela 2).
- **Função:** Supervisor autônomo em Bash (`scripts/booth-terminal.sh`). Exibe o banner de boas-vindas do Google Cloud Summit, detecta a entrada do jogador, inicia o `agy` e reinicia sozinho quando a partida acaba.

---

### Terminal 3: Cockpit do Jogador (Tela 1 — Monitor Principal)
```bash
npm run start:player
```
- **Acesso:** Abra o navegador Chrome em `http://localhost:5173` em **Tela Cheia (F11)** no monitor principal.
- **Função:** Interface do jogador (Cadastro ➔ Sliders ➔ Telemetria MCP ➔ Gameplay Phaser 3 ➔ Debriefing).

---

### Terminal 4: TV Vertical do Estande (Leaderboard Display)
```bash
npm run start:leaderboard
```
- **Acesso:** Abra o navegador Chrome em `http://localhost:5174` na TV vertical do estande.
- **Função:** Exibição dinâmica contínua do Top 10, domínio das empresas e feed de abates em tempo real.

---

## ⚡ 4. O Que o Sistema Faz de Forma 100% Automática

1. **Geração Dinâmica do Workspace:**
   - Ao avançar na Tela 1, o Daemon injeta no diretório `/tmp/booth_session`:
     - `.agents/skills/` com os MCPs selecionados (`weapons-arsenal`, `hull-propulsion`, `cybernetics-shields`).
     - Subagentes especializados (`aesthetic-designer`, `combat-strategist`).
     - Arquivo `GEMINI.md` com as instruções customizadas do piloto e a distribuição exata dos 100 PU de energia.
2. **Início e Captura da Sessão do AGY:**
   - O script supervisor detecta a flag `.session_active` e dispara o `agy` imediatamente na Tela 2.
   - O PID do processo é salvo em `/tmp/booth_session/.agy_pid`.
3. **Telemetria de Ferramentas MCP ao Vivo:**
   - O `mcp_audit.log` é monitorado pelo Daemon em tempo real e transmitido via WebSocket para o `player-app`, exibindo badges coloridos e métricas calibradas antes da decolagem.
4. **Decolagem Imediata:**
   - Assim que o subagente gera o `ship_spec.json`, a Tela 1 exibe a nave montada e o botão pulsante `[ESPAÇO] PARA DECOLAR`.
5. **Combate Balanceado contra o Cyber Overlord:**
   - Gameplay de 90 segundos com sistema de armas primárias e secundárias (`[Shift]`), drones de escolta e batalha contra o Dreadnought Battleship (15.000 HP, 3 fases, escudo cinético hexagonal).
6. **Auto-Reset Seguro:**
   - Ao fim da partida, a tela de Debriefing exibe a contagem regressiva de 15 segundos.
   - Quando o cronômetro zera (ou o jogador clica em "Nova Sessão"), o Daemon envia sinal `SIGINT` para o PID do `agy`, remove os arquivos temporários e retorna ambas as telas ao estado inicial de atração.

---

## 🧹 5. Comandos de Limpeza e Procedimentos de Emergência

Se por qualquer motivo for necessário reiniciar o estande ou limpar os dados locais de teste:

### 1. Parar o Daemon e liberar portas travadas:
```bash
npm run kill:daemon
```

### 2. Limpar a sessão de trabalho temporária:
```bash
rm -rf /tmp/booth_session/* /tmp/booth_session/.* 2>/dev/null
```

### 3. Resetar o banco de dados SQLite local de recordes:

O buffer local fica em `packages/daemon/data/booth_buffer.sqlite`. Para usar outro caminho, defina
`BOOTH_DB_PATH`. Para popular o placar com pilotos fictícios **em desenvolvimento**, defina
`BOOTH_SEED_DEMO=1` — nunca no dia do evento.

---

## 🗺️ 6. Planejamento e Próximos Passos (Roadmap Técnico)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                               ROADMAP TÉCNICO                                    │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ✅ MILESTONE 1: Core Engine, MCPs & Dual-Screen Booth Experience (CONCLUÍDO)     │
│   • Game engine Phaser 3 (90s, scoring, Cyber Overlord Dreadnought 15.000 HP)    │
│   • 3 Servidores MCP com validação flexível e tolerância polimórfica             │
│   • Visual Aerospace Flight Deck (Solar Amber, Cloud Cobalt, Deep Obsidian)      │
│   • Supervisor de terminal do SO (booth-terminal.sh) e auto-reset com PID kill  │
│   • Indicador de arma secundária e legenda tática no HUD                         │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 🚀 MILESTONE 2: Nuvem Híbrida (Cloud Run + Firestore Sync Dual-Head)             │
│   • Deploy do Leaderboard Backend no Cloud Run                                   │
│   • Sincronização em segundo plano: SQLite Local ➔ Google Cloud Firestore        │
│   • Resiliência total: se a internet do centro de convenções oscilar, o estande  │
│     continua 100% jogável e sincroniza quando a conexão voltar                   │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 🎛️ MILESTONE 3: Painel de Controle e Administração do Estande (Cloud Run)       │
│   • Dashboard Web para o time do Google no estande                               │
│   • Visão ao vivo de telemetria: uso de MCPs, modelos Gemini utilizados          │
│   • Fila de pilotos e moderação em tempo real (remoção de callsigns ofensivos)   │
│   • Métricas de engajamento do evento (total de partidas, empresas dominantes)   │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 💎 MILESTONE 4: Polimento Final de Áudio, Efeitos e Variedade de Chefes          │
│   • Síntese de áudio WebAudio adicional para propulsores e lasers contínuos      │
│   • Novos arquétipos visuais de nave na forja do aesthetic-designer              │
│   • Modo Hardcore com variações de ataques especiais para os melhores pilotos    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 👥 Contato e Suporte
- **Projeto:** Jogo de Navinha AGY // Google Cloud Summit 2026
- **Responsável:** Carlos Cabral (`carloscabral@google.com`)
- **Repositório:** `https://github.com/carlosmscabral/jogo-de-navinha-agy-summit-26`
