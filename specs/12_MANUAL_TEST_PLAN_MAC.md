# 12 — Plano de Teste Manual no Mac (Gates M1, M2 e M3)

**Objetivo:** fechar os gates que nenhuma máquina consegue fechar sozinha —
**M1** (a engine, offline, e a dificuldade que a partida realmente transmite),
**M2** (o ciclo completo com o `agy` real, incluindo as falhas provocadas), e
**M3** (a nuvem — Firestore, Cloud Run, Vertex AI — com um projeto real e o Wi-Fi na mão).

> **Acrescentado em 2026-08-24.** Os Blocos 0–9 abaixo são o registro original de M1/M2, fechados
> em 2026-08-16/18/22 — não foram tocados. Os Blocos 10 em diante são novos, para o Gate M3, depois
> de Tarefas C0–C10 mergeadas em `main`. Leia [`11_KNOWN_GAPS_AND_OPEN_ITEMS.md`](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md)
> §4.9 e §4.10 antes de começar M3 — são riscos aceitos, não bugs a caçar durante o teste.

**Pré-condição:** Fases A e B mergeadas em `main`. Estado conhecido do repositório em
[`11_KNOWN_GAPS_AND_OPEN_ITEMS.md`](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md) — **leia antes de começar**,
porque um dos testes automatizados falha de propósito e você precisa reconhecer essa falha para não
perder tempo investigando algo já conhecido.

**Tempo total estimado:** ≈2h30, em blocos independentes. Dá para parar entre blocos.

| Bloco | O que fecha | Tempo |
|-------|-------------|-------|
| 0 | Preparação | 15 min |
| 1 | Sanidade da árvore (revalida M0) | 10 min |
| 2 | M1 parte 1 — engine offline | 20 min |
| 3 | Captura de conformidade (fechado em 2026-08-16; refazer após mexer em balanceamento) | 20 min |
| 4 | M1 parte 2 — 5 partidas à mão vs. simulador | 30 min |
| 5 | M2 parte 1 — ciclo completo com `agy` real | 30 min |
| 6 | M2 parte 2 — falhas provocadas | 25 min |
| 7 | M2 parte 3 — higiene de processos e reset | 10 min |
| 10 | M3 — preparação (limpeza local + CLIs) | 15 min |
| 11 | M3 — provisionamento na nuvem (`deploy.sh`) | 20 min |
| 12 | M3 parte 1 — validação contra o emulador | 15 min |
| 13 | M3 parte 2 — ciclo completo contra o projeto real | 45 min |
| 14 | M3 parte 3 — painel de administração | 20 min |
| 15 | M3 parte 4 — o teste de 10 minutos do Chrome real | 10 min |
| 16 | Limpeza pós-teste (opcional) | 10 min |

**Como registrar:** cada passo tem uma caixa. Marque `[x]` quando passar. Quando **não** passar,
**não marque** — anote o que aconteceu na tabela do §8 e siga em frente, salvo indicação contrária.
Um bloco que falha não impede o próximo, exceto onde estiver escrito.

---

## Bloco 0 — Preparação (uma vez)

- [ ] **0.1 — Versões**

```bash
node -v      # precisa ser 20.x ou 22.x LTS
npm -v       # 10.x ou superior
sw_vers      # registre a versão do macOS na tabela do §8
```

- [ ] **0.2 — Repositório limpo, na `main` atualizada**

```bash
cd ~/caminho/para/jogo-de-navinha-agy-summit-26
git checkout main && git pull
git status --short          # precisa sair vazio
```

- [ ] **0.3 — Instalar dependências**

```bash
npm install
```

- [ ] **0.4 — Portas livres**

```bash
lsof -ti :3000 :5173 :5174   # não deve retornar nada
npm run kill:daemon          # se a 3000 estiver ocupada
```

- [ ] **0.5 — `agy` disponível e autenticado via Vertex AI**

```bash
command -v agy               # precisa retornar um caminho
agy --version
```

O `agy` precisa estar no sabor **Vertex AI / Enterprise**, com `gemini-3.7-flash` — **não** com
chave de API. Confirme antes de começar; um `agy` autenticado do jeito errado só falha no Bloco 5,
depois de você já ter gasto 1h30.

> Se `agy` **não** estiver instalado, os Blocos 5 a 7 rodam em **modo simulação**:
> `scripts/booth-terminal.sh` detecta a ausência do comando e substitui a sessão por um `sleep 20`.
> Isso ainda exercita o daemon, o failover e a limpeza de processos, mas **não** valida a forja
> real. Marque no §8 que o Bloco 5 rodou em simulação — nesse caso o Gate M2 **não** está fechado.

- [ ] **0.6 — Navegador com DevTools**

Chrome ou Edge. Os passos de rede e de latência usam as abas **Network** e **Performance**. O Safari
serve para jogar, mas não para os passos de medição.

- [ ] **0.7 — Preparar a pasta de resultados**

```bash
mkdir -p ~/Desktop/gate-m1-m2
```

Os JSONs baixados pelo harness e as capturas de tela vão para lá.

---

## Bloco 1 — Sanidade da árvore (revalida M0)

- [ ] **1.1 — Build limpo**

```bash
npm run build
```

Esperado: os cinco workspaces compilam (`shared`, `mcps`, `daemon`, `player-app`,
`leaderboard-app`). O aviso de chunk maior que 500 kB no `player-app` é esperado e não é erro.

- [ ] **1.2 — Suíte completa**

```bash
npm test 2>&1 | tee ~/Desktop/gate-m1-m2/npm-test.txt
```

**Esperado — e leia isto com atenção:**

```
shared      67/67  ✅
mcps         3/3   ✅
daemon      41/41  ✅
player-app  34/34  ✅
sim         13/14  — 1 FALHA  ← esperada, conhecida
```

A falha esperada é exatamente esta, e **só** esta:

```
✖ mantém o espalhamento entre arquétipos abaixo do penhasco
  espalhamento de 45.8 pontos percentuais entre o melhor e o pior arquétipo
```

**Qualquer outra falha é uma regressão nova** — pare e investigue antes de continuar. Em particular,
os dois testes de conformidade do `sim` **passam** desde 2026-08-16; até então pulavam por falta de
captura, e voltar a ver `﹣ ... harness-runs.json está vazio` significa fixture perdido, não teste
novo.
Contexto completo dos dois itens: [`11_KNOWN_GAPS_AND_OPEN_ITEMS.md` §2](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md).

- [ ] **1.3 — Matriz de balanceamento de referência**

```bash
npm run sim:balance 2>&1 | tee ~/Desktop/gate-m1-m2/sim-balance.txt
```

Guarde este arquivo. O Bloco 4 compara as partidas jogadas à mão contra estes números. Os valores de
referência (2026-08-16, habilidade **mediano**, contra o modelo já conferido com a engine real) são:

| Arquétipo | Vitórias | TTK p50 |
|-----------|----------|---------|
| `interceptor` | 14,9% | 14,6s |
| `vanguard` | 46,2% | 17,4s |
| `striker` | 0,4% | 21,4s |
| `maximo` | 100,0% | 9,2s |

Se a sua execução divergir muito destes números **com o mesmo commit**, algo está errado no
ambiente — o simulador é determinístico.

---

## Bloco 2 — Gate M1, parte 1: a engine sobe sozinha, offline

O ponto deste bloco é provar que a engine **não depende do daemon nem da rede**. É o que garante que
uma queda de Wi-Fi no estande não derruba o jogo.

- [ ] **2.1 — Derrubar o daemon e desligar o Wi-Fi**

```bash
npm run kill:daemon
```

Depois **desligue o Wi-Fi pelo menu do macOS**. Não basta desconectar do roteador — desligue mesmo.

- [ ] **2.2 — Subir o harness de desenvolvimento**

```bash
npm run dev:game
```

Abre `http://localhost:5173/dev.html`. O cabeçalho diz
**"Harness de Desenvolvimento // Sem daemon, sem rede"**.

