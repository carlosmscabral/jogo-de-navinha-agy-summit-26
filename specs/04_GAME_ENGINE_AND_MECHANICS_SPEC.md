# Spec 04: Game Engine, Gameplay e Boss Fight

> **Status:** RECONCILIADA COM A IMPLEMENTAÇÃO — 2026-08-10
> **Objetivo:** Descrever a engine Phaser 3 tal como construída: pipeline de textura, física de voo,
> balística, pacing da partida de 90s, o boss e a fórmula de score.
> **Endereça:** P3, P4, P5, D12, D13, D15, D17 (ver [Spec 00](./00_AUDIT_AND_DRIFT_REPORT.md)).
> **Fonte de verdade numérica:** esta especificação **descreve** o comportamento; todo valor de tuning
> é governado por [Spec 09](./09_GAME_BALANCE_AND_DEV_MODE.md). Onde os dois divergirem, vale a 09.

---

## 1. Pipeline de textura

### 1.1. O que existe

`ShipTextureFactory` (`packages/player-app/src/game/factories/ShipTextureFactory.ts`) gera todas as
texturas em tempo de execução com Canvas2D e as registra via `scene.textures.addCanvas()`. Não há
nenhum asset de imagem no bundle — nave do jogador, drones e boss são desenhados por código. Para uma
ativação de estande isso é uma boa decisão: zero requisições de rede, zero tempo de carregamento, zero
risco de asset faltando.

A nave do jogador é um canvas de **128×128** renderizado com `setScale(0.65)`, ou seja ≈83px na tela.

### 1.2. [D17] O SVG do agente não é renderizado

> **Correção.** Esta especificação definia: `svg_path_data` → `Blob` → `Image` → rasterização em canvas
> retina 256×256 → `addCanvas`. **Esse pipeline não existe.** A fábrica desenha **três silhuetas fixas
> no código**, escolhidas por substring de `visuals.style_name`:
>
> | `style_name` contém | Silhueta |
> | :--- | :--- |
> | `interceptor` | Agulha aerodinâmica |
> | `fortress` ou `vanguard` | Casco pesado |
> | qualquer outra coisa | Asa invertida |
>
> Do `ship_spec.json`, a aparência consome apenas `primary_color`, `secondary_color` e
> `engine_trail_color`. O `svg_path_data` — produzido pelo `aesthetic-designer`, o único sub-agente
> sempre ativo, validado pelo schema com `minLength: 10` e transportado até o browser — é descartado.
>
> E como os `style_name` gerados na prática (`<callsign>-01 Swarmstrike` no `normalizeSpec`,
> `<callsign>-01 Custom` no exemplo do `GEMINI.md`) não casam com nenhuma das duas primeiras condições,
> **quase toda nave do evento cai no mesmo terceiro desenho**.

**Requisito.** O visitante precisa pilotar a nave que viu o agente desenhar. O pipeline a construir:

1. `Path2D(svg_path_data)` desenhado em um canvas 256×256 com transformação de `viewBox 0 0 128 128`,
   preenchido com `primary_color` e contornado com `secondary_color`.
2. **Validação prévia de sanidade** antes de aceitar o path: comprimento máximo, conjunto de comandos
   permitido (`M L C Q A Z` e minúsculas), e bounding box resultante dentro do viewBox. Um path
   degenerado — uma linha, um ponto, ou algo que renderize fora da caixa — cai para a silhueta padrão.
   Isso não é paranoia: é o mesmo argumento de D16, um modelo pode devolver qualquer string.
3. As três silhuetas atuais permanecem como **fallback**, usadas quando o path é inválido ou quando a
   nave veio de um preset de fallback.
4. Os propulsores, o brilho e o `shadowBlur` continuam aplicados por código sobre o path recebido.

O gate objetivo: com dois `svg_path_data` visivelmente diferentes no mesmo `style_name`, as duas naves
renderizadas devem ser visivelmente diferentes. Hoje são idênticas.

---

## 2. Física de voo e colisão

