# Spec 00: Auditoria de Divergência entre Especificação e Implementação

> **Status:** AUDITORIA EXECUTADA — 2026-08-10
> **Objetivo:** Registrar, com evidência rastreável (`arquivo:linha`), toda divergência entre as
> especificações 01–07 e o código efetivamente entregue em `packages/`, classificando cada item como
> **defeito**, **pivô aceito**, **não construído** ou **requisito perdido**.

---

## 1. Método e Escopo

A auditoria leu integralmente as 7 especificações, o `USER_GUIDE.md`, o `INITIAL_IDEA.md`, os 44
commits do histórico e as ≈7.800 linhas de código dos 5 pacotes (`shared`, `mcps`, `daemon`,
`player-app`, `leaderboard-app`).

**Regra de arbitragem adotada (caso a caso):**

- Onde a implementação divergiu por **decisão deliberada de engenharia**, o código é a verdade e a
  especificação é reescrita — classificado como **Pivô (P)**.
- Onde a especificação define uma **salvaguarda de qualidade ausente**, a especificação é a verdade e
  a lacuna vira dívida rastreada — classificado como **Defeito (D)**.
- Onde a especificação exige um subsistema **inteiramente inexistente**, classificado como **Não
  Construído (U)**.
- Onde o `INITIAL_IDEA.md` pede algo que **nunca chegou a nenhuma especificação**, classificado como
  **Requisito Perdido (L)**.

Cada item recebe um ID estável. As especificações reconciliadas e o plano de implementação
(`10_IMPLEMENTATION_PLAN.md`) referenciam esses IDs — nenhum achado pode ser silenciosamente perdido.

> **Nota de estado:** o repositório foi auditado estaticamente. `node_modules/` não estava instalado e
> nenhum `dist/` existia no momento da leitura, portanto build e testes não foram executados. O Gate
> **M0** do plano de implementação existe justamente para fechar essa lacuna.

---

## 2. Defeitos (D) — a especificação está certa, o código precisa mudar

| ID | Defeito | Evidência | Cláusula violada |
| :--- | :--- | :--- | :--- |
| **D1** | Validação de schema nunca executa | `daemon/src/services/file-watcher.ts:4,113,147` | 03 §3.3, §5.2 |
| **D2** | Sem timeout de 15s do AGY nem injeção automática de preset | ausente no daemon; só botão manual em `HandoffTerminalScreen.tsx:433` | 06 §1.1, 03 §3.3 |
| **D3** | Sem gate de auditoria MCP antes da decolagem | `file-watcher.ts:86` | 02 §3.2, 03 §3.3 |
| **D4** | Reset mata PID único, não o process group | `daemon/src/index.ts:194-209` | 03 §5.1, §6 |
| **D5** | Telemetria calculada e depois descartada | `player-app/src/App.tsx:112-133`, `sqlite-buffer.ts:232-250` | 05 §3.2 |
| **D6** | Placar público nasce com 3 pilotos fictícios | `sqlite-buffer.ts:55,102` | 05 §4 |
| **D7** | `localhost:3000` fixo no código de 4 arquivos | ver §2.7 | 08 (nova) |
| **D8** | `npm test` não executa os testes do `player-app` | `package.json:16`, `player-app/package.json:10` | 07 §3 |
| **D9** | Caminho do SQLite depende do diretório de invocação | `sqlite-buffer.ts:46` | 06 §1.2 |
| **D10** | Código morto que sugere funcionalidade inexistente | `sqlite-buffer.ts:322,338`; `player-app/package.json:14` | 06 §1.2, 07 §1 |
| **D11** | Nenhum watchdog anti-abandono; hotkey só no browser | `player-app/src/App.tsx:53-62` | 01 §4.1, §4.2 |
| **D12** | **Nenhuma nave possível derrota o boss no tempo disponível** | aritmética em §2.11 | 04 §7 |
| **D13** | Armas secundárias são inertes ou quase | `WeaponSystem.ts:100-166`, `MainGameScene.ts:638` | 02 §2, 04 §3 |
| **D14** | Três contratos numéricos incompatíveis para os mesmos atributos | schema × `file-watcher.ts:193-209` × `WeaponSystem.ts:64-74` | 03 §4, 02 §1 |
| **D15** | A matriz de sinergias não tem nenhum efeito no jogo | `MainGameScene.ts:423,520,598` | 02 §6 |
| **D16** | O `GEMINI.md` gerado entrega ao modelo um `ship_spec.json` já preenchido | `workspace-generator.ts:170-208` | 03 §3.1 |
| **D17** | O `svg_path_data` gerado pelo `aesthetic-designer` nunca é renderizado | `ShipTextureFactory.ts:17-145` | 04 §1, 02 §2 |

