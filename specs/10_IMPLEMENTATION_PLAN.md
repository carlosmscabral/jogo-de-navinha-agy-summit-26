# Plano de Implementação — Jogo de Navinha AGY (Google Cloud Summit 2026)

> **Para executores agênticos:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar este plano tarefa a tarefa. Os passos
> usam sintaxe de checkbox (`- [ ]`) para rastreamento.

**Objetivo:** Levar o repositório do estado auditado na [Spec 00](./00_AUDIT_AND_DRIFT_REPORT.md) até um
estande operável por 8 horas contínuas no Summit, fechando todos os 32 achados da auditoria
(D1–D17, P1–P8, U1–U6, L1) em cinco fases, cada uma travada por um ensaio manual no Mac.

**Arquitetura:** Topologia C da [Spec 08](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) — `agy`, os 3 MCPs
stdio, o session bridge e o `player-app` **servido pelo próprio bridge** ficam na máquina do estande;
Firestore, a API de ingestão em Cloud Run, todo consumo de `gemini-3.7-flash` via Vertex AI e o
`leaderboard-app` vão para GCP. O buffer SQLite permanece como garantia de que nenhuma pontuação se
perde com o Wi-Fi do centro de convenções fora do ar.

**Stack:** npm workspaces · TypeScript 5.7 · Vite 6 · React 18 · Phaser 3.88 · Express 4 · `ws` 8 ·
chokidar 4 · better-sqlite3 11 · Ajv 8 · `@modelcontextprotocol/sdk` 1.6 · Vitest 3 (novo) ·
Firebase Admin SDK (novo) · `@google-cloud/vertexai` (novo) · Cloud Run · Cloud Firestore.

---

## Restrições Globais

Valem para **todas** as tarefas. Os requisitos de cada tarefa incluem implicitamente esta seção.

1. **Modelo:** o único modelo permitido é **`gemini-3.7-flash`**, consumido **exclusivamente** pelo
   flavor **Vertex AI / Gemini Enterprise Agent Platform**, autenticado por ADC ou service account.
   **Proibido** em qualquer arquivo do repositório: `GEMINI_API_KEY`, `generativelanguage.googleapis.com`,
   `@google/generative-ai`. A documentação de referência é `docs.cloud.google.com`, nunca `ai.google.dev`.
2. **Credenciais:** nenhuma chave de service account e nenhuma credencial privilegiada reside na máquina
   do estande. O bridge recebe apenas um **token de ingestão de escopo único**, válido só para o endpoint
   de gravação de partidas.
3. **Precedência numérica:** onde a [Spec 09](./09_GAME_BALANCE_AND_DEV_MODE.md) e a
   [Spec 04](./04_GAME_ENGINE_AND_MECHANICS_SPEC.md) divergirem em números, **a 09 prevalece**.
4. **Build:** todo build e todo teste rodam `build:shared` primeiro. Os quatro pacotes consomem
   `@jogo/shared` por referência de workspace.
5. **Node.js 20.x ou 22.x LTS.** Nenhum pacote novo além dos listados na seção Stack sem justificativa
   registrada na tarefa.
6. **TDD:** todo passo de implementação é precedido por um teste que falha, e o passo seguinte é
   executar o teste e **ver a falha**. Um teste que passa antes da implementação é um teste errado.
7. **Commits:** [Conventional Commits](https://www.conventionalcommits.org/). **Nunca** mencionar Claude,
   Anthropic ou qualquer assistente de IA na mensagem; nenhum trailer `Co-Authored-By` de assistente.
   Atribuição apenas à identidade git do usuário. Um commit por tarefa, no mínimo.
8. **Idioma:** todo texto exibido ao visitante é em **português do Brasil**. Código, nomes de símbolos e
   mensagens de log em inglês, seguindo o padrão vigente do repositório.
9. **Markdown:** nunca um `~` isolado antes de um valor — use `≈`. Em `sequenceDiagram` do Mermaid, nada
   de crases, `--`, `<br/>`, setas unicode, ou parênteses em aliases de `participant ... as`.

---

## Gates de Ensaio Manual no Mac

O trabalho **para** em cada gate até que o ensaio manual passe. Os gates não são revisão de código: são
o operador do estande executando os comandos abaixo no Mac e observando o resultado.

| Gate | Depois de | Comando | O que você verifica |
| :--- | :--- | :--- | :--- |
| **M0** | Tarefa A1 | `npm install && npm run build && npm test` | Build limpo. `ScoreCalculator.test.ts` **executa** e o output mostra os testes por nome. D8 se prova aqui. |
| **M1** | Fase B | `npm run dev:game` e `npm run sim:balance` | Engine sobe com o daemon **parado** e o Wi-Fi **desligado**. A taxa de vitória impressa pelo simulador bate com a sensação de 5 partidas jogadas à mão. |
| **M2** | Fase A + B | `npm run start:daemon` + `npm run start:terminal` + `agy` real | Ciclo forja → voo completo. Você corrompe o `ship_spec.json` de propósito e o preset de emergência entra sozinho em menos de 15s. Após o reset, `ps aux \| grep mcps/dist` não retorna nada. |
| **M3** | Fase C | Emulador do Firestore, depois projeto real | O score chega ao Firestore. Você desconecta o Wi-Fi no meio da partida e nada se perde; ao reconectar, o registro aparece uma única vez. |
| **M4** | Fase D | Ensaio das 3 superfícies com cronômetro | Ciclo de visitante em 2m00s–2m45s. Reset limpo. 20 ciclos sem processo órfão. |
| **M5** | Fase D | `npm run soak:matches` | 100 partidas consecutivas. Memória do daemon e contagem de processos estáveis do início ao fim. |

---

## Alocação de Todos os IDs da Auditoria

Nenhum achado da Spec 00 pode ser silenciosamente perdido. Cada ID aparece **exatamente uma vez**.

| ID | Achado | Tarefa |
| :--- | :--- | :--- |
| **D1** | Validação de schema nunca executa | A2 |
| **D2** | Sem timeout de 15s nem preset automático | A4 |
| **D3** | Sem gate de auditoria MCP | A2 |
| **D4** | Reset mata PID único | A5 |
| **D5** | Telemetria descartada | A7 |
| **D6** | Pilotos fictícios no telão | A6 |
| **D7** | `localhost:3000` fixo | C1 |
| **D8** | `npm test` não roda o `player-app` | A1 |
| **D9** | Caminho do SQLite depende do cwd | A6 |
| **D10** | Código morto (`howler`, worker ausente) | A8 |
| **D11** | Sem watchdogs anti-abandono | D2 |
| **D12** | Boss invencível | B8 (medido pelo simulador da B7) |
| **D13** | Armas secundárias inertes | B6 |
| **D14** | Três contratos numéricos conflitantes | B2 |
| **D15** | Sinergias sem efeito | B6 |
| **D16** | `GEMINI.md` entrega a resposta pronta | A3 |
| **D17** | `svg_path_data` nunca renderizado | B5 |
| **P1** | Terminal nativo (resíduo: WS `/pty`) | A8 |
| **P2** | Três superfícies de exibição | Encerrado na Spec 01 — sem trabalho de código |
| **P3** | Boss 15.000 HP, fases por limiar | B8 (números finais medidos) |
| **P4** | Waves contínuas por temporizador | B8 (idem) |
| **P5** | Constantes de score + multiplicador MCP | A1 (asserções) e B1 (extração) |
| **P6** | 1 a 3 MCPs com tradeoff | Encerrado na Spec 02 — sem trabalho de código |
| **P7** | Etapa `INSTRUCTIONS` | Encerrado na Spec 01 — sem trabalho de código |
| **P8** | Áudio por síntese WebAudio | A8 (remoção do `howler`) |
| **U1** | Firestore + Admin SDK | C2, C3 |
| **U2** | Chamadas Gemini | C4 |
| **U3** | Worker de sincronização offline | C5 |
| **U4** | `setup_monitors.sh`, `launch_kiosks.sh`, `reset_booth.sh` | D3 |
| **U5** | `self_test.sh` | D3 |
| **U6** | Teste de carga de 100 partidas | D4 |
| **L1** | Qualidade do prompt influencia a nave | E1 |

### Tarefas sem ID de auditoria

Nem toda tarefa nasce da Spec 00. As de baixo vieram de revisões posteriores e ficam registradas aqui
pelo mesmo motivo que a tabela acima existe: para que a origem de cada uma continue rastreável depois
que a memória da conversa que a criou tiver evaporado.

| Tarefa | Origem | Por que não é um ID de auditoria |
| :--- | :--- | :--- |
| **B3, B4, B7** | Spec 09 | Determinismo, harness e simulador são infraestrutura de teste, não defeito. |
| **C0** | Análise do `duboc/gemini-com-pe` (achado 1) + Spec 05 §3.1 | `match_id` por `Date.now()` e o default `'Google'`: dois defeitos encontrados depois da auditoria. |
| **C0b** | Revisão de entrada da Fase C, 2026-08-22 | Catálogo de empresas em arquivo e moderação do campo empresa (Spec 05 §3.1 e §3.3). |
| **C6** | Spec 05 §7 | O telão sobre Firestore é entrega de escopo, não correção. |
| **C7** | Revisão de entrada da Fase C, 2026-08-22 | Painel de administração, promovido da Tarefa E2 (opcional) para a Fase C. |
| **C8** | Revisão final da Fase C, 2026-08-23 (Spec 11 §4.11) | `company_raw`/`company_confidence`/`score_breakdown` nunca chegavam ao Firestore — achado durante a implementação da C5, corrigido depois do merge. |
| **C9** | Pedido do usuário, 2026-08-23 | Limpeza de dados de teste (placares inconsistentes, empresas fictícias) exigia ação em lote que a C7 não previa. |
| **C10** | Revisão final da Fase C, 2026-08-23 (achado Crítico 4) | `/v1/admin/*` sem autenticação própria; IAP sozinho não convive com o token do estande no mesmo serviço. |
| `scripts/deploy.sh`/`undeploy.sh` | Pedido do usuário, 2026-08-24 | Provisionamento scriptado e reproduzível (banco, regras, service account, segredos, Cloud Run), para o Gate M3 e para um eventual deploy futuro noutro projeto. Não é uma tarefa numerada — é ferramenta de operação, mesma categoria dos scripts da Fase D. |
| **D1** *(tarefa)* | Spec 08 §7 | Runbook. Não confundir com o **defeito** D1 da tabela acima — a colisão de nomes é infeliz e antiga. |

---

## Mapa de Arquivos

**Criados:**

| Arquivo | Responsabilidade |
| :--- | :--- |
| `packages/shared/src/constants/balance.ts` | Contrato numérico único (`BALANCE`). Fonte de tuning e de faixas. |
| `packages/shared/src/utils/rng.ts` | PRNG semeado `mulberry32`. |
| `packages/shared/src/config.ts` | Resolução de endpoints por ambiente (fecha D7 no lado compartilhado). |
| `packages/shared/src/schema/gen-schema.ts` | Gera `ship_spec.schema.json` a partir de `BALANCE.ranges`. Vive sob `src/` porque o tsconfig do pacote tem `rootDir: src`. |
| `packages/shared/src/schema/schema-sync.test.ts` | Falha se o schema versionado divergir do gerado. |
| `packages/daemon/src/services/file-watcher.test.ts` | Validação estrita e gate de auditoria. |
| `packages/daemon/src/services/cloud-sync.ts` | Worker de sincronização com backoff (U3). |
| `packages/daemon/src/services/cloud-sync.test.ts` | Backoff, idempotência, ordem. |
| `packages/player-app/vitest.config.ts` | Runner de testes do pacote. |
| `packages/player-app/dev.html` | Segunda entrada Vite do harness isolado. |
| `packages/player-app/src/dev/DevHarness.tsx` | Painel de controle do harness. |
| `packages/player-app/src/dev/presets.ts` | Arquétipos e presets mínimo/máximo derivados de `BALANCE`. |
| `packages/player-app/src/game/factories/SvgShipRenderer.ts` | Rasteriza `svg_path_data` em textura (D17). |
| `packages/shared/src/game/synergies.ts` | Aplica a matriz de sinergias aos atributos (D15). Em `shared` porque a engine e o simulador precisam da mesma regra. |
| `packages/shared/src/game/score-calculator.ts` | `ScoreCalculator` migrado do `player-app` para ser reutilizável pelo simulador (B7). |
| `packages/shared/src/types/cloud.ts` | `MatchDocument`, `PilotDocument`, `CompanyRankingDocument`, `CompanyCatalogDocument` e `SCHEMA_VERSION` (U1). **Declaração única** — nenhum app declara a sua cópia. |
| `packages/player-app/src/match-id.test.ts` | Afirma que `match_id` é UUID e que dois no mesmo tick diferem (C0). |
| `config/companies.json`, `config/companies.example.json` | Catálogo canônico de empresas, fora do código. Override por `BOOTH_COMPANIES_FILE` (C0b). |
| `packages/daemon/src/services/remote-moderation.ts` | Cliente da moderação de camada 2, que falha aberto na rede (U2). |
| `packages/leaderboard-app/src/firestore-source.ts` | Assinatura `onSnapshot` com queda para o bridge local. |
| `packages/player-app/src/hooks/useIdleWatchdog.ts` | Watchdog anti-abandono por etapa (D11). |
| `packages/sim/` | Pacote novo: simulador headless de balanceamento. |
| `packages/cloud-api/` | Pacote novo: serviço Cloud Run de ingestão, moderação e canonicalização. |
| `packages/cloud-api/src/admin.ts` | Rotas `/v1/admin/*`: busca e correção de partidas, catálogo, saúde (C7). |
| `packages/admin-app/` | Pacote novo: painel de administração, atrás de senha HTTP Basic — sem IAP (C7, corrigido na C10). |
| `scripts/lib/platform.sh` | Detecção de plataforma e caminhos comuns aos quatro scripts. |
| `scripts/setup_monitors.sh`, `launch_kiosks.sh`, `reset_booth.sh`, `self_test.sh` | Operação do estande (U4, U5). |
| `scripts/soak_matches.mjs` | Teste de carga de 100 partidas (U6). |
| `firestore.rules`, `firestore.indexes.json` | Modelo de segurança e índices (U1). |
| `firebase.json`, `.firebaserc.example` | Deploy das regras no banco **nomeado** `jogo-navinha` — `firebase.json` na forma em array (C2). |
| `RUNBOOK.md` | Procedimento de operação e cartão de falhas de uma página. |

**Modificados com maior peso:**

| Arquivo | Mudança |
| :--- | :--- |
| `packages/daemon/src/services/file-watcher.ts` | Validação estrita, gate de auditoria, rejeição explícita (D1, D3). |
| `packages/daemon/src/index.ts` | Timeout de 15s, kill de process group, `/events`, estáticos do `player-app` (D2, D4, P1, D7). |
| `packages/daemon/src/services/workspace-generator.ts` | Remoção do exemplo preenchido, regra anti-alucinação, fim do `run_agy.sh` órfão (D16, D10). |
| `scripts/booth-terminal.sh` | `set -m` para isolar o process group do `agy`, `trap` de sinais (D4). |
| `packages/player-app/src/game/scenes/MainGameScene.ts` | Constantes para `balance.ts`, RNG semeado, colisão de mísseis (B1, B3, D13). |
| `packages/player-app/src/App.tsx` | Telemetria completa, endpoints por configuração, watchdogs, `match_id` por UUID (D5, D7, D11, C0). |
| `packages/leaderboard-app/src/App.tsx` | Fonte Firestore com selo de degradação, endpoints por configuração (D7). |
| `packages/shared/src/types/ship.ts` | `MatchTelemetry` estendida e `ScoreBreakdown` nomeado (D5). |
| `packages/daemon/src/services/sqlite-buffer.ts` | Catálogo lido de arquivo, moderação do campo empresa, fim do default `'Google'` (C0, C0b). |
| `packages/shared/src/utils/company-normalizer.ts` | Entrada vazia deixa de devolver `'Google'` com confiança 1,0 (C0). |

---

## Fase A — Correção: o que quebra na frente de um visitante

Fecha o bloco P0 do backlog da Spec 00 §6. Ordem é dependência real: A1 primeiro porque sem suíte de
testes que executa, nenhuma das correções seguintes é verificável.

### Tarefa A1 — [D8, P5] Fazer a suíte de testes existir de verdade

O `npm test` da raiz não alcança o `player-app`, e o script do pacote foi escrito para nunca falhar.
Consertar o runner **antes** de consertar as asserções é o ponto inteiro da tarefa: ver o teste ficar
vermelho é a prova de que ele passou a rodar.

**Arquivos:**
- Modificar: `package.json:16`
- Modificar: `packages/player-app/package.json:8,10-19`
- Criar: `packages/player-app/vitest.config.ts`
- Modificar: `packages/player-app/src/game/scoring/ScoreCalculator.test.ts:1-3,38-41`

**Interfaces:**
- Consome: `ScoreCalculator.calculateFinalScore()` de `packages/player-app/src/game/scoring/ScoreCalculator.ts:28`.
- Produz: `npm test` na raiz executa os quatro pacotes com teste. Todas as tarefas seguintes dependem disso.

- [ ] **Passo 1: Instalar o Vitest no `player-app`**

O pacote tem `noEmit: true` no `tsconfig.json`, então o padrão `tsc && node --test dist/**` usado por
`shared` e `daemon` não se aplica. O Vitest resolve TypeScript e o alias `@jogo/shared` pelo mesmo
caminho que o Vite já usa em produção.

```bash
npm install -D vitest@^3.0.0 --workspace=packages/player-app
```

- [ ] **Passo 2: Criar `packages/player-app/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@jogo/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx']
  }
});
```

O pacote declara `"type": "module"`, então `__dirname` não existe no escopo de um arquivo de
configuração ESM. Use `import.meta.url`, como acima. *(O `vite.config.ts` existente usa `__dirname` na
linha 9 — se o build do Passo 8 falhar por causa disso, aplique a mesma correção lá.)*

- [ ] **Passo 3: Trocar o script de teste do pacote**

Em `packages/player-app/package.json`, substituir a linha 8 inteira:

```json
    "test": "vitest run"
```

- [ ] **Passo 4: Trocar os imports do teste para o runner do Vitest**

O arquivo importa `describe`/`it` de `node:test`, que registra no runner do Node, não no do Vitest — o
resultado seria "nenhum teste encontrado". Substituir as três primeiras linhas de
`ScoreCalculator.test.ts`:

```ts
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { ScoreCalculator } from './ScoreCalculator.js';
```

As asserções continuam em `node:assert/strict` — a mudança é de runner, não de estilo.

- [ ] **Passo 5: Rodar o teste e ver as quatro falhas**

```bash
npm run test --workspace=packages/player-app
```

Esperado: **FALHA**, com quatro asserções vermelhas em `should apply time bonus only when boss is
defeated` — `bossBonus` esperado 5000 e recebido 10000, `timeBonus` 750 contra 1200, `survivalBonus`
3000 contra 3600, `synergyBonus` 1500 contra 2000. Se o comando passar, o runner ainda não está
executando o arquivo: pare e conserte a configuração antes de seguir.

- [ ] **Passo 6: Corrigir as asserções para as constantes vigentes (P5)**

Em `ScoreCalculator.test.ts`, substituir as quatro linhas 38–41:

```ts
    assert.equal(winResult.breakdown.bossBonus, 10000);
    assert.equal(winResult.breakdown.timeBonus, 15 * 80);
    assert.equal(winResult.breakdown.survivalBonus, 3 * 1200);
    assert.equal(winResult.breakdown.synergyBonus, 2000);
```

- [ ] **Passo 7: Acrescentar cobertura do multiplicador MCP, que nunca teve teste**

Ainda em `ScoreCalculator.test.ts`, dentro do `describe`:

```ts
  it('should apply the MCP specialization multiplier', () => {
    const params = {
      bossDefeated: false,
      remainingTimeSeconds: 0,
      remainingHp: 1,
      synergyBonusUnlocked: false
    };

    const base = new ScoreCalculator().calculateFinalScore(params);
    assert.equal(base.mcpMultiplier, 1.0);
    assert.equal(base.finalScore, 1200);

    const one = new ScoreCalculator().calculateFinalScore({ ...params, mcpCount: 1 });
    assert.equal(one.mcpMultiplier, 1.25);
    assert.equal(one.finalScore, 1500);

    const two = new ScoreCalculator().calculateFinalScore({ ...params, mcpCount: 2 });
    assert.equal(two.mcpMultiplier, 1.1);
    assert.equal(two.finalScore, 1320);

    const three = new ScoreCalculator().calculateFinalScore({ ...params, mcpCount: 3 });
    assert.equal(three.mcpMultiplier, 1.0);
    assert.equal(three.finalScore, 1200);
  });
```

- [ ] **Passo 8: Incluir o `player-app` no runner da raiz**

Em `package.json`, substituir a linha 16 inteira:

```json
    "test": "npm run build:shared && npm run test --workspace=packages/shared && npm run test --workspace=packages/mcps && npm run test --workspace=packages/daemon && npm run test --workspace=packages/player-app",
```

- [ ] **Passo 9: Rodar a suíte inteira e ver verde**

```bash
npm install && npm run build && npm test
```

Esperado: build limpo dos cinco pacotes e testes verdes nos quatro pacotes, com os nomes dos testes
visíveis no output. **Este é o Gate M0.**

- [ ] **Passo 10: Commit**

```bash
git add package.json packages/player-app/package.json packages/player-app/vitest.config.ts \
        packages/player-app/src/game/scoring/ScoreCalculator.test.ts package-lock.json
git commit -m "test(player-app): executar de fato a suíte e alinhar às constantes vigentes"
```

---

### Tarefa A2 — [D1, D3] Validação estrita e gate de auditoria antes da decolagem

Hoje `validateShipSpecification` é importada e nunca chamada, e `normalizeSpec` coage qualquer JSON em
uma nave plausível. Um `ship_spec.json` alucinado, sem nenhuma chamada de tool, decola normalmente.
Esta tarefa fecha as camadas 3 e 4 do protocolo anti-alucinação.

O `normalizeSpec` **não some**: ele continua mapeando nomes de campo frouxos (`raw.damage` →
`weapons.primary.damage`). O que muda é que o resultado dele passa a ser **validado**, e uma falha de
validação passa a ser um evento visível em vez de um silêncio.

**Arquivos:**
- Modificar: `packages/daemon/src/services/file-watcher.ts:24-76,86-145`
- Modificar: `packages/daemon/src/index.ts:84-154`
- Criar: `packages/daemon/src/services/file-watcher.test.ts`

**Interfaces:**
- Consome: `validateShipSpecification(data): { isValid, errors? }` de `packages/shared/src/validator.ts:13`.
- Produz:
  - `FileWatcherService.startWatching(sessionDir, opts)` onde
    `opts: { requiredMcps: string[]; onShipReady: (spec: ShipSpecification) => void; onMcpActivity?: (a: McpActivityEvent) => void; onSpecRejected?: (r: SpecRejection) => void }`.
  - `export type SpecRejection = { reason: 'SCHEMA_INVALID' | 'AUDIT_GATE_FAILED'; details: string[] }`.
  - A Tarefa A4 consome `onSpecRejected`; a C1 consome o evento WS `EVENT_SPEC_REJECTED`.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/daemon/src/services/file-watcher.test.ts`:

```ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FALLBACK_PRESETS } from '@jogo/shared';
import { FileWatcherService } from './file-watcher.js';

function tempSession(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'booth-test-'));
}

