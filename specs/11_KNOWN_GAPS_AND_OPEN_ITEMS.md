# 11 — Lacunas Conhecidas e Itens em Aberto

**Estado em 2026-08-22, após o merge das Fases A e B de
[`10_IMPLEMENTATION_PLAN.md`](./10_IMPLEMENTATION_PLAN.md), o fechamento do §2.2 e o fechamento dos
Gates M1 e M2 no [plano de teste manual](./12_MANUAL_TEST_PLAN_MAC.md).**

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
| **B** | Balanceamento medido, `balance.ts`, simulador headless, modo de desenvolvimento isolado, sinergias reais (Spec 09 inteira) | Implementada e revisada. Gates **M1** e **M2** **fechados** em 2026-08-22 — ver §3. |
| **C** | Nuvem: Firestore, Cloud Run, Vertex AI (D7, U1-U3) | **Não iniciada.** |
| **D** | Ensaio operacional do estande, soak, cronometragem do ciclo | **Não iniciada.** Gates M3, M4 e M5 em aberto. |
| **E** | Opcional, só depois de M0-M5 fechados | **Não iniciada.** |

O jogo **funciona hoje de ponta a ponta em uma máquina local**: registro → builder → forja com `agy`
real → voo → debriefing. O que falta na Fase C é a persistência em nuvem; hoje o placar é local.

---

## 2. Verificações automatizadas que não passam

`npm test` na raiz roda 185 testes. **184 passam, 1 falha.** A exceção é conhecida, rastreada aqui, e
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
verificável em CI. **M0, M1 e M2 foram executados à mão e estão fechados**; M3-M5 dependem de fases
que não começaram.

| Gate | Depende de | O que prova | Estado |
|------|-----------|-------------|--------|
| **M0** | Fase A | Build limpo, testes executam e aparecem por nome | ✅ fechado |
| **M1** | Fase B | Engine sobe offline; a dificuldade prevista pelo simulador é a que a partida transmite (5 partidas à mão) | ✅ **fechado em 2026-08-22** |
| **M2** | Fases A + B | Ciclo completo com `agy` real; failover; portão de auditoria; latência do handoff < 500ms; limpeza de processos | ✅ **fechado em 2026-08-22** |
| **M3** | Fase C | Score chega ao Firestore; nada se perde com o Wi-Fi caindo | ⬜ aberto (fase não iniciada) |
| **M4** | Fase D | Ciclo de visitante em 2m00s-2m45s, 20 ciclos sem processo órfão | ⬜ aberto (fase não iniciada) |
| **M5** | Fase D | 100 partidas consecutivas, memória e processos estáveis | ⬜ aberto (fase não iniciada) |

**Como M1 e M2 fecharam** (roteiro em
[`12_MANUAL_TEST_PLAN_MAC.md`](./12_MANUAL_TEST_PLAN_MAC.md)):

- **M1** (Blocos 2 e 4) — o Bloco 4 foi rodado várias vezes ao longo do ajuste de dificuldade do
  boss e revalidado no fim, em 2026-08-22, com uma partida de cada preset real: `interceptor`
  (vitória, 62.436 pontos), `striker` (não chegou ao boss) e `vanguard` (`boss_damage_dealt: 698` de
  800). O balanceamento medido bate com o espalhamento previsto pelo simulador no §2.1 — inclusive o
  `striker` como âncora inferior.
- **M2** (Blocos 5, 6 e 7) — o ciclo completo com `agy` real fechou em 2026-08-16; as falhas
  provocadas do Bloco 6 e a higiene de processos do Bloco 7, em 2026-08-18; a latência do handoff
  (item 5.14) foi reconfirmada em 2026-08-22. O Bloco 6.2 (spec válida sem auditoria) foi o mais
  disputado: a aprovação só valeu depois de provar, pelo `callsign` e pela linha de log do
  `triggerFallback`, que a nave que voou era a do fallback e **não** a spec não auditada.

