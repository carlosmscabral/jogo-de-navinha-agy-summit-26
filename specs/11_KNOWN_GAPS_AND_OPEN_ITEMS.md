# 11 — Lacunas Conhecidas e Itens em Aberto

**Estado em 2026-08-16, após o merge das Fases A e B de
[`10_IMPLEMENTATION_PLAN.md`](./10_IMPLEMENTATION_PLAN.md) e o fechamento do §2.2.**

Este documento existe para que nada que está quebrado, não verificado ou deliberadamente adiado
fique só na cabeça de quem implementou. Ele é a lista honesta do que **não** está pronto. Cada item
diz: o que é, por que ficou assim, qual o risco real no dia do evento, e o que fecha o item.

Um item só sai daqui quando estiver de fato resolvido — não quando alguém decidir que dá para
conviver com ele.

---

## 1. O que está pronto e o que não está

| Fase | Escopo | Estado |
|------|--------|--------|
| **A** | Correções de integração, harness `agy`, daemon, failover, segurança (D1-D6, D8-D10, P1, P8) | Implementada e revisada. Gate **M0** fechado. |
| **B** | Balanceamento medido, `balance.ts`, simulador headless, modo de desenvolvimento isolado, sinergias reais (Spec 09 inteira) | Implementada e revisada. Gates **M1** e **M2** **em aberto** — ver §4. |
| **C** | Nuvem: Firestore, Cloud Run, Vertex AI (D7, U1-U3) | **Não iniciada.** |
| **D** | Ensaio operacional do estande, soak, cronometragem do ciclo | **Não iniciada.** Gates M3, M4 e M5 em aberto. |
| **E** | Opcional, só depois de M0-M5 fechados | **Não iniciada.** |

O jogo **funciona hoje de ponta a ponta em uma máquina local**: registro → builder → forja com `agy`
real → voo → debriefing. O que falta na Fase C é a persistência em nuvem; hoje o placar é local.

---

## 2. Verificações automatizadas que não passam

`npm test` na raiz roda 159 testes. **158 passam, 1 falha.** A exceção é conhecida, rastreada aqui, e
não é intermitente — falha de forma determinística, sempre pelo mesmo motivo. O item pulado do §2.2
**fechou em 2026-08-16**; ficou registrado abaixo porque a maneira como fechou é o que dá peso ao
§2.1.

### 2.1 FALHA — `mantém o espalhamento entre arquétipos abaixo do penhasco`

`packages/sim/src/balance-gate.test.ts`

```
AssertionError: espalhamento de 45.8 pontos percentuais entre o melhor e o pior arquétipo
```

O portão de balanceamento tem quatro condições. **Três passam.** A quarta é esta.

Taxas de vitória na habilidade **mediano**, 2.000 seeds (`npm run sim:balance`, 2026-08-16, contra o
modelo de combate já conferido com a engine real — ver §2.2):

| Arquétipo | Vitórias (mediano) | No portão? |
|-----------|--------------------|------------|
| `vanguard` | **46,2%** | sim — âncora superior |
| `interceptor` | 14,9% | sim |
| `glass_cannon` | 7,8% | sim |
| `striker` | **0,4%** | sim — âncora inferior |
| `maximo` | 100,0% | não (sintético) |
| `vulcan_max` | 100,0% | não (sintético) |
| `minimo` | 0,0% | não (sintético) |
| `tanque` | 1,3% | não (sintético) |

- Taxa agregada (média das células `mediano` do portão): **17,3%** — dentro da banda de 15-25%. ✅
- Nenhum arquétipo do portão em 0% ou 100% na habilidade mediana. ✅
- Nenhum arquétipo com secundária de dano zero contra o boss (exceto `emp_burst`, esperado). ✅
- Espalhamento `vanguard` − `striker` = **≈45,8 pp**, contra um teto de 35 pp. ❌

> **Os números mudaram desde 2026-08-15** (era 43,0% / 10,2% / 6,7% / 1,3%, espalhamento ≈41,6 pp), e
> não porque alguém mexeu no balanceamento — ninguém mexeu. Mudaram porque o **modelo** foi corrigido
> na caça aos defeitos de medição: cadência independente de quadro, tempo de voo do projétil e taxa
> de acerto das pelotas externas do `vulcan_spread` entraram em `combat-model.ts`
> ([Spec 09 §5.9](./09_GAME_BALANCE_AND_DEV_MODE.md)). O espalhamento piorou porque o modelo ficou
> mais fiel, e a tabela de hoje é a primeira produzida por um simulador verificado.
>
> O aumento de dificuldade do boss de 2026-08-15 (`BALANCE.boss.bullet_damage` por fase + `max_hp`
> 800) tinha melhorado o espalhamento — era ≈50,7 pp antes dele —, mas nunca o fechou: a causa raiz é
> a diferença de estatísticas-base entre os dois presets, não o boss.

