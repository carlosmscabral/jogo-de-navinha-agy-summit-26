# Spec 07: Stack Tecnológica e Estratégia de Validação

> **Status:** RECONCILIADA COM A IMPLEMENTAÇÃO — 2026-08-10
> **Objetivo:** Registrar a stack efetivamente adotada, o estado do ferramental de build e teste, e a
> Definition of Done do evento.
> **Endereça:** P8, D8, U6 (ver [Spec 00](./00_AUDIT_AND_DRIFT_REPORT.md)).
> **O cronograma saiu daqui.** O roadmap P0/P1/P2 desta especificação descrevia trabalho já concluído,
> abandonado ou renomeado. O plano vigente é a [Spec 10](./10_IMPLEMENTATION_PLAN.md).

---

## 1. Stack real

| Camada | Tecnologia | Nota |
| :--- | :--- | :--- |
| Frontend | React 18 + TypeScript 5.7 + Vite 6 | Dois apps: `player-app` e `leaderboard-app`. |
| Estilização | TailwindCSS 3.4 + design system CRT/Neon | `lucide-react` para ícones. |
| Terminal | **Terminal nativo do SO** + `scripts/booth-terminal.sh` | **P1.** Não há `xterm.js` nem `@xterm/addon-fit`. |
| Game engine | Phaser 3.88, WebGL, Arcade Physics | Texturas geradas em runtime por Canvas2D. |
| Áudio | **Síntese WebAudio própria** | **P8.** Ver §2. |
| Local bridge | Node.js + Express 4 + `ws` 8 + `chokidar` 4 | **Sem `node-pty`.** O daemon não cria PTY. |
| MCPs mockados | `@modelcontextprotocol/sdk` 1.6 sobre stdio + `zod` 3 | Três servidores, resposta local. |
| Persistência local | `better-sqlite3` 11 | Buffer de partidas e catálogo de empresas. |
| Nuvem | **Ausente** | Firestore e Admin SDK não instalados (**U1**). |
| Modelo | **Ausente** | Alvo: `gemini-3.6-flash` via Vertex AI (**U2**). |

> **Correção de modelo.** Toda referência a *Gemini 1.5 Flash API* está superada. O consumo é
> exclusivamente pelo flavor **Vertex AI / Gemini Enterprise Agent Platform**, com credencial de conta
> de serviço. Nenhuma chave de API de modelo existe neste projeto, em nenhum ambiente. Ver
> [Spec 08](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) §6.

### 1.1. [P8] Áudio: síntese, não sound sprites

A especificação definia Howler.js com atlas de sprites. A implementação é um sintetizador WebAudio
escrito à mão: osciladores, envelopes e ruído gerados no cliente, sem nenhum arquivo de áudio. Para
esta ativação é a decisão certa — zero bytes de asset, latência determinística e variação paramétrica
por evento de jogo.

**`howler` e `@types/howler` continuam no `package.json` do `player-app` e não são importados em lugar
nenhum** (**D10**). Devem ser removidos: uma dependência não usada em uma lista de dependências é uma
afirmação falsa sobre a arquitetura.

---

## 2. Build

O monorepo usa workspaces npm com uma regra bem resolvida: **todo build e todo teste rodam
`build:shared` primeiro**, porque os quatro pacotes consomem `@jogo/shared` por referência de
workspace. Isso já é o comportamento dos scripts da raiz.

Scripts principais da raiz:

| Script | Faz |
| :--- | :--- |
| `npm run build` | `shared` → `mcps` → `daemon` → `player-app` → `leaderboard-app` |
| `npm run start:daemon` | Mata o :3000, rebuilda e sobe o daemon |
| `npm run dev:player` / `dev:leaderboard` | Vite em modo dev |
| `npm run start:terminal` | Supervisor da Tela 2 |

A [Spec 09](./09_GAME_BALANCE_AND_DEV_MODE.md) acrescenta `dev:game`, `sim:balance` e `gen:schema`.

---

## 3. [D8] Testes: o estado é pior do que "cobertura baixa"

Dois problemas compostos:

**O runner da raiz não alcança o `player-app`.** O `npm test` executa `shared`, `mcps` e `daemon`, e
para. Todo o código de jogo — engine, balística, score — está fora da suíte.

**O script de teste do `player-app` foi escrito para nunca falhar:**

```
node --loader ts-node/esm --test src/game/scoring/ScoreCalculator.test.ts 2>/dev/null || node --test
```

`ts-node` **não é dependência do pacote**, então o primeiro comando falha sempre; o `2>/dev/null`
esconde o erro; e o `|| node --test` roda um comando que não encontra nenhum teste e **sai com
sucesso**. O resultado é um script de teste verde que não testou nada.

**E o teste escondido está vermelho.** `ScoreCalculator.test.ts` afirma quatro constantes que mudaram:

| Asserção do teste | Valor real |
| :--- | :--- |
| `bossBonus: 5000` | 10.000 |
| `timeBonus: 15 × 50` | segundos × 80 |
| `survivalBonus: 3000` | HP × 1.200 |
| `synergyBonus: 1500` | 2.000 |

Não é um teste ausente: é um teste **errado e silenciado**. Ele documenta uma fórmula que não existe
mais, e o mecanismo que deveria ter avisado foi desligado.

**Correção, nesta ordem:** consertar o runner primeiro, ver o teste ficar vermelho, e só então corrigir
as asserções. Consertar as asserções antes prova nada. Isso é o gate **M0**.

### 3.1. Cobertura-alvo

Prioridade por risco, não por percentual:

1. `ScoreCalculator` — pura, determinística, barata de testar.
2. `normalizeSpec` e `validateShipSpecification` — o par que decide o que vira nave (**D1**).
3. `resolveCompanyFromCatalog` e `validateCallsign` — entrada de usuário exibida em telão público.
4. Conformidade entre o simulador e a engine, com tolerância de 5% ([Spec 09](./09_GAME_BALANCE_AND_DEV_MODE.md) §5).
5. Gate de taxa de vitória em CI, na faixa de 15% a 25%.

---

## 4. [U6] Validação de carga

Não existe. As duas verificações necessárias:

- **Soak de 100 partidas consecutivas automatizadas**, medindo memória do daemon, contagem de processos
  e tempo de ciclo. Gate **M5**.
- **Ensaio completo de 3 superfícies** com cronômetro no ciclo do visitante. Gate **M4**.

---

## 5. Definition of Done do evento

1. **SLA de ciclo:** 2m00s a 2m45s do início do registro ao debrief.
2. **Sem janelas soltas no SO:** a Tela 1 roda em kiosk; a Tela 2 roda o supervisor em tela cheia e
   nunca expõe um prompt de shell. *(A redação original — "100% dentro do Chromium com terminal
   `xterm.js` integrado" — descreve uma arquitetura abandonada, **P1**.)*
3. **Determinismo do contrato:** 100% das naves passam na validação de schema **executada** (**D1**),
   e nenhuma decola sem registro correspondente em `mcp_audit.log` (**D3**).
4. **A nave forjada é a nave pilotada:** o `svg_path_data` do agente é renderizado (**D17**).
5. **O jogo é vencível na proporção pretendida:** taxa de vitória medida entre 15% e 25%
   (**D12**, [Spec 09](./09_GAME_BALANCE_AND_DEV_MODE.md)).
6. **Resiliência offline:** nenhuma pontuação perdida em queda de Wi-Fi.
7. **Estabilidade:** 8 horas contínuas sem intervenção técnica e sem acúmulo de processos.
8. **Telemetria preservada:** toda partida chega à nuvem com telemetria e snapshot da nave preenchidos
   (**D5**).
