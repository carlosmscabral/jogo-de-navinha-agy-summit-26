# 12 — Plano de Teste Manual no Mac (Gates M1, M2, M3 e M6)

**Objetivo:** fechar os gates que nenhuma máquina consegue fechar sozinha —
**M1** (a engine, offline, e a dificuldade que a partida realmente transmite),
**M2** (o ciclo completo com o `agy` real, incluindo as falhas provocadas),
**M3** (a nuvem — Firestore, Cloud Run, Vertex AI — com um projeto real e o Wi-Fi na mão), e
**M6** (o grill-me de 4 perguntas, a abertura sem digitação e as dicas de pilotagem).

> **Acrescentado em 2026-08-24.** Os Blocos 0–9 abaixo são o registro original de M1/M2, fechados
> em 2026-08-16/18/22 — não foram tocados. Os Blocos 10 a 18 são para o Gate M3, depois de
> Tarefas C0–C10 mergeadas em `main`. Leia [`11_KNOWN_GAPS_AND_OPEN_ITEMS.md`](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md)
> §4.9 e §4.10 antes de começar M3 — são riscos aceitos, não bugs a caçar durante o teste.

> **Acrescentado em 2026-08-30.** Os Blocos 19–24 fecham o **Gate M6**: o grill-me de quatro
> perguntas com todas as armas e todas as cores à mostra, a abertura do terminal sem digitação
> (`agy --prompt-interactive`) e as dicas de pilotagem dos sub-agentes táticos. Não dependem de
> nuvem — rodam inteiramente na máquina do estande. Se você só quer validar esta entrega, faça o
> Bloco 19 e siga direto para o 20.

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
| 19 | M6 — preparação e sanidade da árvore | 10 min |
| 20 | M6 — abertura sem digitação e clipboard entre telas | 10 min |
| 21 | M6 — grill-me de 4 perguntas, caminho feliz | 15 min |
| 22 | M6 — combinações antes inalcançáveis (EMP) | 15 min |
| 23 | M6 — dicas de pilotagem: presença, ausência e fallback | 10 min |
| 24 | M6 — cronometragem do SLA e registro | 5 min |

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
lsof -ti :3000 -i :5173 -i :5174   # não deve retornar nada
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

No Terminal 3, o `agy` conversa com você (Fast-Grill-Me: quatro perguntas num seletor de setas). Na Tela 1, os
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

**Critério:** o fallback dispara em **135s** (`AGY_PRE_MCP_SILENCE_TIMEOUT_MS`) — este é o relógio que
vale enquanto nenhuma ferramenta MCP tiver sido chamada, e ele não é rearmado pela conversa, porque o
daemon não a enxerga. Se você responder e o agente já tiver chamado MCPs, passam a valer os relógios
mais curtos entre chamadas (30s, `AGY_SILENCE_TIMEOUT_MS`) e, depois do gate de auditoria, o mais
generoso (90s, `AGY_POST_AUDIT_TIMEOUT_MS`). Em qualquer caminho, o teto rígido de 225s
(`AGY_HARD_TIMEOUT_MS`) é a última rede. Ver [Spec 06](./06_RELIABILITY_FAILOVER_AND_SECURITY_SPEC.md) §1.1.

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

> **Correção, achado ao vivo em 2026-08-24 — três erros neste bloco, um deles travava o estande.**
> 1. O `{...}` original era um placeholder literal, não JSON válido — `curl` falhava com
>    `SyntaxError`. `energy_sliders` exige `offense`/`speed`/`defense`/`tech`.
> 2. `"selected_mcps": []` **trava a sessão**. O schema exige `minItems: 1`
>    (`packages/shared/src/schema/gen-schema.ts`), e a REGRA ZERO proíbe o `agy` de inventar
>    números sem MCP ativo — ele não consegue produzir spec válida de jeito nenhum, a tela fica
>    presa no cadastro e nenhuma sessão nova inicia. Sempre mande pelo menos um MCP.
> 3. O critério `422` estava errado para `PORRA` (veja abaixo).

`POST /api/session/start` **inicia uma sessão real do `agy`** — não é uma chamada inócua. Faça o
reset depois de cada uma das duas chamadas abaixo, senão a próxima não inicia:

```bash
curl -s -X POST localhost:3000/api/session/start \
  -H 'Content-Type: application/json' \
  -d '{"pilot": {"callsign": "PORRA", "company_raw": "Teste"}, "energy_sliders": {"offense": 25, "speed": 25, "defense": 25, "tech": 25}, "selected_mcps": ["weapons-arsenal"], "selected_subagents": []}'

curl -s -X POST localhost:3000/api/session/reset   # obrigatório antes da próxima chamada
```

**Critério:** `200` com `pilot.callsign` trocado por um `PILOTO_###` — **não** um `422`. A camada 1
(dicionário local) sanitiza o palavrão em vez de recusar, e isso é deliberado: Spec 06 diz "para
palavrão o efeito é aceitável, porque o `sanitized` vira `PILOTO_###`".

> **`422 callsign_rejected` não existe mais** (decisão do operador, 2026-08-24). A camada 2 (Vertex),
> consultada só quando a camada 1 aprova, também sanitiza para `PILOTO_###` em vez de recusar — o
> 422 chegava ao `player-app` como "verifique a conexão" e travava o visitante numa tela onde o
> codinome nem é editável. Ver a correção na Spec 05 §3.2. Um `block` da camada 2 hoje é visível só
> no log do daemon: `[Daemon] Camada 2 recusou "<nome>" (<motivo>)`.

> **A camada 2 não responde mais dentro do `/api/session/start`** (`fa3b3fb`, 2026-08-24). Ela é
> disparada ali e colhida no `POST /api/matches`, depois da partida — ver Spec 05 §3.2. Consequência
> para este bloco: a resposta do `curl` acima **sempre** traz o veredito da camada 1 e nada mais,
> mesmo para um nome que a camada 2 vá reprovar. Para observar a camada 2:
> - o log do daemon aparece alguns segundos depois do `200`, não junto dele;
> - o callsign trocado só existe no registro da partida (`local_matches` e Firestore), não na
>   resposta do registro.
>
> Para testar a camada 2 isoladamente, sem passar por uma sessão, use a bateria:
> `node scripts/moderation-bench.mjs --concurrency 1` (bate direto no `POST /v1/moderate`).
> Use `--concurrency 1`: o estande é serial, e paralelizar mede a fila do Vertex, não o serviço.

Repita trocando só o `callsign` para `"SKILLER"` (e resete de novo depois):

**Critério:** aceito, com `pilot.callsign` igual a `SKILLER` — o filtro de containment não pode
reprovar isto (achado histórico D1/A2).

> **Bug real encontrado aqui em 2026-08-24:** `SKILLER` voltava como `PILOTO_987`. A correção que
> a Spec 06 pediu ("restringir o containment a termos mais longos") nunca tinha sido implementada:
> `kill` tem 4 letras e a busca por substring na forma densa reprovava `SKILLER`, `SKILL`,
> `KILLJOY`, `COCKPIT` e `PICANHA`. Corrigido subindo o piso do containment para 5 e passando a
> normalizar leet-speak por palavra (para `k1ll`/`sh1t` continuarem barrados), com testes de
> regressão em `packages/shared/src/moderation.test.ts`.

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

## Bloco 15 — Gate M3, parte 4: o telão no Chrome real

> **Decisão registrada em 2026-08-24, durante este Gate.** A pergunta original deste bloco era
> se o Private Network Access do Chrome bloquearia a queda do telão para o bridge local. Ela
> deixou de existir, por duas decisões encadeadas:
>
> 1. **O telão é hospedado no Firebase Hosting**, não servido pelo bridge nem pelo container do
>    Cloud Run. Motivo de campo: a máquina do estande pode não conseguir tocar duas telas, então
>    o telão precisa poder rodar em outra máquina qualquer. Motivo técnico: o admin-app está
>    dentro do container porque compartilha a senha HTTP Basic de `/v1/admin/*`; o telão é
>    público, e não fala com aquela API — ele lê o Firestore direto. Ver o comentário do Passo
>    9 em `scripts/deploy.sh`.
> 2. **O telão não tem mais queda para o bridge local.** Servido por HTTPS, uma chamada a
>    `http://<ip-do-estande>:3000` é conteúdo misto: o Chrome bloqueia antes de qualquer
>    preflight, e nenhum cabeçalho (nem o `Access-Control-Allow-Private-Network` do PNA) muda
>    isso. Era um caminho que só podia falhar, em silêncio, no console de uma TV.
>
> No lugar dele, o selo passou a dizer a verdade quando os dados param — é isso que este bloco
> agora verifica. Ver o comentário no topo de `packages/leaderboard-app/src/firestore-source.ts`.

- [ ] **15.1 — Versão exata do Chrome**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version
```

Registre no §17. Não decide mais nada sobre PNA — fica como registro do que foi testado.

- [ ] **15.2 — Abrir o telão hospedado**

Abra `https://jogo-navinha-telao.web.app` no Chrome (o `deploy.sh` imprime esta URL no fim; a
linha `Hosting URL` do próprio `firebase` é a autoritativa).

> **Não é `vibe-cabral.web.app`.** Esse é o site *padrão* do projeto, e ele já hospeda outra
> aplicação sua — um PWA publicado em 15/08/2026. O telão vai para um site **dedicado**, nomeado
> em `firebase.json` (`hosting.site`), que o `deploy.sh` cria se ainda não existir. Se a criação
> falhar dizendo que o ID está em uso, é porque IDs de site são únicos no mundo inteiro: escolha
> outro em `firebase.json` e rode de novo.

**Critério:** carrega, mostra o selo `NUVEM` no cabeçalho, e atualiza ao vivo quando uma partida
nova chega — jogue uma rápida no estande para confirmar, sem recarregar a página do telão.

> **Se o selo nunca sair de `SEM SINAL`:** o build foi feito sem as seis `VITE_FIREBASE_*`. O Vite
> grava esses valores no bundle em tempo de build, e só o `deploy.sh` (Passo 6) as conhece — um
> `npm run build` na raiz produz um telão sem nuvem. Rode `npm run deploy:gcp` de novo.

- [ ] **15.3 — Cortar a rede e conferir se o selo admite**

Com o telão aberto e em `NUVEM`, desligue o Wi-Fi da máquina do telão (ou DevTools → Network →
throttling `Offline`).