**Por que isto é real e não um artefato.** `vanguard` e `striker` são dois presets reais,
selecionáveis por um visitante ([`fallback-presets.ts`](../packages/shared/src/constants/fallback-presets.ts)).
A diferença vem das estatísticas-base dos dois presets, não do modelo de combate. Quatro arquétipos
**sintéticos** (`minimo`, `maximo`, `vulcan_max`, `tanque`) foram excluídos do portão com aprovação
explícita do dono do projeto, porque são estruturalmente inconstruíveis: os 4 sliders de energia
somam **exatamente** 100 pontos, e `maximo` exigiria ≈200, `tanque` 120, `minimo` apenas 40 (sobrando
60 que precisam ir para algum lugar). Eles continuam aparecendo em `npm run sim:balance` como limites
superior e inferior informativos. **A falha que resta não é esse tipo de artefato** — foi verificada
como uma disparidade genuína entre dois presets reais.

> **Confirmado contra a engine em 2026-08-16.** Até então, "genuína" queria dizer "genuína dentro do
> simulador" — e o simulador não estava verificado. O portão do §2.2 fechou desde então, com o
> `striker` (o preset do `vulcan_spread`, âncora inferior desta tabela) medido a **2,6%** do TTK
> real. O espalhamento é uma propriedade do jogo, não do modelo.

**Risco no evento:** um visitante que caia no preset `striker` tem ≈0,4% de chance de vencer com
habilidade mediana; um que caia no `vanguard`, ≈46%. A experiência é inconsistente entre visitantes,
embora nenhum dos dois casos seja injogável — na habilidade **experiente** o `striker` vence 47,9%
das vezes.

**Decisão registrada:** o dono do projeto decidiu **aceitar 3/4 como o estado documentado deste
merge** e **não** mexer em `fallback-presets.ts` nem afrouxar o teto de 35 pp agora. Isto está aqui
como item aberto, não como "resolvido".

**Fecha o item:** reequilibrar as estatísticas-base de `striker` (e possivelmente `vanguard`) em
`fallback-presets.ts` e reexecutar o portão, ou — com justificativa escrita na Spec 09 §5.3 — rever
o teto de 35 pp.

### 2.2 ~~PULADO~~ **FECHADO em 2026-08-16** — conformidade simulador × engine real

`packages/sim/src/conformance.test.ts`

```
✔ a captura é internamente coerente: shots_fired confere com boss_ttk_s
✔ TTK do boss no simulador está a até 5% do TTK capturado na engine real
```

Este teste compara o TTK do boss calculado pelo simulador com o TTK que a **engine Phaser real**
produziu, para a mesma spec e o mesmo seed (Spec 09 §5.1). É o que prova que
[`combat-model.ts`](../packages/sim/src/combat-model.ts) não é uma reimplementação que só *parece*
certa.

[`harness-runs.json`](../packages/sim/fixtures/harness-runs.json) está populado, e o portão passa nos
três presets — **2,6% / 1,1% / 3,1%**, contra números publicados antes da medição:

| preset | simulador | engine | desvio |
|---|---|---|---|
| `striker` | 11,2 s | 11,5 s | 2,6% |
| `interceptor` | 8,9 s | 9,0 s | 1,1% |
| `maximo` | 6,3 s | 6,5 s | 3,1% |

**Custou sete capturas, e cada uma pagou o próprio custo.** As seis primeiras foram descartadas, mas
não desperdiçadas: cada uma expôs um defeito de medição distinto na engine — multi-acerto por
projétil, `boss_ttk_s` inteiro, `this.time.now` valendo 0 dentro de `create`, tempo de reação do
operador dentro da medição, cadência de tiro quantizada por quadro, e a cena rodando em dois relógios
ao mesmo tempo. Sete defeitos aninhados, encontrados na ordem em que se escondiam uns atrás dos
outros. História completa na [Spec 09 §5.5 a §5.12](./09_GAME_BALANCE_AND_DEV_MODE.md).