- [ ] **2.3 — Zero requisições ao daemon**

DevTools → **Network** → filtro `3000`. Recarregue a página com o painel aberto.

**Critério:** nenhuma linha. Nenhuma requisição a `localhost:3000`, nem falhada, nem pendente.
É o critério central do Gate M1.

- [ ] **2.4 — A nave voa**

Clique no canvas e use `WASD` ou as setas para mover, `ESPAÇO` para o canhão primário.

**Critério:** a nave responde, atira, e inimigos aparecem e morrem.

- [ ] **2.5 — Pular direto para o boss**

Clique em **"Boss (40s)"**.

**Critério:** o boss aparece em **menos de 5 segundos** a partir do clique. Cronometre.

- [ ] **2.6 — A secundária funciona e o indicador recarrega**

Aperte `SHIFT` durante a luta contra o boss.

**Critério:** o HP do boss cai de forma **visível** quando a secundária acerta. No HUD, a barra ao
lado de `[SHIFT] MÍSSEIS:` esvazia no disparo e volta a encher até mostrar **`PRONTO!`**.

> **Nota conhecida:** o HUD rotula a secundária como `[SHIFT] MÍSSEIS` mesmo quando a arma é
> `emp_burst`. É um defeito cosmético já registrado ([§4.3 das lacunas](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md)),
> não uma falha deste passo.

- [ ] **2.7 — Replay determinístico**

Na seção **Determinismo**, anote o valor do campo **Seed**. Deixe a partida rodar ≈20 segundos,
observando a ordem em que as formações de inimigos entram. Clique em **"Replay"**.

**Critério:** com o **mesmo seed**, a mesma sequência de formações se repete, na mesma ordem e nos
mesmos tempos. Depois clique em **"🎲 novo"** para sortear outro seed, clique em **"Replay"** de
novo, e confirme que a sequência **muda**.

- [ ] **2.8 — O casco desenhado é o casco que voa**

No textarea `ship_spec`, localize `visuals.svg_path_data` e substitua por uma forma nitidamente
diferente, por exemplo um losango:

```
M64 8 L120 64 L64 120 L8 64 Z
```

Clique em **"Aplicar"**.

**Critério:** a nave na tela vira um losango. Se continuar com o casco anterior, o D17 regrediu.

- [ ] **2.9 — Religar o Wi-Fi**

Só depois de terminar este bloco.

---

## Bloco 3 — Captura de conformidade (FECHADO em 2026-08-16)

Este bloco produz os dados que faltam para
[`packages/sim/fixtures/harness-runs.json`](../packages/sim/fixtures/harness-runs.json). É o item de
maior alavancagem da lista de lacunas: sem ele, **nenhum número de balanceamento está confirmado
contra a engine real**.

> **Já rodado cinco vezes, e as cinco pagaram o próprio custo.**
>
> A primeira, em 2026-08-15, reprovou com desvios de 90% / 82% / 52% e expôs um bug de multi-acerto
> por projétil na engine (um tiro consumido continuava com o corpo físico habilitado e batia no boss
> uma vez por frame). Ver [Spec 09 §5.5](./09_GAME_BALANCE_AND_DEV_MODE.md).
>
> A segunda, em 2026-08-16, contra a engine corrigida, deu 11 s / 9 s / 6 s — os TTKs voltaram a
> escalar com a build, e os dois presets de `laser` (`interceptor`, `maximo`) fecharam em 1.1% e
> 1.7%. Só o `striker` (`vulcan_spread`) ficou fora, em 13.6%. Ela expôs, por sua vez, que
> `boss_ttk_s` era um inteiro: com até 1 s de erro de quantização num TTK de 11 s, o portão não
> distinguia modelo errado de arredondamento. Ver
> [Spec 09 §5.6](./09_GAME_BALANCE_AND_DEV_MODE.md).
>
> A terceira, também em 2026-08-16, validou os contadores de tiro (`accuracy_pct` de 69% / 94.2% /
> 91.9%, o que mantém viva a hipótese de que o simulador superestima o `vulcan_spread`), mas veio
> com `boss_ttk_s` de 34 / 80.6 / 116.9: a correção para milissegundos lia `this.time.now` dentro de
> `create`, onde ele ainda vale 0, e reportava o relógio da aba do navegador. Corrigido acumulando
> `delta` quadro a quadro. Ver [Spec 09 §5.7](./09_GAME_BALANCE_AND_DEV_MODE.md).
>
> A quarta, ainda em 2026-08-16, passou na conferência de sanidade e **fez o portão executar pela
> primeira vez**: reprovou em 15.9% / 6.2% / 12.9%, os três com o simulador otimista. Três desvios
> do mesmo sinal denunciaram um termo sistemático, e `shots_fired` mostrou qual: o tempo de reação
> entre clicar "Boss (40s)" e apertar `ESPAÇO` — 0.30 s, 1.12 s e 0.92 s — entrava inteiro no
> `boss_ttk_s`. Daí a caixa **"Disparo automático"**. Ver
> [Spec 09 §5.8](./09_GAME_BALANCE_AND_DEV_MODE.md).
>
> A quinta, a primeira com **"Disparo automático"**, confirmou que a caixa funciona: os dois lasers
> caíram de 9.7 s para 9.3 s e de 7.0 s para 6.5 s, exatamente o tempo de reação previsto, e todo o
> resto do resumo veio idêntico byte a byte. Com o gatilho travado, `shots_fired` virou cronômetro
> independente — e os três presets, com dois intervalos nominais diferentes, implicaram o mesmo
> tempo de quadro: **55 a 58 fps**. A cadência de tiro carimbava o instante do quadro, então cada
> intervalo era arredondado para cima e o erro acumulava: 4% a 8% de TTK a mais, com a máquina mais
> lenta atirando menos. Corrigido em `resolveFireCadence`, chamada pelo motor **e** pelo simulador.
> Ver [Spec 09 §5.9](./09_GAME_BALANCE_AND_DEV_MODE.md).
>
> A sexta, a primeira contra a cadência corrigida, deu **11.6 / 8.1 / 6.3 s** e estreou
> `boss_fight_min_fps`: **118.6 / 29.9 / 60.0**, os degraus de vsync de um ProMotion. O
> `interceptor` reprovou em 9.9% com o simulador **pessimista** — sinal invertido pela primeira vez
> em seis capturas, o que não é modelo mal calibrado. `shots_fired` disse o quê: 122 acionamentos
> num TTK de 8.1 s, quando 8.1 s a 12 tiros/s comportam 98. Os 24 excedentes exigem 2.0 s que o TTK
> não relatou. O `time` do `update` do Phaser é relógio de parede; o `delta` é média móvel limitada
> a 16.67 ms durante os 120 quadros de `_coolDown` do boot. Abaixo de 60 fps o mundo anda em câmera
> lenta e a cadência, que §5.9 tinha posto no relógio de parede, não. A cena inteira passou a rodar
> em `worldTimeMs`. Ver [Spec 09 §5.10](./09_GAME_BALANCE_AND_DEV_MODE.md).
>
> A sétima **fechou o portão nos três presets**, contra números publicados antes da medição:
>
> | preset | previsto | medido | desvio | tiros | previsto | `min_fps` |
> |---|---|---|---|---|---|---|
> | `striker` | 11.2 s | **11.5 s** | 2.6% | 171 | ≈168 | 29.2 |
> | `interceptor` | 8.9 s | **9.0 s** | 1.1% | 108 | ≈107 | 29.2 |
> | `maximo` | 6.3 s | **6.5 s** | 3.1% | 78 | ≈76 | 29.8 |
>
> As lutas rodaram a ≈29 fps de mínima — menos que a captura anterior — e mesmo assim os dois
> relógios da engine concordaram: contra os **+24** acionamentos excedentes que o `interceptor`
> produzia a 29.9 fps, agora são **−1**. Mesma faixa de taxa de quadros, defeito ausente. Ver
> [Spec 09 §5.11 e §5.12](./09_GAME_BALANCE_AND_DEV_MODE.md).
>
> O `striker` precisou de recaptura: a corrida rotulada assim na primeira tentativa era uma segunda
> corrida de `interceptor` — `shots_fired: 106` não é divisível por 3, e o `vulcan_spread` solta
> exatamente 3 pelotas por acionamento. O preset da cena nasce em `interceptor`, então o sintoma foi
> o botão **"Aplicar"** não ter sido clicado no passo 3.1. Daí o passo 3.6b.
>
> **Este bloco está fechado.** Refaça-o depois de qualquer mexida em `BALANCE`, na engine ou em
> `combat-model.ts` — o fixture versionado é uma medição, e medições envelhecem.