**Defeitos encontrados por esses gates, todos corrigidos antes do fechamento:** a densidade de
projéteis do boss nas três fases (mais o erro de escala de 0,8× no harness de dev, que invalidava
qualquer julgamento de dificuldade anterior a ele), as armas secundárias que não perseguiam alvo nem
davam retorno ao jogador, o orçamento dos sliders de energia que deixava passar uma nave de 107 PU, e
o temporizador de silêncio do daemon, que nunca era armado no início da sessão e depois media a coisa
errada. Os dois achados que **não** foram corrigidos estão registrados no §4.7 e no §4.8.

---

## 4. Achados de código adiados de propósito

Encontrados em revisão de código (4.1 a 4.6) ou nos testes manuais dos Gates M1 e M2 (4.7 e 4.8),
avaliados e conscientemente adiados. Nenhum é bloqueador para o evento; todos são reais. Os que já
foram corrigidos ficam aqui riscados, com o que mudou — apagar a entrada esconderia o histórico de
por que o defeito existiu.

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

### 4.3 ~~HUD rotula a secundária como "MÍSSEIS" sempre~~ **CORRIGIDO em 2026-08-22**

[`packages/player-app/src/game/scenes/MainGameScene.ts:34-36`](../packages/player-app/src/game/scenes/MainGameScene.ts)

Era visivelmente errado para builds com `emp_burst` — cosmético, mas o visitante via. O rótulo agora
sai de um mapa por `SecondaryWeaponType` (`homing_missiles` → "MÍSSEIS", `emp_burst` → "EMP", `none`
→ "SEM SECUNDÁRIA") alimentado pelo tipo que `getSecondaryStatus` devolve.

O item deixou de ser cosmético no meio do Bloco 4: um jogador com `emp_burst` apertava SHIFT, via um
anel de EMP onde o HUD prometia um míssil, e concluía que a arma não tinha disparado. O rótulo errado
estava mascarando o diagnóstico dos defeitos reais da secundária — que também foram corrigidos na
mesma passada (mísseis que não perseguiam alvo, teto de dano único engolindo a faixa de 60-150, e EMP
sem áudio nem retorno visual).

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

### 4.7 `/api/session/reset` não avisa os clientes web conectados

[`packages/daemon/src/index.ts`](../packages/daemon/src/index.ts) (handler de `POST /api/session/reset`)

O endpoint limpa o estado do daemon, mata o grupo de processos do `agy`/MCPs e apaga o conteúdo de
`/tmp/booth_session` — mas nunca chama `broadcast(...)`. Nenhuma mensagem chega aos clientes web
conectados. A Tela 1 só volta visualmente para a tela de registro quando o reset é disparado pelo
próprio atalho de teclado daquela aba (`Ctrl+Shift+F12` em `App.tsx`, cujo `handleReset()` chama o
mesmo endpoint **e** reseta o estado local do React como uma segunda ação independente). Um reset
disparado de qualquer outro jeito — `curl` direto, um futuro watchdog automático, um painel de
operador num segundo dispositivo — limpa o backend corretamente, mas deixa a Tela 1 travada na tela
do visitante anterior.

**Achado:** 2026-08-18, durante o Bloco 7 (higiene de processos) do
[`12_MANUAL_TEST_PLAN_MAC.md`](./12_MANUAL_TEST_PLAN_MAC.md) — um reset via `curl` limpou o processo
e o Terminal 3 corretamente, mas a tela de pré-voo continuou parada na Tela 1.

**Risco no evento:** baixo hoje, porque o mecanismo de reset real é exatamente esse atalho de
teclado, operado por um humano sentado na Tela 1. Vira risco real assim que qualquer reset deixar de
vir daquela aba específica — por exemplo, os watchdogs anti-abandono já cogitados para a Tarefa D2.

**Fecha o item:** o handler de `/api/session/reset` passa a `broadcast()` um evento (ex.:
`EVENT_SESSION_RESET`), e a Tela 1 escuta esse evento no WebSocket e chama a mesma lógica de reset
local que `handleReset()` já tem, sem depender de ser ela a origem do reset.

