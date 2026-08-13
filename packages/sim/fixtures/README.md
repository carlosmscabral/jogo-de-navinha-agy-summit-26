# `harness-runs.json` — capturas reais do harness para o teste de conformidade

`conformance.test.ts` compara o TTK (time-to-kill) do boss que o simulador calcula com o TTK que a
engine Phaser real produziu, para a mesma spec e o mesmo seed, com tolerância de 5% (Spec 09 §5.1).
Isso é o que garante que `combat-model.ts` não é uma reimplementação que só parece certa.

**Estado atual: `harness-runs.json` está vazio (`[]`).** Nenhuma captura real foi feita ainda —
rodar a engine Phaser exige um navegador de verdade (canvas/WebGL), e nenhuma tarefa desta fase
teve acesso a um. O teste de conformidade detecta o array vazio e pula (`skip`) em vez de falhar,
mas o *mecanismo* já está pronto: assim que este arquivo ganhar entradas reais, o teste passa a
valer e vira um gate de verdade.

## Atenção: granularidade do relógio real é de 1s, não 0,1s

`telemetry.boss_ttk_s` na engine real vem de `MainGameScene.elapsedSeconds`, um contador que só
avança em números inteiros de segundo (`handleMatchTick` roda a cada 1000ms via
`this.time.addEvent`). `boss_ttk_s = bossKilledAtSeconds - BALANCE.match.boss_spawn_s` é, portanto,
sempre um inteiro de segundos na captura real, ainda que o `.toFixed(1)` no código o formate como
`"20.0"` em vez de `"20"`. O simulador, por rodar em ticks de 60Hz, reporta `bossTtkSeconds` com
resolução real de 0,1s (ex.: `20.3`).

Isso importa porque a tolerância do teste de conformidade é 5%: para um TTK de ≈20s, só o
arredondamento de ±1s do relógio real já consome a tolerância inteira (1s / 20s = 5%). Um desvio
de até ≈1s entre simulador e engine, nessa faixa de TTK, pode ser *apenas* granularidade de
relógio — não necessariamente um erro real de `combat-model.ts`. Quem revisar uma captura real que
falhe por uma margem pequena deve checar isso antes de assumir que o modelo está errado.

## Como capturar os dados que faltam

Alguém com acesso a um navegador e a este repositório precisa:

1. Rodar `npm run dev:game` (o harness autônomo do dev, Tarefa B4) e, no painel:
   - Ligar **God mode**.
   - Definir **seed = 1**.
   - Selecionar o preset **striker**.
   - Clicar em **"Boss (45s)"** para pular direto para a luta.
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