Procedimento canônico e completo:
[`packages/sim/fixtures/README.md`](../packages/sim/fixtures/README.md). O roteiro abaixo é o mesmo,
em forma de checklist.

Repita **3.1 a 3.6** para cada um dos três presets: **`striker`**, **`interceptor`**, **`maximo`**.

- [ ] **3.1 — Preset** — no seletor **Preset**, escolha o preset da vez e **clique em "Aplicar"**.
  Escolher no seletor não muda nada sozinho; sem o clique a cena continua com o preset anterior — e
  ela nasce em `interceptor`. Foi assim que a sétima captura produziu duas corridas de `interceptor`
  com uma delas rotulada `striker`.
- [ ] **3.2 — Seed** — digite **`1`** no campo Seed. Sempre 1, para os três.
- [ ] **3.3 — God mode e Disparo automático** — marque **as duas** caixas. "Disparo automático"
  trava o gatilho primário desde o primeiro quadro: é o que `fireUptime: 1.0` do perfil de
  habilidade do teste quer dizer, e sem ela o seu tempo de reação entra no `boss_ttk_s` medido
  (Spec 09 §5.8).
- [ ] **3.4 — Pular para o boss** — clique em **"Boss (40s)"**. A nave já sai atirando sozinha.
- [ ] **3.5 — Não encoste no teclado** — deixe a luta correr até o boss morrer. **Não** aperte
  `SHIFT` em momento nenhum: o perfil de habilidade que o teste usa tem `secondaryUptime: 0`, então
  qualquer disparo secundário invalida a captura. Mover a nave também muda a geometria dos tiros.
- [ ] **3.6 — Baixar** — clique em **"Baixar resumo"**. Salva `match-summary-seed-1.json`. Mova para
  `~/Desktop/gate-m1-m2/` renomeando para `match-summary-<preset>.json`. Anote
  `telemetry.shots_fired` e `telemetry.boss_fight_min_fps`: o primeiro entra no fixture, o segundo
  fica de registro. Nenhum dos dois invalida a captura sozinho — quem decide é o passo 3.8.

- [ ] **3.6b — Conferir que o conteúdo bate com o rótulo**

O nome do arquivo é seu; o conteúdo é da cena. Antes de seguir, confirme que os dois falam do mesmo
preset — o resumo baixado não diz qual preset foi usado, então essa é a única conferência possível:

| Preset | Arma | Confira |
|--------|------|---------|
| `striker` | `vulcan_spread`, 5 tiros/s | **`shots_fired` divisível por 3** (3 pelotas por acionamento) e cadência `shots_fired / 3 / boss_ttk_s` ≈ 5 |
| `interceptor` | `laser`, 12 tiros/s | cadência `shots_fired / boss_ttk_s` ≈ 12 |
| `maximo` | `laser`, 12 tiros/s | cadência ≈ 12, e TTK bem menor que o do `interceptor` (45 de dano contra 20) |

`accuracy_pct` é o desempate barato: o `vulcan_spread` fica na casa dos 70%, os lasers acima de 90%.

Feitos os três:

- [ ] **3.7 — Montar o fixture**

De cada JSON, leia `telemetry.boss_ttk_s`, `telemetry.shots_fired` e
`telemetry.boss_fight_min_fps`, e escreva `packages/sim/fixtures/harness-runs.json`:

```json
[
  { "preset": "striker", "seed": 1, "boss_ttk_s": 11.5, "shots_fired": 171, "boss_fight_min_fps": 29.2 },
  { "preset": "interceptor", "seed": 1, "boss_ttk_s": 9.0, "shots_fired": 108, "boss_fight_min_fps": 29.2 },
  { "preset": "maximo", "seed": 1, "boss_ttk_s": 6.5, "shots_fired": 78, "boss_fight_min_fps": 29.8 }
]
```

Esses são os valores da sétima captura, já versionados e já passando — substitua pelos seus.
`shots_fired` é obrigatório: é o segundo relógio da engine, e é ele que o teste de integridade usa
para reprovar uma captura corrompida antes de o portão de conformidade dar qualquer veredito sobre o
modelo.

- [ ] **3.8 — Rodar a conformidade**

```bash
npm run test --workspace=packages/sim
```

**Critério:** os dois testes **executam** (deixaram de pular na sétima captura) e passam para os
**três** presets. Com isso o simulador está validado contra a engine real e o item §2.2 das lacunas
está fechado.

> Uma falha da engine em `packages/sim` continua saindo no meio de 14 testes, dos quais um —
> a asserção de espalhamento por arquétipo — **já falha de propósito** e está fora de escopo aqui.
> Confira o nome do teste que falhou antes de tratar como regressão.

São dois, e a ordem importa:

1. **Integridade da captura** — `shots_fired` tem que bater com `boss_ttk_s`, porque com o gatilho
   travado uma luta de `T` segundos comporta `floor(T / intervalo) + 1` acionamentos e nunca mais
   que isso. **Se este falhar, o veredito do outro não vale nada:** o instrumento está quebrado, não
   o modelo. Foi assim que §5.10 apareceu. Não mexa em `combat-model.ts` — leia a mensagem do teste,
   que traz os dois relógios lado a lado, e ache a divergência na engine.
2. **Conformidade** — só depois, o desvio de 5% contra o TTK.

**Granularidade de relógio não é mais desculpa.** Até 2026-08-16 `boss_ttk_s` saía em segundos
inteiros e um arredondamento de ±1 s podia sozinho estourar a tolerância; hoje a cena acumula o
tempo de luta quadro a quadro e entrega uma casa decimal (Spec 09 §5.6 e §5.7). **Taxa de quadros
também não é mais desculpa:** a cadência de tiro é independente de quadro nos dois lados (§5.9) e a
cena inteira corre num relógio só (§5.10). Um desvio acima de 5% agora é sinal real — **desde que o
valor tenha passado nas duas conferências**: a de sanidade no começo do bloco
(`boss_ttk_s ≈ duration_s - 40`) e a de integridade acima.

**Se falhar por muito, e a integridade tiver passado:** **a engine é a realidade, o simulador está
errado.** Corrija `combat-model.ts`, **nunca** a tolerância do teste. Anote no §8 e trate como
bloqueador para a Fase C.

- [ ] **3.9 — Commitar o fixture**

```bash
git add packages/sim/fixtures/harness-runs.json
git commit -m "test(sim): capturar TTK real do boss para o teste de conformidade"
```

---

## Bloco 4 — Gate M1, parte 2: a dificuldade que a partida transmite

Este é o único bloco cujo critério é um **julgamento humano**, e é o ponto do gate. A pergunta é:

> **A dificuldade que o simulador prevê é a que a partida transmite?**

> ### ⚠️ A primeira rodada deste bloco foi invalidada (2026-08-16)
>
> Quatro partidas foram jogadas — 2 `interceptor`, 1 `vanguard`, 1 `striker` — e as quatro correram
> **sem arma secundária nos primeiros 6 a 12 segundos**, com a HUD mostrando PRONTO! o tempo todo.
> O defeito está descrito na [§5.13 da Spec 09](./09_GAME_BALANCE_AND_DEV_MODE.md) e já foi
> corrigido; o buraco caía todo na fase de ondas, que é justamente onde se chega ao boss com vida
> cheia ou não.
>
> **As quatro partidas não contam.** Refaça 4.1 do zero contra a build corrigida. A única leitura
> que sobrevive delas é `accuracy_pct`, que conta só a primária (§5.14).
>
> O Bloco 3 **não** foi afetado: lá o `SHIFT` é proibido e a comparação é contra
> `secondaryUptime: 0`.

