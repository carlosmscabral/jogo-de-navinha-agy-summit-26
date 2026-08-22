# Spec 06: Resiliência, Modo Offline, Segurança e Runbook

> **Status:** RECONCILIADA COM A IMPLEMENTAÇÃO — 2026-08-10
> **Objetivo:** Definir tolerância a falhas, presets de emergência, buffer offline, moderação de
> conteúdo, contenção de processos e o runbook operacional do estande.
> **Endereça:** D2, D6, D9, D11, U3, U4, U5 (ver [Spec 00](./00_AUDIT_AND_DRIFT_REPORT.md)).
> **Nota de escopo:** este é o módulo com a maior distância entre o especificado e o construído. Dos
> quatro scripts de operação, existe **um**, e não é nenhum dos quatro.

---

## 1. Contingências

### 1.1. [D2] Timeout do AGY e presets de emergência

Os três presets **existem e estão corretos** (`packages/shared/src/constants/fallback-presets.ts`):

| Preset | Perfil |
| :--- | :--- |
| `interceptor` | Rápido e frágil, canhão `laser`, ciano |
| `vanguard` | Lento e blindado, `plasma` mais `homing_missiles`, dourado |
| `striker` | Equilibrado, `vulcan_spread`, roxo neon |

**O gatilho automático não existe.** Não há temporizador no daemon; a única forma de injetar um preset
é um botão manual em `HandoffTerminalScreen.tsx`. Se o `agy` travar, se a autenticação expirar, ou se o
modelo simplesmente não gravar o arquivo, a estação fica parada até que alguém do staff perceba.

**Requisito.** O daemon arma três gatilhos independentes. O primeiro que disparar injeta o preset:

- **Silêncio de 15s** após a primeira linha de `mcp_audit.log`, rearmado a cada nova linha.
- **Teto rígido de 150s** desde `.session_active`, protegendo o SLA do ciclo.
- **Morte do processo** do `agy` sem spec aceita.

Ao disparar:

1. Encerra o grupo de processos do `agy` — ver [Spec 03](./03_AGY_HARNESS_AND_INTEGRATION_SPEC.md) §6.2.
2. Escolhe o preset mais próximo da alocação de sliders do visitante. Não um preset fixo: quem investiu
   em defesa recebe o `vanguard`. A nave ainda reflete a escolha, mesmo no caminho degradado.
3. Emite `EVENT_SHIP_READY` com esse preset e a flag `fallback: true`.
4. O HUD exibe *"Sistemas autocalibrados no modo padrão"*. Nenhuma mensagem de erro chega ao visitante.

A flag `fallback` precisa chegar à telemetria: a taxa de fallback ao longo do dia é a métrica que diz
se o harness do AGY está saudável, e sem ela o problema fica invisível.

> **Aviso de calibração.** Hoje os três presets têm taxa de vitória **0%** contra o boss (**D12**). Um
> fallback é uma degradação de experiência aceitável; entregar uma nave que não pode vencer não é. Os
> presets entram na simulação da [Spec 09](./09_GAME_BALANCE_AND_DEV_MODE.md) §5 como casos obrigatórios.

### 1.2. [D11] Watchdogs anti-abandono

Nenhum existe. Um visitante que sai no meio da sessão deixa a estação travada na etapa em que estava,
e o único caminho de recuperação é o hotkey `Ctrl+Shift+F12` (`packages/player-app/src/App.tsx:53-62`)
— que só funciona **se o browser da Tela 1 estiver com foco**. No momento em que o visitante está na
Tela 2, o foco está no terminal, e o hotkey não responde.

**Requisito — quatro watchdogs, cada um com seu tempo:**

| Etapa | Inatividade | Ação |
| :--- | :--- | :--- |
| Registro | 60s | Volta para a tela de atração |
| Builder | 120s | Volta para a tela de atração |
| Handoff / forja | 15s de silêncio ou 150s no total | Fallback automático, §1.1 |
| Debrief | 45s | Envia a partida e volta para a atração |

E um caminho de reset independente do foco do browser: `reset_booth.sh` no terminal da Tela 2, que já
está sempre acessível ao staff.

### 1.3. Modo offline

O buffer SQLite existe e a idempotência por `match_id` está garantida pelo `INSERT OR REPLACE`
(`sqlite-buffer.ts:234`). Faltam as duas pontas:

- **[U3, D10] O worker de sincronização.** `getPendingMatches()` e `markMatchSynced()` existem e nada
  os chama. Especificado em [Spec 05](./05_LEADERBOARD_AND_CLOUD_SPEC.md) §5.
- **Fallback do placar.** A TV deve cair para o snapshot do bridge local quando o Firestore ficar
  inacessível, com indicação discreta de modo local.

> **[D9] Caminho do banco.** O default `'./booth_local.sqlite'` é relativo ao diretório de invocação, e
> o `USER_GUIDE.md` documenta outro caminho. Dois diretórios de partida produzem dois bancos, e o
> segundo nasce vazio — placar zerado no meio do evento. Passa a ser absoluto e sobrescrevível por
> variável de ambiente.