function auditLine(server: string, tool: string): string {
  return JSON.stringify({ timestamp: new Date().toISOString(), server, tool, args: {}, result: {} }) + '\n';
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('FileWatcherService — validação estrita e gate de auditoria', () => {
  let dir: string;
  let watcher: FileWatcherService;

  before(() => {
    dir = tempSession();
    fs.writeFileSync(path.join(dir, 'mcp_audit.log'), '', 'utf8');
  });

  after(() => {
    watcher?.stopWatching();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejeita spec que não passa no schema e não emite EVENT_SHIP_READY', async () => {
    const rejections: any[] = [];
    let ready = 0;
    watcher = new FileWatcherService();
    watcher.startWatching(dir, {
      requiredMcps: [],
      onShipReady: () => { ready += 1; },
      onSpecRejected: (r) => rejections.push(r)
    });

    fs.writeFileSync(path.join(dir, 'ship_spec.json'), JSON.stringify({ pilot: { callsign: 'X' } }), 'utf8');
    await wait(900);

    assert.equal(ready, 0);
    assert.equal(rejections.length, 1);
    assert.equal(rejections[0].reason, 'SCHEMA_INVALID');
    watcher.stopWatching();
  });

  it('segura uma spec válida até que todo MCP selecionado tenha registro de auditoria', async () => {
    const dir2 = tempSession();
    const auditPath = path.join(dir2, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    const rejections: any[] = [];
    const readySpecs: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir2, {
      requiredMcps: ['weapons-arsenal', 'hull-propulsion'],
      onShipReady: (s) => readySpecs.push(s),
      onSpecRejected: (r) => rejections.push(r)
    });

    fs.appendFileSync(auditPath, auditLine('weapons-arsenal', 'configure_primary_cannon'));
    fs.writeFileSync(path.join(dir2, 'ship_spec.json'), JSON.stringify(FALLBACK_PRESETS.interceptor), 'utf8');
    await wait(900);
    assert.equal(readySpecs.length, 0, 'não pode decolar com auditoria incompleta');

    fs.appendFileSync(auditPath, auditLine('hull-propulsion', 'tune_engine_output'));
    await wait(900);
    assert.equal(readySpecs.length, 1, 'decola assim que a auditoria fecha');
    assert.equal(rejections.length, 0);

    w.stopWatching();
    fs.rmSync(dir2, { recursive: true, force: true });
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run build:shared && npm run build --workspace=packages/daemon && npm run test --workspace=packages/daemon
```

Esperado: **FALHA de compilação** — `startWatching` ainda tem a assinatura antiga de três argumentos
posicionais e não existe `onSpecRejected`. É a falha correta.

- [ ] **Passo 3: Trocar a assinatura de `startWatching` e introduzir a rejeição**

Em `file-watcher.ts`, substituir o bloco das linhas 6–36 por:

```ts
export interface McpActivityEvent {
  timestamp: string;
  server: string;
  tool: string;
  args?: any;
  result?: any;
}

export type SpecRejection = {
  reason: 'SCHEMA_INVALID' | 'AUDIT_GATE_FAILED';
  details: string[];
};

export interface WatchOptions {
  requiredMcps: string[];
  onShipReady: (spec: ShipSpecification) => void;
  onMcpActivity?: (activity: McpActivityEvent) => void;
  onSpecRejected?: (rejection: SpecRejection) => void;
}

export class FileWatcherService {
  private watcher?: FSWatcher;
  private pollIntervalTimer?: NodeJS.Timeout;
  private opts?: WatchOptions;
  private lastProcessedTimestamp = 0;
  private lastAuditLogLength = 0;
  private currentSpec?: ShipSpecification;
  private pendingSpec?: ShipSpecification;
  private activityHistory: McpActivityEvent[] = [];

  startWatching(sessionDir: string, opts: WatchOptions): void {
    this.stopWatching();
    this.opts = opts;
    this.lastProcessedTimestamp = 0;
    this.lastAuditLogLength = 0;
    this.currentSpec = undefined;
    this.pendingSpec = undefined;
    this.activityHistory = [];
```

Nas linhas seguintes do mesmo método, trocar as referências antigas: `this.onShipReadyCallback` passa a
`this.opts.onShipReady` e `this.onMcpActivityCallback` passa a `this.opts.onMcpActivity`.

- [ ] **Passo 4: Implementar o gate de auditoria**

Ainda em `file-watcher.ts`, acrescentar antes de `checkAndProcessAuditLog`:

```ts
  private auditSatisfied(): { ok: boolean; missing: string[] } {
    const required = this.opts?.requiredMcps ?? [];
    if (required.length === 0) return { ok: true, missing: [] };
    const seen = new Set(this.activityHistory.map((a) => a.server));
    const missing = required.filter((m) => !seen.has(m));
    return { ok: missing.length === 0, missing };
  }

  private releaseIfAuditSatisfied(): void {
    if (!this.pendingSpec) return;
    const audit = this.auditSatisfied();
    if (!audit.ok) return;
    const spec = this.pendingSpec;
    this.pendingSpec = undefined;
    this.currentSpec = spec;
    console.log(`[FileWatcher] Spec liberada após auditoria completa: ${spec.pilot.callsign}`);
    this.opts?.onShipReady(spec);
  }
```

No fim do laço `for (const line of lines)` de `checkAndProcessAuditLog`, depois do
`this.opts?.onMcpActivity?.(entry)`, acrescentar a chamada:

```ts
      this.releaseIfAuditSatisfied();
```

- [ ] **Passo 5: Aplicar a validação estrita no caminho da spec**

Em `checkAndProcessSpecFile`, substituir o bloco das linhas 133–141 por:

```ts
      // 1. Mapeia nomes de campo frouxos para o formato canônico.
      const normalizedSpec = this.normalizeSpec(parsed);

      // 2. [D1] Validação estrita contra o Draft-07. Sem coerção silenciosa.
      const validation = validateShipSpecification(normalizedSpec);
      if (!validation.isValid) {
        const details = validation.errors ?? ['erro de validação desconhecido'];
        console.error('[FileWatcher] ship_spec.json rejeitado pelo schema:', details.join('; '));
        this.opts?.onSpecRejected?.({ reason: 'SCHEMA_INVALID', details });
        return;
      }

      // 3. [D3] Gate de auditoria: nenhuma nave decola sem prova de execução das tools.
      this.pendingSpec = normalizedSpec;
      const audit = this.auditSatisfied();
      if (!audit.ok) {
        console.warn(`[FileWatcher] Spec válida em espera; MCPs sem registro de auditoria: ${audit.missing.join(', ')}`);
        return;
      }

      this.releaseIfAuditSatisfied();
```

- [ ] **Passo 6: Atualizar a chamada no daemon**

Em `packages/daemon/src/index.ts`, substituir o bloco das linhas 122–141 por:

```ts
    const requiredMcps: string[] = Array.isArray(selected_mcps) && selected_mcps.length > 0
      ? selected_mcps
      : ['weapons-arsenal', 'hull-propulsion', 'cybernetics-shields'];

    fileWatcher.startWatching(sessionDir, {
      requiredMcps,
      onShipReady: (shipSpec) => {
        console.log(`[Daemon] Broadcasting EVENT_SHIP_READY to ${activeClients.size} connected client(s)...`);
        broadcast({ type: 'EVENT_SHIP_READY', spec: shipSpec });
      },
      onMcpActivity: (activity) => {
        broadcast({ type: 'EVENT_MCP_ACTIVITY', data: activity });
      },
      onSpecRejected: (rejection) => {
        console.error('[Daemon] Spec rejeitada:', rejection.reason, rejection.details.join('; '));
        broadcast({ type: 'EVENT_SPEC_REJECTED', data: rejection });
      }
    });
```

E acrescentar, logo depois da declaração de `activeClients` na linha 27:

```ts
function broadcast(message: Record<string, unknown>): void {
  const payload = JSON.stringify(message);
  for (const client of activeClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}
```

Substituir os outros três laços de broadcast manuais (linhas 170–174 e as duas de dentro de
`startWatching`) por chamadas a `broadcast(...)`.

- [ ] **Passo 7: Rodar o teste e ver passar**

```bash
npm run build:shared && npm run build --workspace=packages/daemon && npm run test --workspace=packages/daemon
```

Esperado: os dois testes de `file-watcher.test.ts` passam.

- [ ] **Passo 8: Commit**

```bash
git add packages/daemon/src/services/file-watcher.ts packages/daemon/src/services/file-watcher.test.ts \
        packages/daemon/src/index.ts
git commit -m "fix(daemon): validar ship_spec.json contra o schema e exigir auditoria MCP antes da decolagem"
```

---

### Tarefa A3 — [D16] Remover do prompt a resposta pronta

O `GEMINI.md` gerado termina com um `ship_spec.json` completo e preenchido, seguido da instrução mais
enfática do arquivo: *"É CRÍTICO QUE O ARQUIVO EXISTA FISICAMENTE NO DISCO"*. O caminho de menor esforço
para qualquer modelo é copiar o exemplo, trocar o callsign e gravar — sem invocar um único sub-agente.
Pior: `selected_mcps` e `selected_subagents` do exemplo são literais fixos, então a cópia produz
metadados que contradizem a escolha do visitante e alimentam o multiplicador de score com dados falsos.

A troca é: **contrato de campos, não exemplo de valores**.

**Arquivos:**
- Modificar: `packages/daemon/src/services/workspace-generator.ts:133-214`
- Criar: `packages/daemon/src/services/workspace-generator.test.ts`

**Interfaces:**
- Consome: `BALANCE.ranges` — **ainda não existe** na Fase A. Nesta tarefa as faixas são escritas como
  literais no template e a Tarefa B2 as substitui por interpolação de `BALANCE.ranges`. O passo 6 da B2
  faz essa troca explicitamente.
- Produz: `GEMINI.md` sem nenhum valor numérico de atributo e com a regra `PROIBIDO INVENTAR VALORES`.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/daemon/src/services/workspace-generator.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorkspaceGeneratorService } from './workspace-generator.js';

function generate(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-ws-'));
  WorkspaceGeneratorService.generateWorkspace({
    sessionDir: dir,
    pilot: { callsign: 'TESTE', company_raw: 'Acme', company_canonical: 'Acme' },
    energy_sliders: { offense: 40, speed: 20, defense: 25, tech: 15 },
    selected_mcps: ['weapons-arsenal'],
    selected_subagents: ['combat-strategist'],
    mcpsDistDir: '/tmp/fake-mcps'
  });
  return dir;
}

describe('WorkspaceGeneratorService — GEMINI.md', () => {
  it('contém a regra anti-alucinação', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.match(md, /PROIBIDO INVENTAR VALORES/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('não entrega um ship_spec.json de exemplo preenchido', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.doesNotMatch(md, /"damage"\s*:\s*\d/, 'nenhum valor numérico de atributo no template');
    assert.doesNotMatch(md, /"svg_path_data"\s*:\s*"M/, 'nenhum SVG de exemplo copiável');
    assert.doesNotMatch(md, /"synergies_unlocked"\s*:\s*\[\s*"/, 'nenhuma sinergia literal');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('não declara MCPs ou sub-agentes que o visitante não escolheu', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.doesNotMatch(md, /hull-propulsion/);
    assert.doesNotMatch(md, /cybernetics-shields/);
    assert.doesNotMatch(md, /systems-engineer/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run build --workspace=packages/daemon && npm run test --workspace=packages/daemon
```

Esperado: os três testes falham. O primeiro por ausência da regra; o segundo por `"damage": 35`,
`"svg_path_data": "M 64 10..."` e `"synergies_unlocked": ["Glass Cannon 🔥"]`; o terceiro porque o
exemplo lista os três MCPs mesmo com apenas um selecionado.

- [ ] **Passo 3: Reescrever `generateGeminiInstructions`**

Substituir integralmente o corpo do método (`workspace-generator.ts:133-214`) por:

```ts
  private static generateGeminiInstructions(sessionDir: string, config: SessionWorkspaceConfig): void {
    const { pilot, energy_sliders, selected_mcps, selected_subagents } = config;
    const activeSubagents = ['aesthetic-designer', ...selected_subagents];

    const geminiContent = `# PROTOCOLO DE CONSTRUÇÃO DE NAVE: FORJA ESPACIAL AGY

Você é o Orquestrador Chefe da Forja no Antigravity CLI para o evento Google Cloud Summit 2026.

## REGRA ZERO — PROIBIDO INVENTAR VALORES

Você **NÃO** tem permissão para gerar parâmetros numéricos, nomes de sinergia ou dados SVG por conta
própria. Todo número em \`ship_spec.json\` deve vir do retorno de uma ferramenta MCP, e todo dado
visual deve vir do sub-agente \`aesthetic-designer\`. Se uma ferramenta falhar, **relate a falha** e
pare — não preencha o campo com uma estimativa. Um arquivo com valores inventados é uma falha da
demonstração, não um sucesso parcial.

### DADOS DO PILOTO:
- Callsign: "${pilot.callsign}"
- Empresa: "${pilot.company_canonical}" (Raw: "${pilot.company_raw}")

### ALOCAÇÃO DE ENERGIA (Total 100 PU):
- Ataque: ${energy_sliders.offense} PU
- Velocidade: ${energy_sliders.speed} PU
- Defesa: ${energy_sliders.defense} PU
- Tecnologia: ${energy_sliders.tech} PU

### SERVIDORES MCP ATIVOS: ${selected_mcps.join(', ')}
### SUB-AGENTES ATIVOS: ${activeSubagents.join(', ')}

Estes são os únicos MCPs e sub-agentes disponíveis nesta sessão. Não referencie nenhum outro.

### PROTOCOLO RÍGIDO DE 4 PASSOS:
1. **PASSO 1 - FAST GRILL-ME:** Pergunte ao piloto em 1 turno (ou leia seu prompt inicial):
   - [1] Foco de Armas: 1-Laser Perfurante, 2-Chuva de Mísseis, 3-Vulcan Espalhado
   - [2] Estilo Estético: 1-Synthwave 80s, 2-Dark Void Stealth, 3-Cyberpunk Gold
2. **PASSO 2 - DELEGAÇÃO:** Invoque os sub-agentes em \`.agents/agents/\` para forjar a nave.
3. **PASSO 3 - EXECUÇÃO DE TOOLS:** Os sub-agentes DEVEM executar as ferramentas dos MCPs ativos. O
   jogo verifica \`mcp_audit.log\` antes de aceitar a nave: **sem registro de execução, a nave é
   rejeitada.**
4. **PASSO 4 - CRIAÇÃO DO ARQUIVO:** Use sua ferramenta de escrita para gravar
   \`${sessionDir}/ship_spec.json\` com os valores que as ferramentas retornaram.

### CONTRATO DO \`ship_spec.json\` (estrutura, não valores):

| Campo | Origem obrigatória | Faixa aceita |
| :--- | :--- | :--- |
| \`pilot.*\` | Dados do piloto acima, copiados literalmente | — |
| \`build_metadata.selected_mcps\` | Exatamente: ${JSON.stringify(selected_mcps)} | — |
| \`build_metadata.selected_subagents\` | Exatamente: ${JSON.stringify(activeSubagents)} | — |
| \`build_metadata.energy_sliders\` | Alocação de energia acima, copiada literalmente | soma = 100 |
| \`build_metadata.fast_grill_me_choices\` | Respostas do piloto no PASSO 1 | — |
| \`build_metadata.synergies_unlocked\` | Retorno de \`cybernetics-shields\` | — |
| \`attributes.max_hp\` | Retorno de \`hull-propulsion\` | inteiro de 2 a 5 |
| \`attributes.shield_capacity\` | Retorno de \`cybernetics-shields\` | inteiro de 0 a 3 |
| \`attributes.speed_px_s\` | Retorno de \`hull-propulsion\` | 180 a 380 |
| \`attributes.hitbox_radius\` | Retorno de \`hull-propulsion\` | 8 a 16 |
| \`weapons.primary.type\` | Retorno de \`weapons-arsenal\` | laser, plasma ou vulcan_spread |
| \`weapons.primary.damage\` | Retorno de \`weapons-arsenal\` | 15 a 45 |
| \`weapons.primary.fire_rate\` | Retorno de \`weapons-arsenal\` | 5 a 12 |
| \`weapons.secondary.type\` | Retorno de \`weapons-arsenal\` | homing_missiles ou emp_burst |
| \`weapons.secondary.damage\` | Retorno de \`weapons-arsenal\` | 60 a 150 |
| \`weapons.secondary.cooldown_seconds\` | Retorno de \`weapons-arsenal\` | 3 a 12 |
| \`visuals.style_name\` | \`aesthetic-designer\` | texto curto |
| \`visuals.primary_color\`, \`secondary_color\`, \`engine_trail_color\` | \`aesthetic-designer\` | hex \`#rrggbb\` |
| \`visuals.svg_path_data\` | \`aesthetic-designer\` | viewBox 0 0 128 128 |

Valores fora das faixas acima fazem o arquivo ser rejeitado pelo validador do jogo.
`;

    fs.writeFileSync(path.join(sessionDir, 'GEMINI.md'), geminiContent, 'utf8');
    fs.writeFileSync(path.join(sessionDir, 'AGENTS.md'), geminiContent, 'utf8');
  }
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
npm run build --workspace=packages/daemon && npm run test --workspace=packages/daemon
```

Esperado: os cinco testes do daemon (dois de A2, três de A3) passam.

- [ ] **Passo 5: Commit**

```bash
git add packages/daemon/src/services/workspace-generator.ts \
        packages/daemon/src/services/workspace-generator.test.ts
git commit -m "fix(daemon): substituir o exemplo preenchido do GEMINI.md por contrato de campos"
```

### Tarefa A4 — [D2] Timeout do AGY e injeção automática de preset

Hoje a única recuperação de uma falha do `agy` é o visitante clicar em um botão de emergência. A
resiliência depende de a vítima da falha diagnosticá-la.

> **Refinamento da Spec 06 §1.1, a registrar.** A especificação diz *"ao escrever `.session_active`, o
> daemon arma um temporizador de 15s"*. Um timer de 15s a partir do start dispararia em **toda** sessão:
> o visitante ainda está respondendo o Fast Grill-Me nesse intervalo. O que o requisito realmente protege
> é a fase em que o agente já está trabalhando. Esta tarefa implementa três gatilhos, e o passo 7
> atualiza a Spec 06 para descrevê-los:
>
> 1. **Silêncio de 15s** — armado a partir da **primeira** linha de `mcp_audit.log` e rearmado a cada
>    nova linha. Se as tools pararam e a spec não chegou, o agente travou.
> 2. **Teto rígido de 150s** desde `.session_active`, protegendo o SLA de 2m45s do ciclo.
> 3. **Morte do processo** — se o PID de `.agy_pid` some sem spec aceita, o fallback é imediato.

**Arquivos:**
- Criar: `packages/shared/src/utils/fallback-selector.ts`
- Criar: `packages/shared/src/utils/fallback-selector.test.ts`
- Modificar: `packages/shared/src/index.ts:2`
- Modificar: `packages/daemon/src/index.ts` (bloco de `/api/session/start` e de `/api/session/reset`)
- Modificar: `specs/06_RELIABILITY_FAILOVER_AND_SECURITY_SPEC.md` §1.1

**Interfaces:**
- Consome: `FALLBACK_PRESETS` (`packages/shared/src/constants/fallback-presets.ts:22`),
  `EnergySliders` (`packages/shared/src/types/ship.ts`), e o `onSpecRejected` produzido pela Tarefa A2.
- Produz:
  - `selectFallbackPreset(sliders: EnergySliders): { name: 'interceptor' | 'vanguard' | 'striker'; spec: ShipSpecification }`
  - Evento WS `EVENT_SHIP_READY` com o campo adicional `fallback: true`. A Tarefa A7 grava esse campo na
    telemetria; a Tarefa C1 o lê no `HandoffTerminalScreen`.

- [ ] **Passo 1: Escrever o teste do seletor**

Criar `packages/shared/src/utils/fallback-selector.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectFallbackPreset } from './fallback-selector.js';

describe('selectFallbackPreset', () => {
  it('entrega vanguard a quem investiu em defesa', () => {
    const r = selectFallbackPreset({ offense: 15, speed: 15, defense: 60, tech: 10 });
    assert.equal(r.name, 'vanguard');
    assert.equal(r.spec.attributes.max_hp, 5);
  });

  it('entrega interceptor a quem investiu em velocidade', () => {
    assert.equal(selectFallbackPreset({ offense: 20, speed: 55, defense: 15, tech: 10 }).name, 'interceptor');
  });

  it('entrega striker a quem investiu em ataque', () => {
    assert.equal(selectFallbackPreset({ offense: 60, speed: 15, defense: 15, tech: 10 }).name, 'striker');
  });

  it('desempata de forma determinística', () => {
    const a = selectFallbackPreset({ offense: 25, speed: 25, defense: 25, tech: 25 });
    const b = selectFallbackPreset({ offense: 25, speed: 25, defense: 25, tech: 25 });
    assert.equal(a.name, b.name);
  });

  it('devolve uma cópia, não a referência do preset', () => {
    const r = selectFallbackPreset({ offense: 60, speed: 15, defense: 15, tech: 10 });
    r.spec.pilot.callsign = 'MUTADO';
    assert.notEqual(selectFallbackPreset({ offense: 60, speed: 15, defense: 15, tech: 10 }).spec.pilot.callsign, 'MUTADO');
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run test --workspace=packages/shared
```

Esperado: **FALHA** — `Cannot find module './fallback-selector.js'`.

- [ ] **Passo 3: Implementar o seletor**

Criar `packages/shared/src/utils/fallback-selector.ts`:

```ts
import { EnergySliders, ShipSpecification } from '../types/ship.js';
import { FALLBACK_PRESETS } from '../constants/fallback-presets.js';

export type FallbackPresetName = 'interceptor' | 'vanguard' | 'striker';

/**
 * Escolhe o preset de emergência mais próximo da alocação de energia do visitante.
 * A nave degradada ainda precisa refletir a escolha de quem a construiu.
 * Tecnologia é um atributo de suporte: conta meio ponto para os dois perfis que a usam.
 */
export function selectFallbackPreset(
  sliders: EnergySliders
): { name: FallbackPresetName; spec: ShipSpecification } {
  const affinity: Record<FallbackPresetName, number> = {
    striker: sliders.offense,
    interceptor: sliders.speed + sliders.tech * 0.5,
    vanguard: sliders.defense + sliders.tech * 0.5
  };

  // Ordem fixa garante desempate determinístico.
  const order: FallbackPresetName[] = ['striker', 'interceptor', 'vanguard'];
  let name: FallbackPresetName = order[0];
  for (const candidate of order) {
    if (affinity[candidate] > affinity[name]) name = candidate;
  }

  return { name, spec: structuredClone(FALLBACK_PRESETS[name]) };
}
```

- [ ] **Passo 4: Exportar do pacote e ver o teste passar**

Acrescentar a `packages/shared/src/index.ts`:

```ts
export * from './utils/fallback-selector.js';
```

```bash
npm run test --workspace=packages/shared
```

Esperado: os cinco testes passam.

- [ ] **Passo 5: Armar os três gatilhos no daemon**

Em `packages/daemon/src/index.ts`, acrescentar após a função `broadcast` criada na Tarefa A2:

```ts
const AGY_SILENCE_TIMEOUT_MS = Number(process.env.AGY_SILENCE_TIMEOUT_MS) || 15_000;
const AGY_HARD_TIMEOUT_MS = Number(process.env.AGY_HARD_TIMEOUT_MS) || 150_000;
const AGY_LIVENESS_POLL_MS = 1_000;

let silenceTimer: NodeJS.Timeout | undefined;
let hardTimer: NodeJS.Timeout | undefined;
let livenessTimer: NodeJS.Timeout | undefined;
let shipDelivered = false;

function clearAgyTimers(): void {
  if (silenceTimer) clearTimeout(silenceTimer);
  if (hardTimer) clearTimeout(hardTimer);
  if (livenessTimer) clearInterval(livenessTimer);
  silenceTimer = hardTimer = livenessTimer = undefined;
}

function armSilenceTimer(sliders: EnergySliders, reasonPrefix: string): void {
  if (silenceTimer) clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => triggerFallback(sliders, `${reasonPrefix}: silêncio de ${AGY_SILENCE_TIMEOUT_MS}ms`), AGY_SILENCE_TIMEOUT_MS);
}

function triggerFallback(sliders: EnergySliders, reason: string): void {
  if (shipDelivered) return;
  shipDelivered = true;
  clearAgyTimers();

  const { name, spec } = selectFallbackPreset(sliders);
  spec.pilot = { ...spec.pilot, ...currentSessionMetadata?.pilot };
  console.warn(`[Daemon] Fallback automático acionado (${reason}). Preset: ${name}`);

  killAgyProcessGroup();
  broadcast({ type: 'EVENT_SHIP_READY', spec, fallback: true, fallback_preset: name, fallback_reason: reason });
}
```

Acrescentar `selectFallbackPreset` e `EnergySliders` ao import de `@jogo/shared` na linha 11.
`killAgyProcessGroup()` é criada na Tarefa A5; até lá, use uma implementação temporária que chama
`process.kill(pid, 'SIGINT')` lendo `.agy_pid` — a A5 a substitui.

- [ ] **Passo 6: Ligar os gatilhos ao ciclo de vida da sessão**

Dentro de `/api/session/start`, logo depois do bloco `fileWatcher.startWatching(...)` da Tarefa A2:

```ts
    shipDelivered = false;
    clearAgyTimers();
    hardTimer = setTimeout(
      () => triggerFallback(energy_sliders, `teto rígido de ${AGY_HARD_TIMEOUT_MS}ms`),
      AGY_HARD_TIMEOUT_MS
    );
    livenessTimer = setInterval(() => {
      const pidFile = path.join(sessionDir, '.agy_pid');
      if (!fs.existsSync(pidFile)) return;
      const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      if (!pid || Number.isNaN(pid)) return;
      try {
        process.kill(pid, 0); // sinal 0: só testa existência
      } catch {
        triggerFallback(energy_sliders, 'processo do agy encerrou sem entregar a nave');
      }
    }, AGY_LIVENESS_POLL_MS);
```

Dentro do callback `onMcpActivity`, acrescentar `armSilenceTimer(energy_sliders, 'após atividade MCP');`.
Dentro do callback `onShipReady`, acrescentar `shipDelivered = true; clearAgyTimers();` antes do broadcast.
Dentro do callback `onSpecRejected`, acrescentar `armSilenceTimer(energy_sliders, 'após rejeição de spec');`
— uma spec rejeitada dá ao agente uma última janela para corrigir antes do fallback.
Em `/api/session/reset`, acrescentar `clearAgyTimers(); shipDelivered = false;` como primeira linha do `try`.

- [ ] **Passo 7: Atualizar a Spec 06 §1.1 para os três gatilhos**

Substituir, em `specs/06_RELIABILITY_FAILOVER_AND_SECURITY_SPEC.md`, a frase *"Ao escrever
`.session_active`, o daemon arma um temporizador de 15s. Ao estourar:"* por:

```markdown
**Requisito.** O daemon arma três gatilhos independentes. O primeiro que disparar injeta o preset:

- **Silêncio de 15s** após a primeira linha de `mcp_audit.log`, rearmado a cada nova linha.
- **Teto rígido de 150s** desde `.session_active`, protegendo o SLA do ciclo.
- **Morte do processo** do `agy` sem spec aceita.

Ao disparar:
```

Ajustar a tabela de watchdogs da §1.2 na mesma edição: a linha `Handoff / forja | 15s sem spec` passa a
`Handoff / forja | 15s de silêncio ou 150s no total`.

- [ ] **Passo 8: Verificação manual do gatilho**

```bash
npm run start:daemon
curl -s -X POST localhost:3000/api/session/start -H 'Content-Type: application/json' \
  -d '{"pilot":{"callsign":"TESTE","company_raw":"Acme","company_canonical":"Acme"},"energy_sliders":{"offense":15,"speed":15,"defense":60,"tech":10},"selected_mcps":["weapons-arsenal"],"selected_subagents":["combat-strategist"]}'
printf '{"timestamp":"2026-08-10T12:00:00Z","server":"weapons-arsenal","tool":"configure_primary_cannon"}\n' \
  >> /tmp/booth_session/mcp_audit.log
```

Esperado: 15 segundos depois da linha de auditoria, o log do daemon imprime `Fallback automático
acionado ... Preset: vanguard`.

- [ ] **Passo 9: Commit**

```bash
git add packages/shared/src/utils/fallback-selector.ts packages/shared/src/utils/fallback-selector.test.ts \
        packages/shared/src/index.ts packages/daemon/src/index.ts \
        specs/06_RELIABILITY_FAILOVER_AND_SECURITY_SPEC.md
git commit -m "feat(daemon): injetar preset de emergência por silêncio, teto de tempo ou morte do agy"
```

---

### Tarefa A5 — [D4] Encerrar o grupo de processos, não um PID

Os três MCPs são processos-filho stdio do `agy`. Matar só o PID do pai pode deixá-los vivos, e com
≈150 sessões em um dia de evento o vazamento é cumulativo — ataca diretamente o critério de 8 horas
contínuas. A correção é nas duas pontas: o supervisor precisa colocar o `agy` em um grupo próprio, e o
daemon precisa matar o grupo.

> **Nota de portabilidade.** `setsid(1)` não existe no macOS, e o Gate M2 roda no Mac. A solução
> portátil é `set -m` (job control) no supervisor: com monitor mode ligado, todo job em background vira
> líder do próprio grupo de processos, e `$!` passa a ser também o PGID. Funciona igual em bash do
> macOS e do Linux.

**Arquivos:**
- Modificar: `scripts/booth-terminal.sh:1-15,100-114`
- Modificar: `packages/daemon/src/index.ts:182-227`

**Interfaces:**
- Consome: o arquivo `.agy_pid` escrito pelo supervisor, que passa a conter o **PGID**.
- Produz: `killAgyProcessGroup(): void` no daemon, consumida pela Tarefa A4 (`triggerFallback`) e pelo
  endpoint `/api/session/reset`.

- [ ] **Passo 1: Ligar job control no supervisor**

Em `scripts/booth-terminal.sh`, logo após o shebang e antes de qualquer outra linha executável:

```bash
# Job control: cada job em background vira líder do próprio process group,
# de modo que $! é também o PGID e o daemon pode matar a árvore inteira.
set -m

# O visitante não recebe um shell: Ctrl+C e Ctrl+Z não interrompem o supervisor.
trap '' SIGINT SIGTSTP
```

- [ ] **Passo 2: Registrar o PGID em vez do PID**

Na linha 104, e novamente na 110 do caminho de simulação, o `echo "$AGY_PID" > "$PID_FILE"` continua
correto — com `set -m`, `$!` **é** o PGID. Acrescentar uma linha de log logo abaixo de cada um para
tornar a intenção explícita e depurável:

```bash
    echo "[booth-terminal] agy em execução no process group $AGY_PID" >&2
```

- [ ] **Passo 3: Escrever `killAgyProcessGroup` no daemon**

Em `packages/daemon/src/index.ts`, acrescentar junto às demais funções auxiliares:

```ts
function killAgyProcessGroup(): void {
  const pidFile = path.join(sessionDir, '.agy_pid');
  if (!fs.existsSync(pidFile)) return;

  let pgid = 0;
  try {
    pgid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  } catch {
    return;
  }
  if (!pgid || Number.isNaN(pgid) || pgid <= 1) return;

  // Negativo = grupo inteiro. Os 3 MCPs stdio são filhos do agy e morrem junto.
  const signalGroup = (sig: NodeJS.Signals): boolean => {
    try {
      process.kill(-pgid, sig);
      return true;
    } catch (err: any) {
      if (err?.code === 'ESRCH') return false;
      // Grupo não existe (ex.: agy iniciado sem job control). Cai para o PID isolado.
      try { process.kill(pgid, sig); } catch {}
      return false;
    }
  };

  console.log(`[Daemon Reset] Encerrando process group ${pgid}...`);
  signalGroup('SIGINT');
  setTimeout(() => { signalGroup('SIGKILL'); }, 600);

  try { fs.unlinkSync(pidFile); } catch {}
}
```

- [ ] **Passo 4: Trocar o corpo do reset e limpar a sessão inteira**

Substituir o bloco das linhas 193–220 de `/api/session/reset` por:

```ts
    // 2. [D4] Encerra o grupo de processos do agy, incluindo os MCPs stdio.
    killAgyProcessGroup();

    // 3. [Spec 06 §2.1] Higiene: o GEMINI.md do visitante anterior contém nome e empresa.
    //    Apaga todo o conteúdo preservando o inode do diretório (evita uv_cwd ENOENT no terminal aberto).
    try {
      for (const entry of fs.readdirSync(sessionDir)) {
        fs.rmSync(path.join(sessionDir, entry), { recursive: true, force: true });
      }
    } catch (err) {
      console.warn('[Daemon Reset] Falha ao limpar o diretório de sessão:', err);
    }
```

O bloco do `.session_active` (linhas 187–191) permanece, mas passa a ser redundante com a limpeza
total; mantenha-o, porque ele precisa sumir **antes** do supervisor voltar a fazer polling.

- [ ] **Passo 5: Verificação manual**

Com o supervisor rodando em outro terminal e uma sessão ativa:

```bash
ps -o pid,pgid,command -ax | grep -E 'agy|mcps/dist' | grep -v grep
curl -s -X POST localhost:3000/api/session/reset
sleep 2
ps -o pid,pgid,command -ax | grep -E 'agy|mcps/dist' | grep -v grep
```

Esperado: antes do reset, `agy` e os processos `node .../mcps/dist/*.js` compartilham o mesmo PGID;
depois do reset, **nenhuma linha**. Esta é a verificação central do Gate M2.

- [ ] **Passo 6: Commit**

```bash
git add scripts/booth-terminal.sh packages/daemon/src/index.ts
git commit -m "fix(booth): encerrar o process group do agy e limpar o diretório de sessão no reset"
```

---

### Tarefa A6 — [D6, D9] Placar sem pilotos fictícios e banco em caminho estável

Duas correções pequenas de alto impacto operacional. `seedInitialLeaderboard()` insere `CYBER_ACE`
(48.500), `NEO_PILOT` (44.200) e `QUANTUM_VIPER` (39.800) sempre que a tabela está vazia — que é
exatamente o estado da primeira execução no estande, diante de clientes. E o caminho do banco é
relativo ao diretório de invocação, então iniciar o daemon de outro lugar cria um banco novo e vazio no
meio do evento.

**Arquivos:**
- Modificar: `packages/daemon/src/services/sqlite-buffer.ts:46-55,102`
- Criar: `packages/daemon/src/services/sqlite-buffer.test.ts`
- Modificar: `USER_GUIDE.md:151`

**Interfaces:**
- Produz: `BOOTH_DB_PATH` e `BOOTH_SEED_DEMO` como variáveis de ambiente do daemon. O `self_test.sh` da
  Tarefa D3 falha se algum `match_id` começar com `seed_`.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/daemon/src/services/sqlite-buffer.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SQLiteBufferService } from './sqlite-buffer.js';

function tempDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'booth-db-')), 'booth.sqlite');
}

describe('SQLiteBufferService', () => {
  it('não semeia pilotos fictícios por padrão', () => {
    delete process.env.BOOTH_SEED_DEMO;
    const db = new SQLiteBufferService(tempDb());
    const board = db.getLeaderboardData();
    assert.equal(board.top_pilots.length, 0, 'o placar nasce vazio no estande');
    db.close();
  });

  it('semeia apenas quando BOOTH_SEED_DEMO=1', () => {
    process.env.BOOTH_SEED_DEMO = '1';
    const db = new SQLiteBufferService(tempDb());
    assert.ok(db.getLeaderboardData().top_pilots.length > 0);
    db.close();
    delete process.env.BOOTH_SEED_DEMO;
  });

  it('resolve o caminho padrão de forma absoluta, independente do cwd', () => {
    delete process.env.BOOTH_DB_PATH;
    assert.ok(path.isAbsolute(SQLiteBufferService.defaultDbPath()));
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run build --workspace=packages/daemon && npm run test --workspace=packages/daemon
```

Esperado: **FALHA** — `defaultDbPath` não existe e o primeiro teste encontra 3 pilotos.

- [ ] **Passo 3: Caminho absoluto e semente atrás de flag**

Em `sqlite-buffer.ts`, substituir o construtor (linhas 46–55) por:

```ts
  static defaultDbPath(): string {
    if (process.env.BOOTH_DB_PATH) return path.resolve(process.env.BOOTH_DB_PATH);
    // dist/services/ -> dist/ -> raiz do pacote daemon
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    return path.join(packageRoot, 'data', 'booth_buffer.sqlite');
  }

  constructor(dbPath = SQLiteBufferService.defaultDbPath()) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    console.log(`[SQLiteBuffer] Banco local em ${dbPath}`);
    this.initTables();
    this.seedCanonicalCompanies();

    // [D6] Pilotos de demonstração jamais no estande. Só com opt-in explícito.
    if (process.env.BOOTH_SEED_DEMO === '1') {
      console.warn('[SQLiteBuffer] BOOTH_SEED_DEMO=1 — inserindo pilotos fictícios de desenvolvimento.');
      this.seedInitialLeaderboard();
    }
  }
```

Acrescentar ao topo do arquivo: `import { fileURLToPath } from 'node:url';`.

- [ ] **Passo 4: Rodar e ver passar**

```bash
npm run build --workspace=packages/daemon && npm run test --workspace=packages/daemon
```

- [ ] **Passo 5: Alinhar o `USER_GUIDE.md`**

Na linha 151, o caminho documentado passa a ser o real e ganha a variável de ambiente:

```markdown
O buffer local fica em `packages/daemon/data/booth_buffer.sqlite`. Para usar outro caminho, defina
`BOOTH_DB_PATH`. Para popular o placar com pilotos fictícios **em desenvolvimento**, defina
`BOOTH_SEED_DEMO=1` — nunca no dia do evento.
```

- [ ] **Passo 6: Commit**

```bash
git add packages/daemon/src/services/sqlite-buffer.ts packages/daemon/src/services/sqlite-buffer.test.ts USER_GUIDE.md
git commit -m "fix(daemon): banco em caminho absoluto e pilotos de demonstração atrás de flag"
```

---

### Tarefa A7 — [D5] Persistir a telemetria que já é calculada

`ScoreCalculator` rastreia abates, dano recebido, tiros disparados e acertados. Nada disso sai do
navegador: `handleMatchComplete` monta um registro com sete campos e os defaults defensivos do
`saveMatch` gravam `{}` em `telemetry_json` e `ship_spec_json` para **toda** partida real. O `pilot_id`
é sintetizado por partida, o que torna a coleção `pilots` da Spec 05 impossível.

Corrigir D5 e alimentar o simulador da Spec 09 §6 são a mesma tarefa: é o mesmo payload.

**Arquivos:**
- Modificar: `packages/shared/src/types/ship.ts:83-89`
- Modificar: `packages/player-app/src/game/scenes/MainGameScene.ts:24,589-609`
- Modificar: `packages/player-app/src/game/index.ts:5-9`
- Modificar: `packages/player-app/src/App.tsx:17-21,102-133`
- Modificar: `packages/daemon/src/services/sqlite-buffer.ts:232-250`

**Interfaces:**
- Produz:
  - `MatchTelemetry` estendida com `shots_fired`, `shots_hit`, `fallback_used`, `seed`, `boss_ttk_s`.
  - `ScoreBreakdown` — o detalhamento de score, hoje um literal anônimo. Consumido pela B7 e pela C2.
  - `MatchCompleteData` com `telemetry: MatchTelemetry`.
  - O `MatchRecord` completo que a Tarefa C3 envia ao Cloud Run e a C5 sincroniza.
- Consome: a flag `fallback` do evento `EVENT_SHIP_READY` produzida pela Tarefa A4.

- [ ] **Passo 1: Escrever o teste que falha**

O comportamento a travar é do lado do buffer: uma partida sem telemetria não deve ser aceita em
silêncio. Acrescentar a `packages/daemon/src/services/sqlite-buffer.test.ts`:

```ts
  it('rejeita partida sem telemetria em vez de gravar objeto vazio', () => {
    const db = new SQLiteBufferService(tempDb());
    assert.throws(
      () => db.saveMatch({ match_id: 'm1', callsign: 'X', company_canonical: 'Acme', final_score: 10 } as any),
      /telemetry/
    );
    db.close();
  });

  it('preserva telemetria e snapshot da nave no round-trip', () => {
    const db = new SQLiteBufferService(tempDb());
    db.saveMatch({
      match_id: 'm2',
      pilot_id: 'pilot-abc',
      callsign: 'NOVA',
      company_canonical: 'Acme',
      final_score: 12345,
      telemetry: {
        duration_s: 90, enemies_killed: 42, boss_defeated: true, damage_taken: 2,
        accuracy_pct: 61.5, shots_fired: 400, shots_hit: 246,
        fallback_used: false, seed: 7, boss_ttk_s: 31.2
      },
      ship_spec_snapshot: { pilot: { callsign: 'NOVA' } } as any,
      created_at: new Date().toISOString()
    });

    const pending = db.getPendingMatches();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].pilot_id, 'pilot-abc');
    assert.equal(pending[0].telemetry.enemies_killed, 42);
    assert.equal(pending[0].telemetry.seed, 7);
    assert.equal(pending[0].ship_spec_snapshot.pilot.callsign, 'NOVA');
    db.close();
  });
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run build --workspace=packages/daemon && npm run test --workspace=packages/daemon
```

Esperado: **FALHA** — hoje `saveMatch` aceita o registro incompleto e grava `{}`.

- [ ] **Passo 3: Estender o tipo de telemetria**

Em `packages/shared/src/types/ship.ts`, substituir a interface `MatchTelemetry` (linhas 83–89):

```ts
export interface MatchTelemetry {
  duration_s: number;
  enemies_killed: number;
  boss_defeated: boolean;
  damage_taken: number;
  accuracy_pct: number;
  shots_fired: number;
  shots_hit: number;
  /** true quando a nave veio de preset de emergência (D2), não da forja. */
  fallback_used: boolean;
  /** Seed do PRNG da partida. Preenchido pela Tarefa B3; 0 antes dela. */
  seed: number;
  /** Segundos entre o surgimento do boss e sua destruição; null se não foi derrotado. */
  boss_ttk_s: number | null;
}
```

E, no mesmo arquivo, **dar nome ao detalhamento de score**, que hoje existe apenas como literal inline
no retorno de `ScoreCalculator.calculateFinalScore` e é usado como `any` em três lugares:

```ts
/**
 * Detalhamento do score exibido no debrief e persistido em cada partida.
 * Espelha exatamente o objeto `breakdown` de ScoreCalculator.calculateFinalScore.
 */
export interface ScoreBreakdown {
  combatScore: number;
  bossBonus: number;
  timeBonus: number;
  survivalBonus: number;
  synergyBonus: number;
  mcpMultiplier: number;
}
```

Trocar o tipo de retorno de `calculateFinalScore` para usar `ScoreBreakdown` em vez do literal. A
Tarefa B7 leva a classe para `packages/shared` e a C2 usa este tipo em `MatchDocument` — nomeá-lo
agora evita que três lugares descrevam a mesma forma de três jeitos.

- [ ] **Passo 4: Fazer o `saveMatch` exigir o contrato**

Em `sqlite-buffer.ts`, substituir o início de `saveMatch` (linha 232) por:

```ts
  saveMatch(match: MatchRecord): void {
    if (!match.telemetry || typeof match.telemetry.enemies_killed !== 'number') {
      throw new Error(`[SQLiteBuffer] Partida ${match.match_id} sem telemetry — recusada. Ver D5.`);
    }
    if (!match.ship_spec_snapshot || !match.ship_spec_snapshot.pilot) {
      throw new Error(`[SQLiteBuffer] Partida ${match.match_id} sem ship_spec_snapshot — recusada. Ver D5.`);
    }
    if (!match.pilot_id) {
      throw new Error(`[SQLiteBuffer] Partida ${match.match_id} sem pilot_id — recusada. Ver D5.`);
    }
```

E remover os defaults `|| {}` e `|| \`pilot_${Date.now()}\`` das chamadas a `stmt.run(...)`, passando
os campos diretamente. O `POST /api/matches` do daemon passa a devolver `400` quando o `saveMatch`
lança — envolver a chamada em `try/catch` e responder `res.status(400).json({ error: String(err) })`.

- [ ] **Passo 5: A engine passar a emitir telemetria**

Em `MainGameScene.ts`, trocar a assinatura da linha 24:

```ts
  onMatchComplete?: (data: { finalScore: number; victory: boolean; breakdown: ScoreBreakdown; telemetry: MatchTelemetry }) => void;
```

Acrescentar o campo `bossKilledAtSeconds: number | null = null;` junto às demais propriedades da classe,
atribuí-lo com `this.bossKilledAtSeconds = this.elapsedSeconds;` na linha 395 (onde `isVictory` vira
`true`), e substituir o bloco `if (this.onMatchComplete)` das linhas 602–608:

```ts
    if (this.onMatchComplete) {
      const shotsFired = this.scoreCalculator.shotsFired;
      const shotsHit = this.scoreCalculator.shotsHit;
      this.onMatchComplete({
        finalScore: scoreResult.finalScore,
        victory: this.isVictory,
        breakdown: scoreResult.breakdown,
        telemetry: {
          duration_s: Math.round(this.elapsedSeconds),
          enemies_killed: this.scoreCalculator.totalKills,
          boss_defeated: this.isVictory,
          damage_taken: this.scoreCalculator.damageTakenCount,
          accuracy_pct: shotsFired > 0 ? +((shotsHit / shotsFired) * 100).toFixed(1) : 0,
          shots_fired: shotsFired,
          shots_hit: shotsHit,
          fallback_used: this.shipSpec.build_metadata?.fallback_used === true,
          seed: 0,
          boss_ttk_s: this.bossKilledAtSeconds !== null ? +(this.bossKilledAtSeconds - 45).toFixed(1) : null
        }
      });
    }
```

Importar `MatchTelemetry` de `@jogo/shared` no topo do arquivo. Espelhar o novo tipo em
`packages/player-app/src/game/index.ts` na interface `MatchCompleteData`.

> `fallback_used` lê `build_metadata.fallback_used`, um campo opcional que a Tarefa A4 passa a marcar na
> spec injetada. Acrescentar `fallback_used?: boolean` a `BuildMetadata` em `types/ship.ts` e
> `spec.build_metadata.fallback_used = true;` dentro de `triggerFallback`.
> O `seed` fica em `0` até a Tarefa B3 introduzir o PRNG; o passo 5 da B3 o preenche.

- [ ] **Passo 6: O `App.tsx` montar o registro completo**

Gerar um `pilot_id` estável por visitante, não por partida. Acrescentar junto aos demais `useState`
(linha 21):

```tsx
  const [pilotId, setPilotId] = useState<string>(() => crypto.randomUUID());
```

E em `handleReset`, antes de `setStage('ATTRACT')`, acrescentar `setPilotId(crypto.randomUUID());` — um
piloto novo por ciclo de estande, o mesmo `pilot_id` para todas as partidas do mesmo visitante.

Substituir o corpo de `handleMatchComplete` (linhas 112–133):

```tsx
  const handleMatchComplete = (result: MatchCompleteData) => {
    const matchRecord: MatchRecord & { victory: boolean; breakdown: any } = {
      match_id: `match_${Date.now()}`,
      pilot_id: pilotId,
      callsign: pilot.callsign,
      company_canonical: pilot.company_canonical,
      final_score: result.finalScore,
      telemetry: result.telemetry,
      ship_spec_snapshot: shipSpec,
      created_at: new Date().toISOString(),
      victory: result.victory,
      breakdown: result.breakdown
    };

    setLastMatch(matchRecord);

    fetch(`${API_BASE}/api/matches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(matchRecord)
    }).catch((err) => console.warn('[App] Falha ao gravar a partida no bridge:', err));

    setStage('DEBRIEF');
  };
```

`API_BASE` vem da Tarefa C1; até lá, mantenha o literal `http://localhost:3000` e deixe um comentário
`// TODO(C1): configuração`.

- [ ] **Passo 7: Verificar o round-trip de ponta a ponta**

```bash
npm run build && npm run test
npm run start:daemon    # em outro terminal
sqlite3 packages/daemon/data/booth_buffer.sqlite \
  "SELECT match_id, pilot_id, json_extract(telemetry_json,'$.enemies_killed'), length(ship_spec_json) FROM local_matches ORDER BY created_at DESC LIMIT 3;"
```

Esperado, após jogar uma partida: `pilot_id` em formato UUID, contagem de abates diferente de `null`, e
`length(ship_spec_json)` na casa dos milhares — não `2`, que é o comprimento de `{}`.

- [ ] **Passo 8: Commit**

```bash
git add packages/shared/src/types/ship.ts packages/player-app/src/game/scenes/MainGameScene.ts \
        packages/player-app/src/game/index.ts packages/player-app/src/App.tsx \
        packages/daemon/src/services/sqlite-buffer.ts packages/daemon/src/services/sqlite-buffer.test.ts \
        packages/daemon/src/index.ts
git commit -m "feat(telemetry): persistir telemetria completa e snapshot da nave por partida"
```

---

### Tarefa A8 — [D10, P1, P8] Remover o que mente sobre a arquitetura

Três resíduos que fazem o repositório afirmar coisas falsas: `howler` declarado e nunca importado (o
áudio é um sintetizador WebAudio próprio, **P8**), o WebSocket ainda chamado `/pty` quando não há PTY
algum (**P1**), e `run_agy.sh` gerado a cada sessão sem que nada o execute.

`getPendingMatches()` e `markMatchSynced()` **permanecem**: a Tarefa C5 é o worker que faltava.

**Arquivos:**
- Modificar: `packages/player-app/package.json:14,21`
- Modificar: `packages/daemon/src/index.ts:22`
- Modificar: `packages/player-app/src/components/HandoffTerminalScreen.tsx:46`
- Modificar: `packages/daemon/src/services/workspace-generator.ts:47-56`

- [ ] **Passo 1: Remover o `howler`**

```bash
npm uninstall howler @types/howler --workspace=packages/player-app
grep -rn "howler" packages/ --include=*.ts --include=*.tsx --include=*.json | grep -v node_modules
```

Esperado do `grep`: **nenhuma linha**. Se aparecer algum import real, pare — a premissa de P8 estaria
errada e o áudio dependeria mesmo da biblioteca.

- [ ] **Passo 2: Renomear o WebSocket para `/events`**

`packages/daemon/src/index.ts:22`:

```ts
const wss = new WebSocketServer({ server, path: '/events' });
```

`packages/player-app/src/components/HandoffTerminalScreen.tsx:46`:

```ts
      ws = new WebSocket('ws://localhost:3000/events');
```

Aplicar a mesma troca em qualquer outra ocorrência:

```bash
grep -rn "'/pty'\|/pty" packages/ --include=*.ts --include=*.tsx | grep -v node_modules
```

Esperado após a edição: **nenhuma linha**.

- [ ] **Passo 3: Parar de gerar o `run_agy.sh` órfão**

Remover o bloco das linhas 47–56 de `workspace-generator.ts`. O supervisor
`scripts/booth-terminal.sh` executa `agy` diretamente; um script gerado que ninguém chama só oferece ao
visitante uma superfície a mais para clicar.

- [ ] **Passo 4: Rodar tudo e commitar**

```bash
npm run build && npm test
git add packages/player-app/package.json package-lock.json packages/daemon/src/index.ts \
        packages/player-app/src/components/HandoffTerminalScreen.tsx \
        packages/daemon/src/services/workspace-generator.ts
git commit -m "chore: remover howler não usado, renomear o WS para /events e o run_agy.sh órfão"
```

---

> ### Gate M2 — ensaio manual no Mac
>
> Rodar **depois da Fase B** (a Fase A sozinha entrega um jogo corrigido mas ainda invencível). Deixado
> aqui como lembrete do que a Fase A precisa ter tornado possível:
>
> - Ciclo completo com `agy` real: registro → builder → forja → voo → debrief.
> - Corromper `/tmp/booth_session/ship_spec.json` no meio da forja e ver o preset de emergência entrar
>   sozinho, sem mensagem de erro para o visitante.
> - Gravar um `ship_spec.json` válido **sem** nenhuma linha em `mcp_audit.log` e confirmar que a nave
>   **não** decola.
> - `/agents` e `/mcp` no CLI listam **estritamente** os componentes daquela sessão, e nada além
>   ([Spec 03](./03_AGY_HARNESS_AND_INTEGRATION_SPEC.md) §8).
> - **Latência do handoff:** do `EVENT_SHIP_READY` ao canvas do Phaser com foco, **menos de 500ms**
>   (Spec 03 §8). Medir pelo Performance do DevTools, não a olho — é a transição que o visitante lê
>   como "a nave ficou pronta", e meio segundo é o limite entre mágica e travamento.
> - **Os números do builder correspondem à nave gerada**, dentro da tolerância declarada
>   ([Spec 02](./02_BUILDER_AND_BUDGET_MECHANICS_SPEC.md) §7). Anotar os atributos projetados na tela do
>   builder e compará-los com o `ship_spec.json` efetivamente gravado. Divergência grande aqui não é
>   bug de código: é o `GEMINI.md` da Tarefa A3 dando margem demais ao agente, e o conserto é no prompt.
> - Após o reset: `ps -o pid,pgid,command -ax | grep -E 'agy|mcps/dist'` sem resultado.

## Fase B — Balanceamento medido e modo de desenvolvimento isolado

Implementa a [Spec 09](./09_GAME_BALANCE_AND_DEV_MODE.md) inteira. A ordem das tarefas é a cadeia de
dependências do §7 daquela especificação, não uma preferência: sem `balance.ts` não há schema gerado;
sem seed não há regressão atribuível; sem simulador não há como corrigir o boss sem repetir o erro que
produziu D12.

### Tarefa B1 — [P5] Extrair todo o tuning para `balance.ts`

Hoje o mesmo jogo é definido por números em cinco arquivos. Mudar a dificuldade exige encontrá-los, e
duas camadas podem discordar sem que nada avise. Esta tarefa não muda o comportamento do jogo em nada:
ao final, a partida deve jogar **exatamente** como antes. É uma refatoração pura, e é a base de tudo
que vem depois.

**Arquivos:**
- Criar: `packages/shared/src/constants/balance.ts`
- Criar: `packages/shared/src/constants/balance.test.ts`
- Modificar: `packages/shared/src/index.ts`
- Modificar: `packages/player-app/src/game/scoring/ScoreCalculator.ts`
- Modificar: `packages/player-app/src/game/scoring/ScoreCalculator.test.ts`
- Modificar: `packages/player-app/src/game/weapons/WeaponSystem.ts`
- Modificar: `packages/player-app/src/game/objects/PlayerShip.ts`
- Modificar: `packages/player-app/src/game/objects/BossOverlord.ts`
- Modificar: `packages/player-app/src/game/scenes/MainGameScene.ts`

**Interfaces:**
- Produz: `BALANCE`, objeto congelado com as seções `match`, `pools`, `player`, `weapons`, `enemies`,
  `boss`, `score`, `synergies` e `ranges`. Consumido por B2 (geração de schema), B3, B6, B7 e B8, e
  pelo `normalizeSpec` do daemon.
- Produz: `type BalanceRangeKey = keyof typeof BALANCE.ranges` — os caminhos de campo que a Tarefa B2
  usa para gerar o schema.

- [ ] **Passo 1: Escrever o teste de invariantes**

O teste não repete os números — ele afirma as **relações** entre eles. Assim continua valendo depois da
Tarefa B8 mudar os valores.

Criar `packages/shared/src/constants/balance.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from './balance.js';

describe('BALANCE', () => {
  it('tem faixas com mínimo estritamente menor que o máximo', () => {
    for (const [field, range] of Object.entries(BALANCE.ranges)) {
      assert.ok(range.min < range.max, `${field}: min ${range.min} não é menor que max ${range.max}`);
    }
  });

  it('ordena a linha do tempo da partida', () => {
    const { duration_s, boss_spawn_s, boss_warning_s, wave2_starts_s } = BALANCE.match;
    assert.ok(wave2_starts_s < boss_warning_s);
    assert.ok(boss_warning_s < boss_spawn_s);
    assert.ok(boss_spawn_s < duration_s, 'o boss precisa aparecer antes do fim da partida');
  });

  it('deixa tempo suficiente para a luta contra o boss', () => {
    assert.ok(BALANCE.match.duration_s - BALANCE.match.boss_spawn_s >= 40,
      'menos de 40s de janela contra o boss torna a vitória dependente de sorte');
  });

  it('escalona as fases do boss em dificuldade crescente', () => {
    const { phase2_hp_ratio, phase3_hp_ratio, mitigation, fire_cooldown_ms } = BALANCE.boss;
    assert.ok(phase3_hp_ratio < phase2_hp_ratio, 'a fase 3 vem depois da 2');
    assert.ok(mitigation.phase1 < mitigation.phase2, 'a mitigação diminui conforme o boss enfraquece');
    assert.ok(mitigation.phase2 < mitigation.phase3);
    assert.equal(mitigation.phase3, 1.0, 'na fase final o dano passa integralmente');
    assert.ok(fire_cooldown_ms.phase3 < fire_cooldown_ms.phase2);
    assert.ok(fire_cooldown_ms.phase2 < fire_cooldown_ms.phase1);
  });

  it('recompensa a especialização em MCP de forma monotônica', () => {
    const m = BALANCE.score.mcp_multiplier_by_count;
    assert.ok(m[1] > m[2], '1 MCP precisa render mais que 2');
    assert.ok(m[2] > BALANCE.score.mcp_multiplier_default);
  });

  it('nunca deixa o dano mitigado zerar', () => {
    assert.ok(BALANCE.boss.min_damage_per_hit > 0);
    assert.ok(BALANCE.boss.max_damage_per_primary_hit >= BALANCE.ranges['weapons.primary.damage'].max,
      'o teto por projétil não pode anular o topo da faixa autorizada');
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run test --workspace=packages/shared
```

Esperado: **FALHA** — `Cannot find module './balance.js'`.

- [ ] **Passo 3: Escrever `balance.ts` com os valores vigentes**

Os valores abaixo são os que o jogo tem hoje, transcritos das cinco origens. **Nenhum número muda
nesta tarefa.** A Tarefa B8 os altera, com medição.

Criar `packages/shared/src/constants/balance.ts`:

```ts
/**
 * Contrato numérico único do jogo (Spec 09 §2).
 *
 * Toda constante que altera jogabilidade vive aqui. Três consumidores dependem
 * deste arquivo e precisam concordar entre si:
 *   1. `ship_spec.schema.json`, gerado de `ranges` por `npm run gen:schema`.
 *   2. `normalizeSpec` no daemon, que valida contra `ranges`.
 *   3. A engine Phaser, que consome os valores já validados sem reclampar.
 *
 * Cosmético (cores, posições de HUD, durações de tween) NÃO entra aqui.
 */
export const BALANCE = {
  /** Linha do tempo da partida, em segundos e milissegundos. */
  match: {
    duration_s: 90,
    boss_warning_s: 42,
    boss_spawn_s: 45,
    wave2_starts_s: 20,
    wave_interval_ms: 750,
    wave_interval_hardcore_ms: 550,
    enemy_fire_interval_ms: 1200,
    enemy_fire_interval_hardcore_ms: 800
  },

  /** Tetos dos pools de objetos. Esgotar um pool faz a arma parar de existir (D13). */
  pools: {
    enemies: 45,
    enemy_bullets: 120,
    primary_bullets: 100,
    secondary_missiles: 20,
    boss_bullets: 300
  },

  player: {
    sprite_scale: 0.65,
    invulnerability_ms: 1500,
    bank_angle_deg: 12,
    shield_aura_radius_px: 45
  },

  weapons: {
    primary: {
      /** Cada pelota do vulcan_spread causa esta fração do dano nominal. */
      vulcan_pellet_factor: 0.65,
      vulcan_pellet_count: 3,
      default_bullet_speed: 650,
      min_bullet_speed: 550,
      default_spread_deg: 15
    },
    secondary: {
      missile_count_per_volley: 2,
      missile_speed_y: -300,
      missile_speed_x: 100,
      emp_radius_px: 300,
      /** Dano do EMP na borda do raio, como fração do dano no centro. */
      emp_edge_falloff: 0.5
    }
  },

  enemies: {
    drone: { hp: 30, speed_y: 190 },
    cruiser: { hp: 140, speed_y: 130 },
    kamikaze: { hp: 25, speed_y: 320 },
    bullet_speed: 220,
    bullet_speed_hardcore: 280,
    /** Probabilidade de um drone não-kamikaze atirar em cada evento de disparo. */
    fire_chance: 0.6,
    hardcore: { hp_factor: 1.3, speed_factor: 1.2 }
  },

  boss: {
    max_hp: 15000,
    max_hp_hardcore: 22000,
    hardcore_difficulty_factor: 1.4,
    phase2_hp_ratio: 0.66,
    phase3_hp_ratio: 0.33,
    /** Fração do dano que atravessa em cada fase. Menor = mais resistente. */
    mitigation: { phase1: 0.50, phase2: 0.70, phase3: 1.0 },
    min_damage_per_hit: 5,
    /** Teto por projétil da arma primária. NÃO se aplica à secundária (ver D13). */
    max_damage_per_primary_hit: 45,
    phase_transition_invuln_ms: 2000,
    fire_cooldown_ms: { phase1: 140, phase2: 110, phase3: 80 },
    bullet_speed: { phase1: 300, phase2: 340, phase3: 380 },
    hover_speed: { phase1: 0.0018, phase2: 0.0025, phase3: 0.0035 },
    hover_range_px: { phase1: 2.5, phase2: 3.5, phase3: 4.5 }
  },

  score: {
    points: { drone: 100, cruiser: 500, boss: 10000 },
    combo_step: 0.1,
    combo_max: 3.0,
    boss_bonus: 10000,
    time_bonus_per_second: 80,
    survival_bonus_per_hp: 1200,
    synergy_bonus: 2000,
    mcp_multiplier_by_count: { 1: 1.25, 2: 1.10 } as Record<number, number>,
    mcp_multiplier_default: 1.0
  },

  /** Modificadores da matriz da Spec 02 §6. Aplicados pela Tarefa B6. */
  synergies: {
    glass_cannon: { primary_damage_factor: 1.30, forced_max_hp: 2 },
    titan_fortress: { forced_max_hp: 5, min_shield_capacity: 2, regen_interval_s: 20 },
    ghost_interceptor: { use_max_speed: true, use_min_hitbox: true },
    balanced_ace: { all_attributes_factor: 1.15 }
  },

  /**
   * Faixas válidas de cada campo do `ship_spec.json`. Fonte única: o schema é
   * gerado daqui (B2) e o daemon valida contra isto.
   */
  ranges: {
    'attributes.max_hp': { min: 2, max: 5, integer: true },
    'attributes.shield_capacity': { min: 0, max: 3, integer: true },
    'attributes.speed_px_s': { min: 180, max: 380, integer: false },
    'attributes.hitbox_radius': { min: 8, max: 16, integer: false },
    'weapons.primary.damage': { min: 15, max: 45, integer: false },
    'weapons.primary.fire_rate': { min: 5, max: 12, integer: false },
    'weapons.primary.bullet_speed': { min: 400, max: 800, integer: false },
    'weapons.primary.spread_angle': { min: 0, max: 30, integer: false },
    'weapons.secondary.damage': { min: 60, max: 150, integer: false },
    'weapons.secondary.cooldown_seconds': { min: 3, max: 12, integer: false },
    'build_metadata.energy_sliders.offense': { min: 10, max: 50, integer: true },
    'build_metadata.energy_sliders.speed': { min: 10, max: 50, integer: true },
    'build_metadata.energy_sliders.defense': { min: 10, max: 50, integer: true },
    'build_metadata.energy_sliders.tech': { min: 10, max: 50, integer: true }
  }
} as const;

export type BalanceRangeKey = keyof typeof BALANCE.ranges;
```

> **Duas faixas mudam de valor em relação ao schema atual**, e é de propósito — é o conteúdo de D14.
> `weapons.primary.damage` era 10–60 no schema e 15–45 na engine; `fire_rate` era 2–60 no schema e
> 5–12 na engine. `balance.ts` adota a faixa que a engine **realmente honra**, e a Tarefa B2 propaga
> isso para o schema e para o prompt. Sem isso, o AGY continua autorizado a escrever `fire_rate: 60`
> para virar 12 em silêncio.

- [ ] **Passo 4: Exportar e ver o teste passar**

Acrescentar a `packages/shared/src/index.ts`:

```ts
export * from './constants/balance.js';
```

```bash
npm run test --workspace=packages/shared
```

Esperado: os seis testes passam.

- [ ] **Passo 5: `ScoreCalculator` passa a ler do `BALANCE`**

Substituir todos os literais de `ScoreCalculator.ts`:

```ts
import { BALANCE } from '@jogo/shared';

  registerKill(enemyType: 'drone' | 'cruiser' | 'boss'): number {
    const basePoints = BALANCE.score.points[enemyType];
    const earned = Math.round(basePoints * this.comboMultiplier);
    this.currentScore += earned;
    this.totalKills += 1;
    this.comboMultiplier = Math.min(
      BALANCE.score.combo_max,
      +(this.comboMultiplier + BALANCE.score.combo_step).toFixed(2)
    );
    return earned;
  }
```

E no `calculateFinalScore`:

```ts
    const bossBonus = params.bossDefeated ? BALANCE.score.boss_bonus : 0;
    const timeBonus = params.bossDefeated
      ? Math.max(0, Math.round(params.remainingTimeSeconds * BALANCE.score.time_bonus_per_second))
      : 0;
    const survivalBonus = Math.max(0, params.remainingHp * BALANCE.score.survival_bonus_per_hp);
    const synergyBonus = params.synergyBonusUnlocked ? BALANCE.score.synergy_bonus : 0;
    const rawTotal = combatScore + bossBonus + timeBonus + survivalBonus + synergyBonus;
    const mcpMultiplier =
      BALANCE.score.mcp_multiplier_by_count[params.mcpCount ?? 3] ?? BALANCE.score.mcp_multiplier_default;
```

- [ ] **Passo 6: Reescrever as asserções do teste de score em termos do `BALANCE`**

A Tarefa A1 deixou literais (`10000`, `15 * 80`) nas asserções. Trocá-los agora, para que a Tarefa B8
possa retunar sem quebrar testes que não têm nada a ver com o tuning. Em
`ScoreCalculator.test.ts`:

```ts
import { BALANCE } from '@jogo/shared';

    expect(winResult.breakdown.bossBonus).toBe(BALANCE.score.boss_bonus);
    expect(winResult.breakdown.timeBonus).toBe(15 * BALANCE.score.time_bonus_per_second);
    expect(winResult.breakdown.survivalBonus).toBe(3 * BALANCE.score.survival_bonus_per_hp);
    expect(winResult.breakdown.synergyBonus).toBe(BALANCE.score.synergy_bonus);
    expect(winResult.mcpMultiplier).toBe(BALANCE.score.mcp_multiplier_by_count[1]);
```

- [ ] **Passo 7: `WeaponSystem`, `PlayerShip` e `BossOverlord`**

`WeaponSystem.ts`: `maxSize: BALANCE.pools.primary_bullets` e `BALANCE.pools.secondary_missiles`;
`vulcan_pellet_factor` no lugar de `0.65`; `min_bullet_speed` e `default_bullet_speed` no lugar de
`550`/`650`; `default_spread_deg` no lugar de `15`. **Os clamps (`Math.min(12, Math.max(5, …))`,
`Math.min(45, Math.max(15, …))`, `Math.min(120, Math.max(60, …))`) ficam por enquanto** — quem os
remove é a Tarefa B2, junto com a validação estrita que os torna desnecessários.

`PlayerShip.ts`: `setScale(BALANCE.player.sprite_scale)`, `bank_angle_deg` no lugar de `±12`,
`shield_aura_radius_px` no lugar de `45`, e a invulnerabilidade passa a derivar de
`BALANCE.player.invulnerability_ms` — o tween atual (`repeat: 4, duration: 120`, ida e volta) dura
`120 × 2 × 5 = 1200ms`, não 1.500ms. Ajustar para `duration: BALANCE.player.invulnerability_ms / 10`
e documentar a relação em comentário.

`BossOverlord.ts`: HP, `difficultyMultiplier`, limiares de fase, mitigações, teto por projétil, dano
mínimo, cooldowns, velocidades de projétil, `hover_speed`, `hover_range_px`, `maxSize` do pool e a
invulnerabilidade de transição, todos vindos de `BALANCE.boss`.

`MainGameScene.ts`: duração, `boss_warning_s`, `boss_spawn_s`, `wave2_starts_s`, os dois intervalos de
`time.addEvent`, os `maxSize` dos pools, HP e velocidade de cada tipo de drone, os fatores de hardcore
e a probabilidade de disparo inimigo.

- [ ] **Passo 8: Verificar que o jogo não mudou**

```bash
npm run build && npm test
npm run dev:player
```

Jogar uma partida completa. O comportamento precisa ser indistinguível do anterior: mesmo tempo até o
boss, mesma sensação de cadência, mesmo score em situações equivalentes. Qualquer diferença perceptível
é um erro de transcrição — encontre-o antes de commitar.

- [ ] **Passo 9: Conferir o que sobrou de número solto**

```bash
grep -nE '[^a-zA-Z_.$][0-9]{2,}' packages/player-app/src/game/objects packages/player-app/src/game/weapons packages/player-app/src/game/scoring
```

Revisar a lista. O que restar deve ser exclusivamente cosmético: cores hexadecimais, coordenadas de
desenho de textura, tamanhos de fonte, durações de tween e raios de partícula. **Nenhum número que
altere dano, HP, velocidade, cadência ou pontuação pode aparecer.** Se aparecer, ele pertence ao
`balance.ts`.

- [ ] **Passo 10: Commit**

```bash
git add packages/shared/src/constants/balance.ts packages/shared/src/constants/balance.test.ts \
        packages/shared/src/index.ts packages/player-app/src/game
git commit -m "refactor(balance): centralizar todo o tuning do jogo em balance.ts"
```

---

### Tarefa B2 — [D14] Um contrato numérico, três camadas obedientes

Três definições de faixa discordam hoje: o schema autoriza `damage` 10–60, o `normalizeSpec` clampa
para 15–45, e o `WeaponSystem` clampa de novo. O AGY é informado de uma faixa, obedece, e o jogo
silenciosamente ignora. Esta tarefa faz o schema **nascer** do `balance.ts` e apaga os dois clamps
redundantes.

O clamp não é substituído por nada: quando a spec sai da faixa, ela é **rejeitada** pela validação
estrita da Tarefa A2, o daemon escreve o motivo em disco, e o agente tem a chance de corrigir antes de
o temporizador da Tarefa A4 injetar o preset.

**Arquivos:**
- Criar: `packages/shared/src/schema/gen-schema.ts`
- Criar: `packages/shared/src/schema/schema-sync.test.ts`
- Modificar: `packages/shared/src/schema/ship_spec.schema.json` (regerado)
- Modificar: `packages/shared/package.json`, `package.json` da raiz (script `gen:schema`)
- Modificar: `packages/daemon/src/services/file-watcher.ts` (`normalizeSpec`)
- Modificar: `packages/daemon/src/services/file-watcher.test.ts`
- Modificar: `packages/player-app/src/game/weapons/WeaponSystem.ts`
- Modificar: `packages/daemon/src/services/workspace-generator.ts` (tabela de contrato e passo 5)

**Interfaces:**
- Consome: `BALANCE.ranges` (Tarefa B1).
- Produz: `buildShipSpecSchema(): object` exportada de `gen-schema.ts`, usada pelo teste de sincronia e
  pelo script de geração.
- Produz: o arquivo `spec_errors.txt` no diretório de sessão, lido pelo agente conforme o passo 5 do
  protocolo do `GEMINI.md`.

- [ ] **Passo 1: Escrever o teste de sincronia**

Criar `packages/shared/src/schema/schema-sync.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../constants/balance.js';
import { buildShipSpecSchema } from './gen-schema.js';
import versioned from './ship_spec.schema.json' with { type: 'json' };

describe('ship_spec.schema.json', () => {
  it('é idêntico ao que o gerador produz — rode `npm run gen:schema`', () => {
    assert.deepEqual(buildShipSpecSchema(), versioned);
  });

  it('deriva cada faixa numérica de BALANCE.ranges', () => {
    const schema: any = buildShipSpecSchema();
    for (const [fieldPath, range] of Object.entries(BALANCE.ranges)) {
      const node = fieldPath.split('.').reduce((acc: any, key) => acc?.properties?.[key], schema);
      assert.ok(node, `campo ${fieldPath} ausente do schema gerado`);
      assert.equal(node.minimum, range.min, `${fieldPath}.minimum`);
      assert.equal(node.maximum, range.max, `${fieldPath}.maximum`);
      assert.equal(node.type, range.integer ? 'integer' : 'number', `${fieldPath}.type`);
    }
  });

  it('não oferece nenhum valor de enum que a engine ignore', () => {
    const schema: any = buildShipSpecSchema();
    const secondaryTypes = schema.properties.weapons.properties.secondary.properties.type.enum;
    assert.ok(!secondaryTypes.includes('drone_escort'),
      'drone_escort não tem implementação na engine — ver Spec 09 §2.4');
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run test --workspace=packages/shared
```

Esperado: **FALHA** — `Cannot find module './gen-schema.js'`.

- [ ] **Passo 3: Escrever o gerador**

Criar `packages/shared/src/schema/gen-schema.ts`:

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BALANCE } from '../constants/balance.js';

type NumericNode = { type: 'integer' | 'number'; minimum: number; maximum: number };

function numeric(key: keyof typeof BALANCE.ranges): NumericNode {
  const r = BALANCE.ranges[key];
  return { type: r.integer ? 'integer' : 'number', minimum: r.min, maximum: r.max };
}

const HEX_COLOR = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } as const;

/**
 * Constrói o JSON Schema Draft-07 do ship_spec a partir de BALANCE.ranges.
 * Nenhuma faixa numérica é literal aqui — se um valor precisa mudar, ele muda
 * em balance.ts e este arquivo apenas o propaga.
 */
export function buildShipSpecSchema(): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'ShipSpecification',
    type: 'object',
    additionalProperties: false,
    required: ['pilot', 'build_metadata', 'attributes', 'weapons', 'visuals'],
    properties: {
      pilot: {
        type: 'object',
        additionalProperties: false,
        required: ['callsign', 'company_raw', 'company_canonical'],
        properties: {
          callsign: { type: 'string', minLength: 1, maxLength: 15 },
          company_raw: { type: 'string', minLength: 1, maxLength: 40 },
          company_canonical: { type: 'string', minLength: 1, maxLength: 40 }
        }
      },
      build_metadata: {
        type: 'object',
        additionalProperties: false,
        required: ['selected_mcps', 'selected_subagents', 'energy_sliders', 'fast_grill_me_choices', 'synergies_unlocked'],
        properties: {
          selected_mcps: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: { type: 'string', enum: ['weapons-arsenal', 'hull-propulsion', 'cybernetics-shields'] }
          },
          selected_subagents: {
            type: 'array',
            items: { type: 'string', enum: ['aesthetic-designer', 'combat-strategist', 'systems-engineer'] }
          },
          energy_sliders: {
            type: 'object',
            additionalProperties: false,
            required: ['offense', 'speed', 'defense', 'tech'],
            properties: {
              offense: numeric('build_metadata.energy_sliders.offense'),
              speed: numeric('build_metadata.energy_sliders.speed'),
              defense: numeric('build_metadata.energy_sliders.defense'),
              tech: numeric('build_metadata.energy_sliders.tech')
            }
          },
          fast_grill_me_choices: {
            type: 'object',
            additionalProperties: false,
            required: ['weapon_focus', 'visual_theme'],
            properties: {
              weapon_focus: { type: 'string', enum: ['laser_piercing', 'missile_barrage', 'vulcan_spread'] },
              visual_theme: { type: 'string', enum: ['synthwave_80s', 'dark_void_stealth', 'cyberpunk_gold'] }
            }
          },
          synergies_unlocked: { type: 'array', items: { type: 'string' } },
          fallback_used: { type: 'boolean' }
        }
      },
      attributes: {
        type: 'object',
        additionalProperties: false,
        required: ['max_hp', 'shield_capacity', 'speed_px_s', 'hitbox_radius'],
        properties: {
          max_hp: numeric('attributes.max_hp'),
          shield_capacity: numeric('attributes.shield_capacity'),
          speed_px_s: numeric('attributes.speed_px_s'),
          hitbox_radius: numeric('attributes.hitbox_radius')
        }
      },
      weapons: {
        type: 'object',
        additionalProperties: false,
        required: ['primary', 'secondary'],
        properties: {
          primary: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'damage', 'fire_rate', 'bullet_speed', 'spread_angle'],
            properties: {
              type: { type: 'string', enum: ['plasma', 'laser', 'vulcan_spread'] },
              damage: numeric('weapons.primary.damage'),
              fire_rate: numeric('weapons.primary.fire_rate'),
              bullet_speed: numeric('weapons.primary.bullet_speed'),
              spread_angle: numeric('weapons.primary.spread_angle')
            }
          },
          secondary: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'damage', 'cooldown_seconds'],
            properties: {
              type: { type: 'string', enum: ['homing_missiles', 'emp_burst', 'none'] },
              damage: numeric('weapons.secondary.damage'),
              cooldown_seconds: numeric('weapons.secondary.cooldown_seconds')
            }
          }
        }
      },
      visuals: {
        type: 'object',
        additionalProperties: false,
        required: ['style_name', 'primary_color', 'secondary_color', 'engine_trail_color', 'svg_path_data'],
        properties: {
          style_name: { type: 'string', minLength: 1, maxLength: 40 },
          primary_color: HEX_COLOR,
          secondary_color: HEX_COLOR,
          engine_trail_color: HEX_COLOR,
          svg_path_data: { type: 'string', minLength: 10, maxLength: 4000 }
        }
      }
    }
  };
}

