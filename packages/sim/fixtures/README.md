# `harness-runs.json` — capturas reais do harness para o teste de conformidade

`conformance.test.ts` compara o TTK (time-to-kill) do boss que o simulador calcula com o TTK que a
engine Phaser real produziu, para a mesma spec e o mesmo seed, com tolerância de 5% (Spec 09 §5.1).
Isso é o que garante que `combat-model.ts` não é uma reimplementação que só parece certa.

**Estado atual: o portão executa e passa nos três presets** — `striker` 2.6%, `interceptor` 1.1%,
`maximo` 3.1%, todos contra números publicados antes da medição (2026-08-16, ver
[Spec 09 §5.11 e §5.12](../../../specs/09_GAME_BALANCE_AND_DEV_MODE.md)). Com o array vazio os dois
testes pulam (`skip`) em vez de falhar; um fixture vazio nunca pode ser lido como "conformidade
confirmada".

> **Confira o rótulo contra o conteúdo antes de gravar uma entrada.** O preset da cena nasce em
> `FALLBACK_PRESETS.interceptor`: esquecer o botão **"Aplicar"** produz um arquivo com nome de um
> preset e dados de outro. No `vulcan_spread` isso se denuncia sozinho — `shots_fired` tem que ser
> divisível por 3, porque são 3 pelotas por acionamento. Nos lasers, compare a cadência
> (`shots_fired / boss_ttk_s`) com o `fire_rate` esperado.

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

**Confira também `boss_fight_min_fps`**, o pior quadro da luta, que o resumo passou a trazer junto
com o resto da telemetria (ver as duas seções seguintes). Depois de §5.9 e §5.10 ele não deveria mais
mexer no TTK — é justamente isso que a próxima captura testa, e por isso vale anotá-lo mesmo quando
tudo passa. Ele não invalida captura sozinho: quem faz isso é o teste de integridade
`shots_fired` × `boss_ttk_s`. O que um valor baixo faz é dizer **onde procurar** se algo mais falhar.

## Disparo automático: obrigatório desde 2026-08-16

A captura de 2026-08-16 passou na conferência acima, o portão executou pela primeira vez e reprovou
nos três presets — os três com o simulador otimista. O termo comum não era o modelo: era **o tempo
de reação entre clicar "Boss (40s)" e apertar `ESPAÇO`**. Reconstruído a partir de `shots_fired`
(acionamentos × intervalo de cadência dá a janela de tiro; `boss_ttk_s` menos a janela dá o atraso),
ele foi de **0.30 s, 1.12 s e 0.92 s** nas três. Varia 0.8 s de captura para captura, e entra
inteiro no TTK: numa luta de 7 s isso é 13%, contra uma tolerância de 5%.

O harness ganhou a caixa **"Disparo automático"** (`DevGameOptions.autoFirePrimary`), que trava o
gatilho primário desde o primeiro quadro sem teclado. **Marque-a — a captura de conformidade agora
depende dela**, e com ela o passo de segurar `ESPAÇO` deixa de existir. Ver
[Spec 09 §5.8](../../../specs/09_GAME_BALANCE_AND_DEV_MODE.md).

## A cadência dependia da taxa de quadros: capturas 1 a 5 invalidadas (2026-08-16)

A quinta captura confirmou que o disparo automático funciona — os dois lasers caíram exatamente o
tempo de reação que a seção acima previa — e, com o gatilho travado, `shots_fired` virou um
cronômetro independente. Os três presets, com dois intervalos nominais diferentes, implicaram o
mesmo tempo de quadro: **17.3 a 18.1 ms, ou 55 a 58 fps**. O Mac da captura não segurava 60.

Isso importa porque `WeaponSystem.firePrimary` carimbava o instante do quadro ao marcar o último
disparo, então cada intervalo era arredondado para cima até a borda de quadro seguinte e o erro
acumulava: 4% a 8% de TTK a mais, com a máquina mais lenta atirando menos. A 60 fps exatos o defeito
é invisível (83.3 ms são 5 quadros, 200 ms são 12) — só hardware real o revela.

Corrigido em `resolveFireCadence` (`@jogo/shared`), chamada **pelo motor e pelo simulador**, mais
dois termos que faltavam no modelo: o tempo de voo do projétil e a taxa de acerto das pelotas
externas do `vulcan_spread`. Ver [Spec 09 §5.9](../../../specs/09_GAME_BALANCE_AND_DEV_MODE.md).

## Armas no relógio de parede, mundo no relógio do jogo: captura 6 invalidada (2026-08-16)

A sexta captura deu **11.6 / 8.1 / 6.3 s** e estreou `boss_fight_min_fps` com **118.6 / 29.9 / 60.0**
— os degraus de vsync de um ProMotion. O `interceptor` reprovou em 9.9% com o simulador
**pessimista**, sinal invertido pela primeira vez em seis capturas.

`shots_fired` explicou: 122 acionamentos num TTK de 8.1 s, quando 8.1 s a 12 tiros/s comportam 98. Os
24 excedentes exigem 2.0 s que o TTK não relatou. Em `Phaser.Core.TimeStep`, o `time` do `update` é
relógio de parede (`this.time += this.rawDelta`) e o `delta` é média móvel **limitada** a 16.67 ms
durante os 120 quadros de `_coolDown` do boot. Abaixo de 60 fps o mundo anda em câmera lenta e o
relógio de parede não — e a cadência corrigida em §5.9 tinha ficado no relógio de parede. A cena
agora roda inteira em `worldTimeMs`, a soma dos `delta`. Ver
[Spec 09 §5.10](../../../specs/09_GAME_BALANCE_AND_DEV_MODE.md).