> **[D6] Semente de placar.** `seedInitialLeaderboard()` insere três pilotos fictícios sempre que a
> tabela está vazia, o que é exatamente a primeira execução no estande. Fica atrás de uma variável de
> ambiente de desenvolvimento, e o `self_test.sh` falha se algum `match_id` começar com `seed_`.

---

## 2. Segurança

### 2.1. Contenção do terminal

> **Correção (P1).** Esta seção descrevia o endurecimento de um PTY controlado pelo daemon. Não existe
> PTY: a Tela 2 é um **terminal nativo com um shell real**, e o modelo de ameaça muda. Não há sandbox
> a configurar — há uma sessão de sistema operacional exposta a qualquer pessoa que passe pelo estande.

Medidas concretas, em ordem de importância:

1. **Usuário dedicado sem privilégios**, sem `sudo`, sem acesso ao chaveiro do usuário principal.
2. **`trap '' SIGINT SIGTSTP`** no supervisor, para que `Ctrl+C` e `Ctrl+Z` não devolvam um shell ao
   visitante. O supervisor já trata `SIGINT`/`SIGTERM` com `cleanup()`, mas o `agy` em primeiro plano
   ainda recebe o sinal.
3. **O supervisor é o processo de login do terminal**, não um comando digitado em um shell: sair do
   `agy` retorna ao banner de espera, nunca a um prompt.
4. **Credenciais.** A máquina do estande autentica no Vertex AI por ADC de conta de serviço com escopo
   mínimo, e não guarda nenhuma chave do Admin SDK. Ver
   [Spec 08](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) §6.

   > **Contradição conhecida, registrada em 2026-08-22.** "ADC de conta de serviço" pressupõe um
   > arquivo de chave na máquina do estande, e a Spec 08 §6.1 proíbe exatamente isso. A forma correta
   > é ADC de **usuário** (`gcloud auth application-default login`), que não deixa chave de conta de
   > serviço em disco — mas expira, e hoje nada no repositório configura, verifica ou renova essa
   > credencial. O risco e as mitigações aceitas estão em
   > [Spec 11](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md) §4.9; a decisão de 2026-08-22 foi registrar e não
   > automatizar.
5. **Higiene de sessão.** O reset deve apagar **todo** o conteúdo de `/tmp/booth_session`, não apenas
   `ship_spec.json` e `mcp_audit.log`: o `GEMINI.md` do visitante anterior contém nome e empresa e hoje
   permanece legível até o próximo start.

### 2.2. Moderação de callsign

**Camada 1 — determinística, e já implementada** (`packages/shared/src/utils/moderation.ts`):
comprimento de 3 a 15, conjunto de caracteres permitido, detecção de repetição, dicionário PT-BR e EN
com normalização de *leet speak* (`p0rr4` → `porra`). É rápida, offline e resolve a maior parte dos
casos. Boa base.

Três correções necessárias:

- **O daemon valida e ignora o resultado.** `POST /api/session/start` chama `validateCallsign()` e usa
  `validation.sanitized` sem consultar `isValid` (`packages/daemon/src/index.ts:87-95`). Para palavrão o
  efeito é aceitável, porque o `sanitized` vira `PILOTO_###`; mas para callsign curto demais ou
  repetitivo o `sanitized` é o próprio texto, e `AAAAAA` entra no telão por chamada direta à API. O
  servidor precisa **rejeitar** com `400`, não confiar na validação do formulário.
- **O casamento por containment super-bloqueia.** Palavras do dicionário com 4 caracteres ou mais são
  buscadas como substring na forma densa, então `kill` bloqueia `SKILL`, `SKILLER` e `KILLJOY` —
  codinomes de jogador perfeitamente comuns. Restringir o containment a termos mais longos, ou exigir
  fronteira de palavra para os curtos.
- **Um visitante barrado precisa entender o porquê.** A UI mostra o motivo; o caminho de API não.

**Camada 2 — semântica, ausente (U2).** Um filtro de dicionário não pega ofensa contextual nem uma
frase montada com palavras inócuas. A validação semântica usa **`gemini-3.7-flash` via Vertex AI /
Gemini Enterprise Agent Platform**, chamada **somente no Cloud Run**, e — diferente da canonicalização
de empresa — é **bloqueante**, com timeout curto e **falha fechada**: se o modelo não responder a
tempo, o callsign é recusado e o visitante escolhe outro. Esperar 1s vale menos que um palavrão no
telão do estande do Google.

> **Correção de modelo.** Toda referência a *Gemini 1.5 Flash* nesta especificação está superada. O
> modelo é `gemini-3.7-flash`, e o acesso é exclusivamente por Vertex AI — nunca por chave de API.

---

## 3. Runbook de operação

### 3.1. Estado dos scripts