- [ ] **4.1 — Cinco partidas completas**

Ainda em `npm run dev:game`, **com God mode DESLIGADO e "Disparo automático" DESLIGADO**, sem pular
fase, partida inteira do começo ao fim.

> **As duas caixas desligadas, e é o oposto do Bloco 3 de propósito.** Lá a comparação era contra
> `{ fireUptime: 1.0, secondaryUptime: 0 }`, um jogador ideal e imóvel, e o disparo automático era
> obrigatório. Aqui a comparação é contra o perfil **`mediano`** — `fireUptime: 0.7`, `accuracy: 0.55`,
> `secondaryUptime: 0.5`, `hitsTakenPerSecond: 0.4`. Gatilho travado te empurraria para perto de
> `experiente` e você compararia contra a linha errada. **Use `SHIFT`** normalmente: o `mediano` usa
> a secundária metade do tempo.
>
> **Medido na primeira rodada:** desligar o disparo automático não mudou nada — o jogador segura o
> gatilho na mão, e `shots_fired / duration_s` deu ≈100% da cadência nominal nas quatro partidas.
> Isso **não** invalida a comparação, porque o modelo só usa `accuracy × fireUptime` multiplicados
> (§5.14): o produto medido ficou em ≈49%, entre o `mediano` (38,5%) e o `experiente` (72%), bem mais
> perto do `mediano`. Continue com a caixa desligada — segurar o gatilho é comportamento de jogador
> de verdade, e é ele que queremos medir.

Distribua assim:

| # | Preset | Registre |
|---|--------|----------|
| 1 | `interceptor` | venceu? tempo até morrer/vencer |
| 2 | `interceptor` | idem |
| 3 | `striker` | idem |
| 4 | `vanguard` | idem |
| 5 | `vanguard` | idem |

- [ ] **4.2 — Comparar com o simulador**

Confronte com `~/Desktop/gate-m1-m2/sim-balance.txt`, linha `mediano`:
`interceptor` ≈15%, `striker` ≈0,4%, `vanguard` ≈46%.

> **Este bloco vale mais do que valia.** Até o Bloco 3 fechar, ele testava um simulador não
> verificado contra a mão humana e não havia como saber, em caso de discordância, de que lado estava
> o erro. Agora o TTK do modelo está confirmado a menos de 3% do da engine nos três presets — então
> uma discordância aqui aponta para o que o TTK **não** mede: esquiva, pressão de projéteis
> inimigos, e o quanto os perfis de habilidade do §5.1 (que continuam sendo chute) se parecem com
> gente de verdade.

**Critério de aprovação:** o resultado das 5 partidas é **compatível** com essas previsões. Não se
espera correspondência estatística — 5 amostras não medem 15%. O que se espera é ausência de
contradição grosseira:

- Vencer com `striker` logo de cara, ou vencer 4 de 5 no geral → **o modelo está errado**, M1 não
  passou.
- Não conseguir chegar perto de vencer com `vanguard` em nenhuma das duas → **o modelo está
  errado**, M1 não passou.
- `vanguard` visivelmente mais fácil que `striker` → **compatível**, M1 passou.

- [ ] **4.3 — Registrar o julgamento**

Escreva no §8, com suas palavras, se a dificuldade jogada bate com a prevista. **Se não bater, M1
não passou** e o simulador precisa ser corrigido antes da Fase C — a Fase D vai confiar nele.

- [ ] **4.4 — Anotar a disparidade percebida**

Independentemente do resultado: você acabou de jogar `striker` e `vanguard`. A diferença de ≈46 pp
entre eles ([§2.1 das lacunas](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md)) é gritante na mão, ou passa
despercebida? Essa impressão é o dado que falta para decidir se vale reequilibrar
`fallback-presets.ts` antes do evento — e, desde o Bloco 3, é o **único** dado que falta: o número
já não está sob suspeita.

---

## Bloco 5 — Gate M2, parte 1: ciclo completo com o `agy` real

A partir daqui é o sistema inteiro. Três terminais.

- [ ] **5.1 — Terminal 1: daemon**

```bash
npm run start:daemon
```

Esperado: sobe na porta 3000. Verifique:

```bash
curl -s localhost:3000/api/health
```

- [ ] **5.2 — Terminal 2: cockpit**

```bash
npm run start:player
```

Abra `http://localhost:5173`.

- [ ] **5.3 — Terminal 3: supervisor da forja**

```bash
npm run start:terminal
```

Esperado: o banner **"GOOGLE CLOUD SUMMIT 2026 // FORJA AGY"** e
**"AGUARDANDO NOVO PILOTO NA TELA 1..."**.

- [ ] **5.4 — (Opcional) Terminal 4: placar**

```bash
npm run start:leaderboard    # http://localhost:5174
```

### 5A — Caminho feliz, três MCPs

- [ ] **5.5 — Registro** — Callsign e Empresa na Tela 1.
- [ ] **5.6 — Sliders** — distribua os 100 PU. Confirme que a soma trava em 100 e que nenhum slider
  passa de 50 nem cai abaixo de 10.
- [ ] **5.7 — Todos os três MCPs selecionados** — `weapons-arsenal`, `hull-propulsion`,
  `cybernetics-shields`.

- [ ] **5.8 — Anotar os números projetados**

**Antes** de clicar em "Ir para a Forja", anote da tela: DPS projetado, Velocidade, HP, Escudos, e o
texto do **crachá de sinergia** no canto superior direito. Tire um print para
`~/Desktop/gate-m1-m2/`.

- [ ] **5.9 — Crachá de sinergia com o MCP dono selecionado**

Com `cybernetics-shields` **marcado** e o slider de Ataque em 40 ou mais, o crachá deve ficar
**âmbar** e prometer o bônus, ex.: `⚡ Glass Cannon (+30% DPS)`.

- [ ] **5.10 — Crachá de sinergia SEM o MCP dono** ← *comportamento novo, verifique com cuidado*

**Desmarque** `cybernetics-shields`, mantendo o Ataque em 40+.

**Critério:** o crachá fica **cinza** (não âmbar) e passa a dizer
`🔒 ⚡ Glass Cannon — requer cybernetics-shields`. **Nenhum número de bônus pode aparecer.** Se
aparecer "+30% DPS" sem o MCP marcado, é regressão — a UI voltou a prometer um bônus que a engine
não entrega.

Volte a marcar `cybernetics-shields` antes de seguir.

- [ ] **5.11 — Ir para a Forja**

**Critério adicional:** a tela de handoff **não** oferece nenhum botão de pular a forja. O
"Decolar com Nave Balanceada Padrão" foi removido de propósito — o visitante não tem saída
self-service da experiência `agy`. Se aparecer um botão desses, é regressão.

- [ ] **5.12 — A forja acontece de verdade**

No Terminal 3, o `agy` conversa com você (Fast-Grill-Me: foco de arma e tema visual). Na Tela 1, os
badges de MCP acendem ao vivo conforme as ferramentas são chamadas.

- [ ] **5.13 — `/agents` e `/mcp` listam só o desta sessão**

No prompt do `agy`, rode `/agents` e `/mcp`.

**Critério:** listam **estritamente** os componentes daquela sessão — os subagentes escolhidos e os
MCPs selecionados. Nada além. Um MCP de outro projeto aparecendo aqui é vazamento de configuração
global (Spec 03 §8).

- [ ] **5.14 — Latência do handoff < 500ms** ← *medir, não estimar*

DevTools → **Performance** → gravar **antes** de a nave ficar pronta. Pare a gravação logo depois
do canvas do Phaser aparecer com foco.

**Critério:** do evento `EVENT_SHIP_READY` até o canvas com foco, **menos de 500ms**. É a transição
que o visitante lê como "a nave ficou pronta"; meio segundo é a fronteira entre mágica e travamento.