/** Ponto de entrada de `npm run gen:schema`. */
function main(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));           // dist/schema
  const target = path.resolve(here, '..', '..', 'src', 'schema', 'ship_spec.schema.json');
  fs.writeFileSync(target, JSON.stringify(buildShipSpecSchema(), null, 2) + '\n', 'utf8');
  console.log(`[gen-schema] ${target} regerado a partir de BALANCE.ranges`);
}

if (process.argv[1] && process.argv[1].endsWith('gen-schema.js')) {
  main();
}
```

> `weapons.secondary.damage` mínimo passa a **60**, o que exclui `type: 'none'` com dano 0. Trate
> `none` como o caso em que o campo é ignorado — o `WeaponSystem` já retorna cedo. O preset
> `interceptor` do `fallback-presets.ts` usa `homing_missiles` com dano 25: **ele passa a ser inválido
> pelo schema novo**. Corrija os três presets no mesmo commit para valores dentro das faixas, e o teste
> da Tarefa A4 confirmará que continuam selecionáveis.

- [ ] **Passo 4: Ligar o script e regerar**

Em `packages/shared/package.json`, acrescentar:

```json
    "gen:schema": "tsc && node dist/schema/gen-schema.js"
```

Na raiz:

```json
    "gen:schema": "npm run gen:schema --workspace=packages/shared"
```

```bash
npm run gen:schema
git diff packages/shared/src/schema/ship_spec.schema.json
```

Esperado no diff: `damage` 10–60 → 15–45, `fire_rate` 2–60 → 5–12, `secondary.damage` 0–150 → 60–150,
`cooldown_seconds` 0–20 → 3–12, `drone_escort` removido, `minItems`/`maxItems` nos MCPs,
`fallback_used` acrescentado.

- [ ] **Passo 5: Rodar e ver passar**

```bash
npm run test --workspace=packages/shared
```

- [ ] **Passo 6: `normalizeSpec` para de clampar**

Em `file-watcher.ts`, substituir os `Math.max/Math.min` de `normalizeSpec` por preenchimento apenas
**estrutural** — objetos e arrays ausentes ganham forma, valores numéricos passam intactos para a
validação:

```ts
/**
 * Preenche apenas o que é estrutural: seções ausentes, arrays ausentes,
 * campos opcionais. NÃO corrige valores numéricos — quem julga faixa é o
 * schema (D14). Clampar aqui faria a faixa anunciada ao agente ser ficção.
 */
function normalizeSpec(raw: any): any {
  const spec = { ...raw };
  spec.build_metadata = {
    selected_mcps: [],
    selected_subagents: [],
    synergies_unlocked: [],
    ...(spec.build_metadata || {})
  };
  spec.attributes = { ...(spec.attributes || {}) };
  spec.weapons = { ...(spec.weapons || {}) };
  spec.weapons.secondary = { type: 'none', damage: 60, cooldown_seconds: 3, ...(spec.weapons.secondary || {}) };
  spec.visuals = { ...(spec.visuals || {}) };
  return spec;
}
```

Acrescentar a `file-watcher.test.ts` (criado na Tarefa A2):

```ts
  it('rejeita fire_rate fora da faixa em vez de clampar', async () => {
    const rejections: SpecRejection[] = [];
    startWatching(dir, () => {}, () => {}, { onSpecRejected: (r) => rejections.push(r) });

    const spec = validSpecFixture();
    spec.weapons.primary.fire_rate = 60;
    fs.writeFileSync(path.join(dir, 'mcp_audit.log'), auditLineFor('weapons-arsenal'));
    fs.writeFileSync(path.join(dir, 'ship_spec.json'), JSON.stringify(spec));

    await waitFor(() => rejections.length === 1);
    assert.match(rejections[0].errors.join(' '), /fire_rate|maximum/);
  });
```

- [ ] **Passo 7: Escrever o motivo da rejeição em disco**

No `onSpecRejected` do daemon (`index.ts`), além do broadcast criado na Tarefa A2:

```ts
      const errorFile = path.join(sessionDir, 'spec_errors.txt');
      fs.writeFileSync(errorFile,
        `A ship_spec.json foi RECUSADA pelo validador.\n\n` +
        rejection.errors.map((e) => `- ${e}`).join('\n') +
        `\n\nCorrija os campos citados e reescreva o arquivo. Apague este spec_errors.txt depois.\n`,
        'utf8'
      );
```

E acrescentar ao protocolo do `GEMINI.md` gerado (`workspace-generator.ts`), como quinto passo:

```
5. **VERIFIQUE A ACEITAÇÃO.** Depois de gravar o `ship_spec.json`, aguarde 2 segundos e verifique se
   o arquivo `spec_errors.txt` existe neste diretório. Se existir, leia-o, corrija exatamente os
   campos citados, apague o `spec_errors.txt` e reescreva o `ship_spec.json`. Repita até que ele não
   reapareça.
```

- [ ] **Passo 8: `WeaponSystem` para de reclampar**

Remover as três linhas de clamp:

```ts
    const effectiveFireRate = this.weaponsSpec.primary.fire_rate;
    …
    const balancedDamage = this.weaponsSpec.primary.damage;
    const speed = this.weaponsSpec.primary.bullet_speed;
    …
    const balancedDamage = this.weaponsSpec.secondary.damage;
```

O valor chega validado. Se não chegou, o bug é no daemon, e mascará-lo aqui é exatamente o que D14
descreve.

- [ ] **Passo 9: A tabela de contrato do `GEMINI.md` passa a interpolar `BALANCE.ranges`**

A Tarefa A3 escreveu a tabela de faixas com literais. Trocá-los por interpolação, para que a Tarefa B8
não deixe o prompt mentindo:

```ts
const rangeRow = (label: string, key: keyof typeof BALANCE.ranges, origem: string) => {
  const r = BALANCE.ranges[key];
  return `| \`${label}\` | ${origem} | ${r.min} a ${r.max}${r.integer ? ' (inteiro)' : ''} |`;
};
```

- [ ] **Passo 10: Rodar tudo e commitar**

```bash
npm run build && npm test
git add packages/shared packages/daemon/src/services packages/player-app/src/game/weapons/WeaponSystem.ts package.json
git commit -m "feat(schema): gerar o ship_spec.schema.json a partir de balance.ts e eliminar clamps duplicados"
```

---

### Tarefa B3 — Determinismo por seed

Sem seed, uma queda de taxa de vitória pode ser mudança de tuning ou azar amostral, e nenhum bug de
spawn é reproduzível. Esta tarefa também é o que torna o botão *Replay* do harness (B4) possível e o
simulador (B7) honesto.

**Arquivos:**
- Criar: `packages/shared/src/utils/rng.ts`
- Criar: `packages/shared/src/utils/rng.test.ts`
- Modificar: `packages/shared/src/index.ts`
- Modificar: `packages/player-app/src/game/index.ts`
- Modificar: `packages/player-app/src/game/scenes/MainGameScene.ts`
- Modificar: `packages/player-app/src/App.tsx`

**Interfaces:**
- Produz: `mulberry32(seed: number): () => number` e a classe `SeededRandom` com
  `next()`, `between(min, max)`, `floatBetween(min, max)`, `chance(p)`, `pick(arr)`.
- Produz: `createGameInstance(container, options: GameOptions)` — **assinatura nova, por objeto**.
  `GameOptions { shipSpec?, isHardcore?, seed?, onMatchComplete? }`. A Tarefa B4 acrescenta os campos de
  desenvolvimento. Único chamador em produção: `App.tsx`.
- Produz: `telemetry.seed` preenchido de verdade (a Tarefa A7 o deixou em `0`).

- [ ] **Passo 1: Escrever o teste do PRNG**

Criar `packages/shared/src/utils/rng.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SeededRandom } from './rng.js';