### 2.1. D1 — O contrato "estrito" nunca é aplicado

`file-watcher.ts:4` importa `validateShipSpecification`, mas **a função nunca é chamada**. O caminho
real (`checkAndProcessSpecFile`, linha 113) delega tudo a `normalizeSpec()` (linha 147), que parte de
`FALLBACK_PRESETS.interceptor` e coage qualquer JSON recebido para um formato plausível via cadeias
de `||` e `Math.max/min`.

Consequência: o schema Draft-07 de `shared/src/schema/ship_spec.schema.json` (110 linhas) é **código
morto fora do próprio teste unitário**, e o critério de aceitação da Spec 03 §7 — *"o `ship_spec.json`
passa 100% das vezes na validação de schema estrito"* — é vacuamente verdadeiro: nada é validado.

Efeito colateral relevante: `normalizeSpec` também **mascara falhas do AGY**. Um arquivo vazio de
conteúdo semântico vira uma nave jogável, então o operador nunca descobre que o harness parou de
funcionar.

### 2.2. D2 — Não existe o timeout que sustenta a resiliência

A Spec 06 §1.1 define timeout rígido de 15s com injeção de preset em <50ms. No daemon não há
temporizador algum: `fileWatcher.startWatching()` (`index.ts:122`) observa indefinidamente. O único
caminho de recuperação é o visitante clicar em um botão de emergência
(`HandoffTerminalScreen.tsx:433`) — ou seja, a resiliência depende de o próprio visitante perceber a
falha, exatamente o oposto da "transição transparente" especificada.

### 2.3. D3 — A camada 4 do protocolo anti-alucinação não existe

`checkAndProcessAuditLog` (linha 86) apenas lê `mcp_audit.log` e retransmite eventos para a UI. Não há
verificação de que as tools dos MCPs ativos foram efetivamente executadas. Combinado com **D1**, o
"Protocolo de Execução em 4 Camadas" (Spec 02 §3) opera com 3 camadas: se o modelo alucinar o
`ship_spec.json` inteiro sem chamar nenhuma tool, a nave decola normalmente.

### 2.4. D4 — Encerramento deixa órfãos

`index.ts:194-209` lê `.agy_pid` e envia `SIGINT`, seguido de `SIGKILL` após 600ms, **para um único
PID**. A Spec 03 §5.1 exige `process.kill(-pgid, 'SIGKILL')` com `{ detached: true }` precisamente
porque os 3 servidores MCP são processos-filho stdio do AGY. Como estão hoje, podem sobreviver ao pai.

Isso ataca diretamente o critério de aceitação da Spec 03 §7 — *"em nenhuma circunstância o
encerramento deixa processos Node.js de MCPs ativos"* — e o de 8 horas contínuas da Spec 06 §4. Com
≈150 sessões em um dia de evento, o vazamento é cumulativo.

### 2.5. D5 — A telemetria existe, é calculada e é jogada fora

`ScoreCalculator` rastreia `totalKills`, `damageTakenCount`, `shotsFired` e `shotsHit`. Mas
`handleMatchComplete` (`App.tsx:112`) monta o registro apenas com `match_id`, `callsign`,
`company_canonical`, `final_score`, `created_at`, `victory` e `breakdown`.

Em `saveMatch` (`sqlite-buffer.ts:232`) os campos ausentes caem nos defaults defensivos
`match.telemetry || {}` e `match.ship_spec_snapshot || {}`. **Não há erro** — apenas persistência de
`{}` em `telemetry_json` e `ship_spec_json` para toda partida real. Além disso `pilot_id` é sintetizado
por partida (`pilot_${Date.now()}`), tornando impossível a coleção `pilots` da Spec 05 §3.1 e qualquer
noção de piloto recorrente.

O tipo `MatchRecord` (`shared/src/types/ship.ts:91`) declara `telemetry` e `ship_spec_snapshot` como
obrigatórios; o produtor simplesmente não os envia e o TypeScript não reclama porque o payload
atravessa uma fronteira `fetch`/JSON não tipada.