| Script | Estado |
| :--- | :--- |
| `booth-terminal.sh` | **Existe** e funciona. Supervisor da Tela 2, não previsto por nenhuma especificação. |
| `setup_monitors.sh` | **U4** — ausente |
| `launch_kiosks.sh` | **U4** — ausente |
| `reset_booth.sh` | **U4** — ausente |
| `self_test.sh` | **U5** — ausente |

### 3.2. Correção de plataforma

Os exemplos desta especificação assumem Linux com `xrandr` e `google-chrome`. **O desenvolvimento e os
ensaios acontecem em macOS** — ver os gates M0 a M5 da [Spec 10](./10_IMPLEMENTATION_PLAN.md) — e o
hardware do evento ainda é desconhecido ([Spec 08](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) §3).

Cada script precisa detectar a plataforma e degradar de forma explícita:

- **Monitores:** `xrandr` no Linux; no macOS, `displayplacer` se estiver instalado, ou uma mensagem
  dizendo para configurar em Ajustes do Sistema. Nunca falhar em silêncio.
- **Browser:** `google-chrome` no Linux, `open -a "Google Chrome" --args` no macOS.
- **`pkill -f`:** as flags diferem entre BSD e GNU. Usar apenas o subconjunto compatível.

Um script que aborta com erro claro em macOS é melhor que um que "roda" sem efeito — a segunda
hipótese só é descoberta no dia do evento.

### 3.3. `setup_monitors.sh`

Configura Tela 1 e Tela 2 lado a lado e verifica que ambas estão ativas na resolução esperada. A TV do
placar **não entra aqui** — é um dispositivo independente que carrega uma URL hospedada
([Spec 05](./05_LEADERBOARD_AND_CLOUD_SPEC.md) §7).

### 3.4. `launch_kiosks.sh`

Sobe o Chrome em modo kiosk apontando para o `player-app` servido pelo bridge local, com
`--autoplay-policy=no-user-gesture-required` — necessário porque o áudio é síntese WebAudio que precisa
de gesto do usuário para destravar (**P8**: não há Howler.js nem sound sprites). Perfis de
`--user-data-dir` separados por superfície.

### 3.5. `reset_booth.sh`

O reset de emergência do staff, e o único caminho que funciona com o foco fora do browser:

1. `curl -s -X POST http://localhost:3000/api/session/reset`
2. Encerra o grupo de processos do `agy` pelo PGID em `.agy_pid`, com `SIGINT` e depois `SIGKILL`.
3. `pkill -f 'mcps/dist'` como rede de segurança para MCPs órfãos — **não** `pkill -f "node-pty"`, que
   nunca existiu.
4. Limpa o conteúdo de `/tmp/booth_session` **sem remover o diretório**, pelo mesmo motivo do
   [Spec 03](./03_AGY_HARNESS_AND_INTEGRATION_SPEC.md) §3.1: o shell da Tela 2 tem esse diretório como
   `cwd`.
5. Confirma na saída que nenhum processo MCP restou.

### 3.6. `self_test.sh`

Autoteste matinal, executado antes da abertura das portas. Cada verificação imprime PASS ou FAIL e o
script sai com código diferente de zero se qualquer uma falhar:

1. Os três servidores MCP sobem e respondem a um `tools/list`.
2. `agy --version` responde e a credencial do Vertex AI está válida.
3. Uma sessão completa de ponta a ponta gera um `ship_spec.json` que **passa na validação de schema**
   e tem entradas correspondentes em `mcp_audit.log`.
4. O SQLite é gravável, está no caminho esperado, e **não contém nenhum registro `seed_`**.
5. A fila de sincronização pendente é reportada, e o endpoint de ingestão na nuvem responde.
6. As duas telas estão na resolução esperada.
7. `jq` está instalado — o supervisor depende dele e degrada em silêncio sem ele.
8. Nenhum processo MCP órfão de execuções anteriores.

Note o que **saiu** da lista original: *"carregamento dos sound sprites no Howler.js"* verificaria uma
biblioteca que o projeto não usa (**P8**). O `howler` continua no `package.json` e deve ser removido.

---

## 4. Critérios de aceitação

- [ ] 8 horas contínuas sem travamento e sem acúmulo de processos: `pgrep -f 'mcps/dist'` vazio ao fim.
- [ ] O reset de emergência recupera a tela inicial em menos de 1s, **inclusive com o foco no terminal
      da Tela 2**.
- [ ] Nenhuma pontuação é perdida em queda de internet: derrubar o Wi-Fi por 5 minutos durante partidas
      e confirmar a sincronização completa na volta. Gate **M3**.
- [ ] O fallback de 15s dispara sozinho quando o `agy` é morto no meio da forja, e o visitante conclui
      a experiência sem intervenção. Gate **M2**.
- [ ] Os quatro watchdogs disparam nos tempos definidos, verificáveis um a um.
- [ ] `self_test.sh` passa em macOS e na máquina do estande, ou falha com mensagem clara sobre o que
      não se aplica àquela plataforma.
- [ ] Um callsign ofensivo é recusado pela API, não apenas pelo formulário; `SKILLER` é aceito.