### 4.8 O comando de checagem de processo do Bloco 7.2 dá falso positivo neste repositório

[`12_MANUAL_TEST_PLAN_MAC.md`](./12_MANUAL_TEST_PLAN_MAC.md) (Bloco 7.2) — não é defeito de código.

```bash
ps -o pid,pgid,command -ax | grep -E 'agy|mcps/dist' | grep -v grep
```

Esse grep bate em qualquer processo cujo caminho contenha a substring "agy" em qualquer lugar —
inclusive no **nome da própria pasta do projeto**, `jogo-de-navinha-agy-summit-26`. Na prática isso
apareceu como falso positivo dos processos do Vite/esbuild do player-app (invocados por caminho
absoluto via `node_modules/.bin`), que não têm nenhuma relação com o CLI `agy` real nem com os
servidores MCP. Confirmado como falso positivo cruzando com o log do daemon e o callsign exibido no
jogo — nenhum processo do `agy`/MCP sobreviveu de fato.

**Achado:** 2026-08-18, primeira execução literal do comando do 7.2.

**Risco:** nenhum ao sistema — risco é só um testador ler um reset limpo como falha de processo
órfão.

**Fecha o item:** trocar o comando no Bloco 7.2 por
`ps -o pid,pgid,command -ax | grep -E 'agy|mcps/dist' | grep -v grep | grep -v node_modules`.

### 4.9 A credencial local do AGY não se renova, e a falha é invisível

Encontrado em 2026-08-22, na revisão de entrada da Fase C. **É o item mais grave desta seção** — não
pela probabilidade, mas porque o sintoma não se anuncia.

**O estado:** o repositório não configura credencial nenhuma para o `agy`. O
`scripts/booth-terminal.sh:130-135` faz `exec agy` e herda o ambiente do shell; não há uma única
referência a `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS` ou `GOOGLE_GENAI_USE_VERTEXAI`
em todo o projeto. Funciona hoje porque a máquina de desenvolvimento está autenticada de forma
interativa.

**A contradição nas specs:** a [Spec 06](./06_RELIABILITY_FAILOVER_AND_SECURITY_SPEC.md) §2.1.4 pede
"ADC de **conta de serviço** com escopo mínimo"; a
[Spec 08](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) §6.1 proíbe "**nenhum arquivo de chave** na
máquina do estande". Satisfazer as duas exige Workload Identity Federation ou impersonação — nenhuma
planejada, e ambas precisam de uma credencial de usuário para começar. A contradição está aberta.

**O modo de falha:** o token expira, ou a política da organização força reautenticação no meio do
dia. O `agy` para de responder. O timeout de 15s da Tarefa A4 dispara. **Todo visitante a partir dali
recebe preset de emergência.** O jogo continua perfeito, o placar continua enchendo, ninguém no
estande percebe nada — e a Forja, que é a razão de o estande existir, está morta. É a pior combinação
possível: alto impacto, zero sintoma visível.

**Por que está adiado e não resolvido:** automatizar exige descobrir o que o `agy` de fato aceita
como credencial e o que a política do projeto `vibe-cabral` permite. Nenhuma das duas coisas cabe
antes de a Fase C fechar, e a resposta pode ser trivial assim que o hardware do estande for definido —
numa máquina gerenciada, o problema pode simplesmente não existir.

**O que entra no lugar** (Tarefa D1, [plano](./10_IMPLEMENTATION_PLAN.md)):

1. O item 2 do `self_test.sh` passa a imprimir **quanto tempo falta** para a credencial expirar, não
   só PASS/FAIL — uma credencial que vence às 14h passa no teste das 8h.
2. Seção 6 do `RUNBOOK.md` com o procedimento manual de reautenticação, comandos completos.
3. A linha "todo visitante recebe nave de preset → credencial do AGY expirada" no cartão de falhas de
   uma página, porque quem está no balcão precisa conseguir ligar o sintoma à causa.

**Reavaliar** quando o hardware do estande for confirmado, ou antes do Gate M4, o que vier primeiro.