describe('SeededRandom', () => {
  it('produz a mesma sequência para o mesmo seed', () => {
    const a = new SeededRandom(1234);
    const b = new SeededRandom(1234);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    assert.deepEqual(seqA, seqB);
  });

  it('produz sequências diferentes para seeds diferentes', () => {
    const a = Array.from({ length: 20 }, () => new SeededRandom(1).next());
    const b = new SeededRandom(2);
    assert.notDeepEqual(a[0], b.next());
  });

  it('mantém next() no intervalo [0, 1)', () => {
    const r = new SeededRandom(99);
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      assert.ok(v >= 0 && v < 1, `valor fora do intervalo: ${v}`);
    }
  });

  it('between devolve inteiros dentro dos limites, inclusive as pontas', () => {
    const r = new SeededRandom(7);
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i++) {
      const v = r.between(3, 6);
      assert.ok(Number.isInteger(v));
      assert.ok(v >= 3 && v <= 6);
      seen.add(v);
    }
    assert.deepEqual([...seen].sort(), [3, 4, 5, 6]);
  });

  it('chance(p) converge para p', () => {
    const r = new SeededRandom(2026);
    let hits = 0;
    for (let i = 0; i < 20_000; i++) if (r.chance(0.6)) hits++;
    assert.ok(Math.abs(hits / 20_000 - 0.6) < 0.02, `frequência observada: ${hits / 20_000}`);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run test --workspace=packages/shared
```

Esperado: **FALHA** — módulo inexistente.

- [ ] **Passo 3: Implementar**

Criar `packages/shared/src/utils/rng.ts`:

```ts
/**
 * PRNG determinístico (mulberry32). Escolhido por caber em dez linhas, não
 * exigir dependência nova e ter período mais que suficiente para uma partida
 * de 90 segundos. Não é criptográfico e não precisa ser.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SeededRandom {
  readonly seed: number;
  private readonly rand: () => number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.rand = mulberry32(this.seed);
  }

  next(): number {
    return this.rand();
  }

  /** Inteiro em [min, max], ambos inclusivos — mesma semântica de Phaser.Math.Between. */
  between(min: number, max: number): number {
    return Math.floor(this.rand() * (max - min + 1)) + min;
  }

  floatBetween(min: number, max: number): number {
    return this.rand() * (max - min) + min;
  }

  chance(probability: number): boolean {
    return this.rand() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.between(0, items.length - 1)];
  }
}

/** Seed aleatório para uma partida de estande, registrado na telemetria. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
```

- [ ] **Passo 4: Exportar e ver passar**

```ts
export * from './utils/rng.js';
```

```bash
npm run test --workspace=packages/shared
```

- [ ] **Passo 5: Trocar a assinatura de `createGameInstance`**

Em `packages/player-app/src/game/index.ts`:

```ts
export interface GameOptions {
  shipSpec?: ShipSpecification;
  isHardcore?: boolean;
  /** Semente do PRNG. Omitida em produção → sorteada e registrada na telemetria. */
  seed?: number;
  onMatchComplete?: (data: MatchCompleteData) => void;
}

export function createGameInstance(container: HTMLElement | string, options: GameOptions = {}): Phaser.Game {
  const seed = options.seed ?? randomSeed();

  class CustomGameScene extends MainGameScene {
    constructor() {
      super();
      if (options.shipSpec) this.shipSpec = options.shipSpec;
      this.isHardcore = !!options.isHardcore;
      this.seed = seed;
      this.onMatchComplete = options.onMatchComplete;
    }
  }
  …
}
```

Atualizar o único chamador de produção em `App.tsx`:

```tsx
createGameInstance(containerRef.current, { shipSpec, isHardcore, onMatchComplete: handleMatchComplete });
```

- [ ] **Passo 6: A cena usar o RNG**

Em `MainGameScene.ts`, acrescentar `seed = 0;` e `rng!: SeededRandom;` às propriedades, e no `init()`:

```ts
    this.rng = new SeededRandom(this.seed);
```

Substituir, uma a uma:

| Linha atual | Substituição |
| :--- | :--- |
| `:199` `Phaser.Math.Between(1, 3)` | `this.rng.between(1, 3)` |
| `:203,209,215,216` `Phaser.Math.Between(...)` dos spawners | `this.rng.between(...)` |
| `:263` `Math.random() > 0.4` | `this.rng.chance(BALANCE.enemies.fire_chance)` |
| `:626,628-633,845` campo de estrelas | `this.rng.chance(0.2)` / `this.rng.between(...)` / `this.rng.floatBetween(...)` |

`Math.random()` continua legítimo em `AudioManager.ts:153,185` (ruído branco) e em `moderation.ts`
(sufixo de callsign): nenhum dos dois entra no modelo de combate. Não os toque.

Preencher o campo que a Tarefa A7 deixou em zero, no bloco de telemetria:

```ts
          seed: this.seed,
```

- [ ] **Passo 7: Verificar o determinismo à mão**

Com o harness ainda inexistente, a verificação é pelo console do navegador:

```bash
npm run dev:player
```

No console, com o jogo carregado: `game.scene.keys.MainGameScene.rng.seed` deve imprimir um número; a
mesma spec com o mesmo seed forçado deve produzir a mesma primeira formação de inimigos. A verificação
rigorosa é o botão *Replay* da Tarefa B4 — deixe-a para lá, não invente um teste frágil aqui.

- [ ] **Passo 8: Commit**

```bash
git add packages/shared/src/utils/rng.ts packages/shared/src/utils/rng.test.ts \
        packages/shared/src/index.ts packages/player-app/src/game packages/player-app/src/App.tsx
git commit -m "feat(engine): PRNG semeado por partida e seed registrado na telemetria"
```

---

### Tarefa B4 — Harness de desenvolvimento isolado

O requisito do usuário, literal: rodar a engine **sozinha**, sem daemon, sem AGY, sem rede, para
ajustar dificuldade. Hoje, iterar no boss custa 45 segundos de espera por tentativa mais o ciclo
inteiro de forja.

**Arquivos:**
- Criar: `packages/player-app/dev.html`
- Criar: `packages/player-app/src/dev/main.tsx`
- Criar: `packages/player-app/src/dev/DevHarness.tsx`
- Criar: `packages/player-app/src/dev/presets.ts`
- Criar: `packages/player-app/src/dev/dev-build-leak.test.ts`
- Modificar: `packages/player-app/src/game/index.ts` (`GameOptions` de desenvolvimento)
- Modificar: `packages/player-app/src/game/scenes/MainGameScene.ts` (aplicar as opções)
- Modificar: `package.json` da raiz (`dev:game`)

**Interfaces:**
- Consome: `createGameInstance(container, options)` (Tarefa B3), `BALANCE` (B1), `SeededRandom` (B3).
- Produz: `DevGameOptions extends GameOptions { startAtSeconds?, godMode?, timeScale?, physicsDebug?,
  onTelemetryFrame? }`.
- Produz: `DEV_PRESETS: Record<string, ShipSpecification>` — reaproveitado pelos arquétipos do
  simulador na Tarefa B7.

> **`dev.html` não entra no build de produção sem nenhuma configuração extra.** O Vite serve qualquer
> HTML na raiz do projeto em modo dev, e no `vite build` só empacota o `index.html` declarado por
> padrão. Não acrescente `dev.html` a `rollupOptions.input` — é exatamente o que o faria vazar. O
> passo 7 escreve o teste que trava isso.

- [ ] **Passo 1: Escrever o teste do vazamento**

Criar `packages/player-app/src/dev/dev-build-leak.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const distDir = path.join(packageRoot, 'dist');

describe('build de produção', () => {
  it.skipIf(!fs.existsSync(distDir))('não contém o harness de desenvolvimento', () => {
    expect(fs.existsSync(path.join(distDir, 'dev.html'))).toBe(false);

    const bundled = fs
      .readdirSync(path.join(distDir, 'assets'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(distDir, 'assets', f), 'utf8'))
      .join('\n');

    expect(bundled).not.toContain('DevHarness');
  });
});
```

- [ ] **Passo 2: Rodar e ver o teste ser pulado**

```bash
npm run test --workspace=packages/player-app
```

Esperado: o teste aparece como **skipped** (ainda não há `dist/`). Depois de
`npm run build --workspace=packages/player-app`, ele passa a rodar e **passa** — porque o harness ainda
não existe. Isso é aceitável: é um teste de regressão, e o passo 8 o valida com o harness já escrito.

- [ ] **Passo 3: Abrir as opções de desenvolvimento na engine**

Em `packages/player-app/src/game/index.ts`:

```ts
export interface DevGameOptions extends GameOptions {
  /** Começa a partida neste segundo. 45 = boss já na tela. */
  startAtSeconds?: number;
  /** Boss já entra nesta fase. Exige startAtSeconds >= BALANCE.match.boss_spawn_s. */
  startAtBossPhase?: 1 | 2 | 3;
  godMode?: boolean;
  timeScale?: number;
  physicsDebug?: boolean;
  /** Chamado a cada frame com o estado observável. Só o harness usa. */
  onTelemetryFrame?: (frame: DevTelemetryFrame) => void;
}

export interface DevTelemetryFrame {
  fps: number;
  elapsedSeconds: number;
  playerHp: number;
  playerShield: number;
  combo: number;
  score: number;
  bossHp: number | null;
  bossMaxHp: number | null;
  bossPhase: 1 | 2 | 3 | null;
  bossDpsInstant: number;
  bossDpsAverage: number;
  pools: { primaryBullets: number; secondaryMissiles: number; enemyBullets: number; bossBullets: number; enemies: number };
  poolCaps: { primaryBullets: number; secondaryMissiles: number; enemyBullets: number; bossBullets: number; enemies: number };
}
```

Em `MainGameScene.ts`, no `create()`, ao final:

```ts
    // --- Ganchos exclusivos do harness (Spec 09 §4). Inertes em produção. ---
    if (this.devOptions?.startAtSeconds) {
      this.fastForwardTo(this.devOptions.startAtSeconds);
    }
    if (this.devOptions?.timeScale) {
      this.time.timeScale = this.devOptions.timeScale;
      this.physics.world.timeScale = 1 / this.devOptions.timeScale;
    }
    if (this.devOptions?.physicsDebug) {
      this.physics.world.createDebugGraphic();
      this.physics.world.drawDebug = true;
    }
```

E o avanço rápido:

```ts
  /** Só o harness chama. Salta o relógio da partida sem simular o que foi pulado. */
  private fastForwardTo(seconds: number): void {
    this.elapsedSeconds = Math.min(seconds, BALANCE.match.duration_s - 1);
    this.matchTimer = BALANCE.match.duration_s - this.elapsedSeconds;
    if (this.elapsedSeconds >= BALANCE.match.boss_spawn_s && !this.boss) {
      this.spawnBoss();
      const phase = this.devOptions?.startAtBossPhase;
      if (this.boss && phase && phase > 1) {
        const ratio = phase === 3 ? BALANCE.boss.phase3_hp_ratio : BALANCE.boss.phase2_hp_ratio;
        this.boss.currentHp = Math.round(this.boss.maxHp * ratio);
        this.boss.phase = phase;
        this.boss.isInvulnerable = false;
      }
    }
  }
```

`godMode` entra em `PlayerShip.takeDamage`: `if (this.isInvulnerable || this.godMode) return false;`.
`onTelemetryFrame` é chamado no fim do `update()` da cena, com o objeto acima montado a partir de
`countActive()` de cada grupo.

- [ ] **Passo 4: Os presets do harness**

Criar `packages/player-app/src/dev/presets.ts`:

```ts
import { BALANCE, FALLBACK_PRESETS, ShipSpecification } from '@jogo/shared';

const R = BALANCE.ranges;

/** Constrói uma spec sintética a partir de um seletor de faixa. Nenhum literal numérico. */
function fromRanges(
  name: string,
  pick: (key: keyof typeof BALANCE.ranges) => number,
  overrides: Partial<ShipSpecification> = {}
): ShipSpecification { /* … monta a estrutura completa a partir de FALLBACK_PRESETS.interceptor … */ }

export const DEV_PRESETS: Record<string, ShipSpecification> = {
  interceptor: FALLBACK_PRESETS.interceptor,
  vanguard: FALLBACK_PRESETS.vanguard,
  striker: FALLBACK_PRESETS.striker,
  minimo: fromRanges('Mínimo', (k) => R[k].min),
  maximo: fromRanges('Máximo', (k) => R[k].max),
  // Arquétipos do simulador (Spec 09 §5.1), reaproveitados pela Tarefa B7:
  glass_cannon: /* damage máximo, fire_rate máximo, max_hp mínimo, laser */ …,
  vulcan_max: /* vulcan_spread com damage e fire_rate máximos */ …,
  tanque: /* max_hp e shield máximos, damage mínimo */ …
};
```

Preencher os três últimos com valores derivados de `R`, jamais literais — se a Tarefa B8 mudar uma
faixa, os arquétipos acompanham.

- [ ] **Passo 5: O harness**

Criar `packages/player-app/dev.html` (cópia enxuta do `index.html`, apontando para
`/src/dev/main.tsx`), `src/dev/main.tsx` (monta `<DevHarness />` em `#root`) e
`src/dev/DevHarness.tsx` com duas colunas: canvas Phaser à esquerda, painel à direita.

Controles do painel, todos ligados a um `remount(key)` que destrói e recria a instância Phaser:

| Controle | Estado que altera |
| :--- | :--- |
| Textarea de `ship_spec` | `spec`, validado ao vivo com `validateShipSpecification` do `@jogo/shared`; erros listados inline em vermelho; o botão *Aplicar* fica desabilitado enquanto houver erro |
| Seletor de preset | Preenche a textarea a partir de `DEV_PRESETS` |
| Campo `seed` + botão *Replay* | `seed`; *Replay* remonta com o mesmo seed e a mesma spec |
| Slider de `timeScale` | 0,25× a 4×, aplicado sem remontar |
| Botões de fase | *Início*, *Boss (45s)*, *Fase 2*, *Fase 3* → `startAtSeconds` / `startAtBossPhase` |
| Toggle *God mode* | `godMode` |
| Toggle *Debug de física* | `physicsDebug` |
| Botões *Pausa* / *Passo* | `scene.scene.pause()` / `scene.scene.resume()` seguido de pausa no próximo frame |
| Botão *Baixar resumo* | Serializa o último `MatchCompleteData` e faz download do JSON (Spec 09 §6) |

O painel de telemetria ao vivo consome `onTelemetryFrame` e **destaca em amarelo qualquer pool acima de
80% da capacidade**. É esse destaque que teria exposto D13 em segundos.

**Restrição a respeitar:** nenhum `import` de `App.tsx`, de componentes de `src/components/` ou de
qualquer módulo que faça `fetch`. O harness importa apenas de `src/game/`, `src/dev/` e `@jogo/shared`.

- [ ] **Passo 6: O script**

Em `packages/player-app/package.json`: `"dev:game": "vite --open /dev.html"`.
Na raiz: `"dev:game": "npm run build:shared && npm run dev:game --workspace=packages/player-app"`.

- [ ] **Passo 7: Verificar o isolamento de verdade**

```bash
npm run kill:daemon
npm run dev:game
```

Com o daemon **parado**, e idealmente com o Wi-Fi desligado: a engine sobe, a nave voa, o boss aparece
ao clicar em *Fase 3* em menos de 5 segundos, e a aba de rede do DevTools não mostra nenhuma requisição
para `localhost:3000`. Este é o critério central do Gate M1.

Verificar o determinismo: anotar o score final de uma partida, clicar em *Replay* e repetir a mesma
sequência de teclas. As formações de inimigos devem ser idênticas.

- [ ] **Passo 8: Confirmar que o harness não vazou para produção**

```bash
npm run build --workspace=packages/player-app
npm run test --workspace=packages/player-app
```

Esperado: o teste do passo 1 agora **executa** e passa.

- [ ] **Passo 9: Commit**

```bash
git add packages/player-app/dev.html packages/player-app/src/dev packages/player-app/src/game \
        packages/player-app/package.json package.json
git commit -m "feat(dev): harness isolado da engine com seed, timescale e salto de fase"
```

---

### Tarefa B5 — [D17] Renderizar a nave que o agente desenhou

O `svg_path_data` é exigido pelo schema, gerado pelo `aesthetic-designer` a cada sessão, gravado no
`ship_spec.json`, exibido no terminal — e descartado. `ShipTextureFactory.createShipTexture` desenha
uma nave paramétrica a partir das cores. O visitante vê o agente projetar um casco e pilota outro.

**Arquivos:**
- Criar: `packages/player-app/src/game/factories/SvgShipRenderer.ts`
- Criar: `packages/player-app/src/game/factories/SvgShipRenderer.test.ts`
- Modificar: `packages/player-app/src/game/scenes/MainGameScene.ts:86-87`
- Modificar: `packages/daemon/src/services/workspace-generator.ts` (contrato do `viewBox`)

**Interfaces:**
- Produz: `isSafePathData(d: string): boolean`, `pathExtent(d: string): { min: number; max: number }`,
  e `renderSvgShipTexture(scene, key, visuals): boolean` — devolve `false` quando recusa o path, e
  nesse caso o chamador cai no `ShipTextureFactory` existente.

- [ ] **Passo 1: Escrever o teste das funções puras**

A rasterização depende de canvas e é verificada a olho. O que **precisa** de teste é a decisão de
aceitar ou recusar o desenho de um agente.

Criar `packages/player-app/src/game/factories/SvgShipRenderer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isSafePathData, pathExtent } from './SvgShipRenderer.js';

describe('isSafePathData', () => {
  it('aceita um path de comandos e números', () => {
    expect(isSafePathData('M50 5 L90 80 L50 65 L10 80 Z')).toBe(true);
  });

  it('aceita curvas e notação científica negativa', () => {
    expect(isSafePathData('M10,10 C20,20 30,-1e2 40,40 z')).toBe(true);
  });

  it('recusa qualquer coisa que não seja comando ou número', () => {
    expect(isSafePathData('M10 10 <script>alert(1)</script>')).toBe(false);
    expect(isSafePathData('url(#gradient)')).toBe(false);
    expect(isSafePathData('M10 10 " onload="x')).toBe(false);
  });

  it('recusa path curto demais para ser uma nave', () => {
    expect(isSafePathData('M0 0')).toBe(false);
  });
});

describe('pathExtent', () => {
  it('extrai os extremos numéricos do path', () => {
    expect(pathExtent('M50 5 L90 80 L10 80 Z')).toEqual({ min: 5, max: 90 });
  });

  it('enxerga coordenadas fora do viewBox contratado', () => {
    expect(pathExtent('M50 5 L900 80 Z').max).toBeGreaterThan(100);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run test --workspace=packages/player-app
```

- [ ] **Passo 3: Implementar**

Criar `packages/player-app/src/game/factories/SvgShipRenderer.ts`:

```ts
import Phaser from 'phaser';
import { ShipVisuals } from '@jogo/shared';

/** Lado do canvas de destino, em pixels. O contrato do agente é um viewBox 0 0 100 100. */
const TEXTURE_SIZE = 128;
const VIEWBOX_SIZE = 100;
/** Tolerância além do viewBox antes de recusar o desenho. */
const EXTENT_SLACK = 20;

const SAFE_PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\-+\s]+$/;

/**
 * O path vem de um LLM e vira conteúdo de canvas. Path2D não executa script,
 * mas um path com caracteres estranhos é sinal de que a saída do agente
 * degenerou — nesse caso é melhor a nave paramétrica que um casco corrompido.
 */
export function isSafePathData(d: string): boolean {
  if (typeof d !== 'string' || d.trim().length < 10) return false;
  return SAFE_PATH.test(d);
}

export function pathExtent(d: string): { min: number; max: number } {
  const numbers = (d.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []).map(Number).filter(Number.isFinite);
  if (numbers.length === 0) return { min: 0, max: 0 };
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

/**
 * Rasteriza o casco desenhado pelo agente em uma textura Phaser.
 * Devolve false quando recusa — o chamador então usa ShipTextureFactory.
 */
export function renderSvgShipTexture(scene: Phaser.Scene, key: string, visuals: ShipVisuals): boolean {
  const d = visuals.svg_path_data;
  if (!isSafePathData(d)) {
    console.warn('[SvgShipRenderer] svg_path_data recusado: caracteres fora do contrato.');
    return false;
  }

  const { min, max } = pathExtent(d);
  if (min < -EXTENT_SLACK || max > VIEWBOX_SIZE + EXTENT_SLACK) {
    console.warn(`[SvgShipRenderer] svg_path_data fora do viewBox 0..${VIEWBOX_SIZE} (extensão ${min}..${max}).`);
    return false;
  }

  const canvasTexture = scene.textures.createCanvas(key, TEXTURE_SIZE, TEXTURE_SIZE);
  if (!canvasTexture) return false;
  const ctx = canvasTexture.getContext();
  const scale = TEXTURE_SIZE / VIEWBOX_SIZE;

  try {
    const path = new Path2D(d);
    ctx.save();
    ctx.scale(scale, scale);

    ctx.fillStyle = visuals.primary_color;
    ctx.fill(path);

    ctx.lineWidth = 2 / scale;
    ctx.strokeStyle = visuals.secondary_color;
    ctx.stroke(path);

    // Brilho do motor, para a nave não sair chapada contra o fundo escuro.
    ctx.shadowColor = visuals.engine_trail_color;
    ctx.shadowBlur = 12 / scale;
    ctx.stroke(path);

    ctx.restore();
  } catch (err) {
    console.warn('[SvgShipRenderer] Path2D recusou o desenho:', err);
    scene.textures.remove(key);
    return false;
  }

  canvasTexture.refresh();
  return true;
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
npm run test --workspace=packages/player-app
```

- [ ] **Passo 5: Ligar na cena, com fallback**

Em `MainGameScene.create()`, substituir a linha 87:

```ts
    const textureKey = `ship_${this.shipSpec.visuals.style_name.replace(/\s+/g, '_')}`;
    if (!renderSvgShipTexture(this, textureKey, this.shipSpec.visuals)) {
      // D17: o casco do agente foi recusado. A nave paramétrica preserva as cores.
      ShipTextureFactory.createShipTexture(this, textureKey, this.shipSpec.visuals);
    }
```

- [ ] **Passo 6: Tornar o `viewBox` parte do contrato do prompt**

Na tabela de contrato do `GEMINI.md` (Tarefa A3, agora interpolada pela B2), a linha do
`svg_path_data` passa a exigir:

```
| `visuals.svg_path_data` | aesthetic-designer | Path SVG em viewBox `0 0 100 100`, nariz apontando
  para cima (y menor), apenas comandos M/L/C/Q/Z e números. Sem `<svg>`, sem atributos, sem `url()`. |
```

- [ ] **Passo 7: Verificar a olho no harness**

```bash
npm run dev:game
```

Colar na textarea uma spec com um `svg_path_data` reconhecível (uma seta assimétrica, por exemplo) e
confirmar que **a nave na tela é aquele desenho**. Depois, colar um path com coordenada 900 e confirmar
que a nave paramétrica entra sem quebrar a partida, com o aviso no console.

- [ ] **Passo 8: Commit**

```bash
git add packages/player-app/src/game/factories packages/player-app/src/game/scenes/MainGameScene.ts \
        packages/daemon/src/services/workspace-generator.ts
git commit -m "feat(engine): rasterizar o svg_path_data do agente com recuo para a nave paramétrica"
```

---

### Tarefa B6 — [D13, D15] Fazer a arma secundária e as sinergias existirem

Dois mecanismos anunciados ao visitante que não fazem nada. A arma secundária: os mísseis são
disparados, sobem pela tela e **nunca colidem com nada** — não há `overlap` registrado entre
`secondaryMissiles` e `enemies` nem com o boss, e o pool de 20 nunca é reciclado, então após dez
salvas a arma para de existir em silêncio. O `emp_burst` desenha um anel e causa dano zero. As
sinergias: detectadas no builder, calculadas pelo MCP, gravadas na spec, **nunca lidas pela engine**.

**Arquivos:**
- Criar: `packages/shared/src/game/synergies.ts`
- Criar: `packages/shared/src/game/synergies.test.ts`
- Modificar: `packages/shared/src/index.ts`
- Modificar: `packages/player-app/src/game/weapons/WeaponSystem.ts`
- Criar: `packages/player-app/src/game/weapons/WeaponSystem.test.ts`
- Modificar: `packages/player-app/src/game/scenes/MainGameScene.ts` (colisões, EMP, regeneração, score)
- Modificar: `packages/player-app/src/game/objects/PlayerShip.ts`
- Modificar: `packages/mcps/src/weapons-arsenal.ts` (remoção do `drone_escort`)

**Interfaces:**
- Produz: `applySynergies(spec: ShipSpecification): { attributes, weapons, applied: SynergyName[] }` —
  função pura, consumida por `PlayerShip` e pelo modelo de combate do simulador (Tarefa B7).
- Produz: `type SynergyName = 'Glass Cannon' | 'Titan Fortress' | 'Ghost Interceptor' | 'Balanced Ace'`.
- Produz: `regeneratesHp(applied: SynergyName[]): boolean`.
- Produz: `computeEmpDamage(baseDamage: number, distance: number): number`, exportada de
  `WeaponSystem.ts` e reusada pelo simulador.

> **Por que em `packages/shared` e não no `player-app`:** o simulador da Tarefa B7 precisa aplicar
> exatamente a mesma transformação, e não pode importar nada que carregue Phaser. Duas cópias da matriz
> de sinergias divergiriam no primeiro ajuste — é a forma exata do defeito D14, em outro lugar.

- [ ] **Passo 1: Escrever o teste das sinergias**

Criar `packages/shared/src/game/synergies.test.ts` (runner `node:test`, como o resto do pacote):

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../constants/balance.js';
import { FALLBACK_PRESETS } from '../constants/fallback-presets.js';
import { applySynergies } from './synergies.js';

function specWith(synergies: string[]) {
  const base = structuredClone(FALLBACK_PRESETS.striker);
  base.build_metadata.synergies_unlocked = synergies;
  return base;
}