- **Corpo circular.** `PlayerShip` aplica `body.setCircle(hitbox_radius, offsetX, offsetY)` com o raio
  vindo do spec e o offset centralizando o círculo no sprite (`PlayerShip.ts:48-49`). O corpo é menor
  que a arte: asas e fuselagem externa não colidem. É a *graze box* pretendida, e funciona.
- **Movimento.** Oito direções por teclado, WASD e setas, velocidade `attributes.speed_px_s` aplicada
  diretamente como velocidade do corpo, sem aceleração nem inércia (`PlayerShip.ts:104-118`).
- **Dano ao jogador é sempre 1.** Bala inimiga, bala do boss e colisão por aríete removem exatamente um
  ponto de casco (`MainGameScene.ts:670,687,357`). `shield_capacity` absorve os primeiros impactos antes
  do casco. Não existe dano variável contra o jogador — só frequência de impacto.
- **Invulnerabilidade de 1,5s** após cada impacto (`PlayerShip.ts:158`).

```mermaid
graph TD
    SPRITE[Sprite 128x128 escalado para 0.65]
    ARTE[Asas e fuselagem: decorativo, sem colisao]
    NUCLEO[Nucleo central: corpo circular Arcade]
    SPRITE --> ARTE
    SPRITE --> NUCLEO
    NUCLEO -->|setCircle com hitbox_radius| FISICA[Arcade Physics Body]
```

---

## 3. Balística

### 3.1. Arma primária

Disparo contínuo com a barra de espaço. O `WeaponSystem` **reescreve** os valores do spec antes de
usá-los (`WeaponSystem.ts:64-74`):

- `fire_rate` é grampeado em **5 a 12** tiros/s.
- `damage` é grampeado em **15 a 45**.
- `vulcan_spread` dispara três projéteis com dano de `round(damage × 0,65)` cada.
- `laser` e `plasma` disparam um projétil por ciclo com o dano cheio.

Esses clamps são o coração de **D14**: o schema aceita `fire_rate` de 2 a 60 e `damage` de 10 a 60,
`normalizeSpec` grampeia em outra faixa, e aqui há uma terceira. Um preset `interceptor` com
`fire_rate: 60` voa como se tivesse 12. A [Spec 09](./09_GAME_BALANCE_AND_DEV_MODE.md) §2.3 unifica as
três em uma tabela gerada; **nenhum número de faixa deve permanecer escrito à mão aqui.**

### 3.2. [D13] Arma secundária

Acionada por Shift, com cooldown de `secondary.cooldown_seconds`. Quatro falhas independentes a tornam
quase inexistente — a evidência completa está em [Spec 00](./00_AUDIT_AND_DRIFT_REPORT.md) §2.12. Em
resumo, e como requisitos:

| Falha | Requisito |
| :--- | :--- |
| Mísseis não colidem com inimigos comuns; só o overlap contra o boss existe | Registrar `secondaryMissiles × enemies` em `setupCollisions`. |
| `emp_burst` só desenha um círculo; o parâmetro `damage` é ignorado | Aplicar dano em área e destruir os projéteis inimigos na tela, como a especificação sempre descreveu. |
| `spawnMissile` recebe `targets` e ignora | Implementar perseguição, ou remover o parâmetro e reclassificar a arma como *barrage* não-guiada. Uma das duas — o nome `homing_missiles` não pode continuar mentindo. |
| O pool de 20 mísseis nunca é reciclado; `update()` limpa só `primaryBullets` | Limpar mísseis fora de tela no mesmo laço. |
| `drone_escort` não é tratado em nenhum ramo | Removido do enum. Ver [Spec 03](./03_AGY_HARNESS_AND_INTEGRATION_SPEC.md) §5. |

E uma quinta, que só aparece quando somada ao boss: o dano do míssil é grampeado em 60–120 aqui, e o
`takeDamage` do boss corta qualquer impacto em 45. Um míssil de 120 entrega 45 antes da mitigação. Ver §5.

---

## 4. Pacing da partida