- [ ] **5.15 — Voar a partida inteira** — 90 segundos, até o debriefing.

- [ ] **5.16 — Os números do builder correspondem à nave gerada**

```bash
cat /tmp/booth_session/ship_spec.json
```

Compare `attributes` e `weapons` com o que você anotou em 5.8, dentro da tolerância da Spec 02 §7.

**Critério:** correspondem. Divergência grande **não é bug de código** — é o `GEMINI.md` dando
margem demais ao agente, e o conserto é no prompt (Tarefa A3), não na engine.

### 5B — Um MCP só: o caminho da fórmula-base ← *cenário que já esteve estruturalmente quebrado*

Este é o cenário que motivou a reformulação do schema: com menos de três MCPs, os domínios não
selecionados são preenchidos pelo **daemon**, a partir de uma fórmula determinística derivada dos
sliders — nunca pelo agente. Antes dessa mudança, qualquer sessão com menos de três MCPs falhava a
validação **por construção**.

- [ ] **5.17 — Resetar** — `Ctrl+Shift+F12` na Tela 1.

- [ ] **5.18 — Nova sessão, só `cybernetics-shields`**

Registro novo, sliders à sua escolha, e **apenas** `cybernetics-shields` marcado. Anote os números
projetados na tela antes de seguir.

**Critério na tela:** o multiplicador de placar mostra **1.25x** (Ultra-Especialista), e os cartões
de `weapons-arsenal` e `hull-propulsion` dizem que usarão configuração padrão.

- [ ] **5.19 — Forjar e decolar**

**Critério:** a nave é gerada, valida e **decola**. Uma falha de validação aqui é exatamente a
regressão que a fórmula-base existe para impedir.

- [ ] **5.20 — Conferir a origem de cada campo**

```bash
cat /tmp/booth_session/ship_spec.json
grep -c "" /tmp/booth_session/mcp_audit.log
```

**Critério:** `weapons.*`, `max_hp`, `speed_px_s` e `hitbox_radius` batem **exatamente** com os
números que a tela do builder mostrou em 5.18 (a UI e o daemon chamam a mesma função). Só
`shield_capacity` — domínio do MCP que você selecionou — pode divergir, porque veio da calibração
real da IA. O `mcp_audit.log` deve ter linhas **apenas** de `cybernetics-shields`.

- [ ] **5.21 — Repetir com `weapons-arsenal` sozinho**

Mesmo procedimento. Agora o inverso: `weapons.*` vem da IA, e os quatro atributos vêm da fórmula-base
e precisam bater com a tela.

---

## Bloco 6 — Gate M2, parte 2: falhas provocadas

Aqui se prova que o estande não trava quando algo dá errado. **Nenhum destes cenários pode mostrar
uma mensagem de erro técnica para o visitante.**

- [ ] **6.1 — `ship_spec.json` corrompido no meio da forja**

Comece uma sessão normal. Enquanto o `agy` ainda estiver trabalhando:

```bash
echo '{ isto não é json' > /tmp/booth_session/ship_spec.json
```

**Critério:** o preset de emergência entra **sozinho**, em menos de 15 segundos, e o visitante
decola sem ver erro nenhum. O daemon deve logar o fallback; a Tela 1, não.

- [ ] **6.2 — Spec válida sem nenhuma linha de auditoria**

```bash
npm run kill:daemon && npm run start:daemon      # sessão limpa
```

Comece uma sessão, e antes de o `agy` chamar qualquer MCP, escreva à mão um `ship_spec.json`
sintaticamente válido e completo em `/tmp/booth_session/`, deixando `mcp_audit.log` **vazio**.

**Critério:** a nave **não** decola. Este é o portão de auditoria (REGRA ZERO): sem prova de que uma
ferramenta real produziu os números, a spec é recusada por mais bem-formada que esteja. Se ela
decolar, a garantia anti-alucinação está furada — **bloqueador**.

- [ ] **6.3 — `agy` morto no meio da forja**

Comece uma sessão. Com o `agy` rodando:

```bash
pkill -f agy
```

**Critério:** o fallback automático entrega uma nave e o visitante voa. Confirme no debriefing / no
JSON que `build_metadata.fallback_used` é `true`.

- [ ] **6.4 — Silêncio prolongado**

Comece uma sessão e simplesmente **não responda** ao `agy`.

**Critério:** o timeout de silêncio (15s, `AGY_SILENCE_TIMEOUT_MS`) dispara o fallback. Se você
responder e o agente já tiver chamado MCPs, vale o timeout pós-auditoria, mais generoso (90s).

---

## Bloco 7 — Gate M2, parte 3: higiene de processos

O critério central do M2. Um processo órfão por ciclo, em 8 horas de evento, derruba o estande.

- [ ] **7.1 — Resetar** — `Ctrl+Shift+F12` na Tela 1, ou:

```bash
curl -s -X POST localhost:3000/api/session/reset
```

- [ ] **7.2 — Nenhum processo sobrevivente**

```bash
ps -o pid,pgid,command -ax | grep -E 'agy|mcps/dist' | grep -v grep
```

**Critério:** **nenhuma linha.** Um `agy` ou um servidor MCP sobrevivendo ao reset é falha de M2.

- [ ] **7.3 — O supervisor volta ao banner de espera**

**Critério:** o Terminal 3 limpa a tela e volta a **"AGUARDANDO NOVO PILOTO NA TELA 1..."**, pronto
para o próximo visitante, sem intervenção manual.

- [ ] **7.4 — Cinco ciclos seguidos**

Repita registro → forja → voo → reset **cinco vezes**, rodando o comando de 7.2 após cada um.

**Critério:** zero processos órfãos nas cinco vezes, e a contagem não cresce entre ciclos. (O ensaio
de 20 ciclos é o Gate M4, na Fase D — aqui bastam cinco para detectar vazamento.)

---

## Bloco 8 — Registro de resultados

Preencha e cole no relatório de execução.

```
Data:                     ____________
macOS:                    ____________
Node:                     ____________
Commit (git rev-parse --short HEAD):  ____________
agy: [ ] real (Vertex AI)   [ ] modo simulação

Bloco 1 — sanidade                    [ ] passou  [ ] falhou
  Falhas além das duas conhecidas:    ____________________________
Bloco 2 — M1 engine offline           [ ] passou  [ ] falhou
Bloco 3 — captura de conformidade     [ ] passou  [ ] falhou  [ ] não feito
  boss_ttk_s striker:      ______     simulador: ______   desvio: ____%
  boss_ttk_s interceptor:  ______     simulador: ______   desvio: ____%
  boss_ttk_s maximo:       ______     simulador: ______   desvio: ____%
Bloco 4 — M1 5 partidas               [ ] passou  [ ] falhou
  Resultado (V/D) por preset:  int __/__   str __/__   van __/__
  A dificuldade jogada bate com a prevista? ____________________________
  A diferença striker × vanguard é perceptível na mão? ________________
Bloco 5 — M2 ciclo completo           [ ] passou  [ ] falhou
  Latência do handoff medida:  ______ ms   (teto: 500)
  Builder × ship_spec conferem?  [ ] sim  [ ] não — divergência: ______
  Crachá de sinergia trava sem o MCP dono?  [ ] sim  [ ] não
  Sessão com 1 MCP decola?  [ ] sim  [ ] não
Bloco 6 — falhas provocadas           [ ] passou  [ ] falhou
  Spec sem auditoria foi RECUSADA?  [ ] sim  [ ] NÃO ← bloqueador
Bloco 7 — higiene de processos        [ ] passou  [ ] falhou
  Órfãos após 5 ciclos:  ______

GATE M1:  [ ] fechado  [ ] não fechado
GATE M2:  [ ] fechado  [ ] não fechado

Itens novos para 11_KNOWN_GAPS_AND_OPEN_ITEMS.md:
____________________________________________________________
```

---

## Bloco 9 — Problemas comuns no macOS