describe('applySynergies', () => {
  it('não altera nada quando nenhuma sinergia foi desbloqueada', () => {
    const spec = specWith([]);
    const r = applySynergies(spec);
    assert.deepEqual(r.applied, []);
    assert.deepEqual(r.attributes, spec.attributes);
    assert.deepEqual(r.weapons, spec.weapons);
  });

  it('Glass Cannon amplifica o dano primário e trava o HP em 2', () => {
    const spec = specWith(['Glass Cannon']);
    const r = applySynergies(spec);
    assert.equal(
      r.weapons.primary.damage,
      spec.weapons.primary.damage * BALANCE.synergies.glass_cannon.primary_damage_factor
    );
    assert.equal(r.attributes.max_hp, BALANCE.synergies.glass_cannon.forced_max_hp);
  });

  it('Titan Fortress eleva HP e garante escudo mínimo', () => {
    const r = applySynergies(specWith(['Titan Fortress']));
    assert.equal(r.attributes.max_hp, BALANCE.synergies.titan_fortress.forced_max_hp);
    assert.ok(r.attributes.shield_capacity >= BALANCE.synergies.titan_fortress.min_shield_capacity);
  });

  it('Ghost Interceptor leva velocidade ao máximo e hitbox ao mínimo', () => {
    const r = applySynergies(specWith(['Ghost Interceptor']));
    assert.equal(r.attributes.speed_px_s, BALANCE.ranges['attributes.speed_px_s'].max);
    assert.equal(r.attributes.hitbox_radius, BALANCE.ranges['attributes.hitbox_radius'].min);
  });

  it('Balanced Ace amplifica tudo sem estourar as faixas', () => {
    const r = applySynergies(specWith(['Balanced Ace']));
    for (const field of ['max_hp', 'shield_capacity', 'speed_px_s'] as const) {
      const range = BALANCE.ranges[`attributes.${field}`];
      assert.ok(r.attributes[field] <= range.max, `${field} estourou o máximo`);
      assert.ok(r.attributes[field] >= range.min, `${field} furou o mínimo`);
    }
  });

  it('ignora nomes de sinergia que a engine não conhece', () => {
    const r = applySynergies(specWith(['Sinergia Inventada Pelo Agente']));
    assert.deepEqual(r.applied, []);
  });

  it('produz naves mensuravelmente diferentes entre sinergias', () => {
    const glass = applySynergies(specWith(['Glass Cannon']));
    const titan = applySynergies(specWith(['Titan Fortress']));
    assert.notEqual(glass.attributes.max_hp, titan.attributes.max_hp);
    assert.notEqual(glass.weapons.primary.damage, titan.weapons.primary.damage);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run test --workspace=packages/shared
```

- [ ] **Passo 3: Implementar `synergies.ts`**

Criar `packages/shared/src/game/synergies.ts`:

```ts
import { BALANCE } from '../constants/balance.js';
import type { ShipAttributes, ShipSpecification, ShipWeapons } from '../types/ship.js';

export type SynergyName = 'Glass Cannon' | 'Titan Fortress' | 'Ghost Interceptor' | 'Balanced Ace';

const KNOWN: SynergyName[] = ['Glass Cannon', 'Titan Fortress', 'Ghost Interceptor', 'Balanced Ace'];

function clampToRange(value: number, key: keyof typeof BALANCE.ranges): number {
  const r = BALANCE.ranges[key];
  const bounded = Math.min(r.max, Math.max(r.min, value));
  return r.integer ? Math.round(bounded) : bounded;
}

/**
 * Aplica a matriz de sinergias da Spec 02 §6 aos atributos já validados.
 * Pura de propósito: o simulador (Spec 09 §5) precisa da mesma transformação
 * sem instanciar Phaser.
 */
export function applySynergies(spec: ShipSpecification): {
  attributes: ShipAttributes;
  weapons: ShipWeapons;
  applied: SynergyName[];
} {
  const attributes = structuredClone(spec.attributes);
  const weapons = structuredClone(spec.weapons);
  const declared = spec.build_metadata?.synergies_unlocked || [];
  const applied = KNOWN.filter((name) => declared.includes(name));

  for (const name of applied) {
    if (name === 'Glass Cannon') {
      const s = BALANCE.synergies.glass_cannon;
      weapons.primary.damage = weapons.primary.damage * s.primary_damage_factor;
      attributes.max_hp = s.forced_max_hp;
    } else if (name === 'Titan Fortress') {
      const s = BALANCE.synergies.titan_fortress;
      attributes.max_hp = s.forced_max_hp;
      attributes.shield_capacity = Math.max(attributes.shield_capacity, s.min_shield_capacity);
    } else if (name === 'Ghost Interceptor') {
      attributes.speed_px_s = BALANCE.ranges['attributes.speed_px_s'].max;
      attributes.hitbox_radius = BALANCE.ranges['attributes.hitbox_radius'].min;
    } else if (name === 'Balanced Ace') {
      const f = BALANCE.synergies.balanced_ace.all_attributes_factor;
      attributes.max_hp = clampToRange(attributes.max_hp * f, 'attributes.max_hp');
      attributes.shield_capacity = clampToRange(attributes.shield_capacity * f, 'attributes.shield_capacity');
      attributes.speed_px_s = clampToRange(attributes.speed_px_s * f, 'attributes.speed_px_s');
      weapons.primary.damage = clampToRange(weapons.primary.damage * f, 'weapons.primary.damage');
    }
  }

  return { attributes, weapons, applied };
}

/** Titan Fortress regenera 1 HP a cada intervalo. Consultado pelo relógio da partida. */
export function regeneratesHp(applied: SynergyName[]): boolean {
  return applied.includes('Titan Fortress');
}
```

Exportar em `packages/shared/src/index.ts`:

```ts
export * from './game/synergies.js';
```

> **`Glass Cannon` não é clampado de propósito.** `damage × 1,30` pode passar de 45, e deve: é o efeito
> inteiro da sinergia. O teto por projétil contra o boss (`BALANCE.boss.max_damage_per_primary_hit`)
> continua valendo, e a Tarefa B8 mede se essa combinação fica justa. Se o teto anular a sinergia, a
> B8 sobe o teto — mas isso é uma decisão medida, não um clamp escondido.

- [ ] **Passo 4: `PlayerShip` construir a partir da spec já transformada**

Em `MainGameScene.create()`, antes de instanciar a `PlayerShip`:

```ts
    const synergy = applySynergies(this.shipSpec);
    this.appliedSynergies = synergy.applied;
    this.player = new PlayerShip(this, startX, startY, textureKey, synergy.attributes, synergy.weapons, this.shipSpec.visuals);
```

No `handleMatchTick()`, a regeneração da Titan Fortress:

```ts
    if (
      regeneratesHp(this.appliedSynergies) &&
      this.elapsedSeconds > 0 &&
      this.elapsedSeconds % BALANCE.synergies.titan_fortress.regen_interval_s === 0 &&
      this.player.currentHp < this.player.attributes.max_hp
    ) {
      this.player.currentHp += 1;
      this.updateHudHp();
    }
```

E nos **três** pontos que chamam `calculateFinalScore` (`:423`, `:520`, `:598`), trocar o valor
de `synergyBonusUnlocked` por `this.appliedSynergies.length > 0`. Hoje a linha 423 passa `true` fixo,
a 520 passa `false` fixo e a 598 repete `isVictory` — nenhuma delas consulta a sinergia.

- [ ] **Passo 5: Escrever o teste da arma secundária**

O acerto do míssil depende de física Phaser, mas o **reaproveitamento do pool** é lógica pura.
Acrescentar a `WeaponSystem` um método testável e testá-lo:

```ts
import { describe, it, expect } from 'vitest';
import { computeEmpDamage } from './WeaponSystem.js';
import { BALANCE } from '@jogo/shared';

describe('computeEmpDamage', () => {
  it('aplica o dano cheio no epicentro', () => {
    expect(computeEmpDamage(100, 0)).toBe(100);
  });

  it('aplica o dano reduzido na borda do raio', () => {
    const edge = BALANCE.weapons.secondary.emp_radius_px;
    expect(computeEmpDamage(100, edge)).toBe(100 * BALANCE.weapons.secondary.emp_edge_falloff);
  });

  it('não causa dano fora do raio', () => {
    expect(computeEmpDamage(100, BALANCE.weapons.secondary.emp_radius_px + 1)).toBe(0);
  });
});
```

- [ ] **Passo 6: Implementar as três correções da arma secundária**

**(a) Reciclagem do pool.** Em `WeaponSystem.update()`, acrescentar o mesmo laço que já existe para
`primaryBullets`, agora sobre `secondaryMissiles`. Sem isso, o pool de 20 esgota e a arma some.

**(b) Dano real do EMP.** Exportar a função pura e usá-la:

```ts
export function computeEmpDamage(baseDamage: number, distance: number): number {
  const { emp_radius_px, emp_edge_falloff } = BALANCE.weapons.secondary;
  if (distance > emp_radius_px) return 0;
  const t = distance / emp_radius_px;
  return baseDamage * (1 - t * (1 - emp_edge_falloff));
}
```

`triggerEmpBurst` passa a receber a lista de alvos (inimigos ativos e boss) e a aplicar
`computeEmpDamage` a cada um, além de desenhar o anel.

**(c) Colisões que faltam.** Em `MainGameScene.setupCollisions()`:

```ts
    this.physics.add.overlap(this.player.weaponSystem.secondaryMissiles, this.enemies,
      (missile, enemy) => this.handleBulletHitsEnemy(missile as any, enemy as any));
```

E no bloco que registra as colisões do boss (dentro de `spawnBoss()`), acrescentar o mesmo `overlap`
entre `secondaryMissiles` e o boss. **Sem esse `overlap`, o míssil atravessa o boss.**
Confirme que `handleBulletHitsEnemy` lê `getData('damage')` — o `spawnMissile` já o preenche.

- [ ] **Passo 7: Remover o `drone_escort` do MCP**

A Tarefa B2 já o tirou do schema. Em `packages/mcps/src/weapons-arsenal.ts:86`, remover o valor da
lista de retornos possíveis, para o MCP não sugerir ao agente algo que o schema recusa.

```bash
grep -rn "drone_escort" packages specs --include="*.ts" --include="*.json" --include="*.md" | grep -v node_modules
```

Esperado: apenas as menções em `specs/00` e `specs/09` que **documentam a remoção**.

- [ ] **Passo 8: Verificar no harness**

```bash
npm run dev:game
```

Com o preset `striker` (que usa `vulcan_spread` e secundária), pular para *Boss (45s)* e disparar a
secundária com Shift: a barra de HP do boss precisa **cair visivelmente** a cada salva, e o contador do
pool `secondaryMissiles` no painel precisa voltar a zero entre salvas em vez de subir monotonicamente.
Depois, carregar uma spec com `emp_burst` e confirmar que o anel causa dano.

- [ ] **Passo 9: Commit**

```bash
git add packages/shared/src/game packages/shared/src/index.ts \
        packages/player-app/src/game packages/mcps/src/weapons-arsenal.ts
git commit -m "feat(engine): aplicar sinergias e dar efeito real à arma secundária"
```

---

### Tarefa B7 — Simulador headless de balanceamento

O harness responde *"como está o jogo?"*. O simulador responde *"o jogo atinge a meta?"* — sem humano,
em CI, em menos de 60 segundos.

**Arquivos:**
- Criar: `packages/sim/package.json`, `packages/sim/tsconfig.json`
- Criar: `packages/sim/src/combat-model.ts`
- Criar: `packages/sim/src/combat-model.test.ts`
- Criar: `packages/sim/src/archetypes.ts`
- Criar: `packages/sim/src/run.ts`
- Criar: `packages/sim/fixtures/harness-runs.json`
- Criar: `packages/sim/src/conformance.test.ts`
- Modificar: `package.json` da raiz (`sim:balance`, `test`)

**Interfaces:**
- Consome: `BALANCE` (B1), `SeededRandom` (B3) e `applySynergies` (B6, já em `@jogo/shared`).
- Consome: `ScoreCalculator`, que **migra** nesta tarefa de
  `packages/player-app/src/game/scoring/ScoreCalculator.ts` para
  `packages/shared/src/game/score-calculator.ts`. Ele já é uma classe pura sem nenhuma dependência de
  Phaser; o `player-app` passa a reexportá-la de `@jogo/shared` e `ScoreCalculator.test.ts` acompanha o
  arquivo. Uma definição, dois consumidores — reimplementar a fórmula de pontuação no simulador seria
  criar um quarto contrato numérico divergente.
- Produz: `simulateMatch(input: SimInput): SimResult`, `runMatrix(): SimMatrix`.

```ts
export interface SimInput {
  spec: ShipSpecification;
  skill: SkillProfile;
  seed: number;
  isHardcore?: boolean;
}
export interface SkillProfile {
  name: 'iniciante' | 'mediano' | 'experiente';
  /** Fração dos projéteis primários que acerta o alvo. */
  accuracy: number;
  /** Fração do tempo em que o jogador está atirando. */
  fireUptime: number;
  /** Probabilidade de ser atingido por segundo, durante a fase de boss. */
  hitsTakenPerSecond: number;
  /** Fração das salvas de secundária que o jogador realmente usa. */
  secondaryUptime: number;
}
export interface SimResult {
  victory: boolean;
  bossTtkSeconds: number | null;
  defeatReason: 'timeout' | 'death' | null;
  damageTaken: number;
  finalScore: number;
}
```

- [ ] **Passo 1: Criar o pacote**

`packages/sim/package.json`:

```json
{
  "name": "@jogo/sim",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "tsc && node --test dist/**/*.test.js",
    "start": "tsc && node dist/run.js"
  },
  "dependencies": { "@jogo/shared": "*" },
  "devDependencies": { "@types/node": "^22.13.4", "typescript": "^5.7.3" }
}
```

`tsconfig.json` copiado do `packages/daemon`. Na raiz, acrescentar
`"sim:balance": "npm run build:shared && npm run start --workspace=packages/sim"` e incluir
`packages/sim` no script `test`.

- [ ] **Passo 2: Escrever o teste do modelo de combate**

Criar `packages/sim/src/combat-model.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE, FALLBACK_PRESETS } from '@jogo/shared';
import { simulateMatch } from './combat-model.js';
import { SKILL_PROFILES } from './archetypes.js';

const perfect = { name: 'experiente' as const, accuracy: 1.0, fireUptime: 1.0, hitsTakenPerSecond: 0, secondaryUptime: 1.0 };

describe('simulateMatch', () => {
  it('é determinístico para o mesmo seed', () => {
    const a = simulateMatch({ spec: FALLBACK_PRESETS.striker, skill: SKILL_PROFILES.mediano, seed: 42 });
    const b = simulateMatch({ spec: FALLBACK_PRESETS.striker, skill: SKILL_PROFILES.mediano, seed: 42 });
    assert.deepEqual(a, b);
  });

  it('um jogador que nunca atira nunca vence', () => {
    const r = simulateMatch({
      spec: FALLBACK_PRESETS.striker,
      skill: { ...perfect, accuracy: 0, fireUptime: 0, secondaryUptime: 0 },
      seed: 1
    });
    assert.equal(r.victory, false);
    assert.equal(r.defeatReason, 'timeout');
  });

  it('um jogador perfeito que morre perde por morte, não por tempo', () => {
    const r = simulateMatch({
      spec: FALLBACK_PRESETS.interceptor,
      skill: { ...perfect, hitsTakenPerSecond: 3 },
      seed: 5
    });
    assert.equal(r.victory, false);
    assert.equal(r.defeatReason, 'death');
  });

  it('respeita a janela de tempo contra o boss', () => {
    const r = simulateMatch({ spec: FALLBACK_PRESETS.striker, skill: perfect, seed: 3 });
    if (r.victory) {
      assert.ok(r.bossTtkSeconds !== null);
      assert.ok(r.bossTtkSeconds! <= BALANCE.match.duration_s - BALANCE.match.boss_spawn_s);
    }
  });

  it('honra a mitigação por fase: mais dano bruto na fase 3 que na 1', () => {
    // Um projétil de dano D causa D×mitigation.phaseN, com piso min_damage_per_hit.
    const d = BALANCE.ranges['weapons.primary.damage'].max;
    const p1 = Math.max(BALANCE.boss.min_damage_per_hit, Math.round(d * BALANCE.boss.mitigation.phase1));
    const p3 = Math.max(BALANCE.boss.min_damage_per_hit, Math.round(d * BALANCE.boss.mitigation.phase3));
    assert.ok(p3 > p1);
  });
});
```

- [ ] **Passo 3: Implementar o modelo**

`combat-model.ts`: laço de tempo discreto a 60 ticks/s, alimentado **só** por `BALANCE`. A regra de
ouro é que cada número usado aqui tenha um par exato na engine — se você precisar inventar um valor,
ele pertence ao `balance.ts`.

O modelo resolve, por tick:
1. **Cadência primária** — `1000 / fire_rate` ms; conta pelotas (`vulcan_pellet_count` quando
   `vulcan_spread`, com `vulcan_pellet_factor` no dano).
2. **Acerto** — `rng.chance(skill.accuracy * skill.fireUptime)` por pelota.
3. **Dano no boss** — `min(damage, max_damage_per_primary_hit)`, depois
   `max(min_damage_per_hit, round(× mitigation[fase]))`.
4. **Secundária** — a cada `cooldown_seconds`, se `rng.chance(skill.secondaryUptime)`; dano **sem** o
   teto por projétil (D13) e sujeito à mitigação da fase.
5. **Transições de fase** — nos limiares de HP, com `phase_transition_invuln_ms` de dano zero.
6. **Dano recebido** — `rng.chance(hitsTakenPerSecond / 60)` por tick, com
   `player.invulnerability_ms` de imunidade após cada acerto.
7. **Fim** — vitória quando o HP do boss zera; `timeout` quando `duration_s` acaba; `death` quando o
   HP do jogador zera. Antes de `boss_spawn_s`, o modelo acumula abates de drone a uma taxa derivada de
   `wave_interval_ms` e da precisão, apenas para alimentar o `combatScore`.

O score final vem do `ScoreCalculator` migrado para `packages/shared/src/game/score-calculator.ts`
(ver o bloco de Interfaces). Faça a migração **antes** de escrever `combat-model.ts`, em um commit
próprio: `refactor(shared): mover o ScoreCalculator para o pacote compartilhado`. É um `git mv` mais a
troca de import em `MainGameScene.ts`; o teste acompanha o arquivo e passa a rodar sob `node:test`.

- [ ] **Passo 4: Rodar e ver passar**

```bash
npm run test --workspace=packages/sim
```

- [ ] **Passo 5: Arquétipos e perfis de habilidade**

`archetypes.ts` exporta `SKILL_PROFILES` (os três perfis, com os números marcados em comentário como
**estimativa a recalibrar com os dados do evento**, conforme Spec 09 §6) e `ARCHETYPES`, importados de
`DEV_PRESETS` para não haver duas listas.

- [ ] **Passo 6: A matriz e a saída**

`run.ts` roda `ARCHETYPES × SKILL_PROFILES × 200 seeds`, imprime a tabela e grava `sim-results.json`
na raiz do repositório (com `sim-results.json` no `.gitignore`):

```
arquétipo        habilidade    vitórias   TTK p50   TTK p90   dano   score    derrota
striker          mediano          18,5%     26,1s     38,4s    2,3   41.230   62% tempo / 38% morte
```

```bash
npm run sim:balance
```

Esperado: completa em menos de 60s e imprime a matriz. **Não corrija nenhum número ainda** — o
diagnóstico é o produto desta tarefa; a correção é a próxima.

- [ ] **Passo 7: O teste de conformidade simulador × engine**

O simulador é uma reimplementação, e uma reimplementação pode mentir. A verificação é comparar o TTK do
boss entre simulador e engine real, com tolerância de 5% (Spec 09 §5.1).

Rodar a engine headless exigiria jsdom com canvas — caro e frágil. A verificação é de **captura
manual**, e o teste a torna permanente:

1. No harness (`npm run dev:game`), com *God mode* ligado, seed `1`, preset `striker`, pular para
   *Boss (45s)* e segurar o disparo até derrubar o boss. Clicar em *Baixar resumo*.
2. Repetir para os presets `interceptor` e `maximo`.
3. Salvar os três resumos em `packages/sim/fixtures/harness-runs.json`.

`conformance.test.ts` roda o simulador com a mesma spec, o mesmo seed e um perfil de habilidade
`accuracy: 1.0, fireUptime: 1.0, hitsTakenPerSecond: 0` — que é o que *God mode* com disparo contínuo
representa — e afirma:

```ts
    const deviation = Math.abs(sim.bossTtkSeconds! - fixture.boss_ttk_s) / fixture.boss_ttk_s;
    assert.ok(deviation <= 0.05,
      `${fixture.preset}: simulador ${sim.bossTtkSeconds}s vs engine ${fixture.boss_ttk_s}s (${(deviation * 100).toFixed(1)}%)`);
```

Se divergir, **o simulador está errado até prova em contrário** — a engine é a realidade. Encontre a
regra que o modelo transcreveu mal e corrija o modelo, não a tolerância.

- [ ] **Passo 8: Commit**

```bash
git add packages/sim packages/shared/src/game packages/player-app/src/game package.json .gitignore
git commit -m "feat(sim): simulador headless de balanceamento com teste de conformidade contra a engine"
```

---

### Tarefa B8 — [D12, P3, P4] Corrigir o balanceamento com número, e travá-lo em CI

Agora — e só agora — o tuning muda. A ordem importa: corrigir a dificuldade antes de conseguir
medi-la repetiria exatamente o processo que produziu um boss de 15.000 HP que ninguém consegue matar.

A auditoria mostrou, por aritmética, que a taxa de vitória real é **0% para os três presets de
fallback**. A meta herdada da Spec 04 §7 é 15% a 25%.

**Arquivos:**
- Modificar: `packages/shared/src/constants/balance.ts`
- Criar: `packages/sim/src/balance-gate.test.ts`
- Modificar: `specs/04_GAME_ENGINE_AND_MECHANICS_SPEC.md` §7, `specs/09_GAME_BALANCE_AND_DEV_MODE.md` §2.4
- Modificar: `.github/workflows/ci.yml` se existir; caso contrário, criar

- [ ] **Passo 1: Registrar a linha de base**

```bash
npm run sim:balance | tee /tmp/baseline.txt
```

Colar a matriz em um comentário no topo de `balance-gate.test.ts`, datada. É o "antes" contra o qual
toda mudança seguinte é julgada.

- [ ] **Passo 2: Escrever o portão de CI, e vê-lo falhar**

Criar `packages/sim/src/balance-gate.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runMatrix, WIN_RATE_TARGET, MAX_ARCHETYPE_SPREAD_PP } from './run.js';

describe('portão de balanceamento (Spec 09 §5.3)', () => {
  const matrix = runMatrix();

  it('mantém a taxa de vitória agregada na banda alvo', () => {
    const rate = matrix.aggregateWinRate;
    assert.ok(rate >= WIN_RATE_TARGET.min && rate <= WIN_RATE_TARGET.max,
      `taxa agregada ${(rate * 100).toFixed(1)}% fora da banda ${WIN_RATE_TARGET.min * 100}–${WIN_RATE_TARGET.max * 100}%`);
  });

  it('não deixa nenhum arquétipo em 0% nem em 100% na habilidade mediana', () => {
    for (const cell of matrix.cells.filter((c) => c.skill === 'mediano')) {
      assert.ok(cell.winRate > 0, `${cell.archetype} é invencível — este é exatamente o defeito D12`);
      assert.ok(cell.winRate < 1, `${cell.archetype} vence sempre — a escolha do visitante deixou de importar`);
    }
  });

  it('mantém o espalhamento entre arquétipos abaixo do penhasco', () => {
    const medians = matrix.cells.filter((c) => c.skill === 'mediano').map((c) => c.winRate);
    const spreadPp = (Math.max(...medians) - Math.min(...medians)) * 100;
    assert.ok(spreadPp <= MAX_ARCHETYPE_SPREAD_PP,
      `espalhamento de ${spreadPp.toFixed(1)} pontos percentuais entre o melhor e o pior arquétipo`);
  });

  it('não deixa nenhum arquétipo com secundária de dano zero (D13)', () => {
    for (const cell of matrix.cells) {
      assert.ok(cell.secondaryDamageDealt > 0 || cell.secondaryType === 'none',
        `${cell.archetype}: arma secundária ${cell.secondaryType} causou dano zero`);
    }
  });
});
```

Com `WIN_RATE_TARGET = { min: 0.15, max: 0.25 }` e `MAX_ARCHETYPE_SPREAD_PP = 35` exportados de
`run.ts`.

```bash
npm run test --workspace=packages/sim
```

Esperado: **FALHA**, e as mensagens dizem exatamente o que está errado. Este é o teste que teria
barrado D12 no dia em que foi introduzido.

- [ ] **Passo 3: Aplicar as hipóteses da Spec 09 §2.4, uma de cada vez**

Após **cada** alteração isolada em `balance.ts`, rodar `npm run sim:balance` e anotar o efeito. Mudar
duas coisas ao mesmo tempo destrói a atribuição.

| Ordem | Hipótese | Campo em `balance.ts` |
| :--- | :--- | :--- |
| 1 | Reduzir o HP do boss | `boss.max_hp` (partir de 6.000; `max_hp_hardcore` proporcional) |
| 2 | Teto por projétil só na primária | Já feito na B6; confirmar no relatório da secundária |
| 3 | Estender a janela do boss | `match.boss_spawn_s` 45 → 40, `boss_warning_s` 42 → 37 |
| 4 | Compensar o projétil único | `weapons.primary.vulcan_pellet_factor`, para baixo |
| 5 | Aliviar a mitigação da fase 1 | `boss.mitigation.phase1` 0,50 → acima |

Parar assim que os quatro testes do passo 2 passarem. **Não continue otimizando** — a banda é uma
banda, não um alvo pontual.

- [ ] **Passo 4: Conferir com a mão, não só com o número**

```bash
npm run dev:game
```

Cinco partidas completas, sem *God mode*, sem pular fase, com os presets `interceptor`, `striker` e
`maximo`. A pergunta a responder é a do usuário: **a dificuldade que o simulador prevê é a que a
partida transmite?** Se o simulador diz 20% e você vence 4 de 5, o modelo está errado — volte à Tarefa
B7 passo 7 e refaça a conformidade. Este é o conteúdo do Gate M1.

- [ ] **Passo 5: Registrar os números medidos nas especificações**

Na Spec 04 §7, substituir a meta aspiracional pelo valor **medido**, com a data e o comando que o
produziu. Na Spec 09 §2.4, marcar cada hipótese como aplicada ou descartada, com o delta observado. Uma
especificação que continua afirmando 15.000 HP depois desta tarefa volta a ser o problema que a Spec 00
documentou.

- [ ] **Passo 6: Ligar o portão em CI**

```yaml
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm run test --workspace=packages/sim
```

O `npm test` da raiz já inclui `packages/sim` desde a Tarefa B7 passo 1; o passo separado existe para
que a falha de balanceamento apareça com nome próprio no log.

- [ ] **Passo 7: Commit**

```bash
git add packages/shared/src/constants/balance.ts packages/sim/src/balance-gate.test.ts \
        specs/04_GAME_ENGINE_AND_MECHANICS_SPEC.md specs/09_GAME_BALANCE_AND_DEV_MODE.md .github
git commit -m "fix(balance): tornar o boss vencível na banda de 15% a 25% e travar a meta em CI"
```

---

> ### Gate M1 — ensaio manual no Mac
>
> ```bash
> npm run kill:daemon
> npm run build && npm test
> npm run sim:balance
> npm run dev:game
> ```
>
> Com o daemon parado e o Wi-Fi desligado, você precisa observar:
>
> - A engine sobe sozinha e a nave voa. Nenhuma requisição a `localhost:3000` no DevTools.
> - *Fase 3* coloca você contra o boss em menos de 5 segundos a partir do clique.
> - *Replay* com o mesmo seed reproduz a mesma sequência de formações.
> - O `svg_path_data` que você colar é o casco que aparece na tela.
> - A arma secundária derruba HP do boss de forma visível, e o pool de mísseis volta a zero.
> - A taxa de vitória impressa por `npm run sim:balance` corresponde ao que 5 partidas jogadas à mão
>   transmitem. **Se não corresponder, o Gate M1 não passou** — o simulador precisa ser corrigido antes
>   da Fase C, porque a Fase D vai confiar nele.
>
> O Gate **M2** (Fase A + B, com o `agy` real) roda logo em seguida, com o roteiro descrito ao fim da
> Fase A.

## Fase C — Nuvem: Firestore, Cloud Run e Vertex AI

Implementa a Topologia C da [Spec 08](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) e a
[Spec 05](./05_LEADERBOARD_AND_CLOUD_SPEC.md) inteira. Fecha D7, U1, U2 e U3.

A Fase A precisa estar pronta antes: sincronizar `telemetry: {}` para o Firestore não tem valor
nenhum, e o dado perdido é irrecuperável depois do evento. **Está** — as Fases A e B fecharam, com os
Gates M0, M1 e M2, e a telemetria hoje chega completa.

> **Revisão de entrada, 2026-08-22.** Antes de escrever código de nuvem, as Specs 05 e 08 foram
> reconciliadas com a implementação real e a Fase C foi reescrita para absorver o resultado. O que
> mudou em relação à versão original deste plano:
>
> | Mudança | Onde | Origem |
> | :--- | :--- | :--- |
> | Tarefa **C0**, nova, obrigatoriamente primeira | `App.tsx`, `sqlite-buffer.ts` | `match_id` por `Date.now()` colide entre estações; `resolveCompany('')` devolve `'Google'` |
> | Banco Firestore **nomeado** `jogo-navinha`, não o `(default)` | C2 | Decisão de provisionamento, Spec 08 §6.3 |
> | `schema_version: 1` em todo documento | C2 | Achado do `duboc/gemini-com-pe` |
> | Helper de campo tipado para as queries | C2 | Idem — fecha o buraco de literal string que o TS não pega |
> | O quinto arquivo com `localhost:3000` | C1 | `AttractScreen.tsx` nasceu depois deste plano |
> | `pilots_count` não incrementava ao trocar de empresa | C3 | Defeito no código de exemplo do próprio plano |
> | Falha de autenticação distinguida de falha de rede | C5 | Achado do `duboc/gemini-com-pe` |
> | Tarefa **C0b**, nova | `config/companies.json`, `sqlite-buffer.ts` | O catálogo de empresas era código, e o campo empresa não tinha moderação nenhuma |
> | Tarefa **C7**, nova | `packages/admin-app/`, `cloud-api/src/admin.ts` | Painel de administração, promovido da Tarefa E2 (opcional, Fase E) |
> | Credencial local do `agy` registrada como risco aceito | D1, Spec 11 §4.9 | Nada no repositório configura, verifica ou renova a credencial do Vertex no estande |
>
> As três últimas linhas vieram das perguntas de operação de 2026-08-22 (cadastro de empresas,
> painel de administração, renovação de credencial), não da revisão de código. As duas primeiras
> viraram tarefa; a terceira foi deliberadamente **não** automatizada — ver a Tarefa D1.
>
> **Correção de modelo, 2026-08-22, feita durante a implementação da Tarefa C4.** O modelo passa de
> `gemini-3.6-flash` para **`gemini-3.7-flash`**, e a região do Vertex AI — até então "a confirmar
> na implementação" (Spec 08 §6.3) — fica decidida em **`global`**, não `us-central1`. Atualizado em
> todas as specs e nesta tarefa; `VERTEX_LOCATION` continua uma variável de ambiente, com `global`
> como default.
>
> Três achados do `gemini-com-pe` foram avaliados e **rejeitados** para esta fase, com motivo:
> fan-out por Pub/Sub (temos um consumidor só — a regra é dos próprios autores), polling de 1,5s no
> telão (fica como plano B nomeado na Spec 05 §7), e o script Python de CI contra deriva de schema
> (o compilador já fecha a classe inteira, exceto pelo buraco que o helper tipado da C2 tapa).
> O `smoke-cloud.sh` deles é bom e pertence à **Tarefa D3**, não aqui.

### Tarefa C0 — Dois defeitos de uma linha que ficam caros depois da C2

Nenhum dos dois é de nuvem. Os dois se tornam irreversíveis no momento em que o primeiro documento é
gravado no Firestore, e é por isso que abrem a fase em vez de serem corrigidos junto de outra coisa.

**Arquivos:**
- Modificar: `packages/player-app/src/App.tsx:114`
- Modificar: `packages/shared/src/utils/company-normalizer.ts:87`
- Modificar: `packages/daemon/src/services/sqlite-buffer.ts:222`
- Modificar: `packages/shared/src/moderation.test.ts`
- Modificar: `packages/daemon/src/services/sqlite-buffer.test.ts`
- Criar: `packages/player-app/src/match-id.test.ts`

**Interfaces:**
- Nada novo. Muda o *valor* de `match_id` e o *default* de `resolveCompany`, ambos já tipados como
  `string`.

> **O default `'Google'` tem dois sítios, não um.** A revisão de entrada encontrou o primeiro
> (`sqlite-buffer.ts:222`); a pergunta sobre o cadastro de empresas revelou o segundo,
> `resolveCompanyFromCatalog` em `company-normalizer.ts:87`, que devolve `canonical: 'Google'` com
> `confidence: 1.0` para entrada vazia. Corrigir só um deixa o outro alcançável — e o de
> `company-normalizer.ts` é o mais grave dos dois, porque afirma confiança máxima num palpite.

- [ ] **Passo 1: Escrever os dois testes**

Criar `packages/player-app/src/match-id.test.ts` — vitest, como o resto do `player-app`:

```ts
import { describe, it, expect } from 'vitest';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('geração de match_id', () => {
  it('produz UUID v4', () => {
    expect(crypto.randomUUID()).toMatch(UUID_V4);
  });

  it('duas partidas terminadas no mesmo milissegundo têm IDs diferentes', () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    expect(a).not.toEqual(b);
  });

  it('nunca colide em mil gerações', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => crypto.randomUUID()));
    expect(ids.size).toBe(1000);
  });
});
```

Este teste é curto de propósito: ele documenta a invariante que a Spec 05 §4.1 exige, e falharia se
alguém voltasse a usar timestamp. O que ele **não** faz é testar `crypto.randomUUID` em si.

Acrescentar a `packages/daemon/src/services/sqlite-buffer.test.ts`:

```ts
it('não atribui a Google uma empresa vazia', () => {
  assert.notEqual(buffer.resolveCompany(''), 'Google');
  assert.notEqual(buffer.resolveCompany('   '), 'Google');
  assert.equal(buffer.resolveCompany(''), 'Independente');
});

it('continua resolvendo os typos conhecidos', () => {
  assert.equal(buffer.resolveCompany('Gooogle'), 'Google');
});
```

E a `packages/shared/src/moderation.test.ts`, para o segundo sítio:

```ts
it('não devolve Google para entrada vazia, e não finge confiança', () => {
  const r = resolveCompanyFromCatalog('', seedCatalog);
  assert.strictEqual(r.canonical, 'Independente');
  assert.strictEqual(r.matchedBy, 'fallback');
  assert.ok(r.confidence < 1.0, 'entrada vazia não pode ter confiança máxima');
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run test --workspace=packages/daemon && npm run test --workspace=packages/shared
```

Esperado: os dois casos de empresa vazia **falham** com `'Google'`.

- [ ] **Passo 3: Corrigir o `match_id`**

Em `packages/player-app/src/App.tsx`, dentro de `handleMatchComplete`:

```ts
-      match_id: `match_${Date.now()}`,
+      // UUID, não timestamp: este valor é a PRIMARY KEY do SQLite e vira o ID do
+      // documento Firestore, onde a escrita é set() por ID. Duas estações que
+      // terminam no mesmo milissegundo sobrescreveriam uma à outra em silêncio.
+      // Spec 05 §4.1.
+      match_id: crypto.randomUUID(),
```

`crypto.randomUUID()` existe em todo browser servido por origem segura — e `http://localhost` conta
como segura, que é como o kiosk roda depois da Tarefa C1.

- [ ] **Passo 4: Corrigir o default de empresa vazia nos dois sítios**

Em `packages/daemon/src/services/sqlite-buffer.ts:222`:

```ts
-    if (!raw) return 'Google';
+    // 'Independente', não 'Google': num evento do Google, o default errado infla
+    // o ranking corporativo do próprio anfitrião. Spec 05 §3.1.
+    if (!raw) return 'Independente';
```

E em `packages/shared/src/utils/company-normalizer.ts:83-91`:

```ts
   if (!rawTrimmed) {
     return {
       raw: '',
-      canonical: 'Google',
-      confidence: 1.0,
+      canonical: 'Independente',
+      confidence: 0,          // não há o que inferir de uma string vazia
       matchedBy: 'fallback'
     };
   }
```

O formulário já exige empresa preenchida, então o caminho só é alcançável por chamada direta à API —
mas o efeito, se alcançado, é exatamente o que ninguém quer explicar no telão. A `confidence: 1.0`
original era pior que o nome errado: ela diria ao backfill da Tarefa C4 que não há nada a revisar.

- [ ] **Passo 5: Rodar tudo e ver passar**

```bash
npm test
```

Esperado: a mesma falha única de sempre (`balance-gate.test.ts`, gate de dispersão de arquétipos,
§2.1 da [Spec 11](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md)) e nada mais.

- [ ] **Passo 6: Commit**

```bash
git add packages/player-app/src packages/shared/src packages/daemon/src/services/sqlite-buffer.ts \
        packages/daemon/src/services/sqlite-buffer.test.ts
git commit -m "fix(match): gerar match_id como UUID e parar de atribuir empresa vazia ao anfitrião"
```

---

### Tarefa C0b — Catálogo de empresas em arquivo, e o campo empresa moderado

Duas lacunas que a revisão de entrada não pegou porque nenhuma das duas é de nuvem — vieram das
perguntas de 2026-08-22 sobre cadastro.

**Lacuna 1: o catálogo é código.** `seedCanonicalCompanies()` (`sqlite-buffer.ts:99`) tem 25 nomes
literais em TypeScript. Pré-cadastrar as empresas reais do evento exige editar o fonte e rebuildar —
o que ninguém vai querer fazer na véspera, e ninguém *pode* fazer no dia.

**Lacuna 2: o campo empresa não passa por moderação nenhuma.** `resolveCompanyFromCatalog` faz
fallback para o texto cru capitalizado quando nada casa — comportamento testado e deliberado
(`moderation.test.ts:82`: `'startup do joao'` → `'Startup Do Joao'`), porque um visitante de uma
empresa fora do catálogo tem que aparecer com o nome dela. O efeito colateral é que **qualquer texto
digitado no campo empresa chega ao telão**. O callsign tem duas camadas de moderação; a empresa tem
zero, e as duas aparecem lado a lado na mesma linha do placar.

**Arquivos:**
- Criar: `config/companies.json`
- Criar: `config/companies.example.json`
- Modificar: `packages/daemon/src/services/sqlite-buffer.ts` (`seedCanonicalCompanies`, `resolveCompany`)
- Modificar: `packages/daemon/src/services/sqlite-buffer.test.ts`
- Modificar: `packages/shared/src/moderation.test.ts`
- Modificar: `packages/daemon/.env.example`

**Interfaces:**
- Produz: `loadCompanyCatalog(filePath?: string): string[]` — pura o bastante para ser testada com um
  arquivo temporário, com a lista embutida como fallback se o arquivo não existir.
- Consome: `validateCallsign` de `@jogo/shared`, já existente. **Nenhuma dependência nova, nenhuma
  segunda lista de palavras** — uma segunda lista divergiria da primeira em uma semana.

- [ ] **Passo 1: Escrever os testes**

Em `packages/daemon/src/services/sqlite-buffer.test.ts`:

```ts
describe('catálogo de empresas', () => {
  it('carrega do arquivo apontado por BOOTH_COMPANIES_FILE', () => {
    const f = path.join(os.tmpdir(), `companies-${process.pid}.json`);
    fs.writeFileSync(f, JSON.stringify({ companies: ['Acme Corp', 'Umbrella'] }));
    assert.deepEqual(loadCompanyCatalog(f), ['Acme Corp', 'Umbrella']);
    fs.unlinkSync(f);
  });

  it('cai na lista embutida quando o arquivo não existe, em vez de subir vazio', () => {
    const catalog = loadCompanyCatalog('/caminho/que/nao/existe.json');
    assert.ok(catalog.includes('Google'));
    assert.ok(catalog.length >= 20);
  });

  it('recusa um arquivo malformado em vez de silenciar', () => {
    const f = path.join(os.tmpdir(), `bad-${process.pid}.json`);
    fs.writeFileSync(f, '{ isto não é json');
    assert.throws(() => loadCompanyCatalog(f), /companies\.json/i);
    fs.unlinkSync(f);
  });
});

describe('moderação do campo empresa', () => {
  it('não deixa texto ofensivo virar nome de empresa no telão', () => {
    assert.equal(buffer.resolveCompany('PORRA LTDA'), 'Independente');
    assert.equal(buffer.resolveCompany('p0rr4 tech'), 'Independente');
  });

  it('não afeta empresa desconhecida mas inofensiva', () => {
    assert.equal(buffer.resolveCompany('Startup do João'), 'Startup Do João');
  });

  it('não afeta empresa do catálogo', () => {
    assert.equal(buffer.resolveCompany('Gooogle Brasil'), 'Google');
  });
});
```

O segundo caso é o que impede a correção de virar um problema pior que o original: reprovar toda
empresa fora do catálogo esvaziaria o placar corporativo de todo mundo que não trabalha nas 25 do
seed.

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run test --workspace=packages/daemon
```

- [ ] **Passo 3: Criar o arquivo de catálogo**

`config/companies.json` — a lista atual, extraída do fonte sem alteração, mais um comentário no
`example`:

```json
{
  "_comment": "Catálogo de empresas para auto-complete e normalização. Editar e reiniciar o daemon; não exige rebuild. Sobrescrever o caminho com BOOTH_COMPANIES_FILE.",
  "companies": [
    "Google", "Google Cloud", "Android", "YouTube", "Alphabet",
    "Itaú", "Bradesco", "Nubank", "Mercado Livre", "Stone",
    "Globo", "Embraer", "Petrobras", "Ambev", "Totvs",
    "Votorantim", "Magazine Luiza", "iFood", "QuintoAndar", "C6 Bank",
    "Accenture", "Deloitte", "PwC", "KPMG", "CI&T"
  ]
}
```

Copiar para `config/companies.example.json`. O `companies.json` **fica versionado** — é conteúdo do
evento, não segredo, e versioná-lo é como se sabe qual lista rodou.

- [ ] **Passo 4: Implementar o carregamento**

```ts
/**
 * Catálogo de empresas para auto-complete e normalização.
 * Arquivo em vez de literal no código para que a lista do evento possa ser
 * trocada sem rebuild — ver Spec 05 §3.1.
 */
export function loadCompanyCatalog(filePath?: string): string[] {
  const target = filePath
    || process.env.BOOTH_COMPANIES_FILE
    || path.join(packageRoot, '..', '..', 'config', 'companies.json');

  if (!fs.existsSync(target)) {
    console.warn(`[SQLiteBuffer] ${target} não encontrado; usando o catálogo embutido.`);
    return [...BUILTIN_COMPANIES];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (e) {
    // Malformado é diferente de ausente: ausente é uma máquina nova, malformado
    // é alguém que editou e errou. Silenciar o segundo esconde o erro até o evento.
    throw new Error(`[SQLiteBuffer] companies.json inválido em ${target}: ${(e as Error).message}`);
  }
  const list = (parsed as { companies?: unknown }).companies;
  if (!Array.isArray(list) || list.some((c) => typeof c !== 'string')) {
    throw new Error(`[SQLiteBuffer] companies.json em ${target} precisa de um array "companies" de strings.`);
  }
  return list as string[];
}
```

`seedCanonicalCompanies()` passa a iterar sobre `loadCompanyCatalog()`. O `INSERT OR IGNORE` já
existente torna a operação idempotente entre reinícios; nomes **removidos** do arquivo continuam na
tabela, o que é o comportamento certo — uma empresa que já tem partidas não pode sumir do placar.

- [ ] **Passo 5: Moderar o campo empresa**

Em `resolveCompany`, **depois** da resolução e **antes** de devolver — a ordem importa, porque uma
empresa do catálogo nunca deve ser reprovada por um falso positivo do filtro:

```ts
    const resolution = resolveCompanyFromCatalog(raw, catalog);

    // Empresa que casou com o catálogo é confiável por construção: o catálogo é
    // curado. Só o fallback — texto cru do visitante — precisa passar pelo filtro,
    // porque é o único caminho em que texto arbitrário chega ao telão.
    if (resolution.matchedBy === 'fallback') {
      const check = validateCallsign(resolution.canonical);
      if (!check.valid && check.reason === 'profanity') {
        this.cacheAlias(raw, 'Independente');
        return 'Independente';
      }
    }

    this.cacheAlias(raw, resolution.canonical);
    return resolution.canonical;
```

Reusar `validateCallsign` é deliberado: uma segunda lista de palavras divergiria da primeira. Só o
motivo `profanity` reprova — os outros motivos (comprimento de 3 a 15, charset, repetição) são regras
de callsign e reprovariam nomes de empresa legítimos como `Magazine Luiza` ou `CI&T`.

> Isto **não** substitui a camada 2 da Tarefa C4. Fecha o buraco agora, com o filtro determinístico
> que já existe e funciona offline. Se a C4 estender a moderação semântica ao campo empresa, ela entra
> como camada 2 do mesmo caminho, com a mesma regra de falhar fechada.

- [ ] **Passo 6: Rodar e ver passar**

```bash
npm test
```

- [ ] **Passo 7: Documentar para o operador**

Uma linha em `packages/daemon/.env.example` (`BOOTH_COMPANIES_FILE`) e um parágrafo no
`USER_GUIDE.md`: como pré-cadastrar as empresas do evento editando `config/companies.json` e
reiniciando o daemon. Sem isso a funcionalidade existe e ninguém sabe.

- [ ] **Passo 8: Commit**

```bash
git add config packages/daemon/src packages/shared/src/moderation.test.ts \
        packages/daemon/.env.example USER_GUIDE.md
git commit -m "feat(empresas): catálogo em arquivo editável e moderação do campo empresa"
```

---

### Tarefa C1 — [D7] Endereços por configuração, e o `player-app` servido pelo bridge

`http://localhost:3000` está fixo em **cinco** arquivos, dez ocorrências. Enquanto estiver, nada pode
ser hospedado. A
[Spec 08](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) §5 decide que o `player-app` é servido pelo
próprio bridge — o que torna a origem local e elimina de uma vez a exposição às regras de Private
Network Access do Chrome em modo kiosk.

**Arquivos:**
- Criar: `packages/shared/src/config.ts`
- Criar: `packages/shared/src/config.test.ts`
- Criar: `packages/player-app/src/config.ts`
- Criar: `packages/leaderboard-app/src/config.ts`
- Criar: `packages/player-app/.env.example`, `packages/leaderboard-app/.env.example`
- Modificar: `packages/shared/src/index.ts`
- Modificar: `packages/daemon/src/index.ts` (servir os estáticos)
- Modificar: `packages/player-app/src/App.tsx`, `src/components/RegistrationForm.tsx`,
  `src/components/HandoffTerminalScreen.tsx`, `src/components/AttractScreen.tsx`
- Modificar: `packages/leaderboard-app/src/App.tsx`
- Modificar: `package.json` da raiz

**Interfaces:**
- Produz: `resolveEndpoints(env, origin): EndpointConfig`, pura e sem dependência de Vite, para poder
  ser testada em `node:test` e reutilizada pelo daemon.
- Produz: `ENDPOINTS` em cada app — o objeto já resolvido, importado pelos componentes.
- Fecha o `TODO` de `API_BASE` que a Tarefa A7 deixou no `App.tsx`.

- [ ] **Passo 1: Escrever o teste da resolução**

Criar `packages/shared/src/config.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEndpoints } from './config.js';

describe('resolveEndpoints', () => {
  it('usa a própria origem quando nada está configurado', () => {
    const c = resolveEndpoints({}, 'http://localhost:3000');
    assert.equal(c.bridgeBase, '');
    assert.equal(c.bridgeWsUrl, 'ws://localhost:3000/events');
    assert.equal(c.cloudApiBase, null);
  });

  it('honra o override explícito do bridge, usado pelo dev server do Vite', () => {
    const c = resolveEndpoints({ VITE_BRIDGE_BASE: 'http://localhost:3000' }, 'http://localhost:5173');
    assert.equal(c.bridgeBase, 'http://localhost:3000');
    assert.equal(c.bridgeWsUrl, 'ws://localhost:3000/events');
  });

  it('usa wss quando a página é servida por https', () => {
    const c = resolveEndpoints({}, 'https://placar.exemplo.app');
    assert.equal(c.bridgeWsUrl, 'wss://placar.exemplo.app/events');
  });

  it('remove a barra final do endereço da nuvem para a concatenação ser previsível', () => {
    const c = resolveEndpoints({ VITE_CLOUD_API_BASE: 'https://api.exemplo.app/' }, 'https://x.app');
    assert.equal(c.cloudApiBase, 'https://api.exemplo.app');
  });

  it('nunca devolve localhost embutido em código', () => {
    const c = resolveEndpoints({}, 'https://placar.exemplo.app');
    assert.ok(!JSON.stringify(c).includes('localhost'));
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run test --workspace=packages/shared
```

- [ ] **Passo 3: Implementar**

Criar `packages/shared/src/config.ts`:

```ts
export interface EndpointConfig {
  /** Prefixo das chamadas ao bridge. String vazia significa "mesma origem". */
  bridgeBase: string;
  bridgeWsUrl: string;
  /** Endereço da API de ingestão em Cloud Run. null quando o app não fala com a nuvem. */
  cloudApiBase: string | null;
}

/**
 * Resolve endereços a partir do ambiente de build e da origem em execução.
 * Recebe `env` e `origin` como parâmetros em vez de ler `import.meta.env` e
 * `window` porque o pacote shared também é consumido pelo daemon em Node,
 * onde nenhum dos dois existe.
 */
export function resolveEndpoints(
  env: Record<string, string | undefined>,
  origin: string
): EndpointConfig {
  const stripSlash = (s: string) => s.replace(/\/+$/, '');
  const bridgeBase = env.VITE_BRIDGE_BASE ? stripSlash(env.VITE_BRIDGE_BASE) : '';
  const wsOrigin = bridgeBase || origin;
  const bridgeWsUrl = `${wsOrigin.replace(/^http/, 'ws')}/events`;
  const cloudApiBase = env.VITE_CLOUD_API_BASE ? stripSlash(env.VITE_CLOUD_API_BASE) : null;
  return { bridgeBase, bridgeWsUrl, cloudApiBase };
}
```

Exportar em `packages/shared/src/index.ts`:

```ts
export * from './config.js';
```

Criar `packages/player-app/src/config.ts` e `packages/leaderboard-app/src/config.ts` (idênticos):

```ts
import { resolveEndpoints } from '@jogo/shared';

export const ENDPOINTS = resolveEndpoints(
  import.meta.env as unknown as Record<string, string | undefined>,
  window.location.origin
);
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
npm run test --workspace=packages/shared
```

- [ ] **Passo 5: Trocar os literais nos cinco arquivos**

Cada `fetch('http://localhost:3000/api/…')` vira `fetch(\`${ENDPOINTS.bridgeBase}/api/…\`)`, e o
`new WebSocket('ws://localhost:3000/events')` vira `new WebSocket(ENDPOINTS.bridgeWsUrl)` — a Tarefa A8
já renomeou o caminho para `/events`. Preencher também o `API_BASE` que a Tarefa A7 deixou pendente no
envio da telemetria.

A lista exata, verificada em 2026-08-22 — **dez ocorrências em cinco arquivos**:

| Arquivo | Linhas | O que é |
| :--- | :--- | :--- |
| `packages/player-app/src/App.tsx` | 89, 128, 154 | `session/start`, `matches`, `session/reset` |
| `packages/player-app/src/components/HandoffTerminalScreen.tsx` | 44, 69, 77 | WebSocket `/events`, `session/spec`, `session/activity` |
| `packages/player-app/src/components/AttractScreen.tsx` | 63 | `api/leaderboard` |
| `packages/player-app/src/components/RegistrationForm.tsx` | 19 | `api/companies?q=` |
| `packages/leaderboard-app/src/App.tsx` | 42, 65 | `api/leaderboard`, WebSocket `/events` |

> **O `AttractScreen.tsx` não estava na versão original desta tarefa** — o componente nasceu depois
> que este plano foi escrito. Como o Passo 8 é um `grep` que precisa voltar vazio, a lista
> desatualizada faria a própria tarefa reprovar no seu último passo. Confira o `grep` antes de
> começar, não só depois: o repositório pode ter ganhado um sexto arquivo desde 2026-08-22.

Criar `packages/player-app/.env.example`:

```
# Deixe VAZIO em produção: o player-app é servido pelo próprio bridge (Spec 08 §5).
# Preencha apenas para rodar `npm run dev:player` com o Vite em outra porta.
VITE_BRIDGE_BASE=http://localhost:3000
```

E `packages/leaderboard-app/.env.example` com `VITE_BRIDGE_BASE`, `VITE_CLOUD_API_BASE` e as variáveis
`VITE_FIREBASE_*` que a Tarefa C6 consome.

- [ ] **Passo 6: O bridge servir o build do `player-app`**

Em `packages/daemon/src/index.ts`, **depois** de todas as rotas `/api` — a ordem importa, senão o
fallback de SPA engole os endpoints:

```ts
// --- Estáticos do player-app (Spec 08 §5) ---
// Servir o app pelo próprio bridge torna a origem local e elimina a exposição
// às regras de Private Network Access do Chrome em modo kiosk.
const playerAppDist =
  process.env.BOOTH_PLAYER_APP_DIST || path.resolve(__dirname, '../../player-app/dist');

if (fs.existsSync(path.join(playerAppDist, 'index.html'))) {
  app.use(express.static(playerAppDist));
  app.get(/^\/(?!api\/|events).*/, (_req, res) => {
    res.sendFile(path.join(playerAppDist, 'index.html'));
  });
  console.log(`[Local Bridge Daemon] Serving player-app from ${playerAppDist}`);
} else {
  console.warn(`[Local Bridge Daemon] player-app build not found at ${playerAppDist}. ` +
    `Run "npm run build --workspace=packages/player-app" before the event.`);
}
```

O aviso é deliberado: um bridge que sobe silenciosamente sem o app é uma falha que só aparece quando
alguém abre o navegador no dia do evento.

- [ ] **Passo 7: Verificar**

```bash
npm run build
npm run start:daemon
open http://localhost:3000
```

Esperado: o `player-app` carrega **na porta 3000**, não em 5173. O DevTools não mostra nenhuma
requisição cruzando origem. `npm run dev:player` continua funcionando na 5173 graças ao
`VITE_BRIDGE_BASE` do `.env`.

- [ ] **Passo 8: O portão da Spec 05 §8**

```bash
grep -rn "localhost:3000" packages/*/src
```

Esperado: **nenhuma saída**. Ocorrências em `scripts/`, `README.md` e `USER_GUIDE.md` são legítimas —
são instruções para o operador, não código.

- [ ] **Passo 9: Commit**

```bash
git add packages/shared/src/config.ts packages/shared/src/config.test.ts packages/shared/src/index.ts \
        packages/player-app/src packages/player-app/.env.example \
        packages/leaderboard-app/src packages/leaderboard-app/.env.example \
        packages/daemon/src/index.ts package.json
git commit -m "feat(config): resolver endpoints por ambiente e servir o player-app pelo bridge local"
```

---

### Tarefa C2 — [U1] Modelo de dados, regras e índices do Firestore

Antes de qualquer código de nuvem, o contrato de dados e o modelo de segurança. A regra central da
[Spec 05](./05_LEADERBOARD_AND_CLOUD_SPEC.md) §6 é uma frase: **nenhum cliente escreve**. Ela precisa
ser verificável, não afirmada.

**Arquivos:**
- Criar: `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `.firebaserc.example`
- Criar: `packages/cloud-api/package.json`, `tsconfig.json` (esqueleto; a Tarefa C3 preenche)
- Criar: `packages/cloud-api/src/firestore-rules.test.ts`
- Criar: `packages/shared/src/types/cloud.ts`
- Modificar: `packages/shared/src/index.ts`, `package.json` da raiz

**Interfaces:**
- Produz: `MatchDocument`, `PilotDocument`, `CompanyRankingDocument` — os três tipos do §4 da Spec 05,
  consumidos pela Tarefa C3 (escrita) e pela C6 (leitura).
- Produz: `SCHEMA_VERSION` e `field<T>(name: keyof T): string`, consumidos pelas mesmas duas tarefas.
- Produz: `DATABASE_ID = 'jogo-navinha'`, consumido por todo cliente Admin SDK.

> **Dependência nova, justificada (Restrição Global 5):** `@firebase/rules-unit-testing` como
> `devDependency` de `packages/cloud-api`. É a única forma de provar `PERMISSION_DENIED` sem um projeto
> real, e o critério de aceitação da Spec 05 §8 exige exatamente essa prova. Exige o emulador do
> Firestore (`firebase-tools`), instalado localmente e não versionado, que por sua vez exige uma JRE
> (`sudo apt install -y default-jre-headless`).

> **O banco é `jogo-navinha`, nomeado, não o `(default)` — Spec 08 §6.3.** Consequências práticas que
> aparecem em todos os passos abaixo: o `firebase.json` usa a forma em **array**, e todo cliente Admin
> SDK precisa nomear o banco na construção. Esquecer o nome não dá erro: escreve no `(default)` de
> `vibe-cabral`, em silêncio, junto dos dados de outro projeto. É por isso que o Passo 7 testa
> exatamente esse esquecimento.

- [ ] **Passo 1: Declarar os tipos**

Criar `packages/shared/src/types/cloud.ts` com os três documentos, campo a campo, espelhando a Spec 05
§4.1–4.3. `created_at` é `string` em trânsito (ISO) e vira `Timestamp` do servidor na escrita —
comentar isso no tipo, porque é a fonte clássica de confusão:

```ts
import type { ScoreBreakdown, MatchTelemetry, ShipSpecification } from './ship.js';

/** Banco Firestore nomeado. Nunca o (default). Spec 08 §6.3. */
export const DATABASE_ID = 'jogo-navinha';

/**
 * Versão da forma dos documentos. Nasce em 1 e sobe quando um campo muda de
 * significado ou some. Custa um inteiro por documento e evita ter que adivinhar,
 * depois do evento, qual forma um documento tem. Spec 05 §4.1.
 */
export const SCHEMA_VERSION = 1;

/** Documento em /matches/{match_id}. `match_id` é a chave: reenviar é idempotente. */
export interface MatchDocument {
  schema_version: number;
  /** UUID v4. Nunca timestamp — duas estações colidiriam. Spec 05 §4.1. */
  match_id: string;
  pilot_id: string;
  callsign: string;
  company_raw: string;
  company_canonical: string;
  company_confidence: number;
  final_score: number;
  score_breakdown: ScoreBreakdown;
  telemetry: MatchTelemetry;
  ship_spec_snapshot: ShipSpecification;
  /** ISO 8601 no cliente. O servidor sobrescreve com FieldValue.serverTimestamp(). */
  created_at: string;
  /** Marcado quando a canonicalização por modelo ainda não rodou (Spec 05 §3.2). */
  needs_company_review?: boolean;
}
```

`score_breakdown` e `telemetry` são **referenciados por tipo**, nunca copiados campo a campo:
`ScoreBreakdown` e `MatchTelemetry` já mudaram duas vezes durante a Fase B, e uma cópia teria
divergido em silêncio. Mais `PilotDocument` e `CompanyRankingDocument` conforme §4.2 e §4.3, ambos
também com `schema_version`.

**A regra que acompanha o arquivo:** nenhum outro pacote declara sua própria versão desses três tipos.
`cloud-api` (escritor) e `leaderboard-app` (leitor) importam de `@jogo/shared`. É isso que faz o
compilador — e não uma revisão humana — pegar deriva de schema. O Passo 7 tem o `grep` que verifica.

- [ ] **Passo 1b: O helper de campo tipado**

O compilador fecha a deriva de schema com uma exceção: nomes de campo passados como **string** em
`.where('company_canonical', …)` e `.orderBy('final_score', …)` não são checados por tipo. Renomear
um campo no tipo compila limpo e quebra a consulta em produção.

```ts
/**
 * Nome de campo checado pelo compilador, para as consultas do Firestore.
 * `orderBy(field<MatchDocument>('final_score'), 'desc')` quebra o build se o
 * campo for renomeado; `orderBy('final_score', 'desc')` compila e falha no evento.
 */
export function field<T>(name: keyof T & string): string {
  return name;
}
```

Nove linhas fecham o único buraco que o sistema de tipos deixa aberto. A alternativa considerada e
rejeitada foi portar o script Python de CI do `duboc/gemini-com-pe`, que varre os fontes procurando
campos desconhecidos: ele existe lá porque eles têm TypeScript e Python escrevendo as mesmas coleções
sem tipos compartilhados. Nós temos um escritor só, em TS. O helper pega o mesmo erro no editor, e não
no CI.

- [ ] **Passo 2: Escrever o teste das regras**

Criar `packages/cloud-api/src/firestore-rules.test.ts`:

```ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';

let env: RulesTestEnvironment;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'jogo-navinha-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 }
  });
});

