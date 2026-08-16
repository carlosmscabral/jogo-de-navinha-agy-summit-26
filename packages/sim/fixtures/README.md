# `harness-runs.json` — capturas reais do harness para o teste de conformidade

`conformance.test.ts` compara o TTK (time-to-kill) do boss que o simulador calcula com o TTK que a
engine Phaser real produziu, para a mesma spec e o mesmo seed, com tolerância de 5% (Spec 09 §5.1).
Isso é o que garante que `combat-model.ts` não é uma reimplementação que só parece certa.

**Estado atual: `harness-runs.json` está vazio (`[]`).** O teste de conformidade detecta o array
vazio e pula (`skip`) em vez de falhar, mas o *mecanismo* já está pronto: assim que este arquivo
ganhar entradas reais, o teste passa a valer e vira um gate de verdade.

> **A captura de 2026-08-15 foi descartada.** Ela rodou contra a engine antes da correção do
> multi-acerto por projétil (Spec 09 §5.5): um tiro "consumido" continuava com o corpo físico
> habilitado e reentrava no overlap do boss a cada frame, então o boss recebia dezenas de acertos
> por tiro e morria em 4-5s independentemente da build. Qualquer captura anterior a essa correção
> mede a engine bugada, não o jogo. **Só capture com a correção aplicada.**

## Granularidade do relógio: resolvida em 2026-08-16, em duas tentativas

Até 2026-08-16 `telemetry.boss_ttk_s` vinha de `MainGameScene.elapsedSeconds`, um contador que só
avança em números inteiros de segundo (`handleMatchTick` roda a cada 1000ms via
`this.time.addEvent`), e cuja fase não tem relação com o instante em que o boss aparece. O TTK
capturado era sempre um inteiro, com até 1s de erro de quantização — o que, contra a tolerância de
5% deste teste, tornava invalidável por construção qualquer luta abaixo de ≈20s. Uma captura de 11s
carregava ±9% de ruído puro de relógio.

A primeira correção — medir `this.time.now - bossFightStartMs` — trocou um erro por outro pior.
`spawnBoss` roda dentro de `create` no caminho do harness (`fastForwardTo`), antes do primeiro passo
do game loop, e ali `this.time.now` ainda vale `0` (`Clock.boot` copia `game.loop.time`, e
`TimeStep.time` nasce em `0`). O marco zero fazia `boss_ttk_s` reportar milissegundos desde o
carregamento da página: a captura correspondente veio com 34 / 80.6 / 116.9 para lutas de 11 / 9 / 6s.

`MainGameScene` agora acumula `bossFightElapsedMs += delta` no `update`, zerado em `spawnBoss`, e
`boss_ttk_s` sai com uma casa decimal real (ex.: `11.4`). Não depende de relógio absoluto, vale
igual no harness e na partida real, e uma troca de aba não infla mais a medição. O simulador sempre
reportou `bossTtkSeconds` com resolução de 0,1s, então os dois lados finalmente têm a mesma régua.
**Um desvio acima de 5% é sinal real, não arredondamento.**
Ver [Spec 09 §5.6 e §5.7](../../../specs/09_GAME_BALANCE_AND_DEV_MODE.md).

**Ao capturar, confira que `boss_ttk_s` tem casa decimal e que bate com a duração da partida** — no
harness a luta começa em `BALANCE.match.boss_spawn_s`, então `duration_s - 40` é o TTK esperado. Um
inteiro redondo significa build velha; um valor muito acima de `duration_s` significa relógio errado.
Nos dois casos a captura não presta.

## Como capturar os dados que faltam

Alguém com acesso a um navegador e a este repositório precisa:

1. Rodar `npm run dev:game` (o harness autônomo do dev, Tarefa B4) e, no painel:
   - Ligar **God mode**.
   - Definir **seed = 1**.
   - Selecionar o preset **striker**.
   - Clicar em **"Boss (40s)"** — o rótulo do botão vem de `BALANCE.match.boss_spawn_s`, então
     ele acompanha a constante se ela mudar.
   - Segurar o disparo primário (barra de espaço) sem soltar até o boss ser derrotado.
   - Clicar em **"Baixar resumo"** — isso baixa `match-summary-seed-1.json`, um `MatchCompleteData`
     completo (`{ finalScore, victory, breakdown, telemetry }`).
2. Repetir o passo 1 para os presets **interceptor** e **maximo** (mesma seed, mesmo procedimento:
   God mode ligado, pular para o boss, segurar o disparo primário até derrubá-lo, baixar o resumo).
3. De cada `match-summary-seed-*.json` baixado, extrair `telemetry.boss_ttk_s` e montar uma entrada
   neste arquivo com o formato abaixo — um objeto por preset capturado:

```json
[
  { "preset": "striker", "seed": 1, "boss_ttk_s": 0.0 },
  { "preset": "interceptor", "seed": 1, "boss_ttk_s": 0.0 },
  { "preset": "maximo", "seed": 1, "boss_ttk_s": 0.0 }
]
```

Campos:
- `preset`: uma chave de `ARCHETYPES` (`src/archetypes.ts`) — o simulador usa essa chave para
  buscar a `ShipSpecification` correspondente.
- `seed`: o seed usado no harness (o mesmo que `simulateMatch` recebe).
- `boss_ttk_s`: `telemetry.boss_ttk_s` do resumo baixado (segundos entre o boss aparecer e morrer).
- `isHardcore` (opcional): incluir apenas se a captura foi feita com o modo difícil ligado.

O teste roda o simulador com a mesma spec e o mesmo seed, e um perfil de habilidade
`{ accuracy: 1.0, fireUptime: 1.0, hitsTakenPerSecond: 0, secondaryUptime: 0 }` — o que *God mode*
com o disparo primário sempre segurado (e a secundária nunca acionada, já que o procedimento acima
não manda apertar Shift) representa.

**Se o desvio passar de 5%: o simulador está errado até prova em contrário — a engine é a
realidade.** Ache a regra que `combat-model.ts` transcreveu mal e corrija o modelo, nunca a
tolerância do teste.
