# 12 — Plano de Teste Manual no Mac (Gates M1 e M2)

**Objetivo:** fechar os dois gates que nenhuma máquina consegue fechar sozinha —
**M1** (a engine, offline, e a dificuldade que a partida realmente transmite) e
**M2** (o ciclo completo com o `agy` real, incluindo as falhas provocadas).

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
| 3 | Captura de conformidade (destrava o teste pulado) | 20 min |
| 4 | M1 parte 2 — 5 partidas à mão vs. simulador | 30 min |
| 5 | M2 parte 1 — ciclo completo com `agy` real | 30 min |
| 6 | M2 parte 2 — falhas provocadas | 25 min |
| 7 | M2 parte 3 — higiene de processos e reset | 10 min |

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

O `agy` precisa estar no sabor **Vertex AI / Enterprise**, com `gemini-3.6-flash` — **não** com
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
shared      57/57  ✅
mcps         3/3   ✅
daemon      41/41  ✅
player-app  28/28  ✅
sim          9/11  — 1 FALHA + 1 PULADO  ← esperado, conhecido
```

A falha esperada é exatamente esta, e **só** esta:

```
✖ mantém o espalhamento entre arquétipos abaixo do penhasco
  espalhamento de 41.6 pontos percentuais entre o melhor e o pior arquétipo
```

E o pulado esperado é:

```
﹣ TTK do boss no simulador está a até 5% do TTK capturado na engine real
  # harness-runs.json está vazio
```

**Qualquer outra falha é uma regressão nova** — pare e investigue antes de continuar.
Contexto completo dos dois itens: [`11_KNOWN_GAPS_AND_OPEN_ITEMS.md` §2](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md).

- [ ] **1.3 — Matriz de balanceamento de referência**

```bash
npm run sim:balance 2>&1 | tee ~/Desktop/gate-m1-m2/sim-balance.txt
```

Guarde este arquivo. O Bloco 4 compara as partidas jogadas à mão contra estes números. Os valores de
referência (2026-08-15, habilidade **mediano**, após o aumento de dificuldade do boss —
`bullet_damage` por fase + `max_hp` 800) são:

| Arquétipo | Vitórias | TTK p50 |
|-----------|----------|---------|
| `interceptor` | 10,2% | 15,9s |
| `vanguard` | 43,0% | 18,0s |
| `striker` | 1,3% | 18,2s |
| `maximo` | 99,9% | 9,6s |

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

## Bloco 3 — Captura de conformidade (destrava o teste pulado)

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
> **As seis capturas estão descartadas; este bloco precisa ser refeito.** As conferências desta vez:
> **marcar "Disparo automático"** (sem ela a captura não vale, e some o passo de segurar `ESPAÇO`),
> **`boss_ttk_s` batendo com `duration_s - 40`** com casa decimal, e **anotar `shots_fired` e
> `boss_fight_min_fps`** — o primeiro virou campo obrigatório do fixture e agora é verificado por
> teste. Se o TTK não bater, pare: o problema é de medição, não de modelo.
>
> **O modelo prevê, em pares que se conferem:** `striker` 11.2 s / ≈168 tiros, `interceptor` 8.9 s /
> ≈107, `maximo` 6.3 s / ≈76. A contagem carrega ±2 acionamentos de folga honesta. Se os três
> caírem perto disso, o portão fecha.

Procedimento canônico e completo:
[`packages/sim/fixtures/README.md`](../packages/sim/fixtures/README.md). O roteiro abaixo é o mesmo,
em forma de checklist.

Repita **3.1 a 3.6** para cada um dos três presets: **`striker`**, **`interceptor`**, **`maximo`**.

- [ ] **3.1 — Preset** — no seletor **Preset**, escolha o preset da vez e clique em **"Aplicar"**.
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

Feitos os três:

- [ ] **3.7 — Montar o fixture**

De cada JSON, leia `telemetry.boss_ttk_s`, `telemetry.shots_fired` e
`telemetry.boss_fight_min_fps`, e escreva `packages/sim/fixtures/harness-runs.json`:

```json
[
  { "preset": "striker", "seed": 1, "boss_ttk_s": 0.0, "shots_fired": 0, "boss_fight_min_fps": 0 },
  { "preset": "interceptor", "seed": 1, "boss_ttk_s": 0.0, "shots_fired": 0, "boss_fight_min_fps": 0 },
  { "preset": "maximo", "seed": 1, "boss_ttk_s": 0.0, "shots_fired": 0, "boss_fight_min_fps": 0 }
]
```

trocando cada zero pelo valor real medido. `shots_fired` é obrigatório: é o segundo relógio da
engine, e é ele que o teste de integridade usa para reprovar uma captura corrompida antes de o
portão de conformidade dar qualquer veredito sobre o modelo.

- [ ] **3.8 — Rodar a conformidade**

```bash
npm run test --workspace=packages/sim
```

**Critério:** os dois testes que antes pulavam agora **executam**. Se passarem, o simulador está
validado contra a engine real e o item §2.2 das lacunas está fechado.

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

- [ ] **4.1 — Cinco partidas completas**

Ainda em `npm run dev:game`, **com God mode DESLIGADO**, sem pular fase, partida inteira do começo
ao fim. Distribua assim:

| # | Preset | Registre |
|---|--------|----------|
| 1 | `interceptor` | venceu? tempo até morrer/vencer |
| 2 | `interceptor` | idem |
| 3 | `striker` | idem |
| 4 | `vanguard` | idem |
| 5 | `vanguard` | idem |

- [ ] **4.2 — Comparar com o simulador**

Confronte com `~/Desktop/gate-m1-m2/sim-balance.txt`, linha `mediano`:
`interceptor` ≈9%, `striker` ≈1%, `vanguard` ≈52%.

**Critério de aprovação:** o resultado das 5 partidas é **compatível** com essas previsões. Não se
espera correspondência estatística — 5 amostras não medem 9%. O que se espera é ausência de
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

Independentemente do resultado: você acabou de jogar `striker` e `vanguard`. A diferença de ≈50 pp
entre eles ([§2.1 das lacunas](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md)) é gritante na mão, ou passa
despercebida? Essa impressão é o dado que falta para decidir se vale reequilibrar
`fallback-presets.ts` antes do evento.

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