### 2.6. D6 — Pilotos fictícios no telão público

`seedInitialLeaderboard()` (`sqlite-buffer.ts:102`, chamado incondicionalmente na linha 55) insere
`CYBER_ACE` (48.500), `NEO_PILOT` (44.200) e `QUANTUM_VIPER` (39.800) sempre que a tabela
`local_matches` está vazia. No dia do evento, a TV pública abre exibindo três pilotos que não existem,
com pontuações altas o bastante para dominar o Top 10 por boa parte da manhã.

Ótimo para desenvolvimento, inaceitável em produção sem uma flag explícita.

### 2.7. D7 — Endpoints fixos impedem qualquer deploy hospedado

Nove ocorrências de `localhost:3000` em quatro arquivos:

- `player-app/src/App.tsx:88,126,141`
- `player-app/src/components/RegistrationForm.tsx:19`
- `player-app/src/components/HandoffTerminalScreen.tsx:46,71,79`
- `leaderboard-app/src/App.tsx:42,65`

Nenhum uso de `import.meta.env` existe nos dois frontends (apenas o daemon lê `process.env`). Este é o
bloqueador mecânico para a estratégia cloud-first da Spec 08.

### 2.8. D8 — A suíte de testes esconde que não roda

O script raiz (`package.json:16`) cobre `shared`, `mcps` e `daemon`, mas **não** `player-app`. E o
script do próprio pacote é:

```
node --loader ts-node/esm --test src/game/scoring/ScoreCalculator.test.ts 2>/dev/null || node --test
```

`ts-node` não consta das dependências, então o primeiro comando falha; o `2>/dev/null` engole o erro e
o `|| node --test` sai com sucesso sem executar nada. `ScoreCalculator.test.ts` (54 linhas) **nunca
roda** e sempre "passa".

Prova direta: o teste ainda afirma os valores anteriores ao rebalanceamento (**P5**) e teria **quatro
asserções falhando** se executasse:

| Linha | Teste afirma | Código produz |
| :--- | :--- | :--- |
| `:38` | `bossBonus === 5000` | `10000` |
| `:39` | `timeBonus === 15 × 50` | `15 × 80` |
| `:40` | `survivalBonus === 3000` | `3 × 1200 = 3600` |
| `:41` | `synergyBonus === 1500` | `2000` |

Ou seja, a suíte não está apenas incompleta: ela está **vermelha e silenciada**.

Cobertura real hoje: 4 arquivos de teste, nenhum cobrindo `MainGameScene` (931 linhas), `BossOverlord`,
`WeaponSystem`, `file-watcher` ou `workspace-generator`. Não há CI.

### 2.9. D9 e D10 — Configuração e código morto

- **D9:** `constructor(dbPath = './booth_local.sqlite')` resolve relativo ao *cwd* de invocação; o
  `USER_GUIDE.md:151` documenta `packages/daemon/data/booth_buffer.sqlite`. Iniciar o daemon de outro
  diretório cria um banco novo e vazio — e o `.gitignore` cobre `*.sqlite`, então o arquivo perdido
  passa despercebido.
- **D10:** `getPendingMatches()` (322), `markMatchSynced()` (338) e a coluna `synced_to_cloud` existem
  sem nenhum worker que os consuma. `howler` e `@types/howler` são dependências declaradas
  (`player-app/package.json:14,21`) e **nunca importadas** — o áudio é um sintetizador WebAudio
  próprio (`AudioManager.ts`, 430 linhas). Ambos sugerem funcionalidade que não existe.

### 2.10. D11 — Sem proteção contra abandono

A Spec 01 §4.1 define quatro watchdogs (registro 30s, builder 45s, terminal 30s, gameplay 15s).
**Nenhum existe.** Um visitante que desiste no meio congela a estação até intervenção humana.

O reset por `Ctrl+Shift+F12` está implementado apenas como listener de `window` (`App.tsx:53-62`),
inoperante se o foco estiver no terminal da Tela 2 ou em qualquer outra janela — justamente os
cenários em que o staff precisaria dele.

### 2.11. D12 — O boss é matematicamente invencível para todos os presets

Este é o achado mais grave da auditoria, e só aparece ao fazer a conta. A cadeia de dano é:

1. `WeaponSystem.firePrimary` (`:64,73`) trava a cadência em `min(12, max(5, fire_rate))` e o dano em
   `min(45, max(15, damage))`. O `vulcan_spread` divide em 3 projéteis de `round(dano × 0,65)`.