**Porta 3000 ocupada.** O macOS Monterey+ usa a 5000 para o AirPlay Receiver, não a 3000 — se a 3000
estiver ocupada é resíduo de uma execução anterior:

```bash
npm run kill:daemon
```

**`setsid: command not found`.** Não existe no macOS. O `booth-terminal.sh` usa `set -m` + subshell
+ `exec` justamente para não depender dele; se você vir esse erro, algo fora do script está
chamando `setsid`.

**Bash 3.2.** É o `/bin/bash` padrão do macOS. O `booth-terminal.sh` foi escrito para ele (usa `$$`,
não `$BASHPID`). Não "modernize" o script sem testar no bash do sistema.

**O canvas do Phaser não recebe teclado.** Clique **dentro** do canvas antes de jogar. É a causa
mais comum de "a nave não se move".

**O harness de dev não abre.** `npm run dev:game` abre `/dev.html`, não `/`. Se a aba abrir na raiz,
navegue à mão para `http://localhost:5173/dev.html`.

**Downloads do harness.** "Baixar resumo" salva em `~/Downloads`, não na pasta do projeto.

**Wi-Fi.** Nos blocos 2 e 3, desligue o Wi-Fi **pelo menu do macOS**. Só desconectar do roteador
deixa o sistema tentando reconectar e pode gerar tráfego que confunde a aba Network.

---

## Bloco 10 — Preparação para M3 (uma vez)

- [ ] **10.1 — `main` atualizada, no commit certo, dependências instaladas**

```bash
git checkout main && git pull
git log --oneline -1     # deve mostrar f3172ab ou mais recente
git status --short       # vazio
npm install              # ESSENCIAL: Fase C trouxe a dependência `firebase` (admin-app e
                          # leaderboard-app) e outras novas — pular este passo faz o Bloco 11
                          # falhar no build local com "Cannot find module 'firebase/app'"
```

- [ ] **10.2 — Limpar o SQLite local antigo**

Qualquer banco de uma sessão anterior a Tarefa C8 (schema antigo) trava `saveMatch` — a Tarefa C8
já corrigiu isso com auto-cura de schema (`ALTER TABLE`), mas comece limpo mesmo assim: dados de
teste com placares inconsistentes e empresas fictícias de antes dos fixes não têm valor nenhum, e
"apagar e deixar reseedar" evita qualquer dúvida sobre o que é dado real do ensaio de hoje.

```bash
npm run reset:db
```

Confirme `s` no prompt. Critério: o comando termina sem erro, e o próximo `npm run start:daemon`
recria o banco do zero (você vai ver `[SQLiteBuffer] Banco local em ...` no log de boot).

- [ ] **10.3 — CLIs autenticados**

```bash
gcloud auth list                          # sua conta deve aparecer como ACTIVE
gcloud config get-value project           # confirme que é o projeto certo, ou deixe
                                           # PROJECT_ID=vibe-cabral explícito no Bloco 11
firebase login:list                       # sua conta deve aparecer
```

`gcloud auth login` e `firebase login` são comandos separados — logar num não loga no outro.

- [ ] **10.4 — `openssl` disponível**

```bash
command -v openssl        # o deploy.sh usa openssl rand para gerar os segredos
```

Vem instalado por padrão no macOS; só falha se você tiver removido de propósito.

- [ ] **10.5 — Pasta de resultados**

```bash
mkdir -p ~/Desktop/gate-m3
```

---

## Bloco 11 — Provisionamento na nuvem

Um projeto GCP do zero, ou um já usado antes — `deploy.sh` é idempotente nos dois casos (Bloco 11.1).

- [ ] **11.1 — Rodar o provisionamento**

```bash
npm run deploy:gcp
```

Confirme `s` no prompt. Acompanhe os 8 passos no terminal. **Pare e leia com atenção o Passo 5**
(segredos): os valores de `BOOTH_INGEST_TOKEN` e `ADMIN_PANEL_PASSWORD` só são mostrados **uma
vez**, na criação. Copie os dois para `~/Desktop/gate-m3/segredos.txt` (fora do repositório —
nunca commite isso) antes de rolar a tela.

> Se algum passo falhar por falta de permissão (IAM), você precisa de `roles/owner` ou papéis
> equivalentes (`roles/datastore.owner`, `roles/run.admin`, `roles/secretmanager.admin`,
> `roles/iam.serviceAccountAdmin`) no projeto. Resolva a permissão e rode `npm run deploy:gcp` de
> novo — os passos já concluídos (banco criado, regras publicadas) são detectados e pulados.

- [ ] **11.2 — Anotar a URL do serviço**

O último bloco do output mostra a URL do Cloud Run e lembra de configurar o estande. Anote a URL
em `~/Desktop/gate-m3/segredos.txt` também.

- [ ] **11.3 — Configurar o daemon local para falar com a nuvem**

Em `packages/daemon/.env` (crie a partir de `.env.example` se ainda não existir):

```
BOOTH_CLOUD_API_BASE=<URL do Cloud Run do passo 11.2>
BOOTH_INGEST_TOKEN=<valor gerado no passo 11.1>
```

`npm run start:daemon`/`dev` carrega este arquivo sozinho (`node --env-file-if-exists=.env`,
achado ao vivo em 2026-08-24 — antes disso `.env` era só documentação, nada lia de verdade).
Se `GET localhost:3000/api/sync/status` mostrar `"state": "disabled"` mesmo com o arquivo
preenchido, confirme que está na `main` atualizada (`git log --oneline -1`, precisa ser
`6deac4a` ou mais recente) — numa árvore mais antiga, exporte as duas variáveis no shell antes
de `npm run start:daemon` como contorno.

- [ ] **11.4 — Sem IAP, de propósito (corrigido ao vivo em 2026-08-24)**

O serviço sobe com `--allow-unauthenticated` e fica protegido só pela senha HTTP Basic
(`ADMIN_PANEL_PASSWORD`) — e **isto é a topologia final**, não um atalho de teste. A tentativa
original de usar IAP além da senha foi corrigida durante o primeiro deploy real: IAP no Cloud Run
é por serviço inteiro, sem exceção de rota, e bloquearia `/v1/matches` (a ingestão do estande)
junto com `/v1/admin/*`. `npm run deploy:gcp -- --with-iap` recusa com essa explicação em vez de
ligar algo que quebraria o estande — nada a fazer aqui além de confirmar que a senha entra
(Bloco 14.2).

---

## Bloco 12 — Gate M3, parte 1: validação contra o emulador

Antes do projeto real — mais rápido de iterar, e pega erro de configuração sem gastar cota.

- [ ] **12.1 — Emulador do Firestore**

```bash
npx firebase emulators:start --only firestore
```

Deixe rodando num terminal à parte.

- [ ] **12.2 — Build e suíte completa**

Noutro terminal:

```bash
npm run build
npm test
```

**Critério:** exatamente **duas** falhas conhecidas e nenhuma outra —
`packages/sim`'s `balance-gate.test.ts` (45,8 p.p. de espalhamento, aceito) e, **neste Mac, com o
emulador rodando na porta 8080 de verdade**, `firestore-rules.test.ts` deveria **passar** (o
Mac não tem o conflito de porta 8080 que bloqueava isto nos ambientes de desenvolvimento em
worktree). Se `firestore-rules.test.ts` falhar aqui, é um problema novo — investigue antes de
prosseguir, não assuma que é o mesmo "conflito de sandbox" de antes.

- [ ] **12.3 — Daemon local sobe apontando para o emulador**

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run start:daemon
```

**Critério:** log de boot sem erro, `GET localhost:3000/api/sync/status` responde.

Pare o emulador (`Ctrl+C` no terminal do Bloco 12.1) antes do próximo bloco — a partir daqui é
contra o projeto real.

---

## Bloco 13 — Gate M3, parte 2: ciclo completo contra o projeto real

- [ ] **13.1 — Subir as três superfícies apontando para a nuvem real**

```bash
npm run start:daemon      # Tela 1 (registro/jogo) — o player-app já vem servido em localhost:3000,
                           # não precisa de mais nada para "ligar o player"