**O que isso muda para o §2.1 acima.** O espalhamento de arquétipos era, até aqui, uma afirmação de
um simulador não verificado. O `striker` é o preset do `vulcan_spread`, e o modelo dele acaba de ser
medido contra a engine a 2,6% — **o espalhamento é uma propriedade do jogo, não do modelo.** A
decisão sobre o que fazer a respeito continua aberta e continua sendo do dono do projeto; o que
mudou é que ela agora se apoia em número medido.

**Manutenção:** o fixture é uma medição versionada, e medições envelhecem. Depois de qualquer mexida
em `BALANCE`, na engine de combate ou em `combat-model.ts`, recapture — procedimento em
[`packages/sim/fixtures/README.md`](../packages/sim/fixtures/README.md), roteiro no
[Bloco 3 do plano de teste manual](./12_MANUAL_TEST_PLAN_MAC.md), ≈10 minutos no Mac.

---

## 3. Verificação que nenhuma máquina fez

Tudo abaixo exige um humano com um Mac, um navegador real e o `agy` autenticado. Nada disso é
verificável em CI, e nada disso foi feito ainda.

| Gate | Depende de | O que prova | Estado |
|------|-----------|-------------|--------|
| **M0** | Fase A | Build limpo, testes executam e aparecem por nome | ✅ fechado |
| **M1** | Fase B | Engine sobe offline; a dificuldade prevista pelo simulador é a que a partida transmite (5 partidas à mão) | ⬜ **aberto** |
| **M2** | Fases A + B | Ciclo completo com `agy` real; failover; portão de auditoria; latência do handoff < 500ms; limpeza de processos | ⬜ **aberto** |
| **M3** | Fase C | Score chega ao Firestore; nada se perde com o Wi-Fi caindo | ⬜ aberto (fase não iniciada) |
| **M4** | Fase D | Ciclo de visitante em 2m00s-2m45s, 20 ciclos sem processo órfão | ⬜ aberto (fase não iniciada) |
| **M5** | Fase D | 100 partidas consecutivas, memória e processos estáveis | ⬜ aberto (fase não iniciada) |

M1 e M2 são executáveis **hoje** — o roteiro está em
[`12_MANUAL_TEST_PLAN_MAC.md`](./12_MANUAL_TEST_PLAN_MAC.md).

---

## 4. Achados de código adiados de propósito

Todos foram encontrados em revisão, avaliados e conscientemente adiados. Nenhum é bloqueador para o
evento; todos são reais.

### 4.1 `WeaponSystem` reescreve `spread_angle` (graus × radianos)

[`packages/player-app/src/game/weapons/WeaponSystem.ts:85-87`](../packages/player-app/src/game/weapons/WeaponSystem.ts)

O schema declara `spread_angle` em graus (0 a 30), mas o `WeaponSystem` trata o valor como radianos
em um caminho legado e o reescreve, incluindo um colapso para zero em certos casos. A Spec 04
§7 já registra a ressalva. O efeito prático hoje é pequeno (o leque de tiro do `vulcan_spread` fica
mais fechado do que o número na spec sugere), mas é uma divergência entre contrato e engine.

### 4.2 Sinergias: composição dependente de ordem e `Balanced Ace` quase inócuo

[`packages/shared/src/game/synergies.ts`](../packages/shared/src/game/synergies.ts)

- `Balanced Ace` aplica +15% sobre atributos inteiros: em quase todo valor legal isso arredonda de
  volta para o mesmo número (só `max_hp` 4→5 se move de fato).
- Quando duas sinergias se aplicam juntas, a ordem importa de um jeito que pode apagar a desvantagem
  pretendida — `Glass Cannon` + `Titan Fortress` mantém o bônus de dano **sem** a penalidade de HP.

Nenhum dos dois foi escopo de nenhuma tarefa da Fase B; ficam registrados para uma futura passada de
tuning.

### 4.3 HUD rotula a secundária como "MÍSSEIS" sempre

[`packages/player-app/src/game/scenes/MainGameScene.ts`](../packages/player-app/src/game/scenes/MainGameScene.ts)

Visivelmente errado para builds com `emp_burst`. Cosmético, mas o visitante vê.

### 4.4 `aggregateWinRate` é média não ponderada

[`packages/sim/src/combat-model.ts`](../packages/sim/src/combat-model.ts)

A Spec 09 §5.3 define a taxa agregada como "ponderada pela distribuição esperada de visitantes". A
implementação usa média simples, porque **não existe dado real de distribuição de visitantes ainda**.
A simplificação é defensável; o que falta é ela estar declarada no texto da spec em vez de só no
código.

### 4.5 Cobertura de teste com lacunas conhecidas