2. `BossOverlord.takeDamage` (`:302,306`) trava **cada projétil** em `min(45, dano)` e aplica
   mitigação de fase: ×0,50 na fase 1, ×0,70 na fase 2, ×1,0 na fase 3.
3. O boss entra aos 45s de uma partida de 90s (`MainGameScene.ts:188`) — restam **45 segundos**, dos
   quais **4s são de invulnerabilidade** nas duas transições de fase (`BossOverlord.ts:353`).
4. São 15.000 HP repartidos em 5.100 (fase 1) + 4.950 (fase 2) + 4.950 (fase 3).

Aplicando isso aos três presets de fallback (`shared/src/constants/fallback-presets.ts`):

| Preset | Arma efetiva após travas | DPS fase 1 / 2 / 3 | TTK do boss | Janela disponível |
| :--- | :--- | :--- | :--- | :--- |
| `interceptor` | laser 15 dmg @ 12/s | 96 / 132 / 180 | **≈122s** | 45s |
| `vanguard` | plasma 40 dmg @ 5/s | 100 / 140 / 200 | **≈115s** | 45s |
| `striker` | vulcan 3 × 12 @ 5/s | 90 / 120 / 180 | **≈130s** | 45s |

**A taxa de vitória dos três presets é exatamente 0%** — não "baixa", não "difícil": impossível, por
um fator de ≈2,7×. E como o preset `interceptor` é também o ponto de partida de `normalizeSpec`
(**D1**), toda nave malformada herda esse perfil.

No melhor caso que as travas permitem (dano 45, cadência 12/s):

- `vulcan_spread` com os 3 projéteis acertando: TTK ≈ 21s + 4s → vence com folga confortável.
- `laser`/`plasma` de projétil único: TTK ≈ 40,6s + 4s = **44,6s** contra uma janela de 45s, ou seja,
  exige 100% de uptime de tiro e 100% de precisão para vencer por 0,4s.

A dificuldade real não é uma curva de 15–25%: é um **penhasco binário** determinado quase inteiramente
pelo tipo de arma primária. O critério de aceitação da Spec 04 §7 não está apenas não verificado
(**P3**) — está violado. A Spec 09 existe para tornar esta conta executável em CI em vez de manual.

### 2.12. D13 — A arma secundária quase não existe

Quatro falhas independentes se acumulam em `WeaponSystem`:

- **Sem colisão contra inimigos comuns.** `setupCollisions` (`MainGameScene.ts:638-702`) registra
  overlap de `primaryBullets` × `enemies`, mas **nunca** de `secondaryMissiles` × `enemies`. A única
  sobreposição de mísseis registrada é contra o boss (`:331`). Nos primeiros 45s de partida, a
  secundária não pode causar dano algum.
- **Dois dos quatro tipos não fazem nada.** `fireSecondary` (`:111-116`) trata `homing_missiles` e
  `emp_burst`; `drone_escort` cai fora de todos os ramos. E `triggerEmpBurst` (`:157-166`) apenas
  desenha um círculo animado — o parâmetro `damage` é recebido e ignorado. O preset `vanguard`
  (`emp_burst`) e o `striker` (`drone_escort`) têm secundária de dano zero.
- **"Homing" não persegue.** `spawnMissile` (`:146`) aceita `targets` e o ignora, disparando com
  velocidade fixa `(±100, -300)`. A ≈540px de distância vertical do boss, isso resulta em ≈180px de
  desvio lateral contra um alvo de 150px de meia-largura: os mísseis passam ao largo por padrão.
- **O pool esgota e nunca se recicla.** `WeaponSystem.update()` (`:168-178`) limpa apenas
  `primaryBullets`. Mísseis que saem da tela permanecem `active` para sempre e o pool de 20
  (`:29`) se esgota após 10 disparos, silenciando a arma pelo resto da partida.

Resultado: a escolha de arma secundária no builder — parte da proposta de valor do estande — é
praticamente decorativa.

### 2.13. D14 — Três contratos numéricos disputando os mesmos campos

O mesmo atributo tem três faixas diferentes em três camadas:

| Campo | Schema Draft-07 | `normalizeSpec` (daemon) | `WeaponSystem` (engine) |
| :--- | :--- | :--- | :--- |
| `primary.damage` | 10 – 60 | *sem trava* | **15 – 45** |
| `primary.fire_rate` | 2 – 60 | 1 – 25 | **5 – 12** |
| `max_hp` | 2 – 5 | 1 – 10 | — |
| `speed_px_s` | 180 – 380 | 150 – 500 | — |
| `hitbox_radius` | 8 – 16 | 5 – 25 | — |
| `secondary.cooldown_seconds` | 0 – 20 | 1 – 10 | — |

A camada que efetivamente decide é a mais restritiva e a menos documentada. Uma cadência de 60 tiros/s
— valor que o próprio preset `interceptor` declara e que o schema autoriza — vira 12. Isso significa
que **a maior parte do espaço de escolha oferecido ao visitante é descartada antes de chegar ao jogo**:
os sliders de energia e as respostas dos MCPs movem números que a engine trunca.

Isso corrói diretamente a premissa do `INITIAL_IDEA` (*"melhor prompt, melhor nave"*, ver **L1**) e
precisa ser resolvido como um contrato único — que é o primeiro entregável da Spec 09.

### 2.14. D15 — As sinergias são inteiramente decorativas

A Spec 02 §6 define uma matriz formal de quatro sinergias com modificadores matemáticos precisos
(*Glass Cannon* +30% de dano com HP travado em 2, *Titan Fortress* HP 5 + 2 escudos + regeneração,
etc.). A cadeia existe quase inteira:

- O builder detecta e exibe a sinergia ativa (`EnergySlidersBuilder.tsx:45-56`).
- O MCP `cybernetics-shields` a calcula e a retorna (`cybernetics-shields.ts:80-96`).
- Ela é gravada em `build_metadata.synergies_unlocked` e faz parte do schema.

**E então nada a lê.** `grep` por `synergies_unlocked` no diretório `game/` não retorna nada: nenhum
modificador de atributo é aplicado em `PlayerShip`, `WeaponSystem` ou `MainGameScene`. O único uso do
conceito é `synergyBonusUnlocked: this.isVictory` (`MainGameScene.ts:598`) — que **não consulta a
sinergia**, apenas repete se o jogador venceu. Na prática, os 2.000 pontos de "bônus de sinergia" são
um segundo bônus de vitória, somado ao `bossBonus` de 10.000.

Consequência para a ativação: o visitante escolhe MCPs e sub-agentes, vê uma sinergia ser anunciada na
tela, vê o agente calculá-la no terminal — e ela não muda absolutamente nada na nave que ele pilota.
Junto com **D14**, é o segundo mecanismo pelo qual a escolha do visitante deixa de importar.

### 2.15. D16 — O prompt de anti-alucinação ensina o modelo a alucinar

A Spec 03 §3.1 define como primeira salvaguarda uma regra literal no `GEMINI.md`: *"PROIBIDO INVENTAR
VALORES: você NÃO tem permissão para gerar parâmetros numéricos ou SVG diretamente."* Essa frase
**não existe no template gerado** (`workspace-generator.ts:136-210`). A camada 1 do protocolo de
quatro camadas nunca foi implementada.

O que existe no lugar dela é pior que a ausência. O template termina com um **exemplo completo e
preenchido** do artefato final — `damage: 35`, `fire_rate: 10`, `max_hp: 4`, `shield_capacity: 2`,
`speed_px_s: 350`, as três cores, um `svg_path_data` válido e `"synergies_unlocked": ["Glass Cannon 🔥"]`
— seguido de *"É CRÍTICO QUE O ARQUIVO `ship_spec.json` EXISTA FISICAMENTE NO DISCO PARA O JOGO
INICIAR!"*.

O caminho de menor esforço para qualquer modelo passa a ser copiar o exemplo, trocar o callsign e
gravar. Isso satisfaz a instrução mais enfática do prompt sem invocar um único sub-agente ou tool.
Dois agravantes:

- Os campos `selected_mcps` e `selected_subagents` do exemplo são **literais fixos** — os três MCPs e
  `["aesthetic-designer", "combat-strategist"]` — e não são interpolados a partir da sessão. Uma cópia
  produz metadados que contradizem o que o visitante escolheu, e é esse `build_metadata` que alimenta o
  multiplicador de score.
- Como o gate de auditoria não existe (**D3**) e a validação de schema não roda (**D1**), o arquivo
  copiado decola sem nenhuma objeção.

D16 é, na prática, o que torna D3 perigoso em vez de meramente ausente: sem o exemplo, alucinar exigiria
esforço do modelo; com ele, alucinar é a rota padrão.