> **Correção (P4).** A especificação definia waves **finitas** com contagens exatas — 32 drones, depois
> 6 cruisers, depois 10 drones de bônus — e o boss aos 60s. A implementação usa um **spawner contínuo
> por temporizador** e o boss entra aos 45s. A troca é defensável: waves finitas exigem que o ritmo do
> jogador case com o roteiro, e num estande onde metade dos visitantes nunca jogou um shmup, o spawner
> contínuo mantém a tela ocupada independentemente da perícia. O código é a verdade.

| Janela | O que acontece |
| :--- | :--- |
| 00s–20s | Spawner a cada 750ms. Sorteia entre formação em V de 3 drones de 30 HP e esquadrão kamikaze de 2 drones de 25 HP. |
| 20s–45s | O mesmo spawner passa a sortear também o esquadrão *Elite Cruiser*: 1 cruiser de **140 HP** com 2 drones de escolta. |
| 42s | Aviso de boss na tela. |
| 45s | Boss entra. **O spawner de inimigos comuns para**, assim como o disparo inimigo. |
| 45s–90s | Luta contra o boss, sozinho. |
| 90s | `triggerTimeoutEnd`. Sem vitória. |

Inimigos disparam a cada 1200ms até os 45s. O **modo hardcore** (`isHardcore`, passado na criação da
instância) comprime tudo: spawn a 550ms, disparo a 800ms, HP inimigo ×1,3, velocidade ×1,2, e boss com
22.000 HP. Não há UI para ativá-lo — é um parâmetro de `createGameInstance`, e é exatamente o tipo de
alavanca que o harness de dev da [Spec 09](./09_GAME_BALANCE_AND_DEV_MODE.md) §4 expõe.

Note que **o cruiser tem 140 HP, não os 350 da especificação original**, e não existe a mini-wave de
respiro dos 50s–60s. A janela de respiro entre a última onda e o boss simplesmente não existe: o
spawner roda até 45s e o boss entra em seguida.

---

## 5. Boss: The Cyber Overlord

> **Correção (P3).** A especificação definia 2.000 HP em três fases **cronometradas**, com duas torres
> laterais destrutíveis e um core invulnerável. A implementação tem **15.000 HP**, um corpo único sem
> torres, e fases por **limiar de HP**. O código é a verdade quanto à estrutura; quanto aos números,
> ver D12 logo abaixo.

| Fase | Entra em | Mitigação de dano | Padrão de tiro |
| :--- | :--- | :--- | :--- |
| 1 | Início, 15.000 HP | **50%** | Salvas duplas miradas a partir dos dois canhões laterais |
| 2 | HP ≤ 66% | **30%** | Leque circular mais denso |
| 3 | HP ≤ 33% | **0%** | Enrage: projéteis mais rápidos, cadência maior |

Cada transição concede **2,0s de invulnerabilidade total** ao boss. O intervalo entre salvas cai de
140ms para 110ms e depois 80ms; a velocidade dos projéteis sobe de 300 para 340 e 380 px/s.

> **Nota (B8, 2026-08-13).** Os números da tabela acima (15.000 HP; mitigação de dano — a fração
> absorvida, `1 - BALANCE.boss.mitigation.phaseN` — de 50%/30%/0%) são os que valiam **antes** desta
> tarefa e produziram D12. Ver a correção completa, com os valores medidos vigentes hoje, no final da
> §5.1.

### 5.1. [D12] O boss é invencível para os três presets, e um penhasco para o resto

`BossOverlord.takeDamage()` (`:305-308`) aplica, nesta ordem:

```ts
const cappedPelletDamage = Math.min(45, amount);
const mitigation = this.phase === 1 ? 0.50 : this.phase === 2 ? 0.70 : 1.0;
const actualDamage = Math.max(5, Math.round(cappedPelletDamage * mitigation));
```

O teto de 45 por impacto é aplicado **antes** da mitigação e vale para qualquer fonte de dano —
inclusive mísseis, cujo dano nominal chega a 120 e que entregam 45 antes da mitigação. Os 15.000 HP se
repartem em 5.100 na fase 1, 4.950 na fase 2 e 4.950 na fase 3, e das 45s disponíveis 4,0s são de
invulnerabilidade nas transições.