after(async () => { await env.cleanup(); });

describe('firestore.rules', () => {
  it('permite leitura pública do placar', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertSucceeds(db.collection('matches').doc('m1').get());
    await assertSucceeds(db.collection('company_rankings').doc('Google').get());
    await assertSucceeds(db.collection('pilots').doc('p1').get());
  });

  it('nega escrita de cliente em matches', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(db.collection('matches').doc('m1').set({ final_score: 999999 }));
  });

  it('nega escrita de cliente em company_rankings e pilots', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(db.collection('company_rankings').doc('Google').set({ total_score: 1 }));
    await assertFails(db.collection('pilots').doc('p1').set({ best_score: 1 }));
  });

  it('nega escrita mesmo para um cliente autenticado', async () => {
    const db = env.authenticatedContext('alguem').firestore();
    await assertFails(db.collection('matches').doc('m2').set({ final_score: 1 }));
  });

  it('nega qualquer acesso a coleções não previstas', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(db.collection('segredos').doc('x').get());
  });
});
```

- [ ] **Passo 3: Subir o emulador e ver falhar**

```bash
npx firebase emulators:start --only firestore &
npm run test --workspace=packages/cloud-api
```

Esperado: **FALHA** — `firestore.rules` não existe.

- [ ] **Passo 4: Escrever as regras**

Criar `firestore.rules`:

```
rules_version = '2';

// Modelo de segurança da Spec 05 §6: leitura pública das três coleções do
// placar, escrita negada a todo cliente. A única escrita do sistema vem do
// Cloud Run com o Admin SDK, que ignora estas regras por definição.
service cloud.firestore {
  match /databases/{database}/documents {

    match /matches/{matchId} {
      allow read: if true;
      allow write: if false;
    }

    match /pilots/{pilotId} {
      allow read: if true;
      allow write: if false;
    }

    match /company_rankings/{company} {
      allow read: if true;
      allow write: if false;
    }

    // Nada mais existe. Uma coleção nova precisa ser declarada aqui de propósito.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

E `firestore.indexes.json` com os três índices compostos que as consultas da Tarefa C6 exigem:
`matches` por `final_score` desc, `matches` por `created_at` desc, e `company_rankings` por
`total_score` desc. Sem eles, a primeira consulta em produção falha com um link de "crie o índice" —
que ninguém quer clicar durante o evento.

- [ ] **Passo 5: Amarrar as regras ao banco nomeado**

`firebase.json` precisa da **forma em array** — a forma em objeto publica no `(default)`, que é
exatamente o que a Spec 08 §6.3 proíbe:

```json
{
  "firestore": [
    {
      "database": "jogo-navinha",
      "rules": "firestore.rules",
      "indexes": "firestore.indexes.json"
    }
  ],
  "emulators": {
    "firestore": { "port": 8080 },
    "ui": { "enabled": false }
  }
}
```

E `.firebaserc.example`:

```json
{ "projects": { "default": "vibe-cabral" } }
```

O `.firebaserc` real fica no `.gitignore` — ele nomeia o projeto de alguém, e o exemplo basta para
qualquer um reproduzir.

> **Publicar é `firebase deploy --only firestore:jogo-navinha`**, com o nome do banco. Sem o sufixo,
> o comando publica no `(default)` e derruba o acesso ao que já existe em `vibe-cabral`. Está no
> `README` da `cloud-api` e vale repetir aqui porque é irreversível na prática.

- [ ] **Passo 6: Rodar e ver passar**

```bash
npm run test --workspace=packages/cloud-api
```

- [ ] **Passo 7: Os dois portões desta tarefa**

```bash
grep -rn "interface MatchDocument\|interface PilotDocument\|interface CompanyRankingDocument" packages/*/src
```

Esperado: **exatamente três linhas, todas em `packages/shared/src/types/cloud.ts`**. Qualquer outra é
uma cópia local que vai divergir.

```bash
grep -rn "getFirestore()" packages/cloud-api/src
```

Esperado: **nenhuma saída**. Toda construção de cliente nomeia o banco —
`getFirestore(app, DATABASE_ID)`. Um `getFirestore()` sem argumento escreve no `(default)` sem erro,
sem log e sem sintoma até alguém abrir o console e ver os dados no lugar errado. Este `grep` é a única
defesa barata contra isso, e por isso é um passo e não um comentário.

- [ ] **Passo 8: Commit**

```bash
git add firestore.rules firestore.indexes.json firebase.json .firebaserc.example .gitignore \
        packages/cloud-api packages/shared/src/types/cloud.ts packages/shared/src/index.ts package.json
git commit -m "feat(cloud): modelo de dados, regras e índices do Firestore com teste de negação de escrita"
```

---

### Tarefa C3 — [U1] API de ingestão em Cloud Run

O ponto único onde a credencial privilegiada existe, onde a idempotência por `match_id` é aplicada e
onde os agregados são atualizados por transação. A máquina do estande nunca fala com o Firestore.

**Arquivos:**
- Modificar: `packages/cloud-api/package.json`, `tsconfig.json`
- Criar: `packages/cloud-api/src/index.ts` (bootstrap Express)
- Criar: `packages/cloud-api/src/ingest.ts` (lógica de gravação)
- Criar: `packages/cloud-api/src/ingest.test.ts`
- Criar: `packages/cloud-api/src/auth.ts`, `packages/cloud-api/src/auth.test.ts`
- Criar: `packages/cloud-api/Dockerfile`, `packages/cloud-api/.env.example`
- Criar: `packages/cloud-api/README.md` (comando de deploy)

**Interfaces:**
- Produz: `POST /v1/matches` — corpo `{ matches: MatchDocument[] }` (até 50), cabeçalho
  `Authorization: Bearer <token>`. Resposta:
  `{ accepted: string[]; rejected: Array<{ match_id: string; reason: string }> }`. Consumido pelo
  worker da Tarefa C5.
- Produz: `GET /v1/health` — usado pelo `self_test.sh` (Tarefa D3).
- Produz: `ingestBatch(db, matches): Promise<IngestResult>`, testável contra o emulador.

- [ ] **Passo 1: Escrever o teste de autenticação**

Criar `packages/cloud-api/src/auth.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorized } from './auth.js';

describe('isAuthorized', () => {
  it('aceita o token configurado', () => {
    assert.equal(isAuthorized('Bearer segredo-do-estande', 'segredo-do-estande'), true);
  });

  it('recusa token errado, ausente ou com esquema errado', () => {
    assert.equal(isAuthorized('Bearer outro', 'segredo-do-estande'), false);
    assert.equal(isAuthorized(undefined, 'segredo-do-estande'), false);
    assert.equal(isAuthorized('segredo-do-estande', 'segredo-do-estande'), false);
  });

  it('recusa tudo quando o servidor subiu sem token configurado', () => {
    assert.equal(isAuthorized('Bearer qualquer', ''), false);
    assert.equal(isAuthorized('Bearer qualquer', undefined), false);
  });
});
```

O último caso é o que importa: um serviço que sobe sem `BOOTH_INGEST_TOKEN` e aceita tudo é uma porta
aberta na internet.

- [ ] **Passo 2: Escrever o teste de ingestão contra o emulador**

Criar `packages/cloud-api/src/ingest.test.ts`:

```ts
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ingestBatch } from './ingest.js';
import { testDb, clearFirestore, matchFixture } from './test-helpers.js';

describe('ingestBatch', () => {
  beforeEach(async () => { await clearFirestore(); });

  it('grava a partida e devolve o match_id como aceito', async () => {
    const r = await ingestBatch(testDb, [matchFixture({ match_id: 'm1', final_score: 18450 })]);
    assert.deepEqual(r.accepted, ['m1']);
    const doc = await testDb.collection('matches').doc('m1').get();
    assert.equal(doc.data()!.final_score, 18450);
  });

  it('é idempotente: reenviar o mesmo match_id não duplica nem soma duas vezes', async () => {
    const m = matchFixture({ match_id: 'm1', final_score: 1000, company_canonical: 'Google' });
    await ingestBatch(testDb, [m]);
    await ingestBatch(testDb, [m]);
    const rank = await testDb.collection('company_rankings').doc('Google').get();
    assert.equal(rank.data()!.total_score, 1000, 'o agregado somou o reenvio');
    assert.equal(rank.data()!.pilots_count, 1);
  });

  it('acumula o agregado corporativo entre pilotos diferentes', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'a', pilot_id: 'p1', final_score: 1000, company_canonical: 'Google' }),
      matchFixture({ match_id: 'b', pilot_id: 'p2', final_score: 2500, company_canonical: 'Google' })
    ]);
    const rank = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(rank.total_score, 3500);
    assert.equal(rank.pilots_count, 2);
    assert.equal(rank.top_individual_score, 2500);
  });

  it('mantém o melhor score do piloto e conta as partidas', async () => {
    await ingestBatch(testDb, [matchFixture({ match_id: 'a', pilot_id: 'p1', final_score: 5000 })]);
    await ingestBatch(testDb, [matchFixture({ match_id: 'b', pilot_id: 'p1', final_score: 900 })]);
    const pilot = (await testDb.collection('pilots').doc('p1').get()).data()!;
    assert.equal(pilot.best_score, 5000);
    assert.equal(pilot.matches_played, 2);
  });

  it('conta o piloto na empresa nova quando ele joga de novo por outra empresa', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'a', pilot_id: 'p1', final_score: 1000, company_canonical: 'Gogle' })
    ]);
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'b', pilot_id: 'p1', final_score: 1200, company_canonical: 'Google' })
    ]);
    const nova = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(nova.pilots_count, 1, 'a empresa nova ficou com zero pilotos');
  });

  it('conta cada piloto uma vez só na mesma empresa, mesmo com várias partidas', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'a', pilot_id: 'p1', final_score: 1000, company_canonical: 'Google' }),
      matchFixture({ match_id: 'b', pilot_id: 'p1', final_score: 2000, company_canonical: 'Google' })
    ]);
    const rank = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(rank.pilots_count, 1);
    assert.equal(rank.total_score, 3000);
  });

  it('rejeita score fora da faixa plausível sem derrubar o lote', async () => {
    const r = await ingestBatch(testDb, [
      matchFixture({ match_id: 'ok', final_score: 12000 }),
      matchFixture({ match_id: 'absurdo', final_score: 99_000_000 })
    ]);
    assert.deepEqual(r.accepted, ['ok']);
    assert.equal(r.rejected[0].match_id, 'absurdo');
    assert.match(r.rejected[0].reason, /score/i);
  });

  it('rejeita partida sem telemetria em vez de gravar um documento vazio', async () => {
    const r = await ingestBatch(testDb, [matchFixture({ match_id: 'x', telemetry: undefined as any })]);
    assert.equal(r.accepted.length, 0);
    assert.match(r.rejected[0].reason, /telemetry/i);
  });
});
```

> A última asserção é a Fase A defendida na fronteira. A Tarefa A7 fez o cliente enviar telemetria
> completa; aqui o servidor **recusa** o que vier vazio, para que a regressão apareça no log de
> rejeições e não como uma coleção de documentos inúteis descobertos depois do evento.

- [ ] **Passo 3: Rodar e ver falhar**

```bash
npx firebase emulators:start --only firestore &
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test --workspace=packages/cloud-api
```

- [ ] **Passo 4: Implementar `auth.ts`**

```ts
/**
 * Autenticação do token de ingestão de escopo único (Spec 08 §6.1).
 * Comparação de tempo constante: o token é curto e o endpoint é público.
 */
import { timingSafeEqual } from 'node:crypto';

export function isAuthorized(header: string | undefined, expected: string | undefined): boolean {
  if (!expected) return false;                    // servidor sem token não aceita nada
  if (!header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(expected);
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}
```

- [ ] **Passo 5: Implementar `ingest.ts`**

Uma transação por partida, com quatro escritas: `matches/{match_id}` (create-or-skip),
`pilots/{pilot_id}` (merge com `best_score` e `matches_played`), `company_rankings/{company}` (soma) e
o carimbo `created_at` do servidor. A idempotência vem de ler o documento de `matches` **dentro** da
transação: se já existe, a transação não toca em nenhum agregado.

```ts
const MAX_PLAUSIBLE_SCORE = 500_000;   // ordem de 5× o teto teórico da Spec 09; barra lixo, não perícia

async function ingestOne(db: Firestore, m: MatchDocument): Promise<void> {
  await db.runTransaction(async (tx) => {
    const matchRef = db.collection('matches').doc(m.match_id);
    const existing = await tx.get(matchRef);
    if (existing.exists) return;                 // idempotente: nada a somar

    const pilotRef = db.collection('pilots').doc(m.pilot_id);
    const companyRef = db.collection('company_rankings').doc(m.company_canonical);
    const [pilot, company] = await Promise.all([tx.get(pilotRef), tx.get(companyRef)]);

    // O piloto conta como novo PARA ESTA EMPRESA se nunca existiu, ou se existia
    // registrado em outra. O caso do meio é real: alguém digita a empresa errada
    // na primeira partida e certo na segunda, e a Tarefa C4 canonicaliza depois.
    const pilotIsNewToCompany =
      !pilot.exists || pilot.data()!.company_canonical !== m.company_canonical;

    tx.set(matchRef, { ...m, schema_version: SCHEMA_VERSION, created_at: FieldValue.serverTimestamp() });
    tx.set(pilotRef, {
      schema_version: SCHEMA_VERSION,
      pilot_id: m.pilot_id,
      callsign: m.callsign,
      company_canonical: m.company_canonical,
      created_at: pilot.exists ? pilot.data()!.created_at : FieldValue.serverTimestamp(),
      best_score: Math.max(m.final_score, pilot.exists ? pilot.data()!.best_score : 0),
      matches_played: (pilot.exists ? pilot.data()!.matches_played : 0) + 1
    });
    tx.set(companyRef, {
      schema_version: SCHEMA_VERSION,
      company_canonical: m.company_canonical,
      total_score: (company.exists ? company.data()!.total_score : 0) + m.final_score,
      pilots_count: (company.exists ? company.data()!.pilots_count : 0) + (pilotIsNewToCompany ? 1 : 0),
      top_individual_score: Math.max(m.final_score, company.exists ? company.data()!.top_individual_score : 0),
      last_updated: FieldValue.serverTimestamp()
    });
  });
}
```

> **O `pilots_count` desta versão corrige um defeito da versão original deste plano.** A expressão
> anterior era
> `pilot.exists ? (company.data()?.pilots_count ?? 1) : (company.data()?.pilots_count ?? 0) + 1`, que
> lê "se o piloto já existe, mantenha a contagem da empresa". Isso está certo quando ele volta a jogar
> pela **mesma** empresa e errado quando joga por **outra**: a empresa nova ganha o `total_score` dele
> mas fica com `pilots_count` zero. Não é hipotético — é exatamente o que acontece quando alguém erra
> o nome da empresa na primeira partida, e é o cenário que a canonicalização assíncrona da Tarefa C4
> foi feita para produzir. A condição explícita `pilotIsNewToCompany` diz o que a regra é, em vez de
> codificá-la num aninhamento de ternários.
>
> A imprecisão residual, aceita conscientemente: um piloto que troca de empresa continua contado na
> antiga, porque decrementá-la exigiria uma segunda escrita transacional numa terceira coleção. Num
> evento de dois dias, com o formulário exigindo empresa, isso é ruído; contar zero na empresa certa
> é um bug visível no telão.

A validação (`final_score` na faixa, `telemetry` presente, `ship_spec_snapshot` presente, `pilot_id`
não vazio, `match_id` no formato UUID) roda **antes** da transação e alimenta `rejected` sem abortar o
lote — uma partida corrompida não pode impedir as outras 49 de chegarem. A checagem de formato do
`match_id` é a Tarefa C0 defendida na fronteira: se algum cliente voltar a mandar `match_${Date.now()}`,
aparece no log de rejeições em vez de virar uma colisão silenciosa.

- [ ] **Passo 6: Rodar e ver passar**

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test --workspace=packages/cloud-api
```

- [ ] **Passo 7: Bootstrap, Dockerfile e deploy**

`src/index.ts` monta o Express, aplica `isAuthorized` como middleware em `/v1/*` exceto `/v1/health`,
limita o corpo a 2 MB e registra o `ingestBatch`. O `Dockerfile` é multi-stage sobre `node:22-slim`.

`packages/cloud-api/README.md` documenta o deploy, sem nenhuma chave:

```bash
gcloud run deploy jogo-navinha-api \
  --source packages/cloud-api \
  --region southamerica-east1 \
  --service-account jogo-navinha-api@PROJETO.iam.gserviceaccount.com \
  --set-secrets BOOTH_INGEST_TOKEN=booth-ingest-token:latest \
  --no-allow-unauthenticated=false
```

A service account precisa de `roles/datastore.user` e, a partir da Tarefa C4,
`roles/aiplatform.user`. **Nenhum arquivo de chave é gerado** — o Cloud Run usa a identidade da
própria service account, e o token de ingestão vive no Secret Manager.

- [ ] **Passo 8: Commit**

```bash
git add packages/cloud-api package.json
git commit -m "feat(cloud): API de ingestão em Cloud Run com idempotência por match_id e agregados transacionais"
```

---

### Tarefa C4 — [U2] `gemini-3.7-flash` via Vertex AI: moderação bloqueante e canonicalização assíncrona

O primeiro código de modelo do projeto. Dois usos com exigências **opostas**, e confundi-los é o erro
a evitar: moderação vale a espera e falha fechada; canonicalização não vale a espera e é reconciliada
depois.

> **Restrição Global 1, repetida porque é aqui que ela se aplica:** exclusivamente
> **Vertex AI / Gemini Enterprise Agent Platform**, modelo `gemini-3.7-flash`, autenticação por ADC ou
> service account. Nada de `GEMINI_API_KEY`, nada de `generativelanguage.googleapis.com`, nada de
> `@google/generative-ai`. A biblioteca é `@google-cloud/vertexai`.
>
> **Achado durante a implementação, 2026-08-22:** `@google-cloud/vertexai` está descontinuada pelo
> próprio publicador (aviso impresso ao instanciar `VertexAI`) desde 24/06/2025, com remoção anunciada
> para 24/06/2026 — já passada nesta data. Usada mesmo assim porque é o que esta restrição nomeia, e
> nenhum teste desta tarefa chama o Vertex de verdade para confirmar se ainda responde. Ver
> [Spec 11](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md) §4.10 para o registro completo e o que fazer antes do
> evento.

**Arquivos:**
- Criar: `packages/cloud-api/src/vertex.ts`
- Criar: `packages/cloud-api/src/moderation-l2.ts`, `moderation-l2.test.ts`
- Criar: `packages/cloud-api/src/canonicalize.ts`, `canonicalize.test.ts`
- Modificar: `packages/cloud-api/src/index.ts` (rotas `/v1/moderate`, `/v1/canonicalize`)
- Modificar: `packages/daemon/src/index.ts` (chamar `/v1/moderate` em `/api/session/start`)
- Criar: `packages/daemon/src/services/remote-moderation.ts`, `remote-moderation.test.ts`

**Interfaces:**
- Produz: `POST /v1/moderate` — `{ callsign: string }` → `{ verdict: 'allow' | 'block'; reason?: string }`.
- Produz: `POST /v1/canonicalize` — `{ items: Array<{ match_id, company_raw, local_guess }> }` →
  `{ resolved: Array<{ match_id, company_canonical, confidence }> }`.
- Produz: `moderateRemotely(base, token, callsign, timeoutMs): Promise<RemoteVerdict>` no daemon,
  onde `RemoteVerdict = { verdict: 'allow' | 'block' | 'unavailable'; reason?: string }`.

- [ ] **Passo 1: Confirmar os parâmetros vigentes da API**

Antes de escrever, consultar `docs.cloud.google.com` para o `gemini-3.7-flash` em Vertex AI e anotar no
código: as regiões que o servem, o nome vigente do controle de raciocínio (`thinking_level`, que
substituiu `thinking_budget`) e a confirmação de que `temperature` / `top_p` / `top_k` **não** se
aplicam à família 3.x. Registrar a data da consulta em comentário. Um parâmetro obsoleto passado ao
Vertex é um erro em runtime, e o lugar de descobrir isso não é o estande.

- [ ] **Passo 2: Escrever o teste da moderação de camada 2, com o cliente injetado**

O teste não chama o Vertex. `moderation-l2.ts` recebe uma função `generate` por parâmetro, e o teste
passa um duplo. Isso é o que torna a política — e não a rede — testável.

Criar `packages/cloud-api/src/moderation-l2.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { moderateCallsign } from './moderation-l2.js';

const allow = async () => JSON.stringify({ safe: true, reason: '' });
const block = async () => JSON.stringify({ safe: false, reason: 'insulto velado' });
const lixo = async () => 'desculpe, não posso ajudar com isso';
const trava = () => new Promise<string>(() => {});

describe('moderateCallsign', () => {
  it('libera o que o modelo considera seguro', async () => {
    assert.equal((await moderateCallsign('SKILLER', allow, 1200)).verdict, 'allow');
  });

  it('bloqueia o que o modelo considera ofensivo', async () => {
    const r = await moderateCallsign('xxx', block, 1200);
    assert.equal(r.verdict, 'block');
    assert.equal(r.reason, 'insulto velado');
  });

  it('falha FECHADO quando a resposta do modelo não é o JSON esperado', async () => {
    assert.equal((await moderateCallsign('DUVIDOSO', lixo, 1200)).verdict, 'block');
  });

  it('falha FECHADO no timeout do modelo', async () => {
    assert.equal((await moderateCallsign('DUVIDOSO', trava, 50)).verdict, 'block');
  });
});
```

- [ ] **Passo 3: Escrever o teste do lado do daemon, que falha ABERTO**

A distinção é sutil e deliberada, e as duas especificações a definem em conjunto: a **Spec 05 §3.2**
manda falhar fechado quando o modelo responde em dúvida; a **Spec 08 §6.2** manda que a camada 1 local
prevaleça e o fluxo siga quando o Vertex está **inalcançável**. São situações diferentes: uma é o
modelo dizendo "não sei"; a outra é o estande estar offline — e um estande offline não pode parar de
receber visitantes.

Criar `packages/daemon/src/services/remote-moderation.test.ts`:

```ts
describe('moderateRemotely', () => {
  it('devolve o veredito do serviço quando ele responde', async () => { /* fetch duplo → allow/block */ });

  it('devolve "unavailable" quando a rede falha, sem lançar', async () => {
    const r = await moderateRemotely('http://inexistente.invalid', 'tok', 'PILOTO', 800);
    assert.equal(r.verdict, 'unavailable');
  });

  it('devolve "unavailable" no timeout em vez de segurar o registro', async () => { /* servidor lento */ });

  it('devolve "unavailable" quando nenhum endereço de nuvem está configurado', async () => {
    const r = await moderateRemotely(null, null, 'PILOTO', 800);
    assert.equal(r.verdict, 'unavailable');
  });
});
```

E no `POST /api/session/start`: camada 1 (`validateCallsign`, já existente e síncrona) decide primeiro;
só se ela **aprovar** é que a camada 2 é consultada; `block` recusa o registro com a razão; `allow` e
`unavailable` seguem. Registrar `unavailable` no log — se acontecer o dia inteiro, o staff precisa
saber que a moderação semântica não está atuando.

- [ ] **Passo 4: Rodar e ver falhar**

```bash
npm run test --workspace=packages/cloud-api
npm run test --workspace=packages/daemon
```

- [ ] **Passo 5: Implementar `vertex.ts`**

```ts
import { VertexAI } from '@google-cloud/vertexai';

/**
 * Cliente único do Vertex AI (Spec 08 §6.1). Autenticação por ADC — a service
 * account do Cloud Run tem roles/aiplatform.user. Nenhuma chave de API existe.
 * Parâmetros confirmados em docs.cloud.google.com em <data do Passo 1>.
 */
const vertex = new VertexAI({
  project: requireEnv('GOOGLE_CLOUD_PROJECT'),
  location: process.env.VERTEX_LOCATION || 'global'
});