### 2.16. D17 — A nave desenhada pelo agente não é a nave que voa

A Spec 04 §1 define um pipeline explícito: o `svg_path_data` do `ship_spec.json` vira um `Blob`, depois
uma `Image`, é rasterizado em um canvas retina de 256×256 e entra no cache do Phaser via
`textures.addCanvas`. O `aesthetic-designer` — o único sub-agente **sempre ativo**, cuja razão de existir
é produzir esse SVG — alimenta esse pipeline.

O pipeline não existe. `ShipTextureFactory.createShipTexture()` cria um canvas de **128×128** (o
comentário na linha 6 ainda diz 256×256) e desenha a nave com chamadas Canvas2D **fixas no código**,
escolhendo entre **três silhuetas hardcoded** por correspondência de substring em `visuals.style_name`:

| Condição | Silhueta desenhada |
| :--- | :--- |
| `style_name` contém `interceptor` | Agulha aerodinâmica |
| `style_name` contém `fortress` ou `vanguard` | Casco pesado |
| qualquer outro caso | Asa invertida, rotulada no comentário como *"Custom SVG"* |

`grep -rn "svg_path_data" packages/` retorna apenas a definição do tipo, os três presets, o exemplo do
`GEMINI.md` e a linha do `normalizeSpec` que o copia adiante. **Nada em `player-app/src/game/` o lê.**

Do `ship_spec.json` inteiro, a aparência da nave consome exatamente três campos: `primary_color`,
`secondary_color` e `engine_trail_color`. A geometria é ignorada.

O efeito prático é pior do que "três variações": o `style_name` que o `normalizeSpec` produz por padrão é
`<callsign>-01 Swarmstrike` e o do exemplo do `GEMINI.md` é `<callsign>-01 Custom` — nenhum dos dois casa
com `interceptor`, `fortress` ou `vanguard`. Salvo se o modelo escolher espontaneamente uma dessas
palavras, **toda nave do evento cai no mesmo terceiro desenho**, variando só de cor.

Junto com **D14** e **D15**, fecha o conjunto: os atributos do visitante são achatados por clamps, suas
sinergias não têm efeito, e agora sua nave também não é a que o agente desenhou. Sobram as cores.

---

## 3. Pivôs Aceitos (P) — o código está certo, a especificação mente

| ID | Pivô | Especificação a reescrever |
| :--- | :--- | :--- |
| **P1** | Terminal nativo do SO na Tela 2 substituiu `xterm.js` + `node-pty` embutidos | 01 §2.4, 03 §1, §5, §6 |
| **P2** | Três superfícies de exibição, não duas | 01 §3, 05 §1 |
| **P3** | Boss com 15.000 HP e fases por limiar de HP | 04 §5, 01 §2.6 |
| **P4** | Waves contínuas por temporizador, não contagens finitas | 04 §4 |
| **P5** | Constantes de score alteradas + multiplicador de especialização MCP | 04 §6 |
| **P6** | Seleção de 1 a 3 MCPs com tradeoff de pontuação, não orçamento de 2 | 02 §1 |
| **P7** | Etapa `INSTRUCTIONS` no fluxo, ausente de toda especificação | 01 §2 |
| **P8** | Áudio por síntese WebAudio própria, não Howler.js sound sprites | 07 §1, 04 |

### 3.1. P1 — O pivô mais consequente

As Specs 01 §2.4 e 03 §1 não apenas especificam o terminal embutido: elas **justificam explicitamente
a rejeição** da alternativa — *"em vez de abrir uma janela nativa do SO (que causaria problemas de foco
e conflito com o modo Kiosk do Chrome)"*.

A implementação faz exatamente o que a especificação proíbe. O histórico mostra a jornada:
`94d02a2` troca `node-pty` por `child_process.spawn`, e `4e1c75e` conclui com *"implement clean Native
Terminal Handoff and eliminate legacy web terminal leftovers"*. Não há dependência de `xterm.js` ou
`node-pty` em nenhum `package.json`. O supervisor `scripts/booth-terminal.sh` (5.310 bytes) assumiu o
papel, coordenando-se com o daemon por arquivos-flag (`.session_active`, `.agy_pid`).

Resíduo arquitetural: o WebSocket ainda se chama `/pty` (`daemon/src/index.ts:22`) e transporta apenas
eventos de broadcast. O nome deve mudar para `/events`.