Aplicando isso aos três presets de fallback, o TTK do boss fica entre ≈115s e ≈130s contra uma janela
de 45s: **taxa de vitória exatamente 0%**, por um fator de ≈2,7×. E como o `interceptor` é também a base
de `normalizeSpec` (**D1**), toda nave malformada herda esse perfil. A tabela completa está em
[Spec 00](./00_AUDIT_AND_DRIFT_REPORT.md) §2.11.

Uma nave gerada pelo AGY pode escapar disso, mas de forma binária e não intencional. No melhor caso que
as travas permitem — dano 45, cadência 12/s:

- `vulcan_spread` com os três projéteis acertando entrega 87 por ciclo, porque cada projétil de 29
  passa **abaixo** do teto de 45. TTK ≈ 21s: vence com folga.
- `laser` e `plasma`, de projétil único, batem no teto de 45 e chegam a TTK ≈ 44,6s contra 45s
  disponíveis — vitória por 0,4s, exigindo 100% de precisão e uptime.

Ou seja, o que decide a partida hoje não é a build do visitante: é se a arma primária dispara um
projétil ou três. Isso é o oposto de uma curva de dificuldade de 15–25%.

O ajuste não é escolher outro número por intuição — foi assim que se chegou aqui. É o que a
[Spec 09](./09_GAME_BALANCE_AND_DEV_MODE.md) resolve: extrair o tuning para uma fonte única, simular, e
travar a taxa de vitória em CI. Enquanto isso não existir, qualquer número novo é outro palpite.