export const MODEL_ID = 'gemini-3.7-flash';

/** Uma geração com saída JSON forçada por schema. Devolve o texto bruto. */
export async function generateJson(prompt: string, responseSchema: object): Promise<string> {
  const model = vertex.getGenerativeModel({
    model: MODEL_ID,
    generationConfig: { responseMimeType: 'application/json', responseSchema }
  });
  const result = await model.generateContent(prompt);
  return result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}
```

`moderation-l2.ts` implementa `moderateCallsign(callsign, generate, timeoutMs)` com
`Promise.race` contra o timeout, `JSON.parse` protegido e **qualquer** desvio caindo em `block`.

- [ ] **Passo 6: Implementar a canonicalização assíncrona com backfill**

`canonicalize.ts` recebe o lote de partidas marcadas com `needs_company_review`, monta um prompt com o
catálogo canônico e devolve `{ company_canonical, confidence }` por item. Quando a confiança supera o
limiar e o nome difere do palpite local, uma transação atualiza o documento em `matches`, **corrige os
dois agregados em `company_rankings`** — subtrai do errado, soma no certo — e limpa a marca.

O alias resolvido é devolvido ao estande por `GET /v1/aliases?since=<iso>`, e o daemon o grava em
`company_aliases`. É isso que faz o segundo visitante da mesma empresa resolver em 1ms, localmente,
sem rede — exatamente o comportamento que a Spec 05 §3.1 já descreve para o catálogo local.

O gatilho é o fim de `ingestBatch`, disparado sem `await`. **Nunca no caminho de resposta.**

- [ ] **Passo 7: Rodar, ver passar, e verificar a proibição**

```bash
npm test
grep -rniE "GEMINI_API_KEY|generativelanguage\.googleapis\.com|@google/generative-ai" . \
  --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" --include="*.sh" \
  | grep -v node_modules