> **Atenção — este pivô pode ser revertido.** A Spec 08 mostra que, se o hardware do estande for um
> Chromebook simples, o AGY precisa migrar para a nuvem e o terminal embutido volta a ser a única
> opção viável. O pivô é aceito para o cenário de máquina capaz, não incondicionalmente.

### 3.2. P3, P4, P5 — Rebalanceamento não documentado

| Dimensão | Especificação 04 | Implementação | Evidência |
| :--- | :--- | :--- | :--- |
| HP do Boss | 2.000 | 15.000 (22.000 hardcore) | `BossOverlord.ts:5-6,22` |
| Transição de fase | Por tempo (60s/70s/80s) | Por limiar de HP (66% / 33%) | `BossOverlord.ts:312,316` |
| Entrada do Boss | 60s | 45s | `MainGameScene.ts:186-188` |
| Waves | 32 drones + 6 cruisers + 10 bônus, finitos | Spawners contínuos a 750ms/1200ms até 45s | `MainGameScene.ts:140-158` |
| Wave 2 | 25s | 20s | `MainGameScene.ts:198` |
| Pontos do Boss | 5.000 | 10.000 base + 10.000 bônus | `ScoreCalculator.ts:12,47` |
| Bônus de tempo | ×50 | ×80 | `ScoreCalculator.ts:48` |
| Bônus de HP | ×1.000 | ×1.200 | `ScoreCalculator.ts:49` |
| Bônus de sinergia | 1.500 | 2.000 | `ScoreCalculator.ts:50` |
| Multiplicador MCP | *inexistente* | 1 MCP = 1,25× / 2 MCPs = 1,10× | `ScoreCalculator.ts:55-57` |

Os números foram calibrados por sensação ao longo de commits como `2decf9a` (7.500 HP) e `6f9a8f4`
(bullet hell). **Nenhum deles foi medido.** O critério de aceitação da Spec 04 §7 — taxa de vitória
entre 15% e 25% — não é hoje verificável por nenhum meio. É o que a Spec 09 resolve.

### 3.3. P6 — O orçamento virou tradeoff

A Spec 02 §1 limita a 2 MCPs e 1 sub-agente tático. A implementação permite 1 a 3 MCPs
(`EnergySlidersBuilder.tsx:80-87`, mínimo de 1) e recompensa a especialização com multiplicador de
score. É uma mecânica **melhor** — preserva a intenção de escolha balanceada do `INITIAL_IDEA` por
incentivo em vez de proibição — mas está indocumentada.

---

## 4. Não Construído (U) — especificado, ausente

| ID | Subsistema | Especificação | Situação |
| :--- | :--- | :--- | :--- |
| **U1** | Cloud Firestore + Firebase Admin SDK | 01 §2.7, 05 §1, 06 §1.2, 07 §1 | Zero código. Nenhuma dependência instalada. |
| **U2** | Chamadas Gemini (moderação semântica + desambiguação de empresa) | 05 §2, 06 §2.2 | Zero código. Apenas regex e Levenshtein locais. |
| **U3** | Worker de sincronização offline com backoff | 06 §1.2 | Ausente (ver D10). |
| **U4** | `setup_monitors.sh`, `launch_kiosks.sh`, `reset_booth.sh` | 06 §3.1-3.3, 07 P2.2 | Ausentes. Só existe `booth-terminal.sh`. |
| **U5** | `self_test.sh` (autoteste matinal) | 06 §3.4, 07 P2.4 | Ausente. |
| **U6** | Teste de carga de 100 partidas / validação de SLA | 07 P2.5 | Ausente. |

Sobre **U1/U2**: o `USER_GUIDE.md:169` classifica corretamente a nuvem como "Milestone 2 — pendente",
enquanto as Specs 01/05/06/07 a tratam como entregue e obrigatória. Os dois documentos se contradizem;
o `USER_GUIDE` está certo. O `leaderboard-app` lê o SQLite do daemon por HTTP + WebSocket
(`leaderboard-app/src/App.tsx:42,65`), não `onSnapshot` do Firestore.

Sobre **U2**: além de ausente, o modelo especificado está obsoleto. Todas as menções a *Gemini 1.5
Flash* (05 §2.1, 06 §2.2, 07 §1, README) devem passar a **`gemini-3.6-flash` consumido via Vertex AI /
Gemini Enterprise Agent Platform**, conforme decidido na Spec 08.