---

### 4.10 `@google-cloud/vertexai` está descontinuada desde 24/06/2025, remoção anunciada para 24/06/2026

Encontrado em 2026-08-22, durante a implementação da Tarefa C4 — o próprio pacote imprime o aviso ao
instanciar `VertexAI`.

**O estado:** a Restrição Global 1 do [plano](./10_IMPLEMENTATION_PLAN.md) nomeia
`@google-cloud/vertexai` especificamente como a biblioteca a usar, e a Tarefa C4 a implementou como
pedido — não havia alternativa dentro do escopo daquela tarefa. O pacote recomenda, na própria
mensagem de depreciação, migrar para um SDK sucessor unificado da Google para Vertex AI (o mesmo que
a nota interna deste projeto já cogitava desde antes da Fase C: "`@google/genai` com `vertexai: true`,
ou `@google-cloud/vertexai`").

**Por que importa agora e não é só dívida técnica distante:** a data de remoção anunciada,
24/06/2026, já passou em relação à data desta revisão (2026-08-22). Isso não significa
necessariamente que o pacote parou de funcionar — os testes da Tarefa C4 usam um cliente injetado e
nunca chamam o Vertex de verdade, então **ninguém verificou contra a API real** se `generateContent`
ainda responde por essa biblioteca. É uma lacuna de verificação, não uma prova de que funciona.

**Por que está adiado e não resolvido:** migrar de SDK é uma tarefa própria — troca de import, de
forma de instanciar o cliente e possivelmente de forma de declarar `responseSchema` — não uma linha
dentro da C4. Fazer isso agora arriscaria introduzir uma regressão não coberta pelos testes injetados
que já existem, numa parte do sistema (moderação de callsign) que **falha fechada** por desenho: um
SDK quebrado bloquearia registro de visitante, não apenas degradaria uma métrica.

**O que entra no lugar:**

1. **Antes do evento:** rodar um teste manual de ponta a ponta contra um projeto GCP real —
   `POST /v1/moderate` com um callsign real, observando a resposta do Vertex de verdade — para
   confirmar que a biblioteca ainda responde apesar da janela de remoção anunciada ter passado. Isto é
   trabalho do operador, não de um worktree de desenvolvimento (nenhum ambiente de implementação tem
   um projeto GCP real ou Docker instalado).
2. **Pós-evento ou antes do próximo, o que vier primeiro:** migrar para o SDK sucessor, como item de
   roadmap — não bloqueador do Summit.

**Reavaliar** antes de qualquer verificação de ponta a ponta contra o projeto GCP real, e de novo
antes do próximo evento que reusar este código.

---

### 4.11 `local_matches` nunca carrega `company_raw`/`company_confidence`/`score_breakdown` — **alocado à Tarefa C8**, 2026-08-23

Encontrado em 2026-08-22, durante a implementação da Tarefa C5, ao ligar o worker de sincronização
pela primeira vez ponta a ponta.

**O estado:** `MatchRecord` (`packages/shared/src/types/ship.ts:143-152`) — o tipo que o `App.tsx`
envia a `POST /api/matches` e que `local_matches` (`sqlite-buffer.ts:129-138`) persiste — nunca teve
`company_raw`, `company_confidence` ou `score_breakdown`. Esse tipo e essa tabela são da Fase A,
anteriores à Spec 05 e à Tarefa C2. `getPendingMatches()` (Tarefa C5) devolve exatamente o que a
tabela guarda, e `CloudSyncService` encaminha isso para `POST /v1/matches` sem completar os campos
que faltam.

**Por que isso não é só um campo faltando no Firestore.** A Tarefa C4 implementou a canonicalização
assíncrona inteira — prompt com o catálogo, transação de correção nos dois agregados de
`company_rankings`, `GET /v1/aliases` — condicionada a `needs_company_review: true` no documento.
Nada no caminho real de escrita (estande → `saveMatch` → `local_matches` → `CloudSyncService` →
`POST /v1/matches`) jamais define esse campo, porque ele nunca existiu no lado do estande. **O
recurso da Tarefa C4 está implementado, testado e aprovado — e não dispara nunca em produção**, porque
o gatilho que o aciona nunca é gravado. `company_raw` também nunca chega ao Firestore, então mesmo uma
correção manual futura (Tarefa C7) não teria o texto original do visitante para comparar.

**Por que não foi corrigido nesta tarefa:** consertar exige tocar `App.tsx` (client, já mexido pelas
Tarefas C0 e C1), `MatchRecord` (tipo compartilhado, usado pelo simulador e pela engine), o schema de
`local_matches` (migração de coluna) e o cálculo de confiança local que hoje só existe dentro de
`resolveCompany` no daemon, nunca devolvido ao cliente. Nenhum arquivo desses está na lista de
Arquivos da Tarefa C5, e forçar essa mudança ali teria misturado uma correção de schema de três tarefas
anteriores dentro de uma tarefa que só deveria drenar o buffer existente.

**O que fazer:** uma tarefa própria — candidata a **Tarefa C8** ou a uma extensão pequena da C3/C7 —
que (1) acrescenta `company_raw`, `company_confidence`, `needs_company_review` **e `score_breakdown`**
a `MatchRecord` e à tabela `local_matches` (com migração, já que o banco pode ter partidas do ensaio
manual da Fase B); (2) faz o `App.tsx` enviar `company_raw` (o texto que o visitante digitou, sem
normalizar) e `score_breakdown` (já calculado no cliente, hoje descartado antes de chegar a
`saveMatch`) junto com o `company_canonical` já resolvido; (3) faz a resposta de `resolveCompany` no
daemon devolver a confiança, não só o nome canônico, para popular `company_confidence`. Sem isso, a
Tarefa C4 é código morto tecnicamente correto — **e, mais grave, todo documento gravado durante o
evento fica permanentemente sem `score_breakdown`**, um campo não-opcional de `MatchDocument` (Spec 05
§4.1), não só sem os três campos de canonicalização.

> **Correção, revisão final da Fase C, 2026-08-22:** a frase anterior — "é o gate que testa a
> sincronização ponta a ponta, e é onde esta lacuna teria sido descoberta de qualquer forma" — estava
> errada. O checklist do Gate M3 (Spec 10, Tarefa C7) verifica apenas que `telemetry` e
> `ship_spec_snapshot` chegam preenchidos; não verifica `score_breakdown`, `company_raw` nem
> `company_confidence`. Como está escrito hoje, o M3 **não** pegaria esta lacuna. Um item novo foi
> acrescentado ao checklist do M3 exatamente para fechar isso — ver Tarefa C7 em
> [10_IMPLEMENTATION_PLAN.md](./10_IMPLEMENTATION_PLAN.md).

> **Alocado, 2026-08-23.** Vira **Tarefa C8** em
> [10_IMPLEMENTATION_PLAN.md](./10_IMPLEMENTATION_PLAN.md), mais barata do que esta seção previa: sem
> migração (o usuário confirmou que os dados locais atuais são de teste e podem ser descartados —
> `scripts/reset_local_db.sh` apaga o banco em vez de migrá-lo), e `company_raw` **já existe** no
> cliente (`pilot.company_raw`, preenchido no registro) — só nunca foi incluído no envio da partida.
> Falta só `company_confidence` (o número já é calculado dentro de `resolveCompany` no daemon, e só
> precisa parar de ser descartado) e passar os três campos adiante.

**Fechar ao concluir a Tarefa C8, não antes.**

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
- [`12_MANUAL_TEST_PLAN_MAC.md`](./12_MANUAL_TEST_PLAN_MAC.md) — roteiro que fechou M1 e M2
- [`09_GAME_BALANCE_AND_DEV_MODE.md`](./09_GAME_BALANCE_AND_DEV_MODE.md) — banda de vitória, portão, modo dev
- [`packages/sim/fixtures/README.md`](../packages/sim/fixtures/README.md) — procedimento de captura da conformidade