```

Esperado do `grep`: **apenas** as linhas das especificações e deste plano que **proíbem** esses termos.
Qualquer ocorrência em código é violação da Restrição Global 1.

- [ ] **Passo 8: Commit**

```bash
git add packages/cloud-api/src packages/daemon/src package.json
git commit -m "feat(vertex): moderação bloqueante e canonicalização assíncrona com gemini-3.7-flash"
```

---

### Tarefa C5 — [U3] Worker de sincronização com backoff

`getPendingMatches()` e `markMatchSynced()` existem em `sqlite-buffer.ts:322,338` e **nada os chama**.
São a metade construída de uma funcionalidade: o buffer offline só é um buffer se algo o drena.

**Arquivos:**
- Criar: `packages/daemon/src/services/cloud-sync.ts`
- Criar: `packages/daemon/src/services/cloud-sync.test.ts`
- Modificar: `packages/daemon/src/index.ts`
- Modificar: `packages/daemon/src/services/sqlite-buffer.ts` (`countPending()`)

**Interfaces:**
- Produz: `class CloudSyncService` com `start()`, `stop()`, `syncNow(): Promise<SyncOutcome>` e
  `status(): { state: SyncState; pending: number; lastAttempt: string | null; lastSuccess: string | null; consecutiveFailures: number }`.
- Produz: `type SyncState = 'ok' | 'retrying' | 'auth_failed' | 'disabled'`.
- Produz: `GET /api/sync/status` no daemon — consumido pelo `self_test.sh` (Tarefa D3) e pelo painel de
  status do operador.
- Consome: `POST /v1/matches` da Tarefa C3.

> **`auth_failed` não é um estado a mais por completude.** Um `401`/`403` significa que o token de
> escopo único expirou ou foi rotacionado, e **nenhum retry vai resolver** — o backoff só cresce até o
> teto de 5 minutos, em silêncio, enquanto a fila acumula e o telão para de receber partidas. As duas
> situações exigem ações opostas do staff: "sem rede" é esperar, "token inválido" é trocar o token. Um
> estado só as torna indistinguíveis exatamente quando distingui-las importa. O achado é do
> `duboc/gemini-com-pe`, onde o análogo é uma URL assinada com TTL de 600s.

- [ ] **Passo 1: Escrever o teste**

Criar `packages/daemon/src/services/cloud-sync.test.ts`. O `fetch` é injetado no construtor, então o
teste não toca a rede:

```ts
describe('CloudSyncService', () => {
  it('envia os pendentes e marca como sincronizados apenas os aceitos', async () => {
    const buffer = fakeBufferWith(['m1', 'm2', 'm3']);
    const fetchDuplo = async () => okJson({ accepted: ['m1', 'm3'], rejected: [{ match_id: 'm2', reason: 'telemetry ausente' }] });
    const sync = new CloudSyncService(buffer, { base: 'https://api', token: 't', fetchImpl: fetchDuplo });

    await sync.syncNow();

    assert.deepEqual(buffer.markedSynced, ['m1', 'm3']);
    assert.ok(!buffer.markedSynced.includes('m2'), 'uma rejeição não pode ser marcada como sincronizada');
  });

  it('não marca nada quando a rede falha', async () => {
    const buffer = fakeBufferWith(['m1']);
    const sync = new CloudSyncService(buffer, { base: 'https://api', token: 't', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    const outcome = await sync.syncNow();
    assert.equal(outcome.status, 'failed');
    assert.deepEqual(buffer.markedSynced, []);
  });

  it('cresce o backoff a cada falha consecutiva e para no teto', () => {
    const sync = new CloudSyncService(fakeBufferWith([]), { base: 'https://api', token: 't', fetchImpl: async () => okJson({}) });
    const delays = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => sync.backoffMsFor(n));
    for (let i = 1; i < delays.length; i++) assert.ok(delays[i] >= delays[i - 1]);
    assert.ok(delays.at(-1)! <= CloudSyncService.MAX_BACKOFF_MS);
  });

  it('zera o backoff depois de um sucesso', async () => { /* falha, falha, sucesso → consecutiveFailures 0 */ });

  it('envia no máximo o tamanho do lote de uma vez', async () => {
    const buffer = fakeBufferWith(Array.from({ length: 120 }, (_, i) => `m${i}`));
    let maiorLote = 0;
    const sync = new CloudSyncService(buffer, {
      base: 'https://api', token: 't',
      fetchImpl: async (_url, init: any) => {
        const body = JSON.parse(init.body);
        maiorLote = Math.max(maiorLote, body.matches.length);
        return okJson({ accepted: body.matches.map((m: any) => m.match_id), rejected: [] });
      }
    });
    await sync.syncNow();
    assert.ok(maiorLote <= 50, `lote de ${maiorLote} excede o limite da Spec 05 §5`);
  });

  it('não faz nada, e não lança, quando não há nuvem configurada', async () => {
    const sync = new CloudSyncService(fakeBufferWith(['m1']), { base: null, token: null, fetchImpl: async () => { throw new Error('não deveria chamar'); } });
    assert.equal((await sync.syncNow()).status, 'disabled');
  });

  it('distingue token inválido de falha de rede', async () => {
    const buffer = fakeBufferWith(['m1']);
    const sync = new CloudSyncService(buffer, {
      base: 'https://api', token: 'expirado',
      fetchImpl: async () => new Response('', { status: 401 })
    });

    const outcome = await sync.syncNow();

    assert.equal(outcome.status, 'auth_failed');
    assert.equal(sync.status().state, 'auth_failed', 'o estado precisa ser visível no /api/sync/status');
    assert.deepEqual(buffer.markedSynced, [], 'nada pode ser marcado como sincronizado');
  });

  it('não deixa o estado auth_failed grudado depois que o token é corrigido', async () => {
    const buffer = fakeBufferWith(['m1']);
    let token = 'expirado';
    const sync = new CloudSyncService(buffer, {
      base: 'https://api',
      token: () => token,
      fetchImpl: async (_u, init: any) =>
        init.headers.Authorization === 'Bearer bom'
          ? okJson({ accepted: ['m1'], rejected: [] })
          : new Response('', { status: 401 })
    });

    await sync.syncNow();
    assert.equal(sync.status().state, 'auth_failed');

    token = 'bom';                       // o operador trocou o token e reiniciou nada
    await sync.syncNow();

    assert.equal(sync.status().state, 'ok');
    assert.deepEqual(buffer.markedSynced, ['m1']);
  });

  it('continua tentando mesmo em auth_failed, com o backoff no teto', async () => {
    let chamadas = 0;
    const sync = new CloudSyncService(fakeBufferWith(['m1']), {
      base: 'https://api', token: 'x',
      fetchImpl: async () => { chamadas++; return new Response('', { status: 403 }); }
    });
    await sync.syncNow();
    await sync.syncNow();
    assert.equal(chamadas, 2, 'auth_failed não pode desligar o worker: o token pode ser corrigido');
  });
});
```

O caso da nuvem não configurada é o modo em que o projeto roda hoje e vai rodar em todo
desenvolvimento local: sem nuvem configurada, o daemon precisa funcionar exatamente como antes.

Os dois últimos casos definem a semântica de `auth_failed`, que é sutil: ele **não** para o worker e
**não** é permanente. Parar seria pior que o problema — o operador troca o token no Secret Manager, o
daemon relê, e a fila tem que drenar sozinha. O que `auth_failed` faz é (a) travar o backoff no teto,
porque tentativas rápidas não vão ajudar, e (b) aparecer no `status()` como um estado que exige ação
humana. É por isso que o `token` na opção é uma função e não uma string: uma string capturada no
construtor congelaria o token expirado para sempre.

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run test --workspace=packages/daemon
```

- [ ] **Passo 3: Implementar**

Backoff exponencial com jitter, base 2s, teto 5 minutos:

```ts
  static readonly MAX_BACKOFF_MS = 5 * 60_000;
  private static readonly BASE_BACKOFF_MS = 2_000;

  /** Exponencial com jitter. O jitter evita que várias estações reconectem em uníssono. */
  backoffMsFor(consecutiveFailures: number): number {
    const raw = CloudSyncService.BASE_BACKOFF_MS * 2 ** Math.min(consecutiveFailures - 1, 10);
    const capped = Math.min(raw, CloudSyncService.MAX_BACKOFF_MS);
    return Math.round(capped * (0.8 + this.jitter() * 0.4));
  }
```

O `jitter()` é injetável para o teste ser determinístico (default `Math.random`).

A classificação da resposta, que é o que produz o estado:

```ts
  private classify(res: Response | null, erro: unknown): SyncState {
    if (erro) return 'retrying';                    // rede, DNS, timeout: transitório
    if (res!.status === 401 || res!.status === 403) return 'auth_failed';
    if (res!.ok) return 'ok';
    return 'retrying';                              // 5xx e o resto: o servidor volta
  }
```

Em `auth_failed`, `backoffMsFor` devolve direto `MAX_BACKOFF_MS`: o worker continua tentando a cada 5
minutos — porque o token pode ser corrigido a qualquer momento sem reiniciar nada — mas para de
desperdiçar tentativas rápidas num erro que nenhuma delas resolve.

- [ ] **Passo 4: Rodar e ver passar**

- [ ] **Passo 5: Ligar no daemon**

Instanciar no bootstrap, `start()` com intervalo de 30s, e um `void sync.syncNow()` **sem `await`** ao
final de `POST /api/matches` — o jogador vê o resultado imediatamente e a nuvem se resolve depois.
Acrescentar:

```ts
app.get('/api/sync/status', (_req, res) => res.json(cloudSync.status()));
```

- [ ] **Passo 6: Verificar o comportamento offline de verdade**

```bash
npm run start:daemon
curl -X POST localhost:3000/api/matches -H 'Content-Type: application/json' -d @/tmp/partida.json
curl -s localhost:3000/api/sync/status
```

Com `BOOTH_CLOUD_API_BASE` apontando para um endereço inalcançável: `pending` sobe, `lastSuccess`
permanece `null`, `consecutiveFailures` cresce, e **o `POST /api/matches` continua respondendo em
milissegundos**. É esse último ponto que o gate M3 verifica com o Wi-Fi na mão.

- [ ] **Passo 7: Commit**

```bash
git add packages/daemon/src
git commit -m "feat(daemon): worker de sincronização com backoff exponencial e status observável"
```

---

### Tarefa C6 — Placar da TV sobre o Firestore, com queda para o bridge

O `leaderboard-app` está completo em UI. O que muda é a fonte de dados: `onSnapshot` do Firestore como
caminho principal, bridge local como rede de segurança. Um telão congelado é pior que um telão alguns
segundos atrasado.

**Arquivos:**
- Criar: `packages/leaderboard-app/src/firestore-source.ts`
- Criar: `packages/leaderboard-app/src/leaderboard-source.test.ts`
- Criar: `packages/leaderboard-app/vitest.config.ts`
- Modificar: `packages/leaderboard-app/src/App.tsx`
- Modificar: `packages/leaderboard-app/package.json` (dependência `firebase`, script `test`)
- Modificar: `package.json` da raiz (incluir o pacote no `test`)

**Interfaces:**
- Produz: `subscribeToLeaderboard(handlers): () => void` — abstrai as duas fontes e devolve o
  cancelamento. `handlers = { onData(state), onSourceChange('cloud' | 'local' | 'offline') }`.
- Produz: `mergeLeaderboardState(matches, rankings): LeaderboardState` — pura, e é o que o teste cobre.

> **Dependência nova, justificada:** `firebase` (SDK cliente, apenas o módulo `firestore`) no
> `leaderboard-app`. É o único caminho para `onSnapshot`, exigido pela Spec 05 §7.2; polling a cada 3s
> num telão público é visivelmente pior. O app é hospedado, então o peso do bundle não afeta o estande.

- [ ] **Passo 1: Escrever o teste da lógica pura e da troca de fonte**

```ts
import { describe, it, expect, vi } from 'vitest';
import { mergeLeaderboardState, pickSource } from './firestore-source.js';

describe('mergeLeaderboardState', () => {
  it('ordena o top 10 por score decrescente', () => { /* … */ });
  it('trunca o hall da fama em 10 e o corporativo em 5', () => { /* … */ });
  it('ordena o ticker pelas partidas mais recentes', () => { /* … */ });
  it('sobrevive a uma coleção vazia sem quebrar as estatísticas', () => {
    const s = mergeLeaderboardState([], []);
    expect(s.stats.top_score).toBe(0);
    expect(s.topPilots).toEqual([]);
  });
});

describe('pickSource', () => {
  it('prefere a nuvem quando o Firestore está configurado e responde', () => { /* … */ });
  it('cai para o bridge local quando o Firestore não entrega snapshot no prazo', () => { /* … */ });
  it('sinaliza offline quando nenhuma das duas fontes responde', () => { /* … */ });
  it('volta para a nuvem sozinho quando o Firestore reaparece', () => { /* … */ });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run test --workspace=packages/leaderboard-app
```

- [ ] **Passo 3: Implementar**

Três consultas `onSnapshot`, com os índices criados na Tarefa C2:

```ts
  onSnapshot(query(collection(db, 'matches'), orderBy('final_score', 'desc'), limit(10)), …);
  onSnapshot(query(collection(db, 'company_rankings'), orderBy('total_score', 'desc'), limit(5)), …);
  onSnapshot(query(collection(db, 'matches'), orderBy('created_at', 'desc'), limit(12)), …);
```

A troca de fonte: se nenhum snapshot chegar em 5s, ou se o callback de erro disparar, abrir o caminho
local (`fetch` no `ENDPOINTS.bridgeBase` mais o WebSocket em `ENDPOINTS.bridgeWsUrl`) e emitir
`onSourceChange('local')`. Quando o Firestore voltar a entregar, retomar a nuvem.

Na UI, um selo discreto no cabeçalho — `NUVEM`, `LOCAL` ou `SEM SINAL` — em vez de um erro. O público
vê o placar; o staff vê o selo.

- [ ] **Passo 4: Rodar, ver passar, e verificar no emulador**

```bash
npm run test --workspace=packages/leaderboard-app
npx firebase emulators:start --only firestore &
npm run dev:leaderboard
```

Gravar uma partida pelo `cloud-api` apontado ao emulador e confirmar que a TV atualiza **sem recarregar
a página**. Depois, matar o emulador e confirmar que o selo vira `LOCAL` e o placar continua vivo pelo
bridge.

- [ ] **Passo 5: Commit**

```bash
git add packages/leaderboard-app package.json
git commit -m "feat(placar): assinar o Firestore por onSnapshot com queda automática para o bridge local"
```

---

### Tarefa C7 — Painel de administração

Promovido da Tarefa E2 (opcional, Fase E) para cá em 2026-08-22. O motivo é de custo, não de escopo:
o painel reusa o Firestore, o Cloud Run, os tipos de `@jogo/shared` e o modelo de autenticação que as
Tarefas C2 e C3 acabaram de construir. Construí-lo na Fase E significaria reabrir todos os quatro.

Também é onde mora a resposta operacional para duas coisas que hoje não têm nenhuma: **ver e corrigir
scores** e **gerenciar o catálogo de empresas** sem editar um arquivo por SSH no meio do evento.

**Arquivos:**
- Criar: `packages/admin-app/` (Vite + React, mesmo padrão do `leaderboard-app`)
- Criar: `packages/cloud-api/src/admin.ts`, `packages/cloud-api/src/admin.test.ts`
- Modificar: `packages/cloud-api/src/index.ts` (montar `/v1/admin/*`)
- Modificar: `firestore.rules` (a coleção `companies`)
- Modificar: `packages/shared/src/types/cloud.ts` (`CompanyCatalogDocument`)

**Interfaces:**
- Produz: `GET /v1/admin/matches?q=&company=&limit=` — busca por callsign ou empresa.
- Produz: `PATCH /v1/admin/matches/{match_id}` — corrige `callsign`/`company_canonical` ou marca
  `voided: true`, **sempre recalculando os agregados na mesma transação**.
- Produz: `GET|PUT /v1/admin/companies` — o catálogo canônico, agora também no Firestore.
- Produz: `GET /v1/admin/health` — fila de sync por estação, rejeições recentes, taxa de preset de
  emergência.
- Consome: tudo da Tarefa C3.

> **Autenticação: IAP na frente do Cloud Run, não uma senha.** O painel escreve no banco de produção
> durante um evento público. Uma senha em variável de ambiente é a solução que parece mais simples e
> é a que vaza — ela precisa ser digitada num navegador, no estande, na frente de visitantes. O IAP
> resolve com a conta Google de quem opera, sem nenhum segredo novo no sistema, e é configuração de
> deploy em vez de código. **O token de ingestão da Tarefa C3 não serve aqui**: ele é de escopo único
> e vive na máquina do estande, exatamente a máquina que não pode ter privilégio administrativo.
>
> **Correção, revisão final da Fase C + decisão do usuário, 2026-08-23.** A revisão final de branch
> encontrou uma contradição nesta afirmação: IAP é proteção **de todo o serviço** Cloud Run, e este
> serviço também recebe o token de ingestão do estande (Tarefa C3) — com IAP ligado, o estande é
> recusado pelo IAP antes de chegar ao token; com IAP desligado, `/v1/admin/*` fica aberto ao público.
> Decisão inicial (depois corrigida — ver o bloco abaixo, 2026-08-24): manter **um serviço só**,
> "IAP continua na frente por identidade Google, mais uma senha HTTP Basic por cima" — ver
> **Tarefa C10**.
>
> **Segunda correção, ao vivo no primeiro deploy real, 2026-08-24.** A decisão de 2026-08-23 acima
> não resolvia a contradição que ela mesma descreveu — só a escondia atrás de uma frase. IAP no
> Cloud Run é por **serviço inteiro**, sem exceção de rota: ligá-lo bloquearia `/v1/admin/*` **e**
> `/v1/matches` juntos, exatamente o problema original. Confirmado na prática: `gcloud run deploy`
> com `--no-allow-unauthenticated` rejeitava com 403 **toda** requisição, senha certa incluída,
> porque a checagem da plataforma acontece antes do código do serviço rodar. **Decisão final:**
> nesta topologia de serviço único, **não há IAP** — o Cloud Run sobe com
> `--allow-unauthenticated`, e a senha HTTP Basic (`isAdminAuthorized`, Tarefa C10) é a única
> camada de autenticação do painel, por desenho. Uma segunda camada de identidade Google exigiria
> um segundo serviço Cloud Run só para o painel — decisão de arquitetura em aberto, não algo que
> se resolve com uma flag de deploy.

> **`voided` em vez de `DELETE` — para o evento real.** Anular marca e exclui dos agregados; apagar
> destrói a evidência de que a partida existiu. Num evento onde alguém pode contestar uma pontuação, a
> diferença importa — e restaurar um documento apagado do Firestore não é uma operação que se faça com
> o estande aberto. **Exceção deliberada, Tarefa C9:** para limpar dados de teste (placares
> inconsistentes de antes desta fase, empresas fictícias), a exclusão permanente existe como uma ação
> separada e mais bem guardada — a razão de existir de `voided` (proteger o evento real) não se aplica
> a dados que o próprio operador sabe que são lixo de desenvolvimento.

- [ ] **Passo 1: Escrever o teste da correção com recálculo**

Criar `packages/cloud-api/src/admin.test.ts`. O caso central é o que torna o painel perigoso se
implementado ingenuamente — corrigir a empresa de uma partida **tem** que mexer em dois agregados:

```ts
describe('PATCH /v1/admin/matches/:id', () => {
  beforeEach(async () => { await clearFirestore(); });

  it('mover uma partida de empresa acerta os dois agregados', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', pilot_id: 'p1', final_score: 1000, company_canonical: 'Gogle' })
    ]);

    await patchMatch(testDb, 'm1', { company_canonical: 'Google' });

    const errada = await testDb.collection('company_rankings').doc('Gogle').get();
    const certa = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(errada.data()?.total_score ?? 0, 0, 'a empresa errada ficou com o score');
    assert.equal(certa.total_score, 1000);
    assert.equal(certa.pilots_count, 1);
  });

  it('anular uma partida a tira do agregado e do placar, sem apagá-la', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', final_score: 1000, company_canonical: 'Google' }),
      matchFixture({ match_id: 'm2', pilot_id: 'p2', final_score: 300, company_canonical: 'Google' })
    ]);

    await patchMatch(testDb, 'm1', { voided: true });

    const rank = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(rank.total_score, 300);
    assert.equal(rank.top_individual_score, 300, 'o recorde precisa cair junto');
    const doc = await testDb.collection('matches').doc('m1').get();
    assert.ok(doc.exists, 'anular não apaga');
    assert.equal(doc.data()!.voided, true);
  });

  it('anular duas vezes não desconta duas vezes', async () => {
    await ingestBatch(testDb, [matchFixture({ match_id: 'm1', final_score: 1000, company_canonical: 'Google' })]);
    await patchMatch(testDb, 'm1', { voided: true });
    await patchMatch(testDb, 'm1', { voided: true });
    const rank = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(rank.total_score, 0);
  });

  it('recusa uma correção que deixaria o score fora da faixa plausível', async () => {
    await ingestBatch(testDb, [matchFixture({ match_id: 'm1', final_score: 1000 })]);
    await assert.rejects(() => patchMatch(testDb, 'm1', { final_score: 9_000_000 }), /score/i);
  });
});
```

O terceiro caso é o mesmo raciocínio da idempotência da C3, aplicado ao caminho inverso: o operador
vai clicar duas vezes.

> **`top_individual_score` é o campo que não sobrevive a uma anulação por decremento.** `total_score`
> e `pilots_count` dá para ajustar aritmeticamente; um máximo, não — anular o recordista exige
> descobrir quem é o segundo. Por isso `patchMatch` **recalcula os agregados da empresa afetada
> varrendo as partidas dela**, dentro da transação, em vez de aplicar deltas. A Spec 05 §4.3 proíbe
> recálculo por varredura no caminho de **ingestão**, que é quente e roda 500 vezes; o caminho
> administrativo é frio, roda um punhado de vezes no evento inteiro, e é o único lugar onde a varredura
> é a implementação correta.

- [ ] **Passo 2: Rodar e ver falhar**

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test --workspace=packages/cloud-api
```

- [ ] **Passo 3: Implementar `admin.ts`**

`patchMatch(db, matchId, changes)` numa transação: lê a partida, aplica as mudanças validadas, e
recalcula do zero os agregados de **toda** empresa afetada — a antiga e a nova, quando a empresa muda.
`listMatches` usa o helper `field<MatchDocument>(...)` da Tarefa C2 em toda ordenação e filtro.

O catálogo de empresas ganha um documento `companies/catalog` no Firestore, com `PUT` pelo painel. O
daemon continua lendo `config/companies.json` (Tarefa C0b) como fonte local e offline; o Firestore é
a cópia que o painel edita, e a reconciliação entre as duas é **manual e explícita** — um botão
"exportar para o estande" que gera o JSON. Sincronizar as duas automaticamente criaria um segundo
canal nuvem→estande, que a Spec 05 §5 evita de propósito.

- [ ] **Passo 4: O app**

`packages/admin-app`, quatro telas e nada mais: **Partidas** (tabela com busca, editar, anular),
**Empresas** (lista editável, exportar JSON), **Saúde** (fila de sync por estação, rejeições, taxa de
preset de emergência) e **Rankings** (só leitura, para conferir o efeito de uma correção).

Sem tema neon, sem animação: é ferramenta de operador, e legibilidade sob pressa vale mais que
estética. Reusa `@jogo/shared` e o `ENDPOINTS` da Tarefa C1.

- [ ] **Passo 5: Regras e deploy**

Em `firestore.rules`, `companies` entra como **leitura pública** (o estande pode querer buscá-la) e
escrita negada, como as outras três. O painel escreve pelo Admin SDK, como todo o resto.

Servir o `admin-app` pelo **mesmo** container Cloud Run da API, sob `/admin` — um serviço a menos
para provisionar. **Sem IAP** (corrigido na Tarefa C10, 2026-08-24): a senha HTTP Basic protege
`/admin` e `/v1/admin/*` de uma vez, e o serviço sobe com `--allow-unauthenticated`.

- [ ] **Passo 6: Rodar e ver passar**

- [ ] **Passo 7: Commit**

```bash
git add packages/admin-app packages/cloud-api/src firestore.rules \
        packages/shared/src/types/cloud.ts package.json
git commit -m "feat(admin): painel de operação com correção de partidas e catálogo de empresas"
```

---

> **Revisão pré-Gate M3, 2026-08-23.** A revisão final de branch da Fase C encontrou 5 defeitos
> críticos de integração entre tarefas (todos corrigidos, ver histórico de commits) e deixou dois
> itens em aberto para decisão do usuário: a autenticação do painel de admin, e a lacuna da Spec 11
> §4.11 (`company_raw`/`company_confidence`/`score_breakdown` nunca chegam ao Firestore). As três
> tarefas abaixo fecham os dois itens, mais um pedido novo de limpeza de dados de teste.

### Tarefa C8 — `company_raw`, `company_confidence` e `score_breakdown` chegam ao Firestore (fecha Spec 11 §4.11)

O dado já existe no momento certo em quase todo lugar — só é descartado um passo adiante.
`packages/player-app/src/App.tsx:112-126` já tem `pilot.company_raw` (do registro,
`RegistrationForm.tsx:56`) e já calcula `result.breakdown`, mas o objeto enviado a
`POST /api/matches` não inclui nenhum dos dois. `packages/daemon/src/services/sqlite-buffer.ts:260-289`
(`resolveCompany`) já calcula confiança via `resolveCompanyFromCatalog` e devolve só o nome canônico,
descartando o número.

**Arquivos:**
- Modificar: `packages/daemon/src/services/sqlite-buffer.ts` (`resolveCompany`, schema de
  `local_matches`, `saveMatch`, `getPendingMatches`, `countPending`)
- Modificar: `packages/daemon/src/index.ts` (handler de `/api/session/start`)
- Modificar: `packages/shared/src/types/ship.ts` (`MatchRecord`, `PilotInfo`)
- Modificar: `packages/player-app/src/App.tsx` (`handleMatchComplete`)
- Criar: `scripts/reset_local_db.sh`

**Interfaces:**
- Muda: `resolveCompany(raw: string): string` → `resolveCompany(raw: string): { canonical: string; confidence: number }`. Único chamador atual é `daemon/src/index.ts:253` — atualizar junto.
- Produz: `MatchRecord` ganha `company_raw: string`, `company_confidence: number`,
  `score_breakdown: ScoreBreakdown`, `needs_company_review?: boolean` (derivado de
  `company_confidence < 0.80`, o mesmo limiar de `resolveCompanyFromCatalog`).
- Produz: `PilotInfo` ganha `company_confidence?: number`, devolvido pelo daemon na resposta de
  `/api/session/start` e guardado no estado do cliente.

- [ ] **Passo 1: Escrever os testes**

`sqlite-buffer.test.ts`: `resolveCompany('Gooogle')` devolve `{ canonical: 'Google', confidence: ≥0.8 }`;
uma entrada nova de catálogo (`matchedBy: 'fallback'`) devolve confiança baixa; um alias já em cache
devolve confiança `1.0` (é curado, não há dúvida a marcar). `App.tsx`'s teste de match_id (ou um novo)
confirma que `company_raw`/`score_breakdown` chegam no corpo de `POST /api/matches`.

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar**

`resolveCompany` devolve o par; o cache de alias (`company_aliases`) não guarda confiança — um hit de
cache é, por construção, uma resolução já aceita antes, então trate como confiança `1.0`.
`local_matches` ganha as colunas correspondentes (`company_raw TEXT`, `company_confidence REAL`,
`score_breakdown_json TEXT`, `needs_company_review INTEGER DEFAULT 0`). **Sem migração**: dados de
teste anteriores a esta tarefa são descartáveis (ver `reset_local_db.sh` abaixo) — `CREATE TABLE IF
NOT EXISTS` com o schema novo já resolve bancos novos; um banco antigo precisa ser apagado, não
migrado.

`scripts/reset_local_db.sh`: apaga o arquivo SQLite do estande (caminho de `BOOTH_DB_PATH`, default
documentado em `USER_GUIDE.md`) depois de confirmar com o operador (`read -p "Apagar TUDO em $DB?
(s/N)"`). Existe porque "apagar e deixar reseedar" é mais seguro do que uma migração escrita às
pressas para dados que ninguém precisa preservar.

- [ ] **Passo 4: Rodar e ver passar; rodar `npm test`**

- [ ] **Passo 5: Commit**

```bash
git add packages/daemon/src packages/shared/src/types/ship.ts packages/player-app/src \
        scripts/reset_local_db.sh
git commit -m "feat(sync): levar company_raw, confiança e score_breakdown até o Firestore"
```

---

### Tarefa C9 — Ações em lote no painel: anular e excluir partidas de teste

Duas ações, deliberadamente separadas — **anular continua não-destrutivo** (é o mecanismo certo para
corrigir uma pontuação durante o evento real); **excluir** é novo, permanente, e existe para limpar
dados de teste (placares inconsistentes de antes dos fixes, empresas fictícias) sem deixá-los
acumulados como "ANULADA" para sempre.

**Arquivos:**
- Modificar: `packages/admin-app/src/components/MatchesScreen.tsx` (checkboxes, seleção múltipla,
  duas ações em lote)
- Modificar: `packages/admin-app/src/api.ts` (`bulkUpdateMatches`)
- Criar: `packages/cloud-api/src/admin.ts` — `deleteMatch(db, matchId)` e `bulkPatchOrDelete`
- Criar/Modificar: `packages/cloud-api/src/admin.test.ts`
- Modificar: `packages/cloud-api/src/index.ts` (rota `POST /v1/admin/matches/bulk`)

**Interfaces:**
- Produz: `POST /v1/admin/matches/bulk` — corpo `{ match_ids: string[]; action: 'void' | 'delete' }`.
  Resposta `{ succeeded: string[]; failed: Array<{ match_id: string; reason: string }> }` — o mesmo
  padrão de lote parcial que `POST /v1/matches` já usa, para uma partida com problema não travar as
  outras 49.
- Produz: `deleteMatch(db, matchId): Promise<void>` — transação que **apaga de verdade** o documento
  em `matches/{id}` e recalcula do zero (varredura, mesmo mecanismo de `patchMatch`) os agregados de
  `company_rankings` e `pilots` da partida removida. Diferente de `patchMatch({voided: true})`: aqui o
  documento não sobra.

- [ ] **Passo 1: Escrever o teste do delete com recálculo**

Mesmo formato dos testes de `patchMatch` (Tarefa C7): `ingestBatch` duas partidas da mesma empresa,
`deleteMatch` uma delas, confirmar que `company_rankings` reflete só a que sobrou e que o documento
apagado realmente não existe mais (`get().exists === false`, ao contrário do teste de anulação que
afirma o oposto).

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar `deleteMatch` e a rota em lote**

A rota em lote chama `patchMatch`/`deleteMatch` por item, um por vez, capturando erro individual —
reusa a lógica já testada da Tarefa C7 em vez de duplicá-la. Se o volume de uso real mostrar que
recalcular a mesma empresa dezenas de vezes em sequência é lento, otimizar depois é uma tarefa
separada; não vale complicar isto agora para um caso de uso de limpeza pontual.

- [ ] **Passo 4: A tela**

`MatchesScreen.tsx`: checkbox por linha, "selecionar todas" no cabeçalho, duas ações que aparecem
quando há seleção — **"Anular selecionadas"** (mesmo `window.confirm` de hoje) e **"Excluir
definitivamente"**, com confirmação reforçada: o operador digita a palavra `EXCLUIR` num campo antes
do botão habilitar. Depois de qualquer ação em lote, `runSearch()` de novo para refletir o estado.

- [ ] **Passo 5: Rodar, ver passar, commit**

```bash
git add packages/admin-app/src packages/cloud-api/src
git commit -m "feat(admin): ações em lote — anular e excluir partidas, com confirmação reforçada para exclusão"
```

---

### Tarefa C10 — Senha do painel de admin, sem IAP, um serviço só

Fecha o achado crítico da revisão final: `/v1/admin/*` não tinha autenticação própria, e IAP sozinho
não convive com o token do estande no mesmo serviço Cloud Run. Decisão original (**corrigida ao vivo
no primeiro deploy real, 2026-08-24** — ver a nota na Tarefa C7): IAP no Cloud Run é por serviço
inteiro, sem exceção de rota, então não há como usá-lo aqui sem bloquear `/v1/matches` junto. A
decisão final é **sem IAP**: o Cloud Run sobe com `--allow-unauthenticated`, e uma senha HTTP Basic
é a **única** camada de autenticação do painel — comparação em tempo constante, mesmo padrão de
`auth.ts`, sem sessão, sem cookie, sem dependência nova. O navegador mostra o prompt nativo de login
sozinho.

**Arquivos:**
- Criar: `packages/cloud-api/src/admin-auth.ts`, `admin-auth.test.ts`
- Modificar: `packages/cloud-api/src/index.ts` (middleware antes das rotas `/v1/admin/*` e do bloco
  estático de `/admin`)
- Modificar: `packages/cloud-api/.env.example`, `README.md`

**Interfaces:**
- Produz: `isAdminAuthorized(header: string | undefined, expected: string | undefined): boolean` —
  decodifica `Authorization: Basic <base64(usuario:senha)>`, ignora o usuário (qualquer valor serve),
  compara a senha em tempo constante contra `ADMIN_PANEL_PASSWORD`. Servidor sem a variável
  configurada recusa tudo, mesmo padrão de `isAuthorized`.

- [ ] **Passo 1: Escrever o teste**

Mesmos três casos de `auth.test.ts` (Tarefa C3), adaptados: aceita a senha certa; recusa senha errada,
cabeçalho ausente, ou esquema errado (`Bearer` em vez de `Basic`); recusa tudo quando o servidor sobe
sem `ADMIN_PANEL_PASSWORD`.

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar**

```ts
import { timingSafeEqual } from 'node:crypto';

export function isAdminAuthorized(header: string | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const password = decoded.slice(decoded.indexOf(':') + 1);
  const given = Buffer.from(password);
  const want = Buffer.from(expected);
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}
```

Em `index.ts`, um middleware aplicado antes de **todas** as rotas `/v1/admin/*` e antes do bloco
`express.static('/admin', …)` — sem isso, o painel serve os arquivos estáticos sem senha nenhuma e só
protege a API. Resposta de recusa: `401` com cabeçalho `WWW-Authenticate: Basic realm="admin"`, para o
navegador saber que deve mostrar o prompt.

- [ ] **Passo 4: Rodar e ver passar**

- [ ] **Passo 5: Documentar e commit**

`ADMIN_PANEL_PASSWORD` em `.env.example` e no `README.md`, com nota: guardar no Secret Manager como
`--set-secrets ADMIN_PANEL_PASSWORD=admin-panel-password:latest`, nunca em texto puro no deploy.

```bash
git add packages/cloud-api
git commit -m "feat(admin): senha HTTP Basic na frente do painel, além do IAP"
```

---

> ### Gate M3 — nuvem, no Mac, com o Wi-Fi na mão
>
> ```bash
> npx firebase emulators:start --only firestore     # primeiro no emulador
> npm run build && npm test
> npm run start:daemon
> ```
>
> Depois, repetir contra o projeto real. Você precisa observar:
>
> - Uma partida concluída aparece no telão em menos de 1s.
> - No Firestore, `telemetry` e `ship_spec_snapshot` estão **preenchidos**, e o mesmo `pilot_id` liga o
>   registro à partida.
> - **Abra um documento `matches/{id}` real e confira os 13 campos de `MatchDocument`, não só os
>   dois de cima.** `score_breakdown`, `company_raw` e `company_confidence` são gravados hoje pelo
>   caminho local (Fase A) e **não** chegam ao Firestore — Spec 11 §4.11. Se este item falhar, é o
>   sinal de que a Tarefa C8 (ou a extensão da C3/C7 que a §4.11 propõe) precisa acontecer antes do
>   evento, não depois.
> - **Desligue o Wi-Fi no meio de uma partida.** O jogo não trava, o debrief aparece normalmente, e
>   `GET /api/sync/status` mostra `pending: 1`.
> - **Religue.** Em menos de 60s o registro aparece no Firestore, **uma única vez**. Repita o envio
>   manualmente e confirme que `company_rankings` **não** soma de novo.
> - Tentar `db.collection('matches').doc('x').set({…})` pelo console do navegador retorna
>   `PERMISSION_DENIED`.
> - Um callsign ofensivo é recusado **pela API**, não só pelo formulário. `SKILLER` é aceito.
> - **Um nome de empresa ofensivo não chega ao telão** — vira `Independente` (Tarefa C0b). `Startup do
>   João`, que também não está no catálogo, aparece normalmente.
> - **O auto-complete devolve as empresas do `config/companies.json`.** Acrescente uma empresa ao
>   arquivo, reinicie o daemon, e confirme que ela aparece na digitação — sem rebuild.
> - **Todo documento gravado tem `schema_version: 1`** e um `match_id` em formato UUID.
> - **O banco `(default)` de `vibe-cabral` continua sem nenhuma coleção nossa.** Conferir no console
>   depois da primeira gravação real; é a única forma de pegar um `getFirestore()` sem o nome do banco.
> - **Simule o token expirado:** troque `BOOTH_INGEST_TOKEN` por lixo com partidas pendentes.
>   `GET /api/sync/status` mostra `state: "auth_failed"`, e **não** `retrying`. Corrija o token e
>   confirme que a fila drena sozinha, sem reiniciar o daemon.
> - **No painel de admin:** mova uma partida de empresa e confirme que os dois agregados acertam;
>   anule uma partida do recordista e confirme que `top_individual_score` cai para o segundo colocado.
> - **Sem a senha do painel, `/admin` e `/v1/admin/*` recusam com 401** — teste antes de configurar
>   `ADMIN_PANEL_PASSWORD`, depois confirme que a senha certa entra (Tarefa C10).
> - **Selecione três partidas de teste no painel e exclua em lote** — confirme que os documentos
>   somem de verdade (não ficam `ANULADA`) e que `company_rankings` reflete só o que sobrou
>   (Tarefa C9).
> - **Abra o SQLite do estande depois de uma partida** e confirme `company_raw`, `company_confidence`
>   e `score_breakdown` preenchidos — não só no Firestore, na origem (Tarefa C8).
> - A verificação de 10 minutos da [Spec 08](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) §5: abrir o
>   `leaderboard-app` hospedado, forçar a queda para o bridge local e **registrar a versão exata do
>   Chrome** no resultado. Se o Chrome bloquear a chamada à rede local, o fallback passa a ser um
>   snapshot em cache no próprio Firestore — decida isso aqui, não no dia do evento.

---

## Fase D — Operação do estande: 8 horas sem intervenção

Fecha D11, U4, U5 e U6. É a fase que separa "funciona na minha máquina" de "funciona por oito horas
com 150 visitantes e dois atendentes que não são engenheiros".

### Tarefa D1 — Runbook e cartão de falhas

Escrito **antes** dos scripts, porque o `self_test.sh` da Tarefa D3 implementa a checklist daqui, e
porque o staff precisa do documento mesmo que algum script falhe.

**Arquivos:**
- Criar: `RUNBOOK.md` (raiz, ao lado de `USER_GUIDE.md`, seguindo a convenção do repositório)
- Modificar: `USER_GUIDE.md` (apontar para o runbook)
- Modificar: `README.md` (índice)

Conteúdo, sem nenhuma seção vaga:

1. **Abertura (T-30min):** ligar, `./scripts/setup_monitors.sh`, `./scripts/self_test.sh`,
   `./scripts/launch_kiosks.sh`, conferir o selo do placar, jogar uma partida de teste e
   **`./scripts/reset_booth.sh` para apagá-la** antes da abertura.
2. **Ciclo normal:** os 7 passos do visitante, com o tempo esperado de cada um.
3. **Cartão de falhas** — uma tabela de sintoma → ação, em uma página, para imprimir e deixar no
   balcão:

| Sintoma | Ação imediata |
| :--- | :--- |
| Visitante foi embora no meio | Nada. O watchdog reseta sozinho (30s a 120s conforme a etapa). |
| Terminal travado, nave não sai | Aguardar 15s: o preset de emergência entra sozinho. Se não entrar, `./scripts/reset_booth.sh`. |
| Tela 1 congelada | `Ctrl+Shift+F12`. Se o foco estiver na Tela 2, `./scripts/reset_booth.sh`. |
| Placar parado | Olhar o selo: `LOCAL` é degradação esperada; `SEM SINAL` pede verificar a rede. |
| Fila de pendentes crescendo | `curl -s localhost:3000/api/sync/status`. Normal offline; avisar se passar de 50. |
| `sync/status` diz `auth_failed` | **Não é a rede.** O token de ingestão expirou ou foi rotacionado. Trocar `BOOTH_INGEST_TOKEN` e aguardar até 5min — a fila drena sozinha, sem reiniciar. |
| **Todo visitante recebe nave de preset** | Credencial do AGY expirada. Ver §6 do runbook: reautenticar e reiniciar o supervisor. |
| Nada responde | `npm run kill:daemon && npm run start:daemon`, depois `./scripts/self_test.sh`. |

4. **Encerramento:** conferir `pending: 0`, rodar o `self_test.sh` uma última vez e **exportar o
   SQLite** — é a cópia de segurança dos dados do dia.
5. **Contatos e escalonamento.**
6. **Reautenticação do AGY** — ver o quadro abaixo. Procedimento manual, exato, com os comandos
   completos, porque quem vai executá-lo está com o estande aberto.

> **Risco conhecido e aceito em 2026-08-22: a credencial local do AGY não se renova sozinha.**
>
> O repositório não configura credencial nenhuma para o `agy`. O `booth-terminal.sh:130-135` faz
> `exec agy` e herda o ambiente do shell — nenhuma referência a `GOOGLE_CLOUD_PROJECT`,
> `GOOGLE_APPLICATION_CREDENTIALS` ou `GOOGLE_GENAI_USE_VERTEXAI` existe no projeto. Funciona hoje
> porque a máquina de desenvolvimento está autenticada.
>
> As duas specs também se contradizem: a [Spec 06](./06_RELIABILITY_FAILOVER_AND_SECURITY_SPEC.md)
> §2.1.4 pede "ADC de **conta de serviço** com escopo mínimo", e a
> [Spec 08](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) §6.1 proíbe "**nenhum arquivo de chave** na
> máquina do estande". As duas juntas só são satisfeitas por Workload Identity Federation ou
> impersonação — nenhuma das quais está planejada, e ambas precisam de uma credencial de usuário para
> começar.
>
> **O modo de falha é silencioso e total.** Token expira ou a política da organização força reauth no
> meio do dia; o `agy` para de responder; o timeout de 15s da Tarefa A4 dispara; **todo visitante a
> partir dali recebe preset de emergência**. O jogo continua funcionando perfeitamente — o que morre é
> a Forja, que é a razão de o estande existir. Ninguém percebe olhando a tela.
>
> **Decisão: registrar, não automatizar** (2026-08-22). A automação exige descobrir o que o `agy` de
> fato aceita e o que a política do projeto permite, e isso não cabe antes da Fase C fechar. O que
> entra no lugar:
>
> 1. O item 2 do `self_test.sh` (§3.6 da Spec 06) já checa a validade da credencial na abertura. Ele
>    passa a imprimir **quanto tempo falta** para expirar, não só PASS/FAIL — uma credencial que vence
>    às 14h passa no teste das 8h.
> 2. Esta seção do runbook, com o procedimento manual de reautenticação.
> 3. A entrada correspondente na [Spec 11](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md) §4, para não desaparecer.
> 4. O sintoma "todo visitante recebe nave de preset" no cartão de falhas — porque a falha não se
>    anuncia, e quem estiver no balcão precisa saber ligar o sintoma à causa.
>
> Reavaliar se o hardware do estande for definido antes do evento: numa máquina gerenciada, a resposta
> pode ser trivial.

- [ ] **Passo 1: Escrever o `RUNBOOK.md`** com as cinco seções acima, sem remissões a documentos que o
      staff não vai ler no meio do evento. Números concretos, comandos completos, sem "verifique se
      está tudo certo".
- [ ] **Passo 2: Ligar a partir do `README.md` e do `USER_GUIDE.md`.**
- [ ] **Passo 3: Commit**

```bash
git add RUNBOOK.md README.md USER_GUIDE.md
git commit -m "docs: runbook de operação do estande e cartão de falhas de uma página"
```

---

### Tarefa D2 — [D11] Os quatro watchdogs anti-abandono

Um visitante que desiste no meio congela a estação até intervenção humana. Com ordem de 150 sessões
por dia, isso acontece — e o único recurso hoje é um hotkey que **não funciona quando o foco está na
Tela 2**, que é exatamente quando o staff mais precisa dele.

> **Conflito de números a resolver nesta tarefa.** A [Spec 01](./01_BOOTH_AND_EXPERIENCE_SPEC.md) §4.1
> diz registro 30s, builder 45s, forja 30s e gameplay 15s sem input. A
> [Spec 06](./06_RELIABILITY_FAILOVER_AND_SECURITY_SPEC.md) §1.2 diz registro 60s, builder 120s, forja
> 15s e debrief 45s. **Prevalece a Spec 06**, por três razões: os prazos dela são compatíveis com um
> visitante que está lendo a tela pela primeira vez; a forja em 15s casa com o temporizador de silêncio
> já construído na Tarefa A4; e não existe watchdog de gameplay, porque a partida tem fim próprio de 90
> segundos. Atualizar a Spec 01 §4.1 no mesmo commit — deixar as duas tabelas divergentes é recriar,
> em documentação, o defeito D14.

| Etapa | Inatividade | Ação |
| :--- | :--- | :--- |
| `REGISTER` | 60s | Volta para `ATTRACT` |
| `BUILDER` | 120s | Volta para `ATTRACT` |
| `HANDOFF` / forja | 15s sem spec | Preset de emergência (já implementado na Tarefa A4) |
| `DEBRIEF` | 45s | Envia a partida e volta para `ATTRACT` |

> Os nomes das etapas são os do tipo `AppStage` real em `App.tsx:13` — `'ATTRACT' | 'REGISTER' |
> 'INSTRUCTIONS' | 'BUILDER' | 'HANDOFF' | 'GAMEPLAY' | 'DEBRIEF'`. As especificações 01 e 06 falam em
> "registro" e "gameplay"; o `Record<AppStage, …>` abaixo precisa das chaves exatas, senão não compila.

**Arquivos:**
- Criar: `packages/player-app/src/hooks/useIdleWatchdog.ts`
- Criar: `packages/player-app/src/hooks/useIdleWatchdog.test.ts`
- Modificar: `packages/player-app/src/App.tsx`
- Modificar: `specs/01_BOOTH_AND_EXPERIENCE_SPEC.md` §4.1

**Interfaces:**
- Produz: `useIdleWatchdog({ enabled, timeoutMs, onTimeout, warnAtMs?, onWarn? }): { remainingMs }`.
- Produz: `WATCHDOG_TIMEOUTS: Record<AppStage, number | null>` — `null` onde não há watchdog.

- [ ] **Passo 1: Escrever o teste com temporizadores falsos**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleWatchdog } from './useIdleWatchdog.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useIdleWatchdog', () => {
  it('dispara depois do tempo sem interação', () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleWatchdog({ enabled: true, timeoutMs: 60_000, onTimeout }));
    act(() => { vi.advanceTimersByTime(59_999); });
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('rearma a cada interação do visitante', () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleWatchdog({ enabled: true, timeoutMs: 60_000, onTimeout }));
    for (let i = 0; i < 5; i++) {
      act(() => { vi.advanceTimersByTime(50_000); window.dispatchEvent(new Event('keydown')); });
    }
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('avisa antes de resetar, para o visitante poder cancelar', () => {
    const onWarn = vi.fn();
    renderHook(() => useIdleWatchdog({ enabled: true, timeoutMs: 60_000, warnAtMs: 10_000, onWarn, onTimeout: vi.fn() }));
    act(() => { vi.advanceTimersByTime(50_001); });
    expect(onWarn).toHaveBeenCalledTimes(1);
  });

  it('não dispara nada quando desabilitado', () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleWatchdog({ enabled: false, timeoutMs: 1_000, onTimeout }));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('limpa os temporizadores ao desmontar', () => {
    const onTimeout = vi.fn();
    const { unmount } = renderHook(() => useIdleWatchdog({ enabled: true, timeoutMs: 1_000, onTimeout }));
    unmount();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('dispara apenas uma vez, mesmo se o tempo continuar correndo', () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleWatchdog({ enabled: true, timeoutMs: 1_000, onTimeout }));
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});
```

> **Dependências novas, justificadas:** `@testing-library/react` e `jsdom` como `devDependencies` do
> `player-app`. Um watchdog é lógica de temporizador acoplada a eventos de `window`; testá-lo sem
> renderizar o hook seria testar outra coisa. Já existe `vitest` desde a Tarefa A1.

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npm run test --workspace=packages/player-app
```

- [ ] **Passo 3: Implementar o hook**

Escuta `keydown`, `pointerdown` e `touchstart` no `window`; rearma em cada um; usa `useRef` para o
identificador do temporizador e `useEffect` com limpeza. O aviso é um segundo temporizador em
`timeoutMs - warnAtMs`.

- [ ] **Passo 4: Ligar no `App.tsx`**

```tsx
const WATCHDOG_TIMEOUTS: Record<AppStage, number | null> = {
  ATTRACT: null,          // a tela de atração é o destino, não tem para onde voltar
  REGISTER: 60_000,
  INSTRUCTIONS: null,     // etapa de leitura, com botão explícito de avançar
  BUILDER: 120_000,
  HANDOFF: null,          // coberto pelo temporizador de silêncio do daemon (Tarefa A4)
  GAMEPLAY: null,         // a partida tem fim próprio em 90s
  DEBRIEF: 45_000
};

useIdleWatchdog({
  enabled: WATCHDOG_TIMEOUTS[stage] !== null,
  timeoutMs: WATCHDOG_TIMEOUTS[stage] ?? 0,
  warnAtMs: 10_000,
  onWarn: () => setIdleWarning(true),
  onTimeout: () => { if (stage === 'DEBRIEF') void submitMatch(); handleReset(); }
});
```

O aviso é um overlay em português: *"Ainda por aí? A estação será liberada em 10 segundos."* Qualquer
tecla o dispensa. O `DEBRIEF` **envia a partida antes** de resetar — o visitante que se distraiu não
perde a pontuação que conquistou.

- [ ] **Passo 5: Rodar e ver passar; depois verificar à mão**

```bash
npm run test --workspace=packages/player-app
npm run start:daemon
```

Abrir o app, parar na tela de registro e **não tocar em nada**. Aos 50s o aviso aparece; aos 60s a tela
volta para `ATTRACT`. Repetir no builder (120s) e no debrief (45s), confirmando que a partida chegou ao
placar antes do reset.

- [ ] **Passo 6: Commit**

```bash
git add packages/player-app/src packages/player-app/package.json specs/01_BOOTH_AND_EXPERIENCE_SPEC.md
git commit -m "feat(estande): watchdogs anti-abandono por etapa com aviso antes do reset"
```

---

### Tarefa D3 — [U4, U5] Os quatro scripts de operação

Nenhum existe. São o que permite que o estande seja operado por alguém que não escreveu o código.

> **Portabilidade não é detalhe aqui** ([Spec 06](./06_RELIABILITY_FAILOVER_AND_SECURITY_SPEC.md) §3.2):
> os ensaios acontecem em macOS e o hardware do evento é desconhecido. Cada script **detecta a
> plataforma e aborta com mensagem clara** quando uma etapa não se aplica. Um script que "roda" sem
> efeito em macOS só é descoberto no dia do evento — abortar com erro é estritamente melhor.

**Arquivos:**
- Criar: `scripts/setup_monitors.sh`, `scripts/launch_kiosks.sh`, `scripts/reset_booth.sh`,
  `scripts/self_test.sh`
- Criar: `scripts/lib/platform.sh` (detecção comum, `sourced` pelos quatro)
- Criar: `scripts/self_test.test.sh` (verificação do próprio autoteste)
- Modificar: `package.json` da raiz (`self-test`, `reset:booth`)

- [ ] **Passo 1: A biblioteca comum**

`scripts/lib/platform.sh` exporta `BOOTH_OS` (`macos` | `linux` | `outro`), `chrome_cmd()`,
`require_cmd()` e `say_pass` / `say_fail` com código de saída acumulado. Os quatro scripts a carregam.

Exporta também os dois caminhos que os scripts compartilham com o daemon, com os **mesmos defaults** já
usados em `daemon/src/index.ts:28` e `booth-terminal.sh:8` — divergir aqui faz o reset limpar um
diretório que não é o da sessão:

```sh
export SESSION_DIR="${BOOTH_SESSION_DIR:-/tmp/booth_session}"
export BRIDGE_BASE="${BOOTH_BRIDGE_BASE:-http://localhost:3000}"
```

- [ ] **Passo 2: `setup_monitors.sh`**

Linux: `xrandr` posicionando Tela 1 e Tela 2 lado a lado e verificando a resolução. macOS:
`displayplacer` se existir; senão, imprime as instruções de Ajustes do Sistema e sai com código 0 —
não é falha, é uma etapa manual. A TV do placar **não entra aqui**: é um dispositivo independente que
abre uma URL hospedada.

- [ ] **Passo 3: `launch_kiosks.sh`**

Sobe o Chrome em modo kiosk apontando para **`http://localhost:3000`** — o `player-app` servido pelo
bridge (Tarefa C1) — com `--autoplay-policy=no-user-gesture-required`, necessário porque o áudio é
síntese WebAudio (**P8**) e precisa de gesto para destravar. `--user-data-dir` separado por superfície,
para os perfis não brigarem. Verifica antes que `GET /api/health` responde; se não responder, aborta
dizendo para subir o daemon primeiro.

- [ ] **Passo 4: `reset_booth.sh`**

O caminho de recuperação que funciona **com o foco fora do navegador** — a razão de existir do script:

```bash
curl -s -X POST "$BRIDGE_BASE/api/session/reset" >/dev/null
# Encerra o process group do agy pelo PGID gravado pela Tarefa A5.
if [ -f "$SESSION_DIR/.agy_pid" ]; then
  PGID=$(cat "$SESSION_DIR/.agy_pid")
  kill -INT  "-$PGID" 2>/dev/null || true
  sleep 1
  kill -KILL "-$PGID" 2>/dev/null || true
fi
pkill -f 'mcps/dist' 2>/dev/null || true   # rede de segurança para MCPs órfãos
find "$SESSION_DIR" -mindepth 1 -delete 2>/dev/null || true   # esvazia sem remover o diretório
```

O `find -mindepth 1 -delete` preserva o inode do diretório porque o shell da Tela 2 o tem como `cwd` —
removê-lo deixa o supervisor em um diretório que não existe mais. O script termina confirmando na saída
que nenhum processo MCP restou, e **não** usa `pkill -f "node-pty"`, que nunca existiu neste projeto.

- [ ] **Passo 5: `self_test.sh`**

As oito verificações da [Spec 06](./06_RELIABILITY_FAILOVER_AND_SECURITY_SPEC.md) §3.6, cada uma
imprimindo `PASS` ou `FAIL` e o script saindo diferente de zero se qualquer uma falhar:

1. Os três servidores MCP sobem e respondem a um `tools/list`.
2. `agy --version` responde e a credencial do Vertex AI está válida
   (`gcloud auth application-default print-access-token` devolve token).
3. Uma sessão de ponta a ponta gera um `ship_spec.json` que **passa na validação de schema** e tem
   entradas correspondentes em `mcp_audit.log`.
4. O SQLite é gravável, está no caminho esperado, e **não contém nenhum `match_id` começando com
   `seed_`** (fecha o laço de D6, que a Tarefa A6 colocou atrás de flag).
5. `GET /api/sync/status` responde, e a fila de pendentes é **impressa** — para o staff perceber
   acúmulo antes do fim do evento, não depois.
6. As duas telas estão na resolução esperada.
7. `jq` está instalado — o `booth-terminal.sh` depende dele e degrada em silêncio sem ele.
8. `pgrep -f 'mcps/dist'` está vazio: nenhum órfão de execuções anteriores.

Note o que **saiu** da lista original: a verificação de sound sprites do Howler.js, que testaria uma
biblioteca que o projeto não usa e que a Tarefa A8 removeu (**P8**).

- [ ] **Passo 6: Verificar os scripts no Mac**

```bash
chmod +x scripts/*.sh
./scripts/self_test.sh; echo "código de saída: $?"
./scripts/reset_booth.sh
```

Esperado: o `self_test.sh` imprime oito linhas, e cada `FAIL` diz **o que** falhou e **o que fazer**.
Em macOS, a verificação de monitores pode legitimamente reportar que é manual. Depois do
`reset_booth.sh`, `pgrep -f 'mcps/dist'` não retorna nada e `ls -a /tmp/booth_session` mostra o
diretório vazio, **mas existente**.

- [ ] **Passo 7: Commit**

```bash
git add scripts package.json
git commit -m "feat(estande): scripts de monitores, kiosk, reset de emergência e autoteste matinal"
```

---

### Tarefa D4 — [U6] Soak de 100 partidas

O critério de 8 horas contínuas não pode ser verificado sentando no estande por 8 horas. O soak
comprime o dia inteiro em minutos e mede as três coisas que degradam: memória do daemon, contagem de
processos e tempo de ciclo.

**Arquivos:**
- Criar: `scripts/soak_matches.mjs`
- Criar: `scripts/soak-report.test.mjs`
- Modificar: `package.json` da raiz (`soak:matches`)
- Modificar: `RUNBOOK.md` (quando rodar o soak)

**Interfaces:**
- Produz: `soak-report.json` — `{ cycles, durations_ms[], rss_mb[], mcp_process_counts[], failures[] }`.
- Produz: `analyzeSoak(report): { leaking: boolean; orphaning: boolean; slowing: boolean; summary: string }`,
  função pura e testável separada do laço que a alimenta.

- [ ] **Passo 1: Escrever o teste da análise**

O laço de 100 ciclos não é testável em CI, mas o **julgamento** sobre os números é — e é onde mora a
decisão de aprovar ou não.

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSoak } from './soak_matches.mjs';

describe('analyzeSoak', () => {
  it('acusa vazamento quando a memória cresce de forma monotônica', () => {
    const r = analyzeSoak({ rss_mb: Array.from({ length: 100 }, (_, i) => 80 + i * 2), mcp_process_counts: Array(100).fill(0), durations_ms: Array(100).fill(1000), failures: [] });
    assert.equal(r.leaking, true);
  });

  it('aceita oscilação de memória sem tendência', () => {
    const r = analyzeSoak({ rss_mb: Array.from({ length: 100 }, (_, i) => 80 + (i % 7)), mcp_process_counts: Array(100).fill(0), durations_ms: Array(100).fill(1000), failures: [] });
    assert.equal(r.leaking, false);
  });

  it('acusa órfãos quando a contagem de MCPs não volta a zero', () => {
    const r = analyzeSoak({ rss_mb: Array(100).fill(80), mcp_process_counts: Array.from({ length: 100 }, (_, i) => Math.floor(i / 10)), durations_ms: Array(100).fill(1000), failures: [] });
    assert.equal(r.orphaning, true);
  });

  it('acusa lentidão progressiva quando o último decil é muito pior que o primeiro', () => {
    const durations_ms = [...Array(90).fill(1000), ...Array(10).fill(4000)];
    const r = analyzeSoak({ rss_mb: Array(100).fill(80), mcp_process_counts: Array(100).fill(0), durations_ms, failures: [] });
    assert.equal(r.slowing, true);
  });

  it('aprova um relatório saudável', () => {
    const r = analyzeSoak({ rss_mb: Array(100).fill(82), mcp_process_counts: Array(100).fill(0), durations_ms: Array(100).fill(1100), failures: [] });
    assert.deepEqual([r.leaking, r.orphaning, r.slowing], [false, false, false]);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test scripts/soak-report.test.mjs
```

- [ ] **Passo 3: Implementar**

O laço, por ciclo: `POST /api/session/start` com um piloto sintético, escrever um `mcp_audit.log` e um
`ship_spec.json` válido direto no diretório de sessão (o soak exercita o **daemon**, não o `agy` — que
depende de rede e de um modelo, e cujo tempo dominaria a medição), aguardar o `EVENT_SHIP_READY` pelo
WebSocket, `POST /api/matches` com telemetria completa, `POST /api/session/reset`, e amostrar
`process.resourceUsage` do daemon por `GET /api/health` estendido mais `pgrep -cf 'mcps/dist'`.

A análise: regressão linear simples sobre `rss_mb` para `leaking`; qualquer amostra de
`mcp_process_counts` maior que zero **após** o reset para `orphaning`; mediana do último decil acima de
2× a do primeiro para `slowing`.

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test scripts/soak-report.test.mjs
```

- [ ] **Passo 5: Rodar o soak de verdade**

```bash
npm run start:daemon
npm run soak:matches
```

Esperado: 100 ciclos completos, `soak-report.json` gravado, e os três indicadores em `false`. Se algum
vier `true`, **o gate M5 não passou** — o relatório aponta qual, e a investigação começa pelo D4 (kill
de process group) ou pelo watcher do chokidar, que são os dois candidatos históricos.

- [ ] **Passo 6: Commit**

```bash
git add scripts/soak_matches.mjs scripts/soak-report.test.mjs package.json RUNBOOK.md
git commit -m "test(carga): soak de 100 partidas com análise de vazamento, órfãos e degradação"
```

---

> ### Gates M4 e M5 — ensaio completo no Mac
>
> **M4 — as três superfícies, com cronômetro na mão:**
>
> ```bash
> ./scripts/setup_monitors.sh
> npm run start:daemon
> ./scripts/self_test.sh
> ./scripts/launch_kiosks.sh
> npm run start:terminal
> ```
>
> - Um ciclo completo de visitante, do registro ao debrief, em **2m00s a 2m45s**. Cronometre de verdade.
> - Peça a alguém que **não** conhece o projeto para fazer o ciclo sem instruções suas. Onde essa pessoa
>   hesitar é onde o estande vai formar fila.
> - Abandone de propósito em cada etapa e confirme os quatro watchdogs, um a um.
> - `./scripts/reset_booth.sh` **com o foco no terminal da Tela 2** — o caso que o hotkey não cobre.
> - **20 ciclos seguidos.** Ao final, `pgrep -f 'mcps/dist'` vazio e `ps -o pid,pgid,command -ax | grep agy`
>   sem sobras.
>
> **M5 — soak:**
>
> ```bash
> npm run soak:matches
> ```
>
> 100 partidas consecutivas. `leaking`, `orphaning` e `slowing` todos `false`. Memória do daemon e
> contagem de processos estáveis do primeiro ao último ciclo.

---

## Fase E — Opcional, só com os gates M0 a M5 fechados

Nada aqui é necessário para o evento. Se o cronograma apertar, **esta fase é a que se corta** — e
cortá-la não deixa nenhum critério da Definition of Done em aberto.

### Tarefa E1 — [L1] A qualidade do prompt influencia a nave

O `INITIAL_IDEA` pedia, na linha 5: *"melhor prompt, melhor nave"*. O requisito nunca chegou a
nenhuma das especificações 01–07 e nunca foi implementado. É o único achado de requisito perdido da
auditoria, e é a ideia mais interessante do projeto inteiro: transforma o Fast Grill-Me de um
formulário de duas perguntas em algo que premia quem escreve bem.

**Desenho mínimo, que não coloca o SLA em risco:**

O visitante ganha **um campo de texto livre opcional** no builder — *"Descreva sua nave para o
engenheiro"*, com limite de 200 caracteres. O texto entra no `GEMINI.md` gerado, e uma chamada em
Cloud Run pontua a **especificidade** do prompt de 0 a 3, convertida em um bônus de score na faixa de
`BALANCE.score.synergy_bonus`.

Três decisões que tornam isso seguro:
1. **O campo é opcional.** Deixá-lo vazio não penaliza ninguém — o multiplicador base é 1,0.
2. **A pontuação é assíncrona**, pelo mesmo caminho da canonicalização (Tarefa C4). O visitante nunca
   espera pelo modelo.
3. **O texto passa pela moderação da Tarefa C4 antes de qualquer coisa**, porque vai para o `GEMINI.md`
   e para o telão. Um campo livre em um estande público sem moderação é um incidente esperando
   acontecer.

**Arquivos:** `packages/cloud-api/src/prompt-score.ts` e teste; `packages/shared/src/game/prompt-bonus.ts`
e teste; `EnergySlidersBuilder.tsx`; `workspace-generator.ts`; `balance.ts` (a faixa do bônus).

- [ ] **Passo 1:** Teste da conversão pura `promptScoreToBonus(0..3)` — monotônica, limitada e com 0
      para prompt ausente.
- [ ] **Passo 2:** Rodar e ver falhar.
- [ ] **Passo 3:** Implementar a conversão e a rubrica de pontuação (especificidade, não tamanho: um
      prompt de 200 caracteres genéricos vale menos que 40 caracteres precisos).
- [ ] **Passo 4:** Rodar e ver passar.
- [ ] **Passo 5:** Ligar o campo no builder, o texto no `GEMINI.md` e o bônus no debrief, mostrando ao
      visitante **por que** ganhou o bônus — sem essa devolutiva, o mecanismo é invisível e não ensina
      nada.
- [ ] **Passo 6:** Rodar `npm run sim:balance` de novo. O bônus mexe na distribuição de score; se
      empurrar a taxa de vitória para fora da banda, ajustar a faixa do bônus, não a banda.
- [ ] **Passo 7:** Commit — `feat(forja): bônus de score por qualidade do prompt do piloto`.

---

### ~~Tarefa E2 — Painel de administração (opcional)~~ → **promovida à Tarefa C7**

Movida para a Fase C em 2026-08-22. O argumento original desta entrada era que o painel "só faz
sentido com mais de uma estação", porque o `self_test.sh` e o `GET /api/sync/status` cobririam a mesma
necessidade mais barato. Isso continua verdade para a parte de **monitoramento** — e é falso para as
duas necessidades que apareceram depois: **ver e corrigir scores** e **gerenciar o catálogo de
empresas**. Nenhum script de estande faz nenhuma das duas, e as duas valem com uma estação só.

O custo também mudou de sinal: o painel reusa o Firestore, o Cloud Run, os tipos compartilhados e o
modelo de autenticação que as Tarefas C2 e C3 constroem. Feito na Fase C, é incremental; feito aqui,
seria reabrir quatro tarefas fechadas. O escopo completo está na **Tarefa C7**.

O único item da lista original que **não** migrou é o **botão de reset remoto por estação**, que
depende dos watchdogs da Tarefa D2 e continua condicionado a existir mais de uma estação.

---

## Sequenciamento

A ordem entre fases é rígida em dois pontos e flexível no resto:

- **A antes de C**, sem exceção: sincronizar telemetria vazia para o Firestore produz dados
  irrecuperáveis. Este é o acoplamento mais caro de errar em todo o plano.
- **B1 antes de tudo em B**, porque `balance.ts` é o que as outras sete tarefas consomem.
- **B antes de D4**, porque o soak usa o `ship_spec.json` gerado a partir das faixas do schema.

Fora isso, **A e B são independentes** e podem ser tocadas em paralelo por duas pessoas: a Fase A
mexe no daemon e nos scripts, a Fase B no `player-app`, no `shared` e no `sim`. Os pontos de contato
são três, todos previstos: `fallback-presets.ts` (A4 escreve, B2 corrige as faixas), `App.tsx` (A7 e
B3), e `balance.ts` (B1 cria, A3 passa a interpolar via B2).

A Fase C depende de credenciais de GCP e da criação do projeto — **encaminhe isso durante a Fase A**,
porque o tempo de provisionamento não é tempo de engenharia e não deveria bloquear ninguém.

### Ordem dentro da Fase C (revisada em 2026-08-23)

```
C0  →  C0b  →  C1  →  C2  →  C3  →  C4  →  C5  →  C6  →  C7  →  C8  →  C9  →  C10  →  Gate M3
```

Onde a ordem é obrigatória, e por quê:

- **C0 antes da C2, sem exceção.** Depois da C2 o `match_id` está gravado no Firestore como ID de
  documento, e trocá-lo deixa de ser uma linha e vira uma migração. É o mesmo tipo de acoplamento que
  "A antes de C", em escala menor.
- **C2 antes da C3.** A C3 escreve os tipos e o banco que a C2 define.
- **C3 antes da C5.** O worker consome `POST /v1/matches`.
- **C7 depois da C3.** O painel reusa a transação de agregados; escrevê-lo antes duplicaria a lógica.
- **C8 antes da C9.** Sem `company_raw`/`company_confidence`/`score_breakdown` chegando ao Firestore,
  não há nada de novo para o painel exibir — mas C9 não *depende* tecnicamente de C8 (a exclusão em
  lote funciona nos campos que já existem hoje); a ordem aqui é só para testar a limpeza de dados já
  com o schema final, evitando testar duas vezes.
- **C9 depois da C7.** Reusa `patchMatch`/a lógica de recálculo que a C7 já escreveu e testou.

Onde a ordem é conveniência, e pode ser trocada:

- **C0b** pode ir a qualquer momento antes do Gate M3 — não toca em nada de nuvem. Está no começo
  porque é barata e porque o catálogo de empresas do evento é a coisa que mais provavelmente vai
  chegar atrasada de fora.
- **C4** é a única tarefa que exige o Vertex funcionando. Se a região ou o modelo demorarem a
  resolver, ela pode escorregar para depois da C6 sem bloquear nada: a moderação camada 1 e a
  canonicalização local já funcionam sem ela.
- **C6 e C7** são independentes entre si e podem ir em paralelo — uma é leitura por `onSnapshot`, a
  outra é escrita administrativa pela API.
- **C10 pode ir a qualquer momento depois da C7** — é só um middleware novo na frente de rotas que já
  existem. Está por último porque fechar a autenticação é a última coisa que faz sentido testar, uma
  vez que todo o resto do painel já está estável.

**Pré-requisito de ferramenta — resolvido em 2026-08-22:** as Tarefas C2, C3 e C7 testam contra o
emulador do Firestore, que precisa de uma JRE. Instalada e confirmada: `default-jre-headless`,
OpenJDK 21.0.11. Numa máquina nova, `sudo apt install -y default-jre-headless`; sem ela, três tarefas
ficam sem como rodar seus testes.

---

## Critérios de Conclusão

O plano está completo quando os oito itens da Definition of Done da
[Spec 07](./07_IMPLEMENTATION_ROADMAP_AND_TASKS_SPEC.md) §5 estão verificados nos gates M0 a M5, e:

- [ ] Os 32 IDs da [Spec 00](./00_AUDIT_AND_DRIFT_REPORT.md) estão fechados, cada um pela tarefa
      indicada na tabela de alocação.
- [ ] As tarefas sem ID de auditoria (C0, C0b, C6, C7 e as da Fase B vindas da Spec 09) estão
      fechadas, cada uma com a origem registrada na tabela da seção anterior.
- [ ] `npm test` na raiz cobre `shared`, `mcps`, `daemon`, `player-app`, `leaderboard-app`, `sim`,
      `cloud-api` e `admin-app`, e **falha** quando um deles falha.
- [ ] `grep -rn "localhost:3000" packages/*/src` não retorna nada.
- [ ] `grep -rniE "GEMINI_API_KEY|generativelanguage|@google/generative-ai"` retorna apenas as linhas
      que proíbem esses termos.
- [ ] A taxa de vitória medida está entre 15% e 25%, travada por teste em CI.
- [ ] `RUNBOOK.md` foi lido por quem vai operar o estande, e não por quem o escreveu.