Há ainda uma tensão de latência a resolver: a Spec 05 §2.1 fixa timeout de 600ms para a desambiguação.
Modelos Gemini 3.x têm *thinking* habilitado por padrão, e 600ms é um orçamento agressivo para um
round-trip Vertex. A Spec 08 trata a canonicalização como **assíncrona e não bloqueante** em vez de
esticar o timeout.

---

## 5. Requisitos Perdidos (L)

| ID | Requisito | Origem |
| :--- | :--- | :--- |
| **L1** | Qualidade do prompt do usuário deve influenciar a qualidade da nave | `INITIAL_IDEA.md:5` |

O `INITIAL_IDEA.md` é explícito: *"O prompt de construção do usuário também deverá de alguma forma
influenciar em uma nave melhor (melhor prompt, melhor nave)."*

Esse requisito **não aparece em nenhuma das 7 especificações** e não tem implementação. O que existe é
a `InstructionsPromptScreen` (206 linhas), que oferece prompts de inspiração copiáveis — ajuda o
visitante a escrever, mas nada avalia o que ele escreveu nem converte isso em vantagem.

É a única exigência da visão original que se perdeu inteira na tradução para especificações. Nenhum
`grep` por `prompt_quality`, `promptScore` ou `prompt_bonus` retorna resultado.

---

## 6. Backlog Ordenado por Risco de Evento

Ordenação por "o que quebra na frente de um visitante", não por esforço.

| Prioridade | Itens | Justificativa |
| :--- | :--- | :--- |
| **P0 — Quebra a demo** | D1, D2, D3, D4, D16 | Sem validação, timeout, gate de auditoria e limpeza de processos, uma falha do AGY trava a estação sem recuperação e o host degrada ao longo do dia. D16 torna a alucinação a rota padrão do modelo, esvaziando a demonstração de agentes. |
| **P0 — O jogo não é vencível** | **D12, D13, D14, D15** | Ninguém derruba o boss durante o evento inteiro, e a escolha de build quase não afeta a nave. Ataca o núcleo da ativação: a nave forjada precisa importar. |
| **P0 — A nave forjada não aparece** | **D17** | O visitante vê o agente desenhar sua nave e pilota outra. Correção de escopo médio, impacto direto na percepção da demonstração. |
| **P0 — Constrangimento público** | D6 | Pilotos falsos no telão diante de clientes. Correção trivial, impacto alto. |
| **P1 — Perda de dados** | D5, U1, U3 | Telemetria descartada é irrecuperável após o evento. Define o valor analítico de tudo. |
| **P1 — Habilita a nuvem** | D7, D9 | Pré-requisito mecânico para qualquer topologia hospedada. |
| **P1 — Confiança no balanceamento** | P3, P4, P5 (via Spec 09) | Hoje não se sabe se o jogo é vencível na proporção pretendida. |
| **P2 — Operação do estande** | D11, U4, U5 | Mitigável por staff presente, mas custa tempo de ciclo a cada incidente. |
| **P2 — Higiene de engenharia** | D8, D10 | Testes que não rodam mascaram regressões nas correções acima. |
| **P3 — Escopo opcional** | U6, L1, U2 (scoring de prompt) | Valioso, não bloqueante. |

---

## 7. Mapa de Cobertura por Especificação

Serve de checklist da reconciliação: nenhum arquivo é reescrito sem endereçar seus itens.

| Especificação | Itens a endereçar |
| :--- | :--- |
| **01** Booth & Experiência | P1, P2, P7, D11 |
| **02** Builder & Orçamento | P6, D3, D13, D15 |
| **03** Harness AGY | P1, D1, D2, D3, D4, D14, D16 |
| **04** Engine & Mecânicas | P3, P4, P5, D12, D13, D15, D17 (delega tuning para 09) |
| **05** Leaderboard & Cloud | U1, U2, D5, D6, D7 (delega topologia para 08) |
| **06** Resiliência & Segurança | D2, D9, D11, U3, U4, U5 |
| **07** Roadmap & Stack | P8, D8, U6, substituição do cronograma |
| **08** Topologia *(nova)* | D7, U1, U2, decisão sobre P1 |
| **09** Balanceamento & Dev Mode *(nova)* | P3, P4, P5, D12, D13, D14, D15 |
| **10** Plano de Implementação *(nova)* | Todos os IDs, alocados em fases |