npm run start:terminal    # Tela 2 (forja com o agy)
```

(sem `FIRESTORE_EMULATOR_HOST` desta vez — o `cloud-api` já publicado no Cloud Run fala com o
Firestore real via `BOOTH_CLOUD_API_BASE`, configurado no Bloco 11.3)

**O telão (Tela 3) é um terceiro app, separado, que precisa ser iniciado à parte** —
`npm run start:daemon`/`start:terminal` não o cobrem:

```bash
npm run dev:leaderboard
```

Antes da primeira vez, crie `packages/leaderboard-app/.env` (achado ao vivo, 2026-08-24 — o
`leaderboard-app` lê `company_rankings`/`matches` direto do Firestore pelo SDK cliente, e precisa
da mesma config de app Web que o `deploy.sh` já criou para o admin-app no Bloco 11):

```
VITE_BRIDGE_BASE=http://localhost:3000
VITE_FIREBASE_API_KEY=<mesmos valores do app Web 'jogo-navinha-web' — veja o comando abaixo>
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

```bash
firebase apps:sdkconfig WEB $(firebase apps:list --project vibe-cabral --json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const a=JSON.parse(s).result.find(x=>x.displayName==="jogo-navinha-web");process.stdout.write(a.appId)})') \
  --project vibe-cabral
```

Diferente do daemon (Bloco 11.3), este `.env` já é carregado sozinho pelo Vite — não precisa de
nenhuma flag extra.

- [ ] **13.2 — Uma partida completa, do registro ao debrief**

Registre um piloto, forje com o `agy` real, jogue até o fim.

**Critério:** o telão (a aba do `dev:leaderboard` do 13.1) mostra a partida em **menos de 1s**
depois do debrief.

- [ ] **13.3 — Os 13 campos de `MatchDocument`, não só dois**