> **Correção (B8, medido em 2026-08-13).** Os números de `mitigation`/`max_hp` acima e na tabela da
> §5 são os que **produziram** D12; eles não valem mais em `balance.ts`. Os valores finais medidos —
> `boss.max_hp: 1.750` (`max_hp_hardcore: 2.567`), `boss.mitigation: { phase1: 0.65, phase2: 0.70,
> phase3: 1.0 }`, `weapons.primary.vulcan_pellet_factor: 0.6`, `match.boss_spawn_s: 40`,
> `match.boss_warning_s: 37` — e o processo que chegou a eles (cinco hipóteses aplicadas uma de cada
> vez, efeito medido a cada passo) estão registrados na [Spec 09](./09_GAME_BALANCE_AND_DEV_MODE.md)
> §2.4, que é a fonte numérica autoritativa por definição (Restrições Globais #3). Resultado líquido:
> os três presets de fallback deixam de ter taxa de vitória 0% (`interceptor` 1,5%, `vanguard` 5,5%,
> `striker` 0,5% em habilidade mediana, 200 seeds) — o achado literal de D12 está corrigido. A banda
> agregada de 15–25% do critério abaixo, porém, **não fecha** com o elenco atual de 8 arquétipos do
> simulador: dois arquétipos sintéticos de teto (`maximo`, `vulcan_max`, que empilham todo atributo de
> `BALANCE.ranges` no máximo simultaneamente — combinação que nenhuma nave orçamentada pelo forge
> alcança) saturam perto de 100% em qualquer `boss.max_hp` baixo o bastante para tirar os três
> fallbacks de 0%, e um arquétipo sintético de piso (`minimo`) morre em ≈2 acertos independentemente
> do HP do boss. Ver Spec 09 §2.4 para a prova de que isso é estrutural, não falta de tuning, e para a
> recomendação de próximo passo (revisar o elenco de arquétipos do portão de CI, não os cinco campos
> de `balance.ts` autorizados nesta tarefa).

### 5.2. [D15] As sinergias não afetam o boss nem nada

Nenhum modificador de `build_metadata.synergies_unlocked` é aplicado em `PlayerShip`, `WeaponSystem` ou
`MainGameScene`. A sinergia é anunciada no builder, calculada pelo MCP, gravada no spec — e ignorada
pela engine. Ver [Spec 02](./02_BUILDER_AND_BUDGET_MECHANICS_SPEC.md) §6 para a matriz que precisa
passar a ter efeito.

---

## 6. Fórmula de pontuação

> **Correção (P5).** Todas as constantes mudaram em relação à especificação original, e foi adicionado
> um **multiplicador de especialização por MCP** que nenhuma especificação previa. O código é a verdade.

```
combatScore     soma de basePts × combo, acumulada por abate
bossBonus       10.000, apenas se o boss foi derrotado
timeBonus       segundos restantes × 80, apenas se o boss foi derrotado
survivalBonus   HP restante × 1.200
synergyBonus    2.000
mcpMultiplier   1 MCP = 1,25x | 2 MCPs = 1,10x | 3 MCPs = 1,00x

finalScore = round( (combatScore + bossBonus + timeBonus + survivalBonus + synergyBonus) × mcpMultiplier )
```

- `basePts`: drone 100, cruiser 500, boss **10.000**.
- Combo: +0,1× por abate consecutivo, teto de 3,0×, zerado ao sofrer dano. A proteção anti-exploit
  original — bônus de tempo só com boss derrotado — **foi preservada**, e é a razão pela qual o
  `timeBonus` hoje é sempre zero: ninguém derrota o boss (D12).
- O `synergyBonus` **não consulta a sinergia**: a chamada passa `synergyBonusUnlocked: this.isVictory`
  (`MainGameScene.ts:598`). São 2.000 pontos que funcionam como um segundo bônus de vitória. Parte de
  D15; quando as sinergias passarem a ter efeito, este campo precisa passar a consultá-las.
- O multiplicador de MCP é o contrapeso de score da mecânica de 1–3 MCPs descrita em
  [Spec 02](./02_BUILDER_AND_BUDGET_MECHANICS_SPEC.md) §1.2.

> **[D8] O teste desta fórmula está vermelho e silenciado.** `ScoreCalculator.test.ts` ainda afirma
> `bossBonus: 5000`, `timeBonus: 15 × 50`, `survivalBonus: 3000` e `synergyBonus: 1500` — as quatro
> constantes antigas. O arquivo não falha o build porque o `npm test` da raiz não alcança o `player-app`.
> Corrigir o runner **antes** de corrigir as asserções: é o gate M0, e é o que prova que o teste voltou
> a ter valor.

---

## 7. Critérios de aceitação

- [ ] 60 FPS estáveis com o boss na fase 3 e o pool de 300 projéteis próximo da saturação.
- [ ] Duas naves com `svg_path_data` diferentes renderizam silhuetas diferentes; um path inválido cai
      para a silhueta de fallback sem exceção no console.
- [ ] A arma secundária causa dano mensurável contra inimigos comuns e contra o boss, e continua
      funcionando após 20 disparos.
- [ ] Uma sinergia ativa produz diferença mensurável em atributo ou dano, verificável no harness de dev.
- [ ] A taxa de vitória sobre o boss, medida pelo simulador da
      [Spec 09](./09_GAME_BALANCE_AND_DEV_MODE.md) — **parcialmente cumprido, medido em 2026-08-13**
      via `npm run sim:balance` e `npm run test --workspace=packages/sim` (200 seeds): os três presets
      de fallback (`interceptor`/`vanguard`/`striker`) saem de 0% e passam a vencer em habilidade
      mediana (1,5% / 5,5% / 0,5%), fechando o achado literal de D12. A taxa **agregada** dos 8
      arquétipos do simulador fica em 25,9% (banda-alvo 15–25%, ≈1pp acima), e o teste de CI de
      `balance-gate.test.ts` **ainda falha** em 3 das 4 condições — não por falta de tuning, mas porque
      dois arquétipos sintéticos de teto (`maximo`, `vulcan_max`) saturam perto de 100% sempre que o
      boss é fraco o bastante para os três fallbacks vencerem, enquanto um arquétipo sintético de piso
      (`minimo`) morre em ≈2 acertos independentemente do HP do boss — ver a prova em Spec 09 §2.4.
      Números simulador-somente: o Passo 4 (cinco partidas jogadas à mão) **não foi executado** —
      nenhuma tarefa desta fase teve acesso a navegador — e continua pendente antes do Gate M1, junto
      com a captura de conformidade ainda pendente da Tarefa B7.
- [ ] `ScoreCalculator.test.ts` executa no `npm test` da raiz e passa.