**Critério, em ordem:**

1. Os números **continuam na tela** — não esvazia, não dá tela branca. São os últimos dados
   conhecidos, servidos do cache do SDK do Firestore.
2. Em alguns segundos o selo vira **`SEM SINAL`**. Esse é o comportamento novo: perder a rede
   **não** dispara o callback de erro do `onSnapshot`, então antes desta correção o telão ficava
   exibindo `NUVEM` sobre números congelados por tempo indeterminado. Quem denuncia agora é
   `metadata.fromCache`, e só chega porque as assinaturas usam `includeMetadataChanges: true`.
3. Religue o Wi-Fi: o selo volta sozinho para **`NUVEM`**, sem recarregar a página, e as partidas
   que entraram durante a queda aparecem.

**Se o passo 2 falhar** (selo continua `NUVEM` com a rede caída), é o defeito que este bloco
existe para pegar — anote no §17 e não trate como cosmético: no evento, significa um telão
mentindo sobre estar atualizado.

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

Remove o Cloud Run, os dois segredos e a service account, e **despublica o telão** do Firebase
Hosting (`hosting:disable --site` no site dedicado — o endereço passa a responder "Site Not
Found"; um `deploy.sh` futuro republica). O `--site` é o que garante que o site padrão do
projeto, com a sua outra aplicação, não seja tocado. Não apaga o banco Firestore por padrão. Para apagar tudo, inclusive os dados:
`npm run undeploy:gcp -- --delete-database` (pede a mesma confirmação `EXCLUIR` do painel).

- [ ] **16.3 — Limpar o estande local de novo, para o próximo ensaio**

```bash
npm run kill:all
npm run reset:db
```

---

## Bloco 17 — Registro de resultados (Gate M3)

> **Execução de 2026-08-24: Gate M3 FECHADO.** Projeto `vibe-cabral`, região
> `southamerica-east1`, banco `jogo-navinha`, Chrome `151.0.7922.139`. O registro completo — o que
> cada bloco provou, os cinco defeitos corrigidos durante o gate e as duas decisões de arquitetura
> que só o deploy real derrubou — está em
> [`11_KNOWN_GAPS_AND_OPEN_ITEMS.md`](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md) §3, e os resíduos adiados
> no §4.12. O formulário abaixo fica em branco de propósito: é o gabarito para a próxima execução.

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
Bloco 15 — telão no Chrome real       [ ] passou  [ ] falhou
  15.2 — selo NUVEM e atualiza ao vivo?     [ ] sim  [ ] não
  15.3 — vira SEM SINAL ao cortar a rede?   [ ] sim  [ ] NÃO ← telão mentindo
  15.3 — volta para NUVEM sozinho?          [ ] sim  [ ] não
  URL do telão (Hosting):  ____________

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

---

## Bloco 19 — Preparação e sanidade da árvore (Gate M6, uma vez)

- [ ] **19.1 — Árvore limpa, dependências e portas**

```bash
cd ~/caminho/para/jogo-de-navinha-agy-summit-26
git status --short          # precisa sair vazio
npm install
npm run kill:all            # derruba daemon, terminal e agy órfãos
lsof -ti :3000              # não deve retornar nada
```

- [ ] **19.2 — Schema regerado bate com o commitado**

```bash
npm run gen:schema
git diff --exit-code packages/shared/src/schema/ship_spec.schema.json
```

Esperado: saída vazia e código 0. Se houver diff, o JSON commitado está desatualizado — pare e
commite o regerado antes de seguir.

- [ ] **19.3 — Suíte automatizada**

```bash
npm test
```

Esperado: verde, **exceto** `packages/sim/src/balance-gate.test.ts:87` (espalhamento entre
arquétipos), que já falha na `main` e **não** é regressão desta entrega. Qualquer outra falha em
`packages/sim` é a mudança no dano da secundária — investigue antes de seguir.

- [ ] **19.4 — Nenhum vestígio do vocabulário antigo**

```bash
grep -rn "weapon_focus\|WEAPON_FOCUS_TO_TYPES\|FastGrillMeWeaponFocus" \
  packages/ --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=vendor
```

Esperado: nenhuma linha.

- [ ] **19.5 — O `agy` instalado aceita `--prompt-interactive`**

```bash
agy --help | grep -- '--prompt-interactive'
```

Esperado: uma linha com a flag. **Se não aparecer**, o Bloco 20 muda de caminho: o supervisor cai
no `agy` puro de propósito e o visitante precisa colar a frase à mão. Anote no Bloco 24 e siga —
o teste continua válido, só passa pelo caminho de contingência.

- [ ] **19.6 — Subir a pilha do estande** (dois terminais, deixe abertos até o Bloco 24)

```bash
# Terminal A
npm run start:daemon
# Terminal B
npm run start:terminal
```

Esperado: A serve o player-app em `http://localhost:3000`; B mostra o banner cobalto
`ESTAÇÃO DE ENGENHARIA PRONTA`. Abra `http://localhost:3000` no Chrome.

---

## Bloco 20 — Abertura sem digitação e clipboard entre telas

- [ ] **20.1 — Chegar na tela do AGY**

Percorra atrai → registro (callsign `TESTE01`, empresa qualquer) → briefing → sliders (deixe o
padrão, os 3 MCPs, `combat-strategist`) → **Iniciar Forja**.

Esperado: a tela 1 entra no ramo de espera e o Terminal B troca para o banner âmbar
`🚀 PILOTO CONECTADO: TESTE01` e lança o `agy`.

- [ ] **20.2 — O terminal começa sozinho** ← *asserção central do bloco*

Não toque em nada. Esperado: o `agy` sobe já processando a frase de abertura e a **primeira coisa
na tela** é o menu do Fast Grill-Me. Ninguém digitou nem colou nada.

Se em vez disso o `agy` abrir num prompt vazio, confira o aviso âmbar do Terminal B
(`⚠ Este 'agy' não suporta --prompt-interactive`) e siga pelo caminho de contingência (20.3–20.5).

- [ ] **20.3 — O bloco de contingência existe, e é discreto**

Na tela 1, **entre** a caixa "Converse com o `agy` no terminal ao lado" e a barra de tempo:
uma linha baixa com o rótulo *"Se o terminal não começar sozinho, cole isto:"*, a frase em
monoespaçado e um botão **Copiar**.

Esperado: é um rodapé discreto, não a instrução principal da tela. Nada de múltiplos exemplos,
nada de callsign interpolado — a frase é a mesma para todo visitante.

- [ ] **20.4 — Copiar de fato copia**

Clique em **Copiar**. Esperado: o ícone vira ✓ e o rótulo vira "Copiado" por ≈2s, depois volta.

- [ ] **20.5 — Colar na tela 2 funciona**

No Terminal B, cole com `Cmd+V` (macOS) / `Ctrl+Shift+V` (terminal Linux) e dê Enter.

Esperado: o texto colado é **exatamente** a frase da tela 1. **Se a colagem falhar** (Chrome kiosk
sem permissão de área de transferência, ou X/Wayland sem área compartilhada), anote no Bloco 24 e
**digite a frase à mão** para não travar os blocos seguintes — ela foi escolhida curta exatamente
por isso.

- [ ] **20.6 — O agente começa pelo PASSO 1, sem enrolação**

Esperado: a primeira coisa na tela é o seletor da `Question 1/4`, **sozinho**. Não pode haver
saudação, resumo do protocolo, pergunta sobre o que o piloto quer, anúncio de quantas perguntas vêm
pela frente, nem chamada de ferramenta MCP antes dele.

---

## Bloco 21 — Grill-me de 4 perguntas, caminho feliz

- [ ] **21.1 — O grill-me é um seletor, não um texto para digitar**

Esperado: o `agy` chama a ferramenta `ask_question` e o CLI desenha o widget de seleção — cabeçalho
`Question 1/4`, opções numeradas por ele, cursor `>` na primeira e a linha
`[Use arrow keys to navigate, Enter to select]`.

**Ande com a seta para baixo e confirme com Enter.** O cursor tem que se mover. Se em vez do widget
aparecer texto corrido pedindo que você digite um número, o agente caiu no plano B do PASSO 1 (o
caminho para quando `ask_question` não existe) — anote no Bloco 24, porque é a feature inteira que
falhou, ainda que a sessão siga funcionando.

O agente **não** pode escrever nada antes nem depois da chamada — nem saudação, nem comentário
sobre a escolha entre uma pergunta e outra.

- [ ] **21.2 — Cada opção vem descrita, e todas as opções estão à mostra**

Confira, pergunta por pergunta. As três primeiras trazem `Rótulo — descrição` em cada opção; a
quarta lista só os rótulos. A numeração é do CLI: não pode haver número duplicado (`1. 1) Laser`).

- `Question 1/4` tem **3** opções descritas: Laser Contínuo, Canhão de Plasma, Vulcan em Leque
- `Question 2/4` tem **2** opções descritas: Mísseis Teleguiados e Pulso EMP — e o EMP diz que
  **não fere o boss**
- `Question 3/4` tem **3** temas, cada um com a forma do casco descrita
- `Question 4/4` tem **6** cores nomeadas (Rosa Choque, Ciano Elétrico, Verde Ácido, Vermelho
  Sangue, Dourado Royal, Branco Gélido)

`Sem armamento secundário` **não** pode aparecer. As descrições longas podem quebrar em duas linhas
— isso é esperado; o que não pode é vir **truncada**, com a frase cortada no fim da linha.

O CLI acrescenta sozinho uma última opção `Write-in...` em cada pergunta. Ela é dele, não nossa:
confira que ela aparece **uma vez só** por pergunta (se aparecer duas, o prompt está declarando uma
opção que o CLI já dá de graça).

- [ ] **21.3 — As quatro perguntas vêm de uma chamada só**

Percorra as quatro com as setas: Laser Contínuo → Mísseis Teleguiados → Synthwave 80s → Ciano
Elétrico.

Esperado: o cabeçalho caminha `Question 1/4`, `2/4`, `3/4`, `4/4` **sem pausa de processamento
entre elas** — não há ida e volta ao modelo no meio, o CLI resolve localmente. Depois da quarta o
agente vai **direto** ao PASSO 2 (chamadas MCP), sem resumir as escolhas e sem perguntar se pode
começar.

> **Cronometre este bloco.** Da `Question 1/4` até a primeira chamada MCP aparecer na Tela 1. Esse
> intervalo tem que caber em `AGY_PRE_MCP_SILENCE_TIMEOUT_MS` (`daemon/src/index.ts`), que é um
> orçamento total de sessão-até-primeira-ferramenta, **não** um relógio de silêncio: ele é armado
> uma vez e nunca rearmado.
>
> O valor atual (135s) foi calibrado para o formato anterior, de quatro turnos de texto com uma ida
> e volta ao modelo em cada. Com uma chamada só, a latência do Gemini quase some do orçamento e
> sobra tempo de leitura humana. **Espera-se folga grande.** Anote o número mesmo assim: é ele que
> autoriza (ou não) baixar o pré-MCP e o teto rígido depois, conforme a nota de 2026-09-01 da
> [Spec 06](./06_RELIABILITY_FAILOVER_AND_SECURITY_SPEC.md) §1.1.

- [ ] **21.3b — O `Write-in...` não deixa passar escolha inválida**

Numa sessão nova, na `Question 1/4` escolha `Write-in...` e digite `um canhão de fótons`.

Esperado: o agente **repergunta só aquela pergunta**, com o mesmo widget e as mesmas três opções.
Não pode adivinhar qual você quis dizer, não pode reiniciar o grill-me do zero e não pode seguir em
frente com a escolha em branco.

Repita escolhendo `Write-in...` e digitando `Canhão de Plasma` — texto que **corresponde** a uma
opção. Aí sim ele deve aceitar e seguir.

- [ ] **21.3c — Duas inválidas voltam numa reperguntada só**

Sessão nova. Use `Write-in...` em **duas** perguntas não adjacentes — primária e casco — com texto
absurdo (`picanha` e `lazanha` servem), e responda a secundária e a cor normalmente, pelo seletor.

Esperado: **uma** reperguntada com **duas** perguntas (`Question 1/2` e `2/2`), a primária e o
casco, com as opções de sempre. A secundária e a cor **não** reaparecem — o que já foi respondido
fica. Duas reperguntadas separadas custam um turno de modelo a mais do orçamento pré-MCP medido em
21.3; se acontecer, anote no Bloco 24.

Confirme que o texto absurdo não sobreviveu em lugar nenhum:

```bash
jq '.build_metadata.fast_grill_me_choices' /tmp/booth_session/ship_spec.json
```

Esperado: os quatro slugs válidos das escolhas **corrigidas**, e nenhum vestígio de `picanha`.
Passou em 2026-09-01 com `plasma` / `homing_missiles` / `cyberpunk_gold` / `branco_gelido`.

- [ ] **21.3d — As quatro inválidas voltam as quatro**

Sessão nova. Use `Write-in...` nas **quatro** perguntas, com o mesmo texto absurdo em todas
(`lerolero` serve).

Esperado: uma reperguntada com as **quatro** perguntas, `Question 1/4` a `4/4`. Este é o caso em que
duas regras do prompt se encostam — "leve exatamente as perguntas inválidas, todas juntas" contra
"nunca repita as 4 por causa de uma" — e o certo é reperguntar as quatro, porque não há *uma*
causando o repique. Passou em 2026-09-01.

- [ ] **21.3e — Texto livre que acerta a opção é aceito**

Sessão nova. Responda as quatro por `Write-in...`, cada uma numa forma diferente do rótulo:
`Plasma` (só o slug), `EMP` (rótulo abreviado), o **rótulo inteiro com a descrição** colado do
seletor, e `Rosa Choque` (rótulo exato).

Esperado: as quatro aceitas de primeira, **sem nenhuma reperguntada**. Um piloto que digita a
resposta certa e mesmo assim é reperguntado conclui que o estande está quebrado — é uma falha pior
que a do texto absurdo, que ao menos é culpa dele. Passou em 2026-09-01.

- [ ] **21.3f — Esc não deixa o piloto preso**

Sessão nova. Com o seletor na tela, aperte **Esc**.

Esperado, em duas partes. Primeiro o fato conhecido: o Esc **cancela o turno sem encerrar a
sessão** — o seletor some e sobra o prompt do `agy` aberto. Isso é comportamento do CLI e não tem
conserto do nosso lado. Depois, a recuperação: digite qualquer coisa que não seja uma resposta
(`oi`, `?`, `o que eu faço`) e o agente tem de **reemitir o seletor imediatamente**, com as
perguntas que ainda faltam e sem uma palavra de conversa, saudação ou desculpa. As respostas já
dadas não podem reaparecer.

Se em vez disso ele conversar, se apresentar, ou perguntar se você quer continuar, a regra de
recuperação do `AGENTS.md` não pegou — anote no Bloco 24.

Teste também a variante de abandono: aperte Esc e **não digite nada**. Esperado: nada acontece por
até 135s e então o daemon entrega o preset de emergência (é o orçamento pré-MCP, armado uma vez no
início da sessão e nunca rearmado). A tela 1 deve mostrar o aviso de nave de preset, não travar.

- [ ] **21.4 — O arquivo grava as quatro chaves**

```bash
jq '.build_metadata.fast_grill_me_choices' /tmp/booth_session/ship_spec.json
```

Esperado exatamente:

```json
{ "primary_weapon": "laser", "secondary_weapon": "homing_missiles",
  "visual_theme": "synthwave_80s", "accent_color": "ciano_eletrico" }
```

Nenhum `weapon_focus`. Se o Ajv tiver rejeitado, `spec_errors.txt` existe — leia-o e anote.

- [ ] **21.5 — A cor escolhida chega no casco**

```bash
jq '.visuals' /tmp/booth_session/ship_spec.json
```

Esperado: o ciano `#00f3ff` (ou vizinho próximo) aparece em `primary_color` **ou** em
`engine_trail_color`. Na tela de pré-voo, o casco desenhado deve ler como ciano, não como a
paleta padrão de outro tema.

- [ ] **21.6 — Segunda sessão: só a cor muda**

Reinicie (`Ctrl+Shift+F12` na tela 1), refaça o fluxo e selecione Laser + Mísseis + Synthwave +
Vermelho Sangue — **mesmo** tema da sessão anterior, cor diferente.

Esperado: a **geometria** do casco continua reconhecivelmente Synthwave; só a paleta muda. Se a
silhueta mudar radicalmente, o `aesthetic-designer` está deixando a cor governar a estrutura —
anote no Bloco 24.

---

## Bloco 22 — Combinações antes inalcançáveis

O ponto do bloco: `emp_burst` nunca foi escolhível por um visitante até esta entrega.

- [ ] **22.1 — Plasma + EMP**

Nova sessão. Selecione Plasma + EMP + Cyberpunk Gold + Dourado Royal.

```bash
jq '.weapons, .build_metadata.fast_grill_me_choices' /tmp/booth_session/ship_spec.json
```

Esperado: `weapons.primary.type == "plasma"` **e** `weapons.secondary.type == "emp_burst"`. Esta é
a asserção central da mudança em `computeBaselineWeapons` — antes, qualquer resposta produzia
`homing_missiles`.

- [ ] **22.2 — O EMP se comporta como EMP na partida**

Decole. Aperte **Shift** contra um grupo de drones.

Esperado: anel de EMP visível, drones no raio levam dano, e **projéteis inimigos dentro do raio
somem** (utilidade defensiva, `MainGameScene.ts:1033`). O HUD confirma o disparo.

- [ ] **22.3 — O EMP não fere o boss, e o jogo avisou**

Sobreviva até o Cyber Overlord e aperte Shift perto dele.

Esperado: **zero** dano ao boss (é por construção — `combat-model.ts:311-314`). E, crucialmente:
a dica do `combat-strategist` no pré-voo **já tinha avisado disso**. Se ela não avisou, o texto da
persona está fraco — anote no Bloco 24.

- [ ] **22.4 — Laser + EMP, só para confirmar que o par é livre**

Nova sessão, selecione Laser + EMP + Dark Void Stealth + Rosa Choque. Esperado: `laser` +
`emp_burst` gravados. Não precisa jogar.

- [ ] **22.5 — Um MCP só, para exercitar a fórmula-base**

Nova sessão; nos sliders **desmarque** `weapons-arsenal`, deixando só `hull-propulsion`; escolha
`systems-engineer`. Selecione Vulcan + Mísseis + Dark Void Stealth + Verde Ácido.

**Não procure `weapons` no arquivo.** Com `weapons-arsenal` desmarcado o contrato autoriza o agente
a omitir o bloco inteiro, e o daemon **não reescreve** o `ship_spec.json`: `applyBaselineForUnselectedMcps`
roda em memória (`file-watcher.ts:217`) e só o objeto já preenchido é validado e transmitido.
`jq '.weapons'` no disco devolvendo `null` é o esperado, não uma falha.

```bash
jq '.build_metadata.fast_grill_me_choices' /tmp/booth_session/ship_spec.json
```

Esperado: `"primary_weapon": "vulcan_spread"` e `"secondary_weapon": "homing_missiles"`, e a nave
**aceita** (sem `spec_errors.txt`, pré-voo alcançado). As duas coisas juntas provam o caminho:
`weapons.primary.type` é `required` no schema, a validação roda depois do backfill, e o backfill só
monta o bloco a partir desses dois campos (`file-watcher.ts:291-293`) — se a nave decolou, ele usou
os tipos escolhidos. Confirme na tela: a linha **Armamento** do pré-voo lê do spec liberado
(`HandoffTerminalScreen.tsx:251-253`) e deve dizer "Vulcan em Leque" e "Mísseis Teleguiados".

---

## Bloco 23 — Dicas de pilotagem

- [ ] **23.1 — As dicas chegam no arquivo**

Em qualquer sessão bem-sucedida dos blocos anteriores:

```bash
jq '.build_metadata.pilot_tips' /tmp/booth_session/ship_spec.json
```

Esperado: array com **2** strings em português, no imperativo, cada uma ≤140 caracteres, falando
de **pilotagem** (fugir, sustentar tiro, guardar a secundária) e não repetindo números que a tela
já mostra.

- [ ] **23.2 — As dicas aparecem no pré-voo, no lugar certo**

Esperado: painel entre a grade de stats e o botão de decolagem, com o rótulo do especialista
(`Estrategista Tático` ou `Engenheiro de Sistemas`) na cor do `SUBAGENT_CATALOG`. Nada abaixo de
14px.

- [ ] **23.3 — As dicas combinam com o build**

Compare a dica com os sliders da sessão. Um build de casco baixo tem que falar em fugir; um de
cadência alta, em sustentar o tiro. Se a dica for genérica ("pilote bem, boa sorte"), a persona
está fraca — anote.

- [ ] **23.4 — Ausência de dica não derruba a nave**

Com uma sessão viva, edite o arquivo à mão para remover o campo e force um novo processamento:

```bash
jq 'del(.build_metadata.pilot_tips)' /tmp/booth_session/ship_spec.json > /tmp/s.json \
  && mv /tmp/s.json /tmp/booth_session/ship_spec.json
```

Esperado: a nave continua **aceita** (nada de `spec_errors.txt`), o painel de dicas simplesmente
**não é renderizado** — sem placeholder, sem "nenhuma dica disponível" — e o botão de decolar
funciona.

- [ ] **23.5 — Dica malformada também não derruba**

Repita gravando `"pilot_tips": "uma string só"` (tipo errado).

Esperado: `normalizeSpec` omite o campo, a nave é aceita, o painel some. **Não** pode aparecer
`SCHEMA_INVALID`.

- [ ] **23.6 — Preset de emergência traz dica própria**

Force o timeout: inicie uma sessão e **não** digite nada no `agy`.

O relógio que dispara aqui é o de **pré-conversa**, `AGY_PRE_MCP_SILENCE_TIMEOUT_MS` = **135s**
(`daemon/src/index.ts`), não o teto rígido de 225s: sem digitar nada nenhum MCP roda, e o daemon
nunca sai do primeiro nível da escada de silêncio. Se quiser encurtar a espera, suba o daemon com o
valor reduzido — o mecanismo exercitado é o mesmo:

```bash
AGY_PRE_MCP_SILENCE_TIMEOUT_MS=15000 npm run start:daemon
```

Esperado: a tela mostra o aviso de nave de preset de emergência **e** o painel de dicas com a dica
fixa daquele preset. O caminho que salva a demonstração não pode ser o único sem a feature.

Qual preset aparece depende dos sliders (`fallback-selector.ts:14-18`): `striker` = `offense`,
`interceptor` = `speed + tech/2`, `vanguard` = `defense + tech/2`, maior afinidade vence com
desempate fixo nessa ordem. Com os sliders padrão (35/35/15/15) sai o **interceptor**, cuja primeira
dica é *"Casco fino: fique em movimento e use os corredores laterais..."*.

---

## Bloco 24 — SLA e registro (Gate M6)

- [ ] **24.1 — Passada cronometrada, do zero**

`Ctrl+Shift+F12`, cronômetro na mão, uma passada completa como visitante que nunca viu o estande:
atrai → registro → briefing → sliders → o terminal abre já perguntando → 4 respostas → pré-voo →
90s de partida → debrief.

**Alvo ≤ 2m30s, teto 3m00s** (descontando os 90s de partida, que são fixos).

A abertura automática do terminal deve *encurtar* a hesitação na tela do AGY. As quatro perguntas
sequenciais não podem comer esse ganho. **Se estourar o teto:** cortar a `Question 4/4` de cor — o
`accent_color` volta a ser o `signature_accent` do tema via backfill do `normalizeSpec`, que já
existe, então é tirar uma entrada do array `questions` e nada mais.

> **Compare com o tempo anotado em 21.3.** São dois orçamentos diferentes e o menor não é o do
> SLA: a jornada tem 3m00s de teto, mas a fase entre a abertura da sessão e a primeira chamada MCP
> tem só `AGY_PRE_MCP_SILENCE_TIMEOUT_MS`. Uma passada pode caber folgada no SLA e ainda assim
> receber nave de preset por estourar aquele orçamento no meio do grill-me.

- [ ] **24.2 — Higiene de processos**

```bash
npm run kill:all
lsof -ti :3000        # vazio
pgrep -fl agy         # vazio
```

- [ ] **24.3 — Tabela de registro**

| # | Passo | Passou? | Observação |
|---|-------|---------|------------|
| 19.5 | `agy` aceita `--prompt-interactive` | | |
| 20.2 | Terminal começa sozinho | | |
| 20.5 | Clipboard entre telas (contingência) | | |
| 20.6 | Agente começa no PASSO 1 | | |
| 21.1 | Seletor de setas, não digitação | | |
| 21.2 | Toda opção descrita e à mostra | | |
| 21.3 | Grill-me até a 1ª chamada MCP | | ____ s (orçamento pré-MCP) |
| 21.3c | Duas inválidas numa reperguntada só | | |
| 21.3d | Quatro inválidas voltam as quatro | | |
| 21.3e | Texto livre certo é aceito de primeira | | |
| 21.3f | Esc: o seletor volta sozinho | | |
| 21.4 | Quatro chaves gravadas | | |
| 21.6 | Cor muda, geometria não | | |
| 22.1 | Plasma + EMP alcançável | | |
| 22.3 | Dica avisou sobre o EMP vs. boss | | |
| 23.3 | Dica combina com o build | | |
| 23.4 | Ausência de dica não rejeita | | |
| 23.6 | Preset de emergência tem dica | | |
| 24.1 | Tempo total medido | | ____ min ____ s |

---

## Bloco 25 — O cartão SVG da nave (nuvem, assíncrono)

> **Pré-requisitos:** este bloco só roda contra o projeto real, depois de um `./scripts/deploy.sh`
> que já inclua o passo 9/11 (serviço `jogo-navinha-cardgen` + gatilho Eventarc). Não há como
> exercitá-lo com o emulador: o gatilho é infraestrutura de nuvem. Estimativa: 20 min.

A entrega inteira se resume a uma promessa — **o cartão é desenhado fora do fluxo do jogo**. O 25.1
é o passo que prova isso; os outros verificam o desenho e a ausência de laço. Ao longo do bloco,
troque `<MATCH_ID>` pelo id da partida em teste e use este atalho para ler o documento:

```bash
read_match() {
  curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    "https://firestore.googleapis.com/v1/projects/vibe-cabral/databases/jogo-navinha/documents/matches/$1"
}
```

- [x] **25.1 — A jornada não muda de duração, e o cartão chega depois**

Jogue uma partida completa como visitante, com o cronômetro na mão, exatamente como no 24.1.

**Critério de SLA, o que importa de verdade:** o tempo total continua **≤ 2m30s (teto 3m00s)**,
idêntico ao medido no 24.1 **antes** desta entrega. Nenhum segundo a mais. Se a jornada engordou,
alguma coisa entrou no caminho síncrono e a entrega está errada — não é questão de ajuste fino.

Só **depois** do debrief, com o visitante já fora do estande, comece a cronometrar o cartão:

```bash
read_match <MATCH_ID> | jq '.fields.ship_card_version, (.fields.ship_card_svg.stringValue | length)'
```

**Critério:** em segundos (dezenas, no pior caso, por causa do cold start com `--min-instances 0`),
`ship_card_version` = `1` e o SVG tem algumas centenas de bytes. **Um atraso aqui não é defeito** —
o consumo é "bem depois do jogo jogado".

- [x] **25.2 — A nave do cartão é a nave do pré-voo**

O caminho rápido é o painel de admin: `<URL do Cloud Run>/admin` → Partidas → busque a partida. A
coluna **Nave**, a primeira da tabela, mostra a miniatura.

Para olhar em tamanho grande, salve e abra no navegador:

```bash
read_match <MATCH_ID> | jq -r '.fields.ship_card_svg.stringValue' > /tmp/nave.svg && open /tmp/nave.svg
```

**Critério:** é a **mesma nave** que o piloto viu no pré-voo — mesmo casco, mesma cor primária,
mesmo contorno — com o anel de escudo se a build tinha escudo. Fundo transparente, sem callsign,
sem score, sem texto nenhum além do `<title>` com o nome do estilo (aparece como tooltip).

- [x] **25.3 — Build sem escudo: sem anel, mesmo enquadramento**

Repita numa partida cuja build tenha `shield_capacity == 0`. Duas condições, e as **duas** são
necessárias:

1. **`Tecnologia` no mínimo (10)** — é o slider `tech` que governa o escudo
   (`baseline-ship-stats.ts:66`), não o `defense`, que governa `max_hp`. O arredondamento dá `0`
   até `tech = 16`, mas deixe no mínimo para não depender disso.
2. **Não selecionar "Cibernética & Escudos"** — é o único MCP que calibra `shield_capacity`
   (`mcp-catalog.ts:121`) e o único que destrava sinergias, entre elas a `titan_fortress`, que
   força `min_shield_capacity: 2` (`balance.ts:203`).

```bash
read_match <MATCH_ID> | jq -r '.fields.ship_card_svg.stringValue' | grep -c '<circle'
```

**Critério:** `0` círculos, e — abrindo os dois SVGs lado a lado — o casco do 25.3 tem **o mesmo
tamanho e a mesma posição** do casco do 25.2. O `viewBox` é constante de propósito, para que uma
galeria futura não tenha naves pulando de escala conforme tenham escudo ou não.

- [x] **25.4 — Nenhum laço de eventos**

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="jogo-navinha-cardgen"' \
  --project vibe-cabral --limit 50 --freshness 30m --format='value(timestamp,textPayload)'
```

**Critério:** **uma** invocação para a partida do 25.1. Se aparecerem duas (o Pub/Sub pode
reentregar, e isso é normal), a segunda tem de registrar `up_to_date` e não gravar nada. O que **não
pode** existir é uma cadeia crescente — seria sinal de que a gravação de volta está disparando o
próprio gatilho.

- [x] **25.5 — Anular a partida preserva o cartão**

No painel de admin, anule a partida do 25.1 (botão "Anular").

**Critério:** a linha fica `ANULADA`, a miniatura da coluna Nave **continua lá**, e o
`gcloud logging read` do 25.4 **não** ganha invocação nova — `patchMatch` grava com `update`, e o
gatilho só escuta criação.

- [x] **25.6 — Reentrega manual é inofensiva**

Simule o que o Eventarc faria numa reentrega:

```bash
CARDGEN_URL=$(gcloud run services describe jogo-navinha-cardgen \
  --region southamerica-east1 --project vibe-cabral --format='value(status.url)')

curl -s -o /dev/null -w '%{http_code}\n' -X POST "$CARDGEN_URL/internal/cardgen" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "ce-subject: documents/matches/<MATCH_ID>"
```

**Critério:** `200`, e o documento **byte-idêntico** ao de antes (compare o `length` do 25.1). Sem o
cabeçalho `ce-subject`, a mesma chamada devolve `204` — falha permanente, que o Eventarc não deve
reentregar.

> Se o `curl` devolver `403`, sua conta não tem `run.invoker` no serviço; é esperado — o serviço
> sobe com `--no-allow-unauthenticated` e só a service account do gatilho o alcança. Conceder o
> papel a si mesmo só para este passo é aceitável, mas **remova depois**.

- [x] **25.7 — Preset de emergência: silhueta neutra, cores do preset**

Force o preset como no 23.6 (não digite nada e deixe estourar `AGY_PRE_MCP_SILENCE_TIMEOUT_MS`),
jogue e sincronize.

**Critério — e leia com atenção, porque a expectativa intuitiva está errada:** o cartão sai com a
**silhueta neutra** (o triângulo padrão), pintada com as **cores do preset**. Não com a geometria do
preset.

Isso não é bug, é fidelidade: os `FALLBACK_PRESETS` trazem **marcação SVG** em `svg_path_data`
(`<polygon .../>` e companhia), não comandos de path. O jogo e o pré-voo já recusam esse conteúdo
hoje (`isDrawablePathData` / `usesForgedHull`) e desenham a nave procedural. O cartão faz o mesmo —
mostrar os polígonos do preset seria mostrar ao consumidor futuro uma nave que o visitante **nunca
viu na tela**. Confira lado a lado com a tela de pré-voo daquela sessão: têm de bater.

- [x] **25.8 — Backfill das partidas antigas, primeiro em seco**

As partidas anteriores ao gatilho (todo o Gate M3, por exemplo) nunca receberão evento.

```bash
gcloud auth application-default login   # se ainda não tiver ADC
npm run backfill:cards                  # dry-run: só conta
```

**Critério:** o resumo lista quantas partidas seriam gravadas e mostra o primeiro SVG gerado, **sem
escrever nada** (rode duas vezes: os números têm de ser iguais). Depois:

```bash
npm run backfill:cards -- --apply
```

Uma segunda passada com `--apply` tem de gravar **0** — é a prova da idempotência.

> Publique os índices **antes** do primeiro `--apply` (`deploy.sh` passo 3/11 já roda
> `firebase deploy --only firestore:...`), senão a escrita em massa gera índice de
> `ship_card_svg` que a isenção apaga logo em seguida.

- [x] **25.9 — Tabela de registro**

Execução de 2026-09-06, contra `vibe-cabral` / `jogo-navinha`, revisão
`jogo-navinha-cardgen-00001-998` (imagem de `5609018`). Partidas de referência:
`ead7e4f2-8389-4b16-a11e-67fd1bf0ddfc` (com escudo) e
`2d59afaa-09da-4bbd-bcfc-5067d50ca22d` (sem escudo).

| # | Passo | Passou? | Observação |
|---|-------|---------|------------|
| 25.1 | Jornada não mudou de duração | ✅ | operador reportou a jornada igual à de sempre, com a geração do cartão **imperceptível** ao visitante. Não cronometrada ao segundo |
| 25.1 | Cartão chegou depois do debrief | ✅ | com instância fria, alguns segundos; com instância quente, **1,55 s** de ponta a ponta (`createTime` 15:10:41,337 → `updateTime` 15:10:42,885) |
| 25.2 | Cartão é a nave do pré-voo | ✅ | casco `#ffd700` com contorno `#ff6600`, anel de escudo presente; confere com a coluna Nave do painel |
| 25.3 | Sem escudo: sem anel, mesmo enquadramento | ✅ | build com `Tecnologia` no mínimo e sem `cybernetics-shields` → `shield_capacity: 0`, **zero** `<circle>`, mesmo `viewBox` `-24 -24 176 176`, 411 bytes. Uma invocação, `written` |
| 25.4 | Uma invocação, sem laço | ✅ | uma linha `written`, sem cadeia. Reforçado pelo 25.8: 48 `update` em massa não acordaram o gatilho nenhuma vez |
| 25.5 | Anular preserva o cartão | ✅ | painel mostra a flag `ANULADA` na coluna própria e a miniatura da nave intacta ao lado. No documento: `voided: true`, SVG **byte-idêntico**, e o `updateTime` avançou (15:12:39) — a escrita ocorreu de fato e ainda assim **nenhuma** invocação nova do gatilho |
| 25.6 | Reentrega devolve 200 sem reescrever | ✅ | 200 + `up_to_date`, documento byte-idêntico (mesmo `updateTime`). As três falhas permanentes devolveram 204: sem `ce-subject`, coleção errada, documento inexistente |
| 25.7 | Preset: silhueta neutra com as cores certas | ✅ | correlação perfeita sobre 49 partidas reais: **12/12** com `fallback_used: true` saíram na silhueta neutra com a paleta do preset, **37/37** forjadas saíram com geometria própria |
| 25.8 | Backfill em seco não escreve; `--apply` é idempotente | ✅ | 49 varridas, 48 gravadas, segunda passada gravaria 0. Isenções de índice conferidas publicadas antes (`ship_card_svg` e `ship_spec_snapshot.visuals.svg_path_data`, ambas com 0 entradas) |

**Brinde de verificação, fora do plano original:** o SVG renderizado localmente a partir do spec da
partida saiu **byte-idêntico** ao que a nuvem gravou. A imagem no ar roda o mesmo renderizador de
`@jogo/shared`, sem drift entre o que o teste local afirma e o que o estande vai produzir.

---

## Bloco 26 — Dois estandes simultâneos contra o mesmo placar

> **Pré-requisitos:** este bloco roda contra o projeto real (`vibe-cabral` / `jogo-navinha`), depois
> de um `npm run deploy:gcp` que já inclua a entrega de dois estandes (`GET /v1/companies`, pull de
> catálogo e aliases no daemon, `station_id`/`played_at`, fila de celebração no telão). ADC do
> operador (`gcloud auth application-default login`). Estimativa: 30 min, mais 10 min se você fizer
> o 26.2 nos dois Macs de verdade.

O que este bloco cobre é o que **um Mac só não prova sozinho e um emulador não prova nunca**: o
`company_canonical` é o ID do documento em `company_rankings`, então dois Macs casando nomes contra
listas diferentes racham a mesma empresa em dois rankings — em silêncio, porque as duas grafias
resolvem com confiança alta e nenhuma é marcada para revisão.

A parte automatizável está em `scripts/rehearse-two-booths.mjs`: ele sobe **dois daemons de
verdade** neste Mac (portas 3100 e 3101, bancos SQLite e catálogos separados, `station_id`
`ensaio-booth-a` e `ensaio-booth-b`), aponta os dois para o Cloud Run e afirma tudo que dá para
julgar por HTTP e por uma leitura do Firestore. Este bloco é o resto — o que precisa de olho humano.

- [ ] **26.0 — Rodar o ensaio automatizado**

```bash
gcloud auth application-default login          # se ainda não tiver ADC
export ADMIN_PANEL_PASSWORD='<senha do painel>' # as outras duas saem de packages/daemon/.env
npm run rehearse:two-booths -- --sem-limpeza
```

O `--sem-limpeza` é o modo deste bloco: ele **deixa os dois estandes de pé** nas portas 3100/3101 e
as partidas de ensaio na nuvem, que é o cenário de que os passos seguintes precisam. Ctrl-C no fim
derruba os dois daemons.

> **Um ensaio por vez contra a mesma nuvem.** Os dois usam os mesmos `station_id` e os mesmos nomes
> de empresa, então dois em paralelo se contaminam de um jeito que **não parece concorrência**:
> o `company_rankings` soma as partidas dos dois, as gravações de catálogo de um bagunçam a versão
> que o outro espera, e a limpeza de cada um só apaga os `match_id` que ele mesmo criou. Aconteceu
> em 2026-09-06 (um ensaio no Mac, outro na máquina de desenvolvimento) e produziu três vermelhos
> com cara de regressão de produto — nenhum era bug. Hoje a Preparação aborta se encontrar
> `company_rankings` de ensaio já na nuvem, antes de tocar em qualquer coisa. Se isso acontecer:
> ou outro ensaio está rodando agora, ou um `--sem-limpeza` anterior deixou dados — apague as
> partidas `ENSAIO*` pelo painel e rode de novo.
>
> **Confira a segunda linha do relatório antes de qualquer coisa: `projeto <X> / banco <Y>`.** O
> ensaio fala com a nuvem por dois canais — HTTP no Cloud Run e Firestore direto — e o segundo
> precisa cair no mesmo projeto do primeiro. Achado ao vivo em 2026-09-06: um
> variável de ambiente de outro trabalho no shell do Mac levou o lado Firestore para outro projeto,
> e o erro nativo foi um `5 NOT_FOUND` de gRPC com 30 linhas de pilha do `google-gax` sem nenhuma
> menção a projeto. Repare que **`gcloud config set project` não protege contra isso** — o
> firebase-admin não lê a configuração do gcloud, lê o ambiente. Hoje o script ignora `PROJECT_ID` e
> `GOOGLE_CLOUD_PROJECT` de propósito (nomes genéricos demais para não serem herdados por acidente):
> só `ENSAIO_PROJECT_ID` e `ENSAIO_FIRESTORE_DATABASE` sobrescrevem os defaults. Além disso ele
> afirma que os dois canais veem o mesmo catálogo e, se não virem, aborta dizendo o nome dos dois.
> Mesma armadilha que `cardgen-routes.test.ts` documenta do lado dos testes.

**Critério:** o relatório fecha com **`N/N afirmações passaram`** — nenhuma falha — nos sete blocos,
que cobrem, nesta ordem: divergência silenciosa de catálogo (dois rankings), convergência pelo pull
(um ranking só, com a soma certa), remoção espelhada nos dois estandes, as travas contra poda em
massa e catálogo vazio, buffer offline com `played_at`, `stationActivity` no `/v1/admin/health` e o
cenário de empate.

> O total não é fixo de propósito: ele muda com `--sem-limpeza` (a limpeza tem afirmações próprias)
> e a cada afirmação nova. Fixá-lo aqui já rendeu uma discrepância entre este critério e o número
> registrado no 26.9. O que vale é **zero falhas**; se o total cair de uma execução para a outra sem
> ninguém ter mexido no script, isso é o achado, não o número em si.

> O catálogo de produção é salvo antes de qualquer alteração e **restaurado sempre**, inclusive se
> um passo falhar no meio — a cópia fica em `catalogo-original.json` dentro do diretório de trabalho
> do ensaio, que é `os.tmpdir()/ensaio-dois-booths/`. No macOS **isso não é `/tmp`**: `os.tmpdir()`
> resolve para algo como `/var/folders/tj/…/T/`, e o próprio script imprime o caminho no fim. As
> empresas de ensaio começam com `Ensaio ` e os codinomes com `ENSAIO`. Com `--sem-limpeza` as
> partidas **ficam**: o script imprime os `match_id` no fim, e você as apaga pelo painel (Partidas →
> seleção em massa → Apagar) antes de abrir o estande.

**Duas camadas contra catálogo vazio, e a de fora é a que age.** Vale saber qual é qual, porque a
intuição erra: o `PUT` do painel recusa lista vazia com 400, e o daemon também tem uma trava — mas
essa segunda **nunca dispara na prática**. Se alguém escrever `companies: []` direto no console do
Firestore, `createCompanyCatalogProvider` cai na semente de disco embutida no container e ainda
regrava o documento, então `GET /v1/companies` continua servindo a lista cheia e os estandes não
chegam a ter o que recusar. A trava do daemon segue como defesa em profundidade (tem teste unitário
em `catalog-sync.test.ts`) e só é alcançável apontando um estande para um servidor que devolva `[]`
de verdade. A poda em massa é o oposto: o servidor **aceita** (só a lista vazia é barrada lá) e quem
recusa são os dois daemons, acima de 30% de remoção num pull.

> **Consequência que não é óbvia, e que vale para o dia.** A lista que assume nesse cenário é a do
> **disco do container**, congelada no build — não a que o operador curou no painel. Se as duas
> divergirem (e basta um "Salvar" para isso), esvaziar o documento faz os dois Macs espelharem,
> em silêncio e dentro de um ciclo de pull, um catálogo diferente do que estava valendo. Nada
> quebra e nada esvazia; só passa a valer uma lista antiga. O `source` que `GET /v1/companies`
> devolve (`firestore` / `disk` / `stale-cache`) é o que diz qual camada está no ar.

**Se preferir subir os dois estandes à mão** (para depurar, ou para jogar de verdade nas duas
janelas em vez de deixar o script postar as partidas), é um terminal por estande. O que separa um do
outro são cinco variáveis — porta, `station_id`, banco, sessão e catálogo:

```bash
npm run build:shared && npm run build --workspace=packages/daemon

# Terminal 1 — estande A
cd packages/daemon
PORT=3100 \
BOOTH_STATION_ID=booth-a \
BOOTH_DB_PATH=/tmp/estande-a/booth.db \
BOOTH_SESSION_DIR=/tmp/estande-a/session \
BOOTH_COMPANIES_FILE=/tmp/estande-a/companies.json \
node dist/index.js

# Terminal 2 — estande B (mesma coisa, só troque a/A por b/B e a porta para 3101)
```

`BOOTH_CLOUD_API_BASE` e `BOOTH_INGEST_TOKEN` saem de `packages/daemon/.env` normalmente. Copie
`config/companies.json` para cada `BOOTH_COMPANIES_FILE` antes do primeiro boot. As duas telas do
visitante ficam em `http://localhost:3100` e `http://localhost:3101`.

> **Não use a 3000.** É onde mora o daemon do dia a dia, e derrubar a sessão de quem está
> desenvolvendo é um jeito caro de descobrir uma colisão de porta. Se algo ficar preso:
> `lsof -ti :3100 -ti :3101 | xargs kill -9`.
>
> **Bancos separados não são opcionais.** Dois daemons no mesmo `BOOTH_DB_PATH` compartilham cache
> de aliases e catálogo, e o ensaio inteiro — que existe para provar que dois estandes convergem —
> passaria por convergirem trivialmente, medindo nada.

- [ ] **26.1 — O resíduo de alias, e por que os dois Macs precisam de banco zerado**

Este passo não é uma verificação, é uma **decisão operacional** que o ensaio automatizado torna
visível. O Bloco 2 do script afirma, de propósito, um comportamento que parece bug e não é:

> `o resíduo do alias divergente sobrevive ao pull (comportamento de projeto)`

`resolveCompany` consulta o cache de aliases **antes** do catálogo, e o espelhamento de catálogo
deliberadamente não apaga aliases já aprendidos (senão uma edição no painel reescreveria o histórico
do evento no meio dele). Então um estande que já cacheou uma grafia divergente continua resolvendo
para o canônico velho **para sempre**: o pull de catálogo não conserta, e o pull de aliases também
não, porque aquela resolução divergente teve confiança 1,0 — nunca foi marcada `needs_company_review`
e a nuvem nunca teve o que aprender com ela. **O pull conserta o futuro, não o passado.**

**Critério, e é a única ação deste passo:** em **cada um dos dois Macs**, na véspera do evento,

```bash
npm run reset:db
```

Confirme depois, em cada Mac, que `sqlite3 <BOOTH_DB_PATH> 'select count(*) from company_aliases'`
devolve `0`. Um Mac que chega no dia com aliases de teste é um Mac que vai rachar rankings reais.

- [ ] **26.2 — Smoke de forja em branco, com login do `agy` conferido**

Um auto-update do `agy` já derrubou a autenticação em silêncio, e sem login **todo visitante recebe
preset de emergência** — a experiência inteira vira uma nave genérica. Isto vale por Mac.

**Limitação honesta deste ensaio:** `scripts/booth-terminal.sh` tem `/tmp/booth_session` e
`localhost:3000` fixos no código, então **não** há como rodar dois terminais de forja no mesmo Mac.
Aqui, faça o smoke contra o daemon de sempre (`npm run start:daemon` na 3000 e `npm run
start:terminal`), uma vez. No dia, faça em **cada** Mac, que tem seu próprio `/tmp/booth_session`.

**Critério:** uma jornada completa termina com uma nave **forjada** (geometria própria, não a
silhueta neutra), e o cabeçalho da sessão do `agy` não mostra nenhum pedido de login. Se sair a
silhueta neutra, o `agy` está deslogado — resolva antes de abrir o estande, não é ajuste fino.

- [ ] **26.3 — Fila de celebração: dois recordes em menos de 7 s, duas celebrações em cada TV**

Este é o clímax da experiência e o passo com maior chance de decepcionar um visitante. Antes desta
entrega o telão tinha um **slot único** de celebração, sobrescrito pelo recorde seguinte; o modal
fica 7 s na tela, então dois recordes dentro dessa janela faziam alguém perder o próprio momento.
Com dois estandes, a janela deixa de ser rara.

Abra **duas** janelas de `https://jogo-navinha-telao.web.app` (as duas TVs do dia), lado a lado, as
duas em `NUVEM`. Então, num terminal:

```bash
npm run rehearse:two-booths -- --recordes
```

O modo `--recordes` lê o melhor score do dia, sobe os dois estandes e dispara `topo+100` no A e
`topo+200` no B com ≈1,5 s entre eles. À mão isso é uma corrida de segundos entre duas máquinas, e é
exatamente a corrida que a fila existe para cobrir.

**Critério:** **duas** celebrações, **uma de cada vez**, em **cada uma** das duas janelas — quatro
modais no total, nenhum engolido, nenhum piscando por cima do outro. A ordem entre elas pode diferir
entre as janelas; o que não pode é sumir uma. Apague depois os dois `match_id` que o script imprime.

- [ ] **26.4 — Empate: a mesma ordem nas duas TVs**

O Bloco 7 do ensaio deixa duas partidas com score **idêntico** (2777), uma de cada estande. Com as
duas janelas do telão abertas, recarregue **as duas** três vezes seguidas.

**Critério:** `ENSAIOEMP1` e `ENSAIOEMP2` aparecem na **mesma ordem relativa** nas duas janelas, e
essa ordem **não muda** entre os refreshes. O desempate é `final_score` → `created_at` mais antigo →
`match_id`, e é determinístico de propósito: sem ele a ordem exibida oscilava a cada mesclagem de
snapshot, e com dois estandes os empates deixam de ser exceção.

- [ ] **26.5 — Ticker ordenado por hora de jogo, não por hora de ingestão**

O Bloco 5 do ensaio derruba a rede do estande B, joga duas partidas com 1,5 s entre elas, **segura o
estande sem nuvem por 8 s**, religa e espera a fila drenar. Essas partidas chegam ao Firestore bem
depois de terem sido jogadas, e `created_at` é sobrescrito com a hora de **ingestão** — sem
`played_at`, elas ocupariam o topo de "recentes" e poderiam disparar uma celebração de recorde velho.

**Olhe o `LIVE FEED`, não o ranking.** O ranking do telão ordena por score, e `ENSAIOOFF1`/`OFF2`
(1500 e 1600) ficariam no fim dele de qualquer jeito — ver as duas lá embaixo não prova nada sobre
`played_at`. Quem ordena por hora é o ticker (`LiveTickerFeed`), e é ele que mostra o `[HH:MM]` de
cada partida.

> **De onde vieram os 8 s.** Achado de 2026-09-06, e vale a leitura antes de confiar num relatório
> verde deste bloco. Até aquela data o Bloco 5 conferia a nuvem no instante seguinte à segunda
> partida — uma janela offline de menos de dois segundos. Só que a latência de um envio
> **bem-sucedido** naquela mesma execução foi de 3,3 a 3,8 s por partida, ou seja, **maior que a
> janela**. Com isso as duas afirmações de estande offline passavam por corrida com uma requisição
> em voo, e não por comportamento: passariam igual com a rede perfeita. A terceira afirmação era
> `played_at < created_at`, que é verdade para **toda** partida do ensaio, offline ou não, porque a
> ingestão sempre acontece depois do relógio do estande. Três afirmações verdes, nenhuma medindo o
> que dizia medir. O bloco agora (a) exige que o próprio `/api/sync/status` do estande B acuse
> `state: retrying` com falhas consecutivas antes de afirmar qualquer coisa, (b) segura a janela
> offline por 8 s, mais que qualquer envio observado, e (c) troca a comparação por uma de
> **magnitude**: o atraso da ingestão tem que ser de pelo menos a janela inteira.

**O discriminador na TV é o relógio, não a posição.** Na execução de 2026-09-06 a fila do estande B
drenou **antes** de os Blocos 6 e 7 postarem, então `created_at` e `played_at` davam a mesma ordem —
a posição no ticker concordaria com as duas hipóteses e não separaria nada. O que separa é o horário
exibido, porque `created_at` foi sobrescrito na ingestão e `played_at` não.

**Critério, em três partes:**

1. O Bloco 5 fecha verde **incluindo** a afirmação nova de que o worker acusou falha de envio. Se
   ela falhar, o estande não ficou offline e o resto do bloco não vale — investigue o
   `BOOTH_CLOUD_API_BASE` do processo, não o `played_at`.
2. No `LIVE FEED`, o `[HH:MM]` de `ENSAIOOFF1`/`OFF2` é o de **quando foram jogadas** — anterior ao
   `Criada em` que a tela de Partidas mostra para os mesmos `match_id`. Confirme os dois valores
   lado a lado:
   ```bash
   curl -su ":$ADMIN_PANEL_PASSWORD" '<URL do Cloud Run>/v1/admin/matches?q=ENSAIOOFF&limit=10' \
     | jq '.matches[] | {callsign, played_at, created_at}'
   ```
   A diferença tem que ser de **vários segundos** nas duas, não de centenas de milissegundos: essa
   é a assinatura da fila que esperou, e é o que a versão anterior deste passo não distinguia.

   > **O ticker mostra `[HH:MM]`, sem segundos — confira que os dois lados caem em minutos
   > diferentes antes de dar o passo por fechado.** A janela offline é de 8 s e não garante cruzar
   > a virada do minuto: se jogo e ingestão caírem no mesmo minuto, a TV mostra o mesmo `HH:MM`
   > nas duas hipóteses e não prova nada. Na execução de 06/09 deu certo por pouco — jogadas
   > 21:22:55 e 21:22:56 UTC, ingeridas 21:23:05, ou seja **6:22 PM** no ticker contra **6:23 PM**
   > de `Criada em` no painel. Se caírem no mesmo minuto, rode o Bloco 5 de novo em vez de
   > registrar um verde que não separa as hipóteses.
3. **Nenhuma celebração de recorde** foi disparada pela drenagem. Com os scores de ensaio (1500 e
   1600) isso é satisfeito de graça, bem abaixo de qualquer recorde do dia; o passo só ficaria
   interessante se alguém mexesse nesses números para perto do topo.

- [ ] **26.6 — Painel: "Atividade por estação" e o filtro por Mac**

Abra `<URL do Cloud Run>/admin` → **Saúde**. O script já afirma o conteúdo do JSON; aqui o que se
verifica é a **tela**, e sobretudo que ela não engane o operador.

**Critério:** a tabela **Atividade por estação** lista `ensaio-booth-a` e `ensaio-booth-b` com
contagem e último horário **formatado como data legível** (não `Timestamp` cru, não `undefined`), e
ela aparece como uma seção **separada** da fila de sincronização. As duas respondem perguntas
diferentes — "aquele Mac está produzindo partidas?" contra "a fila de saída daquele Mac está
drenando?" — e a nota honesta de que a nuvem não enxerga a segunda continua na tela.

Depois vá em **Partidas**. A tabela tem uma coluna **Estação** entre Empresa e Score, e o valor de
cada linha é clicável: clicar filtra por aquela estação. Há também um campo **Filtrar estação** na
barra de busca, com as estações da busca atual como sugestão.

**Critério:** sem filtro, as duas estações aparecem misturadas e cada linha diz de qual veio.
Clicando em `ensaio-booth-b` (ou digitando no campo), **todas** as linhas passam a mostrar aquela
estação e as de `ensaio-booth-a` somem; o aviso "Filtrando pela estação …" aparece com o botão
**Mostrar todas as estações**, que desfaz.

> Partidas anteriores ao campo aparecem como `(sem station_id)`, e filtrar por esse rótulo funciona
> — o servidor casa contra `station_id ?? '(sem station_id)'`. Por isso a string mora em
> `@jogo/shared` e não é digitada em cada lado: duas cópias divergentes fariam esse filtro devolver
> zero linhas sem erro nenhum.
>
> A coluna **não** é editável, ao contrário de Callsign/Empresa/Score. `station_id` é injetado pelo
> daemon no `POST /api/matches`, sobrescrevendo o que veio do navegador; deixar corrigir no painel
> reabriria justamente a porta de atribuir a partida de um Mac ao outro.

- [ ] **26.7 — Uma empresa cadastrada no painel chega aos dois autocompletes**

Com os dois estandes de pé (26.0 com `--sem-limpeza`), vá em **Empresas** no painel, acrescente
`Ensaio Empresa Tardia` e salve. Espere um ciclo do worker.

```bash
curl -s 'http://localhost:3100/api/companies?q=Ensaio%20Empresa' | jq
curl -s 'http://localhost:3101/api/companies?q=Ensaio%20Empresa' | jq
curl -s http://localhost:3100/api/catalog/status | jq '.catalog'
curl -s http://localhost:3101/api/catalog/status | jq '.catalog'
```

**Critério:** a empresa aparece no autocomplete dos **dois** estandes, e os dois
`/api/catalog/status` mostram `state: "ok"` com a **mesma** `appliedVersion`. No estande de verdade
o efeito visível é o campo Empresa da Tela 1 sugerindo o nome novo nos dois Macs. Apague a empresa
pelo painel no fim — ela começa com `Ensaio ` justamente para isso.

> No dia, o ciclo do worker é de 120 s, não os 8 s que o ensaio usa. "Cadastrei e não apareceu" nos
> primeiros dois minutos é comportamento normal, e vale avisar quem for operar o painel.

- [ ] **26.8 — Os dois Macs têm `BOOTH_STATION_ID` distinto (fazer nos Macs de verdade)**

Este é o único passo que **não** dá para fechar no Mac único: o ensaio injeta os `station_id` por
env, então ele prova o mecanismo, não a configuração das duas máquinas. No dia, no boot de cada
daemon, olhe a primeira dezena de linhas do log.

**Critério:** cada Mac imprime um `station_id` **diferente**, e nenhum dos dois imprime
`estacao-desconhecida` nem o aviso de env ausente. O default por hostname já é útil (os dois Macs
têm hostnames distintos), mas um `BOOTH_STATION_ID` explícito em cada `.env` é o que torna o painel
legível para quem não decorou os hostnames.

- [ ] **26.9 — Tabela de registro**

Execução parcial de 2026-09-06, contra `vibe-cabral` / `jogo-navinha`, revisão
`jogo-navinha-api-00019-jjp` (cardgen `jogo-navinha-cardgen-00003-t84`), a partir da **máquina de
desenvolvimento**, não do Mac do estande. O que isso cobre e o que não cobre: as afirmações do
script são todas sobre convergência na nuvem e o mesmo código de daemon roda dos dois lados, então
26.0 está fechado; o que **falta rodar no Mac** é tudo que depende de navegador, de TV e do `agy`.

| # | Passo | Passou? | Observação |
|---|-------|---------|------------|
| 26.0 | Ensaio automatizado fechou sem falhas | ✅ | 1ª execução 06/09: **45/45**, e o deploy semeou `companies/catalog` com 25 empresas — o documento **não existia** em produção, confirmando ao vivo que o editor de empresas do painel era um no-op. Mas o Bloco 5 dali não media o que dizia medir (ver 26.5). 2ª execução, com o Bloco 5 corrigido: **44/45** — Bloco 5 ✅ com atrasos de 8988 ms e 10430 ms, e uma falha nova no Bloco 4, também afirmação errada e não defeito (o estande espelhou o catálogo de fallback, que não é obrigado a ser idêntico ao de produção). Corrigida. 3ª execução: **45/45**, sem falhas — este é o verde que vale |
| 26.1 | `reset:db` rodado nos dois Macs, `company_aliases` zerado | [ ] | |
| 26.2 | Forja em branco com `agy` logado | [ ] | |
| 26.3 | Duas celebrações em cada TV, nenhuma engolida | ✅ | **4 modais, 2 em cada janela**, uma de cada vez. Melhor score do dia era 4200; o script mandou `ENSAIOREC1` 4300 (A) e `ENSAIOREC2` 4400 (B). A fila cobriu a corrida que antes fazia o segundo recorde sobrescrever o primeiro |
| 26.4 | Empate na mesma ordem nas duas TVs, estável em 3 refreshes | ✅ | `ENSAIOEMP1` antes de `ENSAIOEMP2`, estável em vários refreshes, simultâneos e alternando entre as duas janelas |
| 26.5 | Partidas drenadas não subiram ao topo do ticker | ✅ | `LIVE FEED` mostrou **6:22 PM** para `ENSAIOOFF1`/`OFF2`, que é o `played_at` (21:22:55/56 UTC); a ingestão foi 21:23:05, ou seja **6:23 PM**. O ticker usa o relógio do estande. Primeira tentativa olhou o **ranking** (onde `ENSAIOOFF2`/`OFF1` ficam no fim só por terem score 1600/1500) — não discrimina. Ao refazer contra o JSON apareceu o achado maior: o atraso medido foi de **707 ms** (`OFF2`) e **2180 ms** (`OFF1`), **abaixo** dos 3,3–3,8 s de latência das partidas online da mesma execução. A janela offline do Bloco 5 era mais curta que um envio normal, então as três afirmações passavam por corrida. Bloco 5 reescrito (prova de `state: retrying`, janela de 8 s, atraso medido por magnitude). Na 2ª execução o bloco fechou verde com atrasos de **8988 ms** e **10430 ms** — uma ordem de grandeza acima do que a versão anterior media, e a TV confirmou o horário do estande |
| 26.6 | Atividade por estação legível; filtro por Mac funciona | ✅ | Saúde passou de primeira: `ensaio-booth-b` 5 / `ensaio-booth-a` 3, com data legível. Partidas ❌ na primeira tentativa: **não havia coluna nem filtro de estação na tela** — o `?station=` já existia no `listMatches` desde a Fase 5, mas o `admin-app` nunca o expôs, e este passo do plano descrevia uma UI que não existia. Coluna e filtro entregues em `2fb0c4a`; depois do redeploy a coluna apareceu e o clique filtrou |
| 26.7 | Empresa nova no autocomplete dos dois estandes, mesma versão | ✅ | `Ensaio Empresa Tardia` apareceu nos dois na mesma `appliedVersion` 43 (26 empresas) e sumiu dos dois na 44 (de volta a 25), sempre com `state: ok`. Curiosidade sem consequência: o cadastro pulou 41 → **43**, dois incrementos para um "Salvar"; a remoção foi 43 → 44, um só. O espelhamento só depende de a versão mudar, não de quanto |
| 26.8 | `station_id` distinto no boot dos dois Macs | [ ] | |
| Fim | Partidas de ensaio apagadas e catálogo conferido | [ ] | Catálogo ✅: `Ensaio Empresa Tardia` já saiu no próprio 26.7 e os dois estandes voltaram a 25 empresas na versão 44. **Resíduo vivo em `vibe-cabral`**: as partidas `ENSAIO*` da 3ª execução, incluindo `ENSAIOREC1` (4300) e `ENSAIOREC2` (4400) — estas duas estão **acima do recorde real (4200)** e sequestrariam a celebração do primeiro visitante. Apagar pelo painel antes de abrir o estande |

---

## Bloco 27 — Telão v2: top 20 / top 15 rolando e a visão do Antigravity

> **Pré-requisitos:** o telão v2 no ar (`packages/leaderboard-app`), **na TV do estande**, não na
> tela do laptop — tudo que este bloco mede é geometria e legibilidade a 1080p, e um monitor de
> desenvolvimento responde a pergunta errada. Ideal contra o Hosting (`https://jogo-navinha-telao.web.app`);
> `npm run dev --workspace=packages/leaderboard-app` serve para ensaiar antes do deploy. Um teclado
> ou apontador de apresentador ligado na máquina que serve a TV. Estimativa: 15 min, mais 15 de
> espera no 27.9.
>
> Para os passos que precisam de placar cheio, ≥20 partidas já ingeridas — as de ensaio do Bloco 26
> servem, desde que apagadas depois.

O que mudou nesta entrega, e por que cada passo abaixo existe: o placar passou de 10 pilotos e 5
empresas **fixos** para 20 e 15 **rolando** (`TOP_PILOTS_LIMIT` / `TOP_COMPANIES_LIMIT` em
`firestore-source.ts`); o bloco "SUA VEZ DE PILOTAR", que tinha um QR **desenhado à mão** e não
legível por celular nenhum, saiu; e a mesma tela agora alterna com um painel institucional sobre o
Antigravity que o apresentador pode segurar com uma tecla.

**A restrição que governa o bloco todo:** nada aqui se conserta diminuindo fonte, padding ou
espaçamento. O telão é lido do fundo do estande. Se algo não couber, o número que se mexe é
`pxPerSecond` em `DEFAULT_AUTO_SCROLL_CONFIG` (`auto-scroll.ts`) — nunca a tipografia.

- [ ] **27.1 — Vinte pilotos e quinze empresas, todos legíveis do fundo do estande**

Com ≥20 partidas no placar, fique de pé **onde o visitante fica**, não a um metro da TV, e acompanhe
um ciclo completo de rolagem em cada painel.

**Critério:** as **20** linhas de piloto e os **15** cards de empresa passam pela tela ao longo do
ciclo — conte, não estime — e o **primeiro e o último item de cada painel são legíveis da distância
de operação**. Os títulos dizem `HALL DA FAMA // TOP 20 PILOTOS` e `BATALHA CORPORATIVA // TOP 15`.

> Se faltarem linhas, o problema não é a rolagem: é a fonte de dados. Confira quantas partidas o
> `topPilots` está trazendo antes de mexer em qualquer coisa de layout — com menos de 20 partidas no
> dia, 20 linhas simplesmente não existem para mostrar.

- [ ] **27.2 — Cronometrar o vai-e-volta**

Cronômetro na mão, do instante em que a lista **começa a descer** até ela voltar ao topo e ficar
parada de novo.

**Critério:** ≈**88 s**, dentro da fatia de 90 s do placar — a conta é
`2 × holdMs + 2 × (transbordo / pxPerSecond)`, com `holdMs = 5 s` e `pxPerSecond = 20`. O que se
verifica não é o número exato e sim que **cabe uma passagem completa por fatia**: se a lista for
pega no meio do caminho toda vez que a tela vira, ninguém nunca vê o fim do ranking.

Sobrou ou faltou muito? Ajuste **só** `pxPerSecond` em `DEFAULT_AUTO_SCROLL_CONFIG`
(`packages/leaderboard-app/src/auto-scroll.ts`) e rode de novo. Mais rápido para caber, mais lento
para ficar legível — é o único parafuso, e mexer nele não quebra nenhum teste (os de
`auto-scroll.test.ts` passam a config explicitamente).

- [ ] **27.3 — Placar cedo no evento: nada para rolar**

Este é o caso das primeiras horas do estande, e é o mais fácil de esquecer. Com **3 ou 4 partidas**
no placar (ou apontando o telão para uma base recém-limpa), olhe os dois painéis por um minuto.

**Critério:** **nenhuma** rolagem, **nenhum** tremor de um pixel indo e voltando, nenhum salto ao
fim de um ciclo invisível. As listas ficam paradas no topo. É o caminho `overflowPx <= 0` de
`scrollOffsetAt`, e um telão que treme com quatro linhas na tela é a primeira coisa que um visitante
nota.

- [ ] **27.4 — O ciclo automático**

Cronômetro de novo, sem tocar em nada. Comece a contar quando o placar aparecer.

**Critério:** **1m30** de placar → o painel do Antigravity entra com fade → **3 seções de ≈20 s**
(`AS SUPERFÍCIES` → `OS DIFERENCIAIS` → `COMO ADQUIRIR`, com os pontinhos de progresso andando) →
volta sozinho ao placar. Total de 1m no painel. O `LIVE FEED` e o cabeçalho (relógio, contadores,
selo `NUVEM`) **não piscam** na troca: eles ficam montados nas duas visões.

- [ ] **27.5 — A retenção manual do apresentador**

Durante o painel do Antigravity, aperte a **seta direita** uma vez.

**Critério:** avança para a próxima seção **e** aparece no rodapé o selo
`MODO APRESENTAÇÃO · placar em 1:30`, com a contagem caindo de segundo em segundo. A partir daí a
rotação **para de avançar sozinha** — a seção fica no ar enquanto o apresentador quiser. Seta
esquerda volta uma seção e **renova** a contagem para 1:30; qualquer outra tecla também renova, sem
mudar de seção.

> **Do placar, só as setas convocam o painel.** Aperte uma letra qualquer com o placar no ar: nada
> deve acontecer. É deliberado — uma tecla esbarrada não pode tirar o ranking da TV no meio do
> evento. Para sair do placar é preciso a intenção explícita de uma seta.

- [ ] **27.6 — A volta sozinho (o passo que não pode ser pulado)**

Com o selo `MODO APRESENTAÇÃO` no ar, **tire a mão do teclado** e espere.

**Critério:** a contagem cai até `0:00` e o telão volta ao placar **sem nenhum clique**. Este é o
único passo que prova a inatividade pedida: sem ele, "volta ao fluxo automático" é intenção, não
comportamento. Um apresentador que larga o teclado e vai atender um visitante não pode deixar a TV
congelada num slide institucional pelo resto do evento.

> Depois da volta, o ciclo recomeça do zero: 1m30 de placar antes do próximo flip. E se ainda
> restava seção pela metade quando a retenção expirou, **a seção corrente recomeça** em vez de
> saltar — cortar no meio da frase de quem acabou de parar de falar seria pior.

- [ ] **27.7 — Recorde top-3 durante a apresentação**

Com o painel do Antigravity **segurado manualmente** (selo no ar), sincronize uma partida que entre
no top 3. A partir de um estande de pé, ou:

```bash
npm run rehearse:two-booths -- --recordes
```

**Critério:** o telão **corta na hora** para o placar e celebra — o modal de recorde aparece, a
retenção manual é descartada e o selo some. Depois dos 7 s do modal, o placar segue no ciclo normal.
Não celebrar, ou celebrar por baixo do painel institucional, é perder exatamente o clímax que a
experiência inteira existe para produzir. Apague as partidas de ensaio depois.

- [ ] **27.8 — O ticker corre nas duas visões, e o QR falso não existe mais**

**Critério, em duas partes:** (1) o `LIVE FEED` do rodapé continua correndo e atualizando **também**
enquanto o painel do Antigravity está no ar; (2) **nenhum** canto da tela, em nenhuma das duas
visões, mostra o bloco "SUA VEZ DE PILOTAR" nem a grade quadriculada que imitava um QR code. A
chamada para ação sobreviveu no rodapé da seção `COMO ADQUIRIR` do painel — confira que ela está
lá, e leia o texto das três seções procurando erro factual sobre o produto.

- [ ] **27.9 — Quinze minutos sem tocar**

Deixe o telão rodando 15 min, sem teclado, sem visitante. É a única forma de pegar deriva.

**Critério:** a rolagem continua alinhada aos painéis (nenhuma lista deslocada para fora da caixa,
nenhum card cortado no topo), o relógio do cabeçalho segue certo, a alternância continua no ritmo
1m30/1m e a memória da aba não cresce sem parar (DevTools → Memory, ou o gerenciador de tarefas do
Chrome: `Shift+Esc`). Cinco ciclos completos cabem nessa janela.

- [ ] **27.10 — Tabela de registro**

| # | Passo | Passou? | Observação |
|---|-------|---------|------------|
| 27.1 | 20 pilotos e 15 empresas, legíveis do fundo | [ ] | |
| 27.2 | Vai-e-volta em ≈88 s, dentro da fatia de 90 s | [ ] | |
| 27.3 | Placar com poucas partidas não rola nem treme | [ ] | |
| 27.4 | Ciclo automático 1m30 / 1m com as 3 seções | [ ] | |
| 27.5 | Seta segura o painel e mostra a contagem | [ ] | |
| 27.6 | **Volta sozinho ao placar por inatividade** | [ ] | |
| 27.7 | Recorde top-3 corta para o placar e celebra | [ ] | |
| 27.8 | Ticker nas duas visões; nenhum QR falso na tela | [ ] | |
| 27.9 | 15 min sem deriva de rolagem, relógio ou memória | [ ] | |
| Fim | Partidas de ensaio do 27.7 apagadas | [ ] | |