No [Console do Firebase](https://console.firebase.google.com), projeto `vibe-cabral`, banco
`jogo-navinha`, coleção `matches`, abra o documento da partida do 13.2. Confira, contra
`packages/shared/src/types/cloud.ts`:

```
schema_version, match_id (formato UUID v4), pilot_id, callsign, company_raw, company_canonical,
company_confidence, final_score, score_breakdown (objeto completo), telemetry (objeto completo),
ship_spec_snapshot (objeto completo), created_at, needs_company_review (presente ou ausente, ok)
```

**Critério:** todos presentes e com valor plausível — `score_breakdown`, `company_raw` e
`company_confidence` são exatamente os três campos que a Tarefa C8 passou a levar até aqui; se
estiverem ausentes, a Tarefa C8 não está realmente em produção (cheque se o daemon local está na
`main` atualizada).

- [ ] **13.4 — Wi-Fi vai e volta no meio de uma partida**

Desligue o Wi-Fi **pelo menu do macOS** no meio de uma partida (não no meio da 13.2 — jogue outra).

**Critério:** o jogo não trava, o debrief aparece normalmente,
`curl -s localhost:3000/api/sync/status` mostra `"pending": 1`.

Religue o Wi-Fi.

> **Correção, achado ao vivo em 2026-08-24: "menos de 60s" está errado se a queda durou mais que
> uns 2 minutos.** O backoff é exponencial com teto de 5 minutos
> (`BASE_BACKOFF_MS * 2^consecutiveFailures`, capado em `MAX_BACKOFF_MS`) — com
> `consecutiveFailures: 8`, a próxima tentativa só dispara **256s** depois da última falha, e a
> partir de 9 falhas o teto de **300s** já valeu. Não há endpoint de "sincronizar agora"; o único
> gatilho é o fim de `POST /api/matches`. Para não esperar o timer natural durante o teste:
> `npm run kill:daemon && npm run start:daemon` (zera `consecutiveFailures` e tenta de novo
> imediatamente), ou jogue mais uma partida rápida (qualquer `POST /api/matches` novo dispara
> `syncNow()` no final, drenando a fila acumulada junto).

**Critério:** depois de reconectar (e, se o backoff já tiver crescido demais, reiniciar o daemon
ou jogar mais uma partida para forçar a próxima tentativa), o registro aparece no Firestore **uma
única vez**. Repita o envio manualmente (força reenviar o mesmo `POST /api/matches` outra vez com
o mesmo corpo) e confirme que `company_rankings` **não** soma de novo — é o teste de idempotência
da Tarefa C3.

- [ ] **13.5 — Escrita direta do navegador é recusada**

> **Correção, achado ao vivo em 2026-08-24:** `firebase.firestore().collection(...)` dá
> `ReferenceError: firebase is not defined` — não existe global `window.firebase` para chamar.
> `leaderboard-app` e `admin-app` usam o SDK modular (`import { getFirestore } from
> 'firebase/firestore'`), que o Vite empacota como módulos ES locais ao bundle, sem expor nada em
> `window`. Testar as regras pelo Console do navegador precisa ir direto na API REST do Firestore
> em vez de depender de um objeto global que nunca existiu nesta versão do SDK.

No Console do navegador (em qualquer aba, nem precisa ser a do `leaderboard-app` — a REST API não
depende do bundle carregado):

```js
fetch('https://firestore.googleapis.com/v1/projects/vibe-cabral/databases/jogo-navinha/documents/matches/x', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { final_score: { integerValue: 999999 } } })
}).then(r => r.json()).then(console.log)
```

**Critério:** a resposta tem `error.status === "PERMISSION_DENIED"` (HTTP 403) — não um objeto de
documento gravado.

- [ ] **13.6 — Callsign ofensivo recusado pela API, não só pelo formulário**

```bash
curl -s -X POST localhost:3000/api/session/start \
  -H 'Content-Type: application/json' \
  -d '{"pilot": {"callsign": "PORRA", "company_raw": "Teste"}, "energy_sliders": {...}}'
```

**Critério:** `422` com `error: "callsign_rejected"`. Repita com `"callsign": "SKILLER"` —
**Critério:** aceito (o filtro de containment não pode reprovar isto, é o achado histórico D1/A2).

- [ ] **13.7 — Empresa ofensiva não chega ao telão**

Registre com `company_raw: "PORRA LTDA"`. **Critério:** aparece como `Independente` no telão, não
o texto digitado (Tarefa C0b). Registre com `company_raw: "Startup do João"` (fora do catálogo, mas
inofensivo). **Critério:** aparece como `Startup Do João`, sem virar `Independente`.

- [ ] **13.8 — Auto-complete lê `config/companies.json` sem rebuild**

Acrescente uma empresa nova a `config/companies.json`, reinicie o daemon (`npm run kill:daemon &&
npm run start:daemon`, sem rebuildar nada), e digite as primeiras letras dela na tela de registro.

**Critério:** aparece na lista de sugestões.

- [ ] **13.9 — O banco `(default)` continua vazio**

No Console do Firebase, troque o seletor de banco de `jogo-navinha` para `(default)`.

**Critério:** nenhuma coleção nossa lá — nem `matches`, nem `pilots`, nem `company_rankings`. Se
algo aparecer, algum cliente Admin SDK esqueceu de nomear o banco (`getFirestore()` sem argumento)
— é exatamente o modo de falha silencioso que a Tarefa C2 foi desenhada para evitar.

- [ ] **13.10 — Token de ingestão expirado**

No Secret Manager, crie uma nova versão do segredo `booth-ingest-token` com lixo (`echo -n
"lixo-invalido" | gcloud secrets versions add booth-ingest-token --data-file=-`), redeployie
(`npm run deploy:gcp -- --yes`) e jogue uma partida com o daemon local ainda usando o
`BOOTH_INGEST_TOKEN` antigo (não atualize o `.env` do daemon).

**Critério:** `GET localhost:3000/api/sync/status` mostra `"state": "auth_failed"`, **não**
`"retrying"`. Corrija o `.env` do daemon com o valor certo (releia do Secret Manager: `gcloud
secrets versions access latest --secret=booth-ingest-token`), reinicie o daemon, e confirme que a
fila pendente drena sozinha — sem precisar reenviar nada manualmente.

---

## Bloco 14 — Gate M3, parte 3: painel de administração

- [ ] **14.1 — Sem senha, recusa**

```bash
curl -s -o /dev/null -w '%{http_code}\n' <URL do Cloud Run>/admin
curl -s -o /dev/null -w '%{http_code}\n' <URL do Cloud Run>/v1/admin/health
```

**Critério:** `401` nos dois.

- [ ] **14.2 — Com a senha certa, entra**

Abra `<URL do Cloud Run>/admin` no navegador. Quando o prompt nativo de login aparecer, qualquer
usuário + a senha do passo 11.1 (`ADMIN_PANEL_PASSWORD`).

**Critério:** o painel carrega, as quatro telas (Partidas, Empresas, Saúde, Rankings) respondem.

- [ ] **14.3 — Corrigir uma partida**

Na tela Partidas, mova a partida do 13.2 para outra empresa (Editar → salvar).

**Critério:** os dois agregados de `company_rankings` (a antiga e a nova empresa) acertam — confira
no Firebase Console ou na tela Rankings do próprio painel.

- [ ] **14.4 — Anular o recordista**

Jogue (ou identifique) a partida com o maior `final_score` de uma empresa. Anule-a (botão
"Anular", confirmação simples).

**Critério:** `top_individual_score` daquela empresa cai para o segundo colocado, não para zero
nem permanece o valor anulado.

- [ ] **14.5 — Seleção múltipla: anular em lote**

Selecione 2-3 partidas de teste (checkbox), clique "Anular selecionadas".

**Critério:** todas ficam marcadas `ANULADA`, os agregados refletem a remoção, e os documentos
continuam existindo (consulte no Firestore).

- [ ] **14.6 — Seleção múltipla: excluir definitivamente**

Selecione as mesmas (ou outras) partidas de teste, digite `EXCLUIR` no campo de confirmação, clique
"Excluir definitivamente".

**Critério:** os documentos **somem de verdade** do Firestore (não ficam como `ANULADA`), e — pela
Tarefa C9 + o fix wave da revisão final — **nenhum documento zerado de `company_rankings` ou
`pilots` sobra** se essa era a última partida daquela empresa/piloto. Confira diretamente no
Console: a empresa/piloto não deveria aparecer mais em `company_rankings`/`pilots` se não tinha
mais nenhuma partida real.

- [ ] **14.7 — Catálogo de empresas**

Tela Empresas: adicione uma empresa, clique em exportar. **Critério:** baixa um JSON no formato de
`config/companies.json` (`{"companies": [...]}`), pronto para copiar para o estande.

---

## Bloco 15 — Gate M3, parte 4: o teste de 10 minutos do Chrome real (Spec 08 §5)

- [ ] **15.1 — Versão exata do Chrome**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version
```

Registre no §17 — é o dado que decide se o Private Network Access do Chrome é ou não um problema
real neste hardware.

- [ ] **15.2 — Abrir o `leaderboard-app` hospedado**

Abra a URL pública do telão (não `localhost`) no Chrome.

**Critério:** carrega, mostra o selo `NUVEM` no cabeçalho, atualiza ao vivo quando uma nova partida
chega (jogue uma rápida para confirmar).

- [ ] **15.3 — Forçar a queda para o bridge local**

Bloqueie o acesso ao Firestore (desligue o Wi-Fi do Mac que roda o telão, ou bloqueie o domínio
`firestore.googleapis.com` no DevTools → Network → Network conditions, se disponível).

**Critério:** o selo vira `LOCAL` (ou `SEM SINAL`, se o bridge também não for alcançável desta
máquina), e o Chrome não bloqueia silenciosamente a chamada ao bridge local por Private Network
Access — se bloquear, é o cenário que a Spec 08 §5 pede para decidir agora: o fallback vira um
snapshot em cache no próprio Firestore, e essa é uma tarefa nova a abrir, não algo para resolver às
pressas no dia do evento.

---

## Bloco 16 — Limpeza pós-teste (opcional)

Depois de fechar M3, decida entre manter o ambiente no ar (se `vibe-cabral` já é o projeto do
evento) ou desmontar (se isto foi um projeto de teste separado, ou você quer recomeçar do zero).

- [ ] **16.1 — Manter** — nada a fazer. A senha HTTP Basic já é a topologia final (Bloco 11.4) —
  não há IAP para ligar depois.
- [ ] **16.2 — Desmontar a nuvem** (só se este NÃO for o projeto do evento):

```bash
npm run undeploy:gcp
```

Não apaga o banco Firestore por padrão. Para apagar tudo, inclusive os dados:
`npm run undeploy:gcp -- --delete-database` (pede a mesma confirmação `EXCLUIR` do painel).

- [ ] **16.3 — Limpar o estande local de novo, para o próximo ensaio**

```bash
npm run kill:all
npm run reset:db
```

---

## Bloco 17 — Registro de resultados (Gate M3)

```
Data:                     ____________
Projeto GCP:              ____________
Região:                   ____________
Commit (git rev-parse --short HEAD):  ____________
Chrome (versão exata, Bloco 15.1):     ____________
Auth do painel: só senha HTTP Basic, sem IAP (topologia final, Bloco 11.4)

Bloco 11 — provisionamento            [ ] passou  [ ] falhou
Bloco 12 — validação no emulador      [ ] passou  [ ] falhou
Bloco 13 — ciclo completo real        [ ] passou  [ ] falhou
  13.3 — 13 campos presentes?         [ ] sim  [ ] não — faltando: ____________
  13.4 — idempotência sob reenvio?    [ ] sim  [ ] não
  13.9 — (default) continua vazio?    [ ] sim  [ ] NÃO ← bloqueador
  13.10 — auth_failed distinguível?   [ ] sim  [ ] não
Bloco 14 — painel de administração    [ ] passou  [ ] falhou
  14.6 — exclusão remove agregados vazios?  [ ] sim  [ ] não
Bloco 15 — Chrome real / fallback     [ ] passou  [ ] falhou
  Private Network Access bloqueou o fallback local?  [ ] sim  [ ] não

GATE M3:  [ ] fechado  [ ] não fechado

Itens novos para 11_KNOWN_GAPS_AND_OPEN_ITEMS.md:
____________________________________________________________
```

---

## Bloco 18 — Problemas comuns específicos da nuvem

**`gcloud` pede login de novo no meio do teste.** Tokens do `gcloud auth login` expiram por
sessão; `gcloud auth login` de novo não afeta nenhum recurso já criado.

**`firebase deploy` falha com "permission denied" mesmo com `gcloud` autenticado.** São
autenticações separadas — rode `firebase login` também, não só `gcloud auth login`.

**IAM demora para propagar.** `add-iam-policy-binding` pode levar até um minuto para valer —
se o Cloud Run falhar por permissão logo após `deploy.sh` criar a service account, espere um
pouco e tente de novo antes de investigar mais fundo.

**`403` em tudo, mesmo com a senha certa.** Sintoma de `--no-allow-unauthenticated` no deploy do
Cloud Run — a plataforma recusa antes do código do serviço rodar, então nem a senha HTTP Basic nem
o token do estande chegam a ser checados. `deploy.sh` já usa `--allow-unauthenticated` desde
2026-08-24; se você vir isto, confirme que está na `main` atualizada (`git log --oneline -1`).

**`--with-iap` recusa com uma explicação.** Esperado, de propósito (não é um bug a contornar): IAP
no Cloud Run é por serviço inteiro, e ligá-lo bloquearia `/v1/matches` — a ingestão do estande —
junto com o painel. Não há flag para isentar uma rota. Rode sem `--with-iap`.

**Faturamento não habilitado.** Firestore, Cloud Run e Vertex AI exigem uma conta de faturamento
vinculada ao projeto — se `deploy.sh` falhar bem no início com um erro de billing, é isto, não um
bug do script.