- O teste de clamp em `synergies.test.ts` afirma `<= max` em vez de `=== max` (mais fraco, mas
  coberto de lado por um teste vizinho de fator exato).
- O caminho de fallback de `spread_angle` ausente (`vulcan_spread` → 0.25) não tem teste de
  regressão dedicado — só foi verificado por execução manual em revisão.
- `damage: 0` e `spread_angle: null` em `normalizeSpec` caem em coerção de falsy que convive mal com
  a afirmação "rejeitado, nunca coagido" da Spec 09 §2.2. A forma é pré-existente, não foi
  introduzida nesta fase.
- `renderSvgShipTexture` não tem teste automatizado de integração (jsdom/node-canvas ausentes do
  ambiente); só traço manual.
- `packages/player-app` roda vitest com `environment: 'node'` — **sem jsdom**. Nenhum componente
  React é renderizado em teste em lugar nenhum deste repositório. Toda lógica de UI que precisa de
  teste tem que ser extraída para um módulo puro primeiro (foi o que se fez com
  [`synergy-preview.ts`](../packages/player-app/src/components/synergy-preview.ts)).

### 4.6 Resíduos pequenos

- `dev.html` ainda busca Google Fonts — inofensivo, mas desnecessário numa ferramenta de dev offline.
- Duas constantes mortas em `balance.ts` (`min_bullet_speed`, `default_bullet_speed`).
- A prévia do terminal em `HandoffTerminalScreen.tsx` desenha um polígono genérico fixo, não o
  `svg_path_data` real do agente — mesmo problema do D17, um passo antes no fluxo.
- ~~**`shots_fired` / `shots_hit` / `accuracy_pct` são sempre zero.**~~ **Corrigido em 2026-08-16.**
  `ScoreCalculator.shotsFired` e `.shotsHit` eram declarados e lidos por
  `MainGameScene.finishMatchAndTransition`, mas nada no repositório os incrementava, então os três
  campos iam zerados para a telemetria, o SQLite do daemon e o placar. Descoberto ao conferir a
  primeira captura do Bloco 3, que veio com `shots_fired: 0` num combate em que o disparo ficou
  segurado o tempo todo. Agora `WeaponSystem.onPrimaryShotsFired` conta os projéteis primários por
  acionamento (3 no `vulcan_spread`) e os handlers de colisão da primária contam os acertos; a
  secundária fica de fora de propósito. Ver [Spec 09 §5.6](./09_GAME_BALANCE_AND_DEV_MODE.md).

---

## 5. O que **não** é lacuna (verificado, apesar da aparência)

Registrado para que ninguém "conserte" de novo o que já foi investigado:

- **`drone_escort` ainda aparece no `grep`.** A remoção está correta e completa. As ocorrências
  restantes são: dois comentários explicativos no passado, um teste de regressão que afirma a
  *ausência* do valor, e prosa histórica de decisão em arquivos de spec. O tipo
  `SecondaryWeaponType` não o contém mais e `normalizeSpec` mapeia "drone" → `homing_missiles`.
- **Caixas de seleção não marcadas nos specs.** Vários arquivos de spec têm centenas de `- [ ]` e
  zero `- [x]`. É a convenção do próprio arquivo (roteiro de execução), não trabalho pendente.
- **A exclusão dos 4 arquétipos sintéticos do portão** não alterou nenhum número de balanceamento:
  foi provada bit-a-bit idêntica rodando o estado antigo e o novo lado a lado sobre os mesmos 2.000
  seeds.
- **Sinergias só existem com o MCP `cybernetics-shields`.** Não é bug: é a regra do jogo, agora
  aplicada de forma consistente nas três camadas (prompt do agente, backfill do daemon, crachá do
  builder). Um visitante que não seleciona esse MCP não recebe sinergia — e a UI diz isso na cara
  dele em vez de prometer um bônus que não sai.

---

## 6. Referências

- [`10_IMPLEMENTATION_PLAN.md`](./10_IMPLEMENTATION_PLAN.md) — plano por fases e definição dos gates
- [`12_MANUAL_TEST_PLAN_MAC.md`](./12_MANUAL_TEST_PLAN_MAC.md) — roteiro que fecha M1 e M2
- [`09_GAME_BALANCE_AND_DEV_MODE.md`](./09_GAME_BALANCE_AND_DEV_MODE.md) — banda de vitória, portão, modo dev
- [`packages/sim/fixtures/README.md`](../packages/sim/fixtures/README.md) — procedimento de captura da conformidade