> **As seis capturas estão descartadas.** A sétima é a primeira contra a engine coerente. Previsão
> publicada, agora em pares que se conferem: **11.2 s / ≈168 tiros**, **8.9 s / ≈107**, **6.3 s /
> ≈76**, para `striker` / `interceptor` / `maximo`.

## O portão passou nos três (2026-08-16)

| preset | previsto | medido | desvio | `shots_fired` | previsto | `min_fps` |
|---|---|---|---|---|---|---|
| `striker` | 11.2 s | **11.5 s** | 2.6% | 171 | ≈168 | 29.2 |
| `interceptor` | 8.9 s | **9.0 s** | 1.1% | 108 | ≈107 | 29.2 |
| `maximo` | 6.3 s | **6.5 s** | 3.1% | 78 | ≈76 | 29.8 |

Todas as lutas rodaram a ≈29 fps de mínima — menos que a captura anterior, não mais — e mesmo assim
os dois relógios da engine concordaram em todas. Contra os **+24** acionamentos excedentes que o
`interceptor` a 29.9 fps produzia antes de §5.10, agora são **−1**. Mesma faixa de taxa de quadros,
defeito ausente.

O sinal do resíduo é o mesmo nos três — a engine entre 0.1 s e 0.3 s mais lenta que o modelo, da
ordem de um intervalo de disparo — e ele deixa o modelo do lado seguro: prevê o jogador um pouco mais
forte do que ele é.

O `striker` só entrou na sétima rodada em recaptura: o arquivo originalmente rotulado assim era uma
segunda corrida de `interceptor`, com `shots_fired: 106`, que não é divisível por 3. Ele acabou
servindo de réplica independente — dois `interceptor` no mesmo seed deram 8.9 s / 106 e 9.0 s / 108,
**1.1% de dispersão real** contra uma tolerância de 5%.

## Como recapturar

Este procedimento continua valendo para toda recaptura — depois de mexer em `BALANCE`, na engine, ou
em `combat-model.ts`. Alguém com acesso a um navegador e a este repositório precisa:

1. Rodar `npm run dev:game` (o harness autônomo do dev, Tarefa B4) e, no painel:
   - Ligar **God mode**.
   - Ligar **Disparo automático** (ver a seção abaixo — sem isso a captura não vale).
   - Definir **seed = 1**.
   - Selecionar o preset **striker** e **clicar em "Aplicar"** — escolher no seletor não muda nada
     sozinho, e a cena nasce em `interceptor`.
   - Clicar em **"Boss (40s)"** — o rótulo do botão vem de `BALANCE.match.boss_spawn_s`, então
     ele acompanha a constante se ela mudar. A nave já sai atirando; não encoste no teclado.
   - Clicar em **"Baixar resumo"** — isso baixa `match-summary-seed-1.json`, um `MatchCompleteData`
     completo (`{ finalScore, victory, breakdown, telemetry }`).
2. Repetir o passo 1 para os presets **interceptor** e **maximo** (mesma seed, mesmo procedimento:
   God mode e Disparo automático ligados, pular para o boss, esperar o boss cair, baixar o resumo).
3. De cada `match-summary-seed-*.json` baixado, extrair `telemetry.boss_ttk_s` e montar uma entrada
   neste arquivo com o formato abaixo — um objeto por preset capturado:

```json
[
  { "preset": "striker", "seed": 1, "boss_ttk_s": 11.5, "shots_fired": 171, "boss_fight_min_fps": 29.2 },
  { "preset": "interceptor", "seed": 1, "boss_ttk_s": 9.0, "shots_fired": 108, "boss_fight_min_fps": 29.2 },
  { "preset": "maximo", "seed": 1, "boss_ttk_s": 6.5, "shots_fired": 78, "boss_fight_min_fps": 29.8 }
]
```

(os valores acima são a captura de 2026-08-16 que está no arquivo hoje, não um gabarito a copiar —
substitua pelos seus.)

Campos:
- `preset`: uma chave de `ARCHETYPES` (`src/archetypes.ts`) — o simulador usa essa chave para
  buscar a `ShipSpecification` correspondente.
- `seed`: o seed usado no harness (o mesmo que `simulateMatch` recebe).
- `boss_ttk_s`: `telemetry.boss_ttk_s` do resumo baixado (segundos entre o boss aparecer e morrer).
- `shots_fired`: `telemetry.shots_fired`. **Obrigatório.** É o segundo relógio da engine, e o teste
  de integridade reprova a captura — antes de olhar para o simulador — se ele discordar de
  `boss_ttk_s` além de `max(5%, 2 intervalos)`. Sem esse campo o portão não distingue modelo errado
  de instrumento quebrado, que foi como o defeito de §5.10 passou despercebido por uma rodada.
- `boss_fight_min_fps` (opcional): `telemetry.boss_fight_min_fps`. Não entra em asserção nenhuma;
  fica registrado para triagem, porque foi o que apontou qual das três capturas investigar.
- `isHardcore` (opcional): incluir apenas se a captura foi feita com o modo difícil ligado.

O teste roda o simulador com a mesma spec e o mesmo seed, e um perfil de habilidade
`{ accuracy: 1.0, fireUptime: 1.0, hitsTakenPerSecond: 0, secondaryUptime: 0 }` — o que *God mode*
mais *Disparo automático* representam literalmente: `fireUptime: 1.0` quer dizer disparando desde o
primeiro quadro, e é justamente por isso que a caixa existe. A secundária fica em `0` porque o
procedimento não encosta em `SHIFT`.

**Se o desvio passar de 5%: o simulador está errado até prova em contrário — a engine é a
realidade.** Ache a regra que `combat-model.ts` transcreveu mal e corrija o modelo, nunca a
tolerância do teste.
