# 13 — Chromebook e Crostini: o que muda se o hardware do estande for um Chromebook

**Data:** 2026-09-01
**Estado:** contingência preparada, hardware **não confirmado**.
**Complementa** a [Spec 08 §3](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) (requisito mínimo da
máquina do estande) e a [Spec 08 §7](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) (contingência de
mover a Camada L para a nuvem). Não substitui nenhuma das duas: onde a 08 já decide, este documento
aponta para lá em vez de repetir.

---

## 1. Status e escopo

O hardware do estande **não está confirmado**. Os organizadores podem entregar um Mac, um notebook
x86 comum, ou um Chromebook. Este documento existe para que, se aparecer um Chromebook na bancada, a
decisão de aceitar ou recusar seja tomada em **minutos** e não em horas de investigação no dia — e
para que, se a decisão for aceitar, exista um roteiro de instalação já escrito.

**Veredito de uma frase:** é executável — o `agy` roda no Crostini, inclusive em ARM64 — mas o estande
**deixa de ser um quiosque e vira uma máquina operada por equipe**, porque no ChromeOS não existe modo
quiosque sem enrollment corporativo e licença.

### 1.1. Base de evidência e como ler os rótulos

Este documento consolida duas fontes, e **elas discordam em pontos concretos**:

| Fonte | Data | Natureza |
|---|---|---|
| Pesquisa Chromebook/Crostini | 2026-08-31 | Levantamento documental + inspeção do repositório, em máquina Linux x86-64. Muita coisa marcada como "não confirmado". |
| Verificação de bancada | 2026-09-01 | Teste executado de 5 dessas afirmações, sem hardware Chromebook. `agy 1.1.23`, `lsof 4.95.0`. |

**Onde as duas discordam, vale a verificação de bancada**, e o texto abaixo diz explicitamente em que
ponto a pesquisa estava errada.

Cada afirmação carrega um rótulo, e o rótulo é parte do conteúdo — não é decoração:

- **CONFIRMADO** — há evidência executada, citada junto da afirmação.
- **NÃO CONFIRMADO** — plausível, documentado em fonte secundária, ou inferido do código, mas
  **ninguém rodou**. Nada aqui deve ser tratado como fato operacional.
- **REFUTADO** — a pesquisa afirmou, a bancada derrubou.

Nenhum número neste documento foi estimado por conta própria. Onde o dado falta, está escrito que
falta e qual teste do §7 o obtém.

### 1.2. O que este documento **não** cobre

- Não reescreve o [`specs/12_MANUAL_TEST_PLAN_MAC.md`](./12_MANUAL_TEST_PLAN_MAC.md). O §8 lista as
  linhas macOS-only e o equivalente Linux, como insumo de decisão — a reescrita, se acontecer, é
  outro trabalho.
- Não substitui a contingência de nuvem da [Spec 08 §7](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md).
  Aquela contingência continua sendo o plano para o caso em que o Crostini **não pode ser habilitado**
  (bloqueador B1 abaixo). Este documento é o plano para o caso em que ele **pode**.

---

## 2. O que está CONFIRMADO

Só entra nesta seção o que a verificação de bancada de 2026-09-01 executou. A evidência vai junto.

### 2.1. O `agy` tem build oficial `linux_arm64`, e a versão corrente é a 1.1.23

**CONFIRMADO.** O canal que o instalador oficial realmente usa responde:

```
GET https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_arm64.json
→ HTTP 200
  { "version": "1.1.23",
    "url": ".../1.1.23-6260551186251776/linux-arm/cli_linux_arm64.tar.gz",
    "sha512": "fe139434dda36241..." }
```

`HEAD` nos dois tarballs mostra **paridade de versão e de publicação** entre as arquiteturas:
`cli_linux_arm64.tar.gz` com `content-length: 53075839` e `last-modified: Mon, 31 Aug 2026 23:55:36
GMT`; `cli_linux_x64.tar.gz` com `56593215` e `23:55:25 GMT`. O `install.sh` (7354 bytes,
`content-type: application/x-sh`) faz `case "$(uname -m)"` mapeando `arm64|aarch64` para `arm64`.

**Três correções à pesquisa**, todas de detalhe mas todas com consequência prática:

1. **Versão.** A pesquisa cita **1.1.22** em três lugares (§2.1, §2.3, §3.4). A versão publicada é
   **1.1.23**, de 2026-08-31 23:55 UTC. Onde o guia de instalação disser "espere a 1.1.22", vai
   assustar quem instalar hoje.
2. **Nome do artefato.** Existem **dois nomes conforme o canal**: `agy_cli_linux_arm64.tar.gz` no
   GitHub Releases (o que a pesquisa cita — está correto para aquele canal) e
   **`cli_linux_arm64.tar.gz` no GCS**, que é o que o `install.sh` oficial de fato baixa. O guia de
   instalação (§6) descreve o caminho `install.sh`/GCS, então o nome que importa é o do GCS.
3. **Orçamento de disco.** A pesquisa diz "≈200 MB baixados" no §3.4. São **53 MB comprimidos** em
   arm64 (56 MB em x64) — a pesquisa **superestimou o download em aprox. 4x**. Os ≈200 MB são o
   binário **descompactado**: 208 986 368 bytes na máquina de bancada. O total de disco do §3.9 da
   pesquisa (≈3,2 GB, com 20 GB alocados) não muda de ordem de grandeza; o que muda é o tempo de
   download, que é bem menor do que o planejado.

Um detalhe extra: **`linux_arm64_musl` retorna HTTP 404** (`linux_amd64` e `linux_arm64` retornam
200). Irrelevante para o Crostini, que é Debian/glibc — mas é armadilha para quem tentar
containerizar o estande em Alpine, e por isso fica registrado aqui.

### 2.2. O `agy` tem uma tela de confiança de workspace, e ela é pré-populável

**CONFIRMADO** (mecanismo e nome da chave). **NÃO CONFIRMADO** ao vivo — ver a ressalva no fim.

A chave existe com o nome exato `trustedWorkspaces` em `~/.gemini/antigravity-cli/settings.json`, e o
formato é **array JSON plano de caminhos absolutos**, sem hash, sem objeto, sem barra final:

```
$ jq -r 'keys' ~/.gemini/antigravity-cli/settings.json
["colorScheme","enableTelemetry","gcp","trustedWorkspaces"]

$ jq -r '.trustedWorkspaces | index("/tmp/booth_session")' ~/.gemini/antigravity-cli/settings.json
null
```

O binário contém um modelo de TUI dedicado — não um aviso passivo, mas **uma tela que espera tecla**:
`WorkspaceTrustModel` com `View`, `Update` e `Keybindings`, além das strings `Do you trust the
contents of this project?`, `Yes, I trust this folder`, `IsTrustedWorkspace` e a tag
`json:"trustedWorkspaces,omitempty"`.

Por que isso importa para o estande: `scripts/booth-terminal.sh:112` faz `cd "$SESSION_DIR"` antes de
exec'ar o `agy`, e `scripts/booth-terminal.sh:15` define `SESSION_DIR="/tmp/booth_session"`. Numa
máquina nova esse caminho não está em `trustedWorkspaces`, então o primeiro visitante do dia
provavelmente encara uma tela de confirmação — o que **quebra o Bloco 20.2** do plano de teste
(`specs/12_MANUAL_TEST_PLAN_MAC.md:1475`, "o terminal começa sozinho"), que é a asserção central do
Gate M6.

**Não existe flag de CLI que pule a confiança de workspace.** O `agy --help 2>&1` da 1.1.23 oferece
`--dangerously-skip-permissions`, mas pelo próprio texto ela é sobre aprovação de *ferramentas*
("tool permission requests"), e no binário isso vive em símbolos distintos do `WorkspaceTrustModel`.
Se ela também dispensa o trust de workspace é **NÃO CONFIRMADO**. **Pré-popular o `settings.json` é o
único caminho de bypass efetivamente identificado** — daí ele ser passo obrigatório do §6.

Duas observações de forma, ambas com efeito no guia:

- A lista contém `/home/carloscabral` **e** dois filhos dele. Se a comparação fosse por prefixo, os
  filhos seriam redundantes; isso sugere **match exato de caminho**, não prefixo. Inferência forte,
  **não prova** — mas é o motivo de o §6 acrescentar `/tmp/booth_session` como entrada própria, com
  caminho absoluto e **sem barra final**.
- `/tmp/booth_session` é recriado a cada boot por `scripts/booth-terminal.sh:38`, mas a confiança é
  por **caminho**, não por inode: sobrevive à recriação.
- Existe um segundo arquivo, `~/.gemini/trustedFolders.json`. Ele é do **Gemini CLI**, produto
  diferente, e **não é lido pelo `agy`**. Não confundir os dois.

**Ressalva honesta:** a reprodução ao vivo foi **INCONCLUSIVA**. A sonda rodou o `agy` sob PTY real
num diretório fora da lista e parou numa tela anterior e independente — `Welcome to the Antigravity
CLI. You are currently not signed in. / Select login method:` — que apareceu igualmente no controle,
rodando num diretório **que está** em `trustedWorkspaces`. O login é um gate anterior ao trust, e sem
completar um OAuth não deu para observar o prompt. Por isso o risco **A4** sobe de "não confirmado"
para **provável, com mitigação conhecida** — e o teste C4 do §7 continua obrigatório.

### 2.3. `lsof` com múltiplas portas posicionais aborta a consulta inteira

**CONFIRMADO por reprodução**, e **já corrigido no repositório** — ver §3.1 para a parte que foi
refutada. Com dois listeners triviais ativos:

```
A) lsof -ti :5173 :5174        stdout=[] bytes=0 rc=1
   stderr: lsof: status error on :5174: No such file or directory
B) lsof -ti :5173 -i :5174     stdout=[1712968 1712969] rc=0
```

O `lsof` do Linux interpreta o segundo `:5174` como **nome de arquivo** e aborta tudo. A forma correta
exige `-i` em cada porta.

**Estado atual do repositório (verificado em 2026-09-01, `main` em `b4201db`):** as duas ocorrências
do bug **já foram corrigidas** no commit `7263ba1` ("fix(scripts): lsof com múltiplas portas precisa
de -i em cada uma"). `scripts/kill-all.sh:15` e `specs/12_MANUAL_TEST_PLAN_MAC.md:84` já usam
`-i` em cada porta. As três ocorrências de porta única (`package.json:20`,
`specs/12_MANUAL_TEST_PLAN_MAC.md:1409` e `:1787`) sempre estiveram corretas. **Nada a fazer aqui** —
o item fica registrado porque a versão do risco **A6** herdada da pesquisa está desatualizada.

Alternativas sem dependência de `lsof`, úteis no container Debian mínimo onde `lsof` não vem
instalado: `ss -ltnp 'sport = :5173 or sport = :5174'` ou `fuser -k 5173/tcp 5174/tcp`.

### 2.4. O plano de teste tem comandos macOS-only, e o alcance é conhecido

**CONFIRMADO.** A varredura encontrou as ocorrências listadas no §8. Igualmente útil é o que **não**
foi encontrado, porque delimita o problema: `pbcopy`, `pbpaste`, `open` como comando, `say`,
`networksetup`, `/Users/`, `osascript`, `launchctl`, `caffeinate`, `brew`, `system_profiler`,
`defaults write`, `diskutil`, `pmset`, `Terminal.app`, `Finder` e `Spotlight` **não aparecem** no
arquivo. A portabilidade é um problema de dezenas de linhas, não de reescrita.

### 2.5. Só existe **um** `vite --open` no monorepo

**CONFIRMADO.** `grep` por `--open` em todos os `package.json` retorna exatamente uma linha:
`packages/player-app/package.json:8` → `"dev:game": "vite --open /dev.html"`. Nenhum `vite.config.ts`
do monorepo define `server.open`.

E existe substituto pronto que serve **o mesmo servidor**: `packages/player-app` expõe `"dev": "vite"`,
publicado no raiz como `npm run dev:player` (`package.json:25`). Sobe o mesmo Vite na 5173 com
`host: true`; a única diferença é não chamar `xdg-open` e abrir `/` em vez de `/dev.html`.

A conclusão que interessa: **o `--open` não é o problema; o port forwarding é.** Mesmo que o
`xdg-open` funcione via Garcon, a URL entregue ao Chrome do ChromeOS é `http://localhost:5173/...`, e
esse `localhost` é o do ChromeOS, não o do container. Com a 5173 encaminhada, o `--open` volta a
funcionar por acidente feliz. Nenhuma mudança de arquivo é necessária.

### 2.6. O `--help` do `agy` continua saindo inteiramente no stderr na 1.1.23

**CONFIRMADO** por medição:

```
$ agy --help </dev/null 2>/dev/null | wc -c      # stdout
0
$ agy --help </dev/null 2>&1 >/dev/null | wc -c  # stderr
2675
```

O `2>&1` de `scripts/booth-terminal.sh:149` continua obrigatório, e a sonda por `--prompt-interactive`
continua encontrando a flag. O comentário do script cita "agy 1.1.22"; o comportamento vale igual na
1.1.23. **Nenhuma mudança necessária** — e o Bloco 19.5
(`specs/12_MANUAL_TEST_PLAN_MAC.md:1441`) continua válido como está.

### 2.7. O estado de autenticação do `agy` não sobreviveu à atualização de versão

**CONFIRMADO**, e é o achado mais acionável de todos. O log da execução do próprio usuário em
`~/.gemini/antigravity-cli/log/cli-20260901_133308.log` registra:

```
keyring.go:52] keyringAuth: incomplete GCP onboarding (no userTier or projectID),
               treating as unauthenticated
cache.go:56]   ... You are not logged into Antigravity.
```

O binário foi atualizado para a 1.1.23 às 13:25 e o diretório `~/.gemini/antigravity-cli/` inteiro foi
refeito no mesmo minuto. O `settings.json` ainda tem `gcp.project = vibe-cabral`, mas o estado de auth
se perdeu.

Consequência direta: **nesta máquina, hoje, um ciclo de forja cairia no fallback de preset** —
`AGY_PRE_MCP_SILENCE_TIMEOUT_MS` (`packages/daemon/src/index.ts:64`) dispara e todo visitante recebe
nave genérica. É exatamente o sintoma que o risco A1 descreve para OOM, e os dois são
indistinguíveis pela UI.

Isso vale para qualquer hardware, não só Chromebook: **uma atualização automática do `agy` na véspera
do evento pode deslogar o estande em silêncio.** Daí o teste C6 do §7 ser "o `agy` está logado?" no
início de cada dia.

---

## 3. O que está REFUTADO

### 3.1. "Só a 5173 é morta; o leaderboard na 5174 sobrevive ao `kill:all`"

**REFUTADO.** A pesquisa (§4.9) descreve o bug do `lsof` como uma morte parcial. Não é: o `lsof`
**aborta a consulta inteira** ao encontrar o argumento posicional inválido — stdout com **0 bytes** e
exit code **1**. Nem a 5173 nem a 5174 eram mortas. O `xargs -r` engolia o vazio e o `|| true` engolia
o `rc=1`, então `npm run kill:all` era um **no-op silencioso para as duas portas de Vite**.

O impacto era maior do que a pesquisa calcula, porque o Gate M2 tem "zero órfãos por ciclo" como
critério central e o comando que deveria garanti-lo não matava nenhum dos dois dev servers.

Além disso, a bancada achou uma ocorrência que a pesquisa **não menciona** e que era pior:
`specs/12_MANUAL_TEST_PLAN_MAC.md:84` tinha a mesma construção no passo 0.4 ("portas livres"). Ela
*mascarava* o próprio bug — o operador rodava o passo, via saída vazia, marcava o checkbox e seguia
com daemon e Vites vivos. Era um **falso PASS** que não validava nada.

**Ambas já corrigidas** em `7263ba1`. Ver §2.3.

### 3.2. "O download do `agy` são ≈200 MB"

**REFUTADO.** São **53 MB** em arm64 e **56 MB** em x64, medidos por `content-length` no GCS. Os
≈200 MB são o binário descompactado. Ver §2.1, correção 3.

### 3.3. "A versão corrente do `agy` é a 1.1.22"

**REFUTADO.** É a **1.1.23**, publicada em 2026-08-31 23:55 UTC. Ver §2.1, correção 1.

### 3.4. "O artefato arm64 se chama `agy_cli_linux_arm64.tar.gz`"

**REFUTADO como nome único.** Esse é o nome no GitHub Releases. O `install.sh` oficial baixa
**`cli_linux_arm64.tar.gz`** do GCS. Como o guia de instalação usa o `install.sh`, o nome do GCS é o
que vale. Ver §2.1, correção 2.

### 3.5. Nota de escopo

Nenhum dos itens sobre **o Chromebook em si** — kiosk, port forwarding, balão de memória, `.tini`,
teclado — foi refutado, porque **nenhum deles foi testado**: a bancada não tinha hardware ChromeOS.
Todos permanecem **NÃO CONFIRMADO** e estão no §7 como testes que só o hardware fecha. Isto é o ponto
mais importante deste documento: a parte verificada é a parte que roda em qualquer Linux; a parte
específica de ChromeOS continua inteiramente por verificar.

---

## 4. Bloqueadores

Um bloqueador é o que **não tem contorno técnico** dentro do estande — ou o ambiente permite, ou o
plano muda. Todos herdados da pesquisa de 2026-08-31 e todos **NÃO CONFIRMADOS** contra hardware real,
porque dependem do dispositivo que aparecer.

| # | Bloqueador | Prob. | Impacto no dia | Mitigação | Confiança |
|---|---|---|---|---|---|
| **B1** | **Dispositivo gerenciado com `VirtualMachinesAllowed` desabilitada.** Se o Chromebook vier do parceiro/organizador e estiver enrolled num domínio, o Crostini está desligado por padrão e exige `VirtualMachinesAllowed` (device) **e** `CrostiniAllowed` (user). | Média — depende de quem fornece o hardware | Total. Sem Crostini não há `agy`, e a [Spec 08 §3](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) é explícita: um Chromebook sem Crostini **não atende** a Camada L. | Só o admin do domínio resolve. **Checar `chrome://policy` no primeiro minuto de contato com o hardware** (teste C1). Plano B é a contingência da [Spec 08 §7](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md), que é uma reescrita, não uma configuração. | NÃO CONFIRMADO (documentação de política) |
| **B2** | **Não existe kiosk sem enrollment + licença.** As flags que a Spec 01 §3.2 e a Spec 06 §3.4 pedem (`--kiosk --noerrdialogs --disable-infobars --user-data-dir=...`) vivem em `/etc/chrome_dev.conf`, no rootfs somente-leitura e verificado criptograficamente. Editá-lo exige developer mode, e ativar developer mode **faz powerwash**. | Certa | Alta. O estande deixa de ser autônomo: qualquer visitante sai da janela com Alt+Tab, abre uma aba, ou desloga com `Ctrl+Shift+Q`. | Aceitar equipe vigiando + PWA instalada em janela e tela cheia (§6.9). Ou comprar a licença Kiosk & Signage e fazer enrollment — o que também resolveria B1. **Não se perde áudio:** `--autoplay-policy` existia para destravar o WebAudio, e o jogo já destrava por gesto do usuário. | NÃO CONFIRMADO (documentação) |
| **B3** | **Sessão de convidado não habilita Crostini.** | Certa | Médio. Obriga uma conta Google logada de verdade no estande, com todo o histórico e perfil dela expostos ao público. | Criar uma conta dedicada ao evento, antes do dia. | NÃO CONFIRMADO (documentação) |
| **B4** | **Backup `.tini` não porta entre arquiteturas.** Um backup de x86 só restaura em x86; um de ARM só em ARM. | Média (só se houver mais de uma estação) | Médio. Mata o plano "prepara uma máquina e clona nas outras". | **Exigir que todas as estações sejam da mesma arquitetura.** Sem isso, o custo de preparo é linear no número de estações. | NÃO CONFIRMADO (documentação) |
| **B5** | **Powerwash apaga tudo**, e ativar developer mode — única via para as flags do Chrome — **faz powerwash**. | Baixa | Total se acontecer no dia. | Backup `.tini` guardado num pendrive, mais este guia. **Não tentar developer mode**, em hipótese alguma, nem na véspera. | NÃO CONFIRMADO (documentação) |

O laço entre B1, B2 e B5 é o que define a natureza da decisão: as três únicas saídas para "o estande
não é um quiosque" são **enrollment com licença** (custa dinheiro e um administrador), **developer
mode** (apaga a máquina) ou **aceitar equipe vigiando**. A terceira é a única realista dentro do
prazo, e é ela que o §1 chama de "máquina operada por equipe".

---

## 5. Riscos

Diferentemente dos bloqueadores, todos estes **funcionam com ajuste**. A coluna de confiança é a que
decide o que precisa ser testado antes das portas abrirem.

| # | Risco | Prob. | Impacto | Mitigação | Confiança |
|---|---|---|---|---|---|
| **A1** | **Chromebook de 4 GB.** O `virtio-balloon` devolve RAM ao ChromeOS sob pressão e os processos do container morrem **primeiro**. Rodam ao mesmo tempo: daemon, até 3 servidores MCP spawnados pelo `agy` (`packages/daemon/src/services/workspace-generator.ts:228`), o próprio `agy`, e o Chrome com o Phaser. | Alta se o hardware for de entrada | **Alta — mata a razão de ser da ativação.** O sintoma é indistinguível de um `agy` travado: o daemon dispara o fallback de preset e todo visitante recebe nave genérica. Degrada em silêncio para "o agente nunca funciona". | **Exigir 8 GB por escrito**, junto do pedido da [Spec 08 §3](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md). Não é negociável. Medir com o teste C3. | NÃO CONFIRMADO |
| **A2** | **`localhost:3000` do Chrome do ChromeOS não alcança o daemon**, que roda dentro da VM `termina`. | Certa | Alta se descoberta no dia | Port forwarding da 3000 (§6.9). **Nenhuma mudança de código é necessária:** `packages/daemon/src/index.ts:624` faz `server.listen(PORT)` sem host, então o Node já liga em `::`/`0.0.0.0`, e os Vite têm `host: true`. | NÃO CONFIRMADO |
| **A3** | **Frame rate abaixo de 60 fps na GPU do Chromebook.** A [Spec 09 §5.9](./09_GAME_BALANCE_AND_DEV_MODE.md) já registra que "o estande pode rodar em Chromebooks — é exatamente a classe de hardware em que isso morde". O defeito de cadência foi corrigido em `packages/shared/src/game/fire-cadence.ts`, então o DPS não cai mais com o frame rate — mas a **sensação** cai. | Média | Média — jogo perceptivelmente pior, e o balanceamento medido no Mac deixa de valer | Refazer os Blocos 3 e 4 do plano de teste no hardware real e medir `boss_fight_min_fps` (teste C11). O jogo roda no Chrome **nativo**, não dentro do container, então a ressalva da Spec 08 §3 sobre VirGL não se aplica — desde que ninguém rode navegador no container. | NÃO CONFIRMADO |
| **A4** | **Tela de confiança de workspace do `agy` em `/tmp/booth_session`** quebra a abertura sem digitação. | **Provável** (era "não confirmado" na pesquisa; a bancada achou o `WorkspaceTrustModel` no binário e confirmou que o caminho não está na lista) | Alta — quebra o Bloco 20.2 (`specs/12_MANUAL_TEST_PLAN_MAC.md:1475`), que é a entrega central do Gate M6 | **Pré-popular `trustedWorkspaces`** (§6.6, passo obrigatório) e validar com um ciclo em branco (teste C4). | CONFIRMADO no mecanismo, NÃO CONFIRMADO ao vivo |
| **A5** | **`Ctrl+Shift+F12` não é digitável.** A top row do Chromebook é de teclas de mídia e a maioria dos modelos não tem posição F12 física. O atalho é usado nos Blocos 5.17, 7.1, 21.6 e 24.1, e implementado em `packages/player-app/src/App.tsx:60`. | Certa | Média — a equipe perde o reset rápido | Em ordem: (a) botão **RESET** da UI (`App.tsx:187`), que funciona sempre que o foco está na Tela 1; (b) `curl -s -X POST localhost:3000/api/session/reset`, que o Bloco 7.1 já oferece; (c) ligar o toggle de F-keys; (d) teclado USB externo. **Agravante pré-existente:** o listener é de `window`, então já é inoperante com o foco na Tela 2 — é o defeito **D11** da Spec 01 §4.2, e no ChromeOS **não há como subir para o nível do SO**. | NÃO CONFIRMADO (comportamento de teclado) |
| **A6** | **`lsof` e `jq` ausentes no container Debian mínimo.** Sem `jq`, `scripts/booth-terminal.sh:101-107` cai nos defaults e o banner mostra "PILOTO (SUMMIT)"; e os passos dos Blocos 21.4, 22.1, 22.5, 23.1 e 23.4 simplesmente não rodam. Sem `lsof`, `npm run kill:daemon` vira no-op silencioso. | Certa | Média | `sudo apt install lsof jq` (§6.2). **A parte do `kill-all.sh` deste risco está encerrada** — corrigida em `7263ba1`, ver §2.3. | CONFIRMADO (ausência dos pacotes é padrão do container) |
| **A7** | **Logout e suspensão derrubam os processos.** O container persiste, os processos não. Uma tela travada, um logout por reflexo, ou o bloqueio automático derrubam a pilha inteira — e nada roda como serviço (não há systemd unit nem LaunchAgent; o USER_GUIDE §3 lista quatro comandos a digitar). | Média | Alta enquanto durar | Desativar suspensão e bloqueio automático nas configurações de energia (§6.9). Escrever o `reset_booth.sh` que a Spec 06 §3.5 pede — é o único dos scripts ausentes (**U4**) 100% portável (`curl` + kill por PGID + `rm`) e o único caminho de reset que funciona com o foco fora do navegador. | NÃO CONFIRMADO |
| **A8** | **Downloads e `~/Desktop` do plano de teste.** Quem baixa é o Chrome do **ChromeOS**; o arquivo vai para a pasta Downloads do ChromeOS, que o container não enxerga. E `~/Desktop` não existe no home do container. | Certa | Baixa — atrapalha o teste, não o evento | Compartilhar Downloads com o Linux (§6.9, item 6); trocar os caminhos conforme o §8. | CONFIRMADO nas linhas do plano (§8); NÃO CONFIRMADO no caminho `/mnt/chromeos/...` |
| **A9** | **`agy` arm64 nunca exercitado por este projeto.** A build existe e está em paridade (§2.1), mas ninguém rodou uma forja completa nela. | Média (só se o hardware for ARM) | Média | Teste C15: uma forja de ponta a ponta com `mcp_audit.log` não-vazio. | Build CONFIRMADA; execução NÃO CONFIRMADA |
| **A10** | **O `agy` pode perder o login sozinho.** Uma atualização de versão refez `~/.gemini/antigravity-cli/` e o estado de auth não sobreviveu (§2.7). Fora de sessão SSH o `agy` tenta o **Secret Service do freedesktop** (libsecret/gnome-keyring via D-Bus); o container `penguin` padrão **não roda** gnome-keyring nem um D-Bus de sessão com Secret Service. Existe um `fallbackServiceProvider`, então provavelmente degrada para arquivo. | Média | **Alta** — todo visitante recebe nave de preset, em silêncio | Smoke test de login no início de cada dia (teste C6) e verificação de persistência entre reinícios do container (teste C5). Considerar travar a versão do `agy` na véspera. | Perda de auth CONFIRMADA nesta máquina; degradação para arquivo no Crostini NÃO CONFIRMADA |

**A10 é novo** em relação à pesquisa de 2026-08-31 — veio dos achados extras da bancada. É o único
risco desta tabela que já se materializou uma vez, e o único que atinge o Mac igualmente.

---

## 6. Instalação numa máquina nova

Premissa: Chromebook de 8 GB (16 GB melhor), conta Google dedicada ao estande já logada, dispositivo
**não** gerenciado — ou gerenciado com `VirtualMachinesAllowed` e `CrostiniAllowed` habilitadas.

Ordem de execução importa: o §6.1 é um portão, e o §6.6 precisa vir antes de qualquer ciclo de forja.

### 6.1 — Checar elegibilidade (2 min) — **portão**

- `chrome://policy` → procurar `VirtualMachinesAllowed` e `CrostiniAllowed`. Se aparecerem como
  **Disabled, pare aqui**: é o bloqueador B1, e só o administrador do domínio resolve. O plano passa a
  ser a [Spec 08 §7](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md).
- `chrome://version` → anotar as versões do ChromeOS e do Chrome. Substitui o Bloco 15.1
  (`specs/12_MANUAL_TEST_PLAN_MAC.md:1257`), que roda um binário de macOS.

### 6.2 — Habilitar o Crostini e instalar pacotes de sistema (15–25 min, quase tudo espera)

Configurações → Sobre o ChromeOS → Desenvolvedores → Ambiente de desenvolvimento Linux → Configurar.
Usuário: qualquer um (ex.: `booth`). **Tamanho do disco: 20 GB** — o btrfs é pré-alocado na criação
(por isso demora), e escolher curto agora custa um resize depois.

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl jq lsof build-essential python3 ca-certificates
# só se você for refazer o Gate M3 nesta máquina — os emuladores do Firebase são Java:
sudo apt install -y default-jre
```

`jq` e `lsof` fecham o risco A6. `build-essential` e `python3` são seguro barato: cobrem o fallback de
compilação do `better-sqlite3` caso o ABI do Node instalado não case com nenhum prebuild.

### 6.3 — Node (3 min)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v      # esperado: v22.x e npm 10.x ou superior
```

**Use NodeSource, não `nvm`.** O motivo é concreto:
`packages/daemon/src/services/workspace-generator.ts:228` grava `command: 'node'` no
`.agents/mcp_config.json` da sessão, e é o **`agy`** — não o nosso shell — quem faz o spawn dos três
servidores MCP. Um `node` que só existe no PATH de shell interativo é uma armadilha esperando o dia em
que alguém transformar o supervisor num serviço.

O `apt` do bookworm entrega Node 18, velho demais para o que o plano de teste pede
(`specs/12_MANUAL_TEST_PLAN_MAC.md:62`: 20.x ou 22.x LTS). Nenhum `package.json` do monorepo tem campo
`engines`, então nada trava a versão errada — a verificação é humana.

### 6.4 — `agy` (3–5 min; 53 MB em arm64, 56 MB em x64)

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
# instala em ~/.local/bin/agy; detecta uname -m e baixa cli_linux_amd64 ou cli_linux_arm64 do GCS
export PATH="$HOME/.local/bin:$PATH"    # confirme que a linha está no ~/.bashrc
agy --version                            # esperado: 1.1.23 ou superior
agy --help 2>&1 | grep -- '--prompt-interactive'
```

O `2>&1` não é firula: o help sai **inteiramente no stderr**, com stdout vazio (§2.6). É o mesmo
motivo pelo qual `scripts/booth-terminal.sh:149` o usa.

### 6.5 — Autenticar o `agy` no sabor Vertex (5 min)

Login com o Google. No Crostini o `xdg-open` funciona: o daemon **Garcon** dentro do container
encaminha a URL via **Cicerone** e o Chrome do ChromeOS abre a aba, desde que o
`cros-container-guest-tools` esteja instalado — o que é o caso no container padrão (**NÃO
CONFIRMADO** em hardware). Se não abrir, o `agy` detecta ambiente headless e imprime a URL para colar
à mão.

Confirmar depois que `~/.gemini/antigravity-cli/settings.json` tem
`"gcp": { "project": "vibe-cabral", "location": "global" }`. O `agy` precisa estar no sabor
**Vertex AI / Enterprise** com `gemini-3.7-flash` — **nunca** com chave de API.

### 6.6 — Pré-popular `trustedWorkspaces` — **obrigatório**

Este passo não é opcional e não é otimização. Sem ele, o `agy` provavelmente exibe a tela
`Do you trust the contents of this project?` na primeira execução em `/tmp/booth_session`, e essa tela
**espera tecla** (§2.2). Isso quebra o Bloco 20.2 do plano de teste
(`specs/12_MANUAL_TEST_PLAN_MAC.md:1475`) — "o terminal começa sozinho, ninguém digitou nem colou nada"
—, que é a asserção central do Gate M6. Na prática, o primeiro visitante do dia encararia um prompt
que ninguém do público sabe responder.

Edição idempotente e sem clobber:

```bash
S=~/.gemini/antigravity-cli/settings.json
jq '.trustedWorkspaces = ((.trustedWorkspaces // []) + ["/tmp/booth_session"] | unique)' "$S" > "$S.tmp" \
  && mv "$S.tmp" "$S"
jq -r '.trustedWorkspaces | index("/tmp/booth_session")' "$S"   # esperado: um índice, não null
```

Regras que valem a pena repetir porque erram fácil:

- O caminho é **absoluto e sem barra final**. `/tmp/booth_session/` provavelmente não casa — a
  comparação aparenta ser por caminho exato, não por prefixo (§2.2).
- Não confundir com `~/.gemini/trustedFolders.json`, que é do **Gemini CLI**, produto diferente, e
  não é lido pelo `agy`.
- O diretório é recriado a cada boot por `scripts/booth-terminal.sh:38`; a confiança é por caminho e
  sobrevive à recriação.

Depois disso, ainda **valide ao vivo** com o teste C4 do §7. Pré-popular é a mitigação; a validação é
outra coisa.

### 6.7 — Repositório (5–10 min)

```bash
git clone https://github.com/carlosmscabral/jogo-de-navinha-agy-summit-26.git
cd jogo-de-navinha-agy-summit-26
npm install          # node_modules medido em 607 MB; repositório completo 632 MB
npm run build        # 5 workspaces
npm test             # há uma falha conhecida e esperada — ver specs/11
```

O `package-lock.json` versionado já contém as entradas arm64 (`@rollup/rollup-linux-arm64-gnu`,
`@esbuild/linux-arm64`, e as musl), então o clássico `Cannot find module
@rollup/rollup-linux-arm64-gnu` **não** deve acontecer. **CONFIRMADO** por inspeção do lockfile, **NÃO
CONFIRMADO** por instalação real em arm64.

Antes de reconhecer qualquer falha de teste como esperada, leia
[`11_KNOWN_GAPS_AND_OPEN_ITEMS.md`](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md) — o plano de teste
(`specs/12_MANUAL_TEST_PLAN_MAC.md:1422`, Bloco 19.3) já traz o resultado esperado da suíte.

### 6.8 — Configuração de nuvem (5 min)

`packages/daemon/.env`, a partir de `packages/daemon/.env.example`:

```
BOOTH_CLOUD_API_BASE=<URL do Cloud Run>
BOOTH_INGEST_TOKEN=<Secret Manager: booth-ingest-token>
```

Ler o token: `gcloud secrets versions access latest --secret=booth-ingest-token`. O gcloud **não é
obrigatório** na máquina do estande — só para operação e deploy; se for instalar, o repo apt do Google
publica `arm64`, e o auth headless é `gcloud auth login --no-launch-browser`.

O telão **não** precisa desta máquina: está em Firebase Hosting desde a Fase C. Isso é importante para
o Chromebook porque elimina uma das três telas do problema de saídas de vídeo.

### 6.9 — A parte que é só do Chromebook (10 min)

Nenhum item abaixo foi verificado em hardware. Todos são **NÃO CONFIRMADO** e cada um tem um teste
correspondente no §7.

1. **Port forwarding da 3000.** Configurações → Desenvolvedores → Linux → Encaminhamento de portas →
   adicionar `3000` (TCP). Portas abaixo de 1024 nunca são tuneladas; a 3000 está liberada. Se for
   usar o harness de dev, encaminhe também a `5173`.
   **Use `localhost`, não `penguin.linux.test`** — e o motivo é decisivo: o botão **Copiar** da Tela 1
   (`packages/player-app/src/components/HandoffTerminalScreen.tsx:273`) usa
   `navigator.clipboard.writeText`, que exige *secure context*. `http://localhost:3000` é secure
   context por definição; `http://penguin.linux.test:3000` **não é**, por ser host comum sobre HTTP.
   Escolher o hostname mata o Bloco 20.4 (`specs/12_MANUAL_TEST_PLAN_MAC.md:1492`).
   Colar no terminal em si continua funcionando: `Ctrl+Shift+V` é o que o plano já documenta em
   `specs/12_MANUAL_TEST_PLAN_MAC.md:1498`, e o clipboard ChromeOS ↔ Crostini é compartilhado para
   `text/plain`.
2. **Instalar a Tela 1 como app em janela.** Abrir `http://localhost:3000` → menu do Chrome →
   "Instalar página como app" com **"Abrir como janela"**. Remove barra de endereço e abas, e libera
   `Ctrl+W`/`Ctrl+N` para a página. É o mais perto de kiosk que se consegue (B2): **perde-se** o perfil
   isolado por `--user-data-dir`, o `--noerrdialogs`, o `--disable-infobars` e a garantia de que o
   visitante não sai.
3. **Top row como F-keys.** Configurações → Dispositivo → Teclado → "Tratar teclas da linha superior
   como teclas de função". Sem isso, `Ctrl+Shift+F12` é impossível de digitar (A5).
4. **Tela cheia:** tecla de tela cheia da top row (posição F4), ou `Search+F4` com o item 3 ligado.
5. **Arranjo de telas:** Configurações → Dispositivo → Telas. Janela do Chrome (a PWA) na Tela 1,
   janela do app Terminal na Tela 2, ambas em tela cheia. Atenção: com tela interna + uma externa, a
   externa provavelmente vira a Tela 1 (jogador) e a **interna** vira a Tela 2 (terminal),
   **invertendo o que a Spec 01 §3.1 assume** sobre a Tela 2 ser a visível ao público. É uma decisão de
   bancada, não de software. O `setup_monitors.sh` ausente (**U4**, Spec 06 §3.1) não deve ser escrito
   com `xrandr` aqui: o arranjo é do ChromeOS, não do container, e é configuração manual feita uma vez.
6. **Compartilhar a pasta Downloads com o Linux** (app Arquivos → Downloads → botão direito →
   "Compartilhar com o Linux"). Ela aparece em `/mnt/chromeos/MyFiles/Downloads` dentro do container.
   Sem isso, os arquivos que o navegador baixa ficam inalcançáveis pelos comandos do plano de teste
   (A8, e as linhas `:353` e `:818` do §8).
7. **Desativar suspensão e bloqueio automático** nas configurações de energia. O logout do ChromeOS
   **encerra os processos do container** (A7).

### 6.10 — Orçamento

| | |
|---|---|
| **Tempo** | 60–90 min para a primeira máquina. Com a correção de §2.1, o download do `agy` deixa de ser um dos trechos longos: sobra o `npm install` e a criação do disco pré-alocado do Crostini. Uma segunda máquina da **mesma arquitetura** pode sair em ≈15 min via backup `.tini` (**NÃO CONFIRMADO** — teste C14). |
| **Disco** | Container base ≈2 GB + Node ≈150 MB + `agy` ≈209 MB descompactado + repositório com `node_modules` **632 MB medidos** ≈ **3,2 GB**. Com gcloud e JRE, ≈4,5 GB. **Aloque 20 GB**: o btrfs pré-alocado e o `.tini` de backup precisam de folga. |

---

## 7. Testes que só o hardware fecha

O §2 mostrou o que dá para verificar sem Chromebook. **Tudo que é específico de ChromeOS continua por
verificar.** Esta seção é a lista, no formato dos blocos de
[`12_MANUAL_TEST_PLAN_MAC.md`](./12_MANUAL_TEST_PLAN_MAC.md): caixa, comando quando houver, resultado
esperado explícito, e o que a falha decide.

Ordem importa até o C4. Depois disso, os blocos são independentes.

### Bloco C — Portão de viabilidade (5 min, antes de qualquer outra coisa)

- [ ] **C1 — O Crostini é permitido nesta máquina?**

No Chrome do ChromeOS: `chrome://policy` → buscar `VirtualMachinesAllowed` e `CrostiniAllowed`.

**Esperado:** ambas ausentes (dispositivo não gerenciado) ou **Enabled**.
**Se falhar:** é o bloqueador **B1**. Pare a instalação. A decisão é: conseguir o admin do domínio, ou
ativar a contingência da [Spec 08 §7](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) — que é uma
reescrita (`xterm.js` + `node-pty` de volta, uma VM por estação), não uma configuração.

- [ ] **C2 — Qual é a arquitetura?**

No terminal do container:

```bash
uname -m
```

**Esperado:** `x86_64` ou `aarch64`. Ambos servem.
**O que decide:** se for `aarch64`, os testes **C15** e **C16** passam a ser obrigatórios (risco A9),
e o backup `.tini` só clona para outras máquinas ARM (**B4**). Se houver mais de uma estação e as
arquiteturas divergirem, o plano de clonagem não existe — o preparo vira linear.

- [ ] **C3 — Quanta RAM sobra com a pilha inteira de pé?**

Com daemon, `agy`, os 3 MCPs e o Chrome com o jogo rodando **ao mesmo tempo**:

```bash
free -h
```

**Esperado:** `available` confortavelmente acima de ≈500 MB.
**Se falhar:** é o risco **A1**, e o sintoma no dia é o pior possível — nave de preset para todo
visitante, sem mensagem de erro. Decide **recusar a máquina** e exigir 8 GB, conforme a
[Spec 08 §3](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md).

### Bloco C4–C6 — O `agy` (15 min)

- [ ] **C4 — O `agy` pede confirmação de workspace em `/tmp/booth_session`?**

**Depois** de executar o §6.6 (pré-popular `trustedWorkspaces`) e com o `agy` já autenticado:

```bash
mkdir -p /tmp/booth_session && cd /tmp/booth_session && agy
```

**Esperado:** o `agy` entra direto na sessão. **Não** aparece a tela `Do you trust the contents of
this project?` nem `Yes, I trust this folder`.
**Se falhar:** o Bloco 20.2 (`specs/12_MANUAL_TEST_PLAN_MAC.md:1475`) não fecha e o Gate M6 não fecha.
Decide investigar se o formato da entrada está errado (barra final? caminho relativo?) ou se
`--dangerously-skip-permissions` também cobre o trust de workspace — o que é **NÃO CONFIRMADO** (§2.2)
e vale testar aqui, porque seria um segundo caminho de mitigação.

- [ ] **C5 — O login do `agy` sobrevive a um reinício do container?**

```bash
# com o agy já logado:
exit                     # fechar o app Terminal por completo
# reabrir o Terminal e:
agy --version && agy
```

**Esperado:** ainda logado, sem pedir OAuth de novo.
**Por que este teste existe:** fora de sessão SSH o `agy` tenta o **Secret Service do freedesktop**
(libsecret/gnome-keyring via D-Bus), e o container `penguin` padrão **não roda** gnome-keyring nem um
D-Bus de sessão com Secret Service. Há um `fallbackServiceProvider` no binário, então provavelmente
degrada para armazenamento em arquivo — **NÃO CONFIRMADO** (§2.7, risco A10).
**Se falhar:** o estande precisa de um login manual a cada abertura do Terminal. Decide acrescentar
esse passo ao runbook do dia, ou forçar o modo arquivo.

- [ ] **C6 — Smoke test de login, no início de cada dia de evento**

```bash
agy --version
grep -i 'not logged into\|treating as unauthenticated' ~/.gemini/antigravity-cli/log/cli-*.log | tail -5
```

**Esperado:** nenhuma linha recente de "not logged into Antigravity".
**Por que este teste existe:** uma atualização de versão já refez `~/.gemini/antigravity-cli/` e
derrubou o auth sem avisar (§2.7). Vale para **qualquer** hardware, não só Chromebook.
**Se falhar:** refazer o login antes de abrir as portas. Se não refizer, todo visitante recebe nave de
preset e o sintoma é indistinguível de OOM.

### Bloco C7–C10 — Rede e a fronteira da VM (15 min)

- [ ] **C7 — O port forwarding da 3000 entrega o daemon ao Chrome do ChromeOS**

Com o daemon de pé e a 3000 encaminhada, no Chrome do ChromeOS: abrir `http://localhost:3000`.

**Esperado:** a Tela 1 carrega. É o equivalente do Bloco 19.6
(`specs/12_MANUAL_TEST_PLAN_MAC.md:1451`).
**Se falhar:** é o risco **A2**. Nenhuma mudança de código deve ser necessária —
`packages/daemon/src/index.ts:624` já liga em `0.0.0.0` — então o problema é a configuração de
forwarding. Decide se a alternativa é `penguin.linux.test`, que custa o C9.

- [ ] **C8 — O port forwarding sobrevive a um reboot?**

Configurar, **reiniciar o Chromebook**, reabrir `http://localhost:3000` sem mexer em nada.

**Esperado:** carrega.
**O que decide:** há relatos de que o forwarding precisa ser rearmado; **NÃO CONFIRMADO** em builds de
2026. Se falhar, "rearmar o port forwarding" vira um item obrigatório do checklist de abertura do dia,
e alguém precisa saber fazê-lo sem consultar este documento.

- [ ] **C9 — O WebSocket `/events` atravessa o túnel**

Abrir a Tela 1 e chegar até a tela de forja —
`packages/player-app/src/components/HandoffTerminalScreen.tsx:114` abre o WS.

**Esperado:** os badges de MCP acendem **ao vivo**, durante a forja, não só no fim.
**Se falhar:** a Tela 1 fica muda durante o momento mais visível da experiência. Decide se o
forwarding do Crostini serve para WebSocket ou se a Tela 1 precisa de polling — o que seria mudança de
código, e portanto motivo para reconsiderar o hardware.

- [ ] **C10 — O botão "Copiar" funciona em `localhost`**

Na tela de forja, clicar em **Copiar** (Bloco 20.4, `specs/12_MANUAL_TEST_PLAN_MAC.md:1492`).

**Esperado:** o ícone vira ✓ e o rótulo vira "Copiado" por ≈2s.
**Se falhar em `localhost`:** é sintoma de outra coisa, porque `localhost` **é** secure context.
**Se você estiver em `penguin.linux.test`, este teste falha por projeto** — o host comum sobre HTTP
não é secure context. Decide voltar para o port forwarding. O plano C já existe: o Bloco 20.5 prevê
digitar a frase à mão, e ela foi escolhida curta exatamente por isso.

### Bloco C11–C13 — Apresentação (30 min)

- [ ] **C11 — Que frame rate o jogo entrega neste hardware?**

```bash
npm run dev:player     # em vez de npm run dev:game — evita o xdg-open, ver §2.5
```

No Chrome do ChromeOS, com a 5173 encaminhada: `http://localhost:5173/dev.html`. Marcar **God mode** e
**Disparo automático**, clicar em **"Boss (40s)"**, deixar correr sem tocar no teclado, baixar o
resumo e ler `boss_fight_min_fps`.

**Esperado:** comparar com os **29,2 / 29,2 / 29,8** medidos no Mac no Bloco 3.7. Números
significativamente piores mudam a percepção de dificuldade.
**Se falhar:** é o risco **A3**. Decide **refazer os Blocos 3 e 4** do plano de teste no hardware real
— o fixture `packages/sim/fixtures/harness-runs.json` é uma medição, e o próprio Bloco 3 avisa que
medições envelhecem. Um fallback para canvas 2D (`Phaser.AUTO` em
`packages/player-app/src/game/index.ts:78`) salvaria a tela e destruiria o frame rate: é cenário a
detectar, não a aceitar.

- [ ] **C12 — O segundo monitor entra na resolução esperada**

Plugar a saída externa. Configurações → Dispositivo → Telas.

**Esperado:** 1080p na tela do jogador.
**O que decide:** amarra na issue #4 do repositório. Também é aqui que se decide qual tela é a 1 e
qual é a 2 (§6.9, item 5) — e se a inversão em relação à Spec 01 §3.1 é aceitável na bancada real.

- [ ] **C13 — A janela PWA em tela cheia entrega o teclado ao Phaser**

Com a Tela 1 instalada como app e em tela cheia: clicar **dentro do canvas** e testar WASD + ESPAÇO.

**Esperado:** a nave se move e atira.
**Por que este teste existe:** o Bloco 9 do plano de teste já registra que clicar dentro do canvas é a
causa nº 1 de "a nave não se move" — e a janela PWA é um contexto de foco que nunca foi exercitado.
**Se falhar:** a experiência não existe. Decide voltar para uma aba normal do Chrome, perdendo o pouco
de kiosk que o item 2 do §6.9 comprava.

### Bloco C14–C17 — Operação e recuperação (20 min)

- [ ] **C14 — Quanto tempo leva o backup `.tini`, e que tamanho tem?**

Com o ambiente inteiro pronto: Configurações → Desenvolvedores → Linux → Fazer backup. Cronometrar e
anotar o tamanho.

**Esperado:** um arquivo `.tini` (tar.gz) recuperável, guardado num pendrive.
**O que decide:** se existe plano de recuperação no dia (**B5**). Se o backup demorar demais ou não
couber, o plano de recuperação passa a ser reinstalar do zero pelo §6 — o que é 60–90 min, e portanto
inviável com fila no estande.
**Atenção de segurança:** o `.tini` **não é criptografado** e leva junto o token de auth do `agy`.
Tratar o pendrive como credencial.

- [ ] **C15 — O `agy` arm64 fala com o Vertex igual ao x86** *(só se C2 = `aarch64`)*

Uma forja completa de ponta a ponta, como visitante.

```bash
test -s /tmp/booth_session/mcp_audit.log && wc -l /tmp/booth_session/mcp_audit.log
```

**Esperado:** `mcp_audit.log` **não-vazio**, e `ship_spec.json` gravado.
**Se falhar:** é o risco **A9** se materializando. Decide se a máquina ARM serve. Não há workaround
local: o `agy` é o componente que não degrada graciosamente (Spec 08 §1.1).

- [ ] **C16 — Os caminhos de reset alternativos funcionam** *(risco A5)*

Testar os três, nesta ordem:

```bash
curl -s -X POST localhost:3000/api/session/reset
```

...o botão **RESET** da UI (`packages/player-app/src/App.tsx:187`), e `Ctrl+Shift+F12` **depois** de
ligar o toggle de F-keys (§6.9, item 3).

**Esperado:** os três resetam a sessão. Pelo menos dois precisam funcionar.
**O que decide:** qual deles vira o procedimento treinado da equipe. O atalho de teclado já é
inoperante com o foco na Tela 2 (defeito **D11**), e no ChromeOS não há como registrar um hotkey
global — então o `curl` é o único que funciona com o foco em qualquer lugar.

- [ ] **C17 — A máquina não desliga sozinha durante uma partida**

Com as configurações de energia ajustadas (§6.9, item 7): deixar a pilha de pé e a máquina ociosa por
mais tempo do que o intervalo entre visitantes.

**Esperado:** nenhuma suspensão, nenhum bloqueio de tela, daemon e `agy` ainda vivos.
**Se falhar:** é o risco **A7**, e ele derruba a pilha inteira porque o logout do ChromeOS encerra os
processos do container. Decide escrever o `reset_booth.sh` (**U4**, Spec 06 §3.5) como pré-requisito
do evento, e não como melhoria.

### Teste condicional

- [ ] **C18 — `penguin.linux.test` resolve com o Wi-Fi desligado?**

**Só execute se você tiver decidido não usar port forwarding.** Desligar o Wi-Fi pelas Configurações
rápidas, recarregar a Tela 1.

**Esperado:** resolve, porque a resolução é interna ao Chrome — **NÃO CONFIRMADO**.
**Se falhar:** o modo offline (Spec 08 §9) não funciona, o que anula o argumento de degradação
graciosa que justifica a Camada L ser local. Decide voltar ao port forwarding, onde a questão não
existe.

---

## 8. Portabilidade do `specs/12`

A varredura de 2026-09-01 encontrou **22 linhas macOS-only** individuais no
[`12_MANUAL_TEST_PLAN_MAC.md`](./12_MANUAL_TEST_PLAN_MAC.md), mais um grupo de 4 linhas que
compartilham o mesmo problema (`Ctrl+Shift+F12`). A tabela abaixo é **insumo de decisão, não um patch**
— o `specs/12` **não foi alterado** por este documento.

**Sobre os números de linha:** foram reconferidos em 2026-09-01 contra `main` em `b4201db`. O arquivo
tem 1810 linhas e mudou duas vezes hoje, então alguns números divergem da varredura original (por
exemplo, os dois `Ctrl+Shift+F12` finais estavam em `:1583` e `:1724` e hoje estão em `:1626` e
`:1767`). Os valores desta tabela são os atuais. Se o arquivo mudar de novo, reconfira por conteúdo,
não por número.

| `specs/12` | Texto atual | Por que falha no Crostini | Equivalente Linux/ChromeOS |
|---|---|---|---|
| `:64` | `sw_vers` | binário só-macOS | `cat /etc/os-release` (Debian do container) **e** `chrome://version` (ChromeOS + Chrome). São dois números distintos, e o formulário do §8 precisa dos dois |
| `:112` | `mkdir -p ~/Desktop/gate-m1-m2` | não existe `~/Desktop` no container | `mkdir -p ~/gate-m1-m2` — aparece no app Arquivos como "Linux files", então os artefatos continuam recuperáveis pelo ChromeOS |
| `:133` | `tee ~/Desktop/gate-m1-m2/npm-test.txt` | idem | `tee ~/gate-m1-m2/npm-test.txt` |
| `:162` | `tee ~/Desktop/gate-m1-m2/sim-balance.txt` | idem | `tee ~/gate-m1-m2/sim-balance.txt` |
| `:191` | "desligue o Wi-Fi **pelo menu do macOS**" | menu inexistente | Configurações rápidas do ChromeOS → Wi-Fi off, ou modo avião. Efeito colateral desejável: corta a rede da VM junto |
| `:353` | mover o download para `~/Desktop/gate-m1-m2/` | idem, **e** o download cai no Downloads do **ChromeOS**, fora da VM | compartilhar Downloads com o Linux (§6.9, item 6); origem vira `/mnt/chromeos/MyFiles/Downloads`, destino `~/gate-m1-m2/` |
| `:485` | `Confronte com ~/Desktop/gate-m1-m2/sim-balance.txt` | idem | `~/gate-m1-m2/sim-balance.txt` |
| `:571` | `~/Desktop/gate-m1-m2/` | idem | `~/gate-m1-m2/` |
| `:636` | `Ctrl+Shift+F12` (Bloco 5.17) | ver grupo no fim da tabela | ver grupo |
| `:727` | `Ctrl+Shift+F12` (Bloco 7.1) | ver grupo | ver grupo |
| `:761` | `macOS:                    ____________` (formulário do §8) | rótulo errado | dois campos: `ChromeOS:` e `Container (/etc/os-release):` — ver `:64` |
| `:796` | `## Bloco 9 — Problemas comuns no macOS` | título | `## Bloco 9 — Problemas comuns`, com subseções por SO |
| `:798` | "O macOS Monterey+ usa a 5000 para o AirPlay Receiver" | não se aplica | irrelevante no Linux; a 5000 está livre |
| `:805` | "`setsid: command not found`. Não existe no macOS." | **invertido** no Linux | `setsid` **existe** (util-linux). O `booth-terminal.sh` não o usa, então o parágrafo fica obsoleto, não corrigido |
| `:809` | "**Bash 3.2.** É o `/bin/bash` padrão do macOS." | obsoleto | Debian 12 traz bash 5.2, e o script — escrito para o subconjunto de 3.2 — roda sem ajuste |
| `:818` | `"Baixar resumo" salva em ~/Downloads` | é o `~/Downloads` do **ChromeOS**, invisível ao container | `/mnt/chromeos/MyFiles/Downloads` depois de "Compartilhar com o Linux" |
| `:820` | "desligue o Wi-Fi **pelo menu do macOS**" | menu inexistente | Configurações rápidas do ChromeOS |
| `:869` | "Vem instalado por padrão no macOS" (sobre `openssl`) | frase errada | Debian traz `openssl`; se faltar, `sudo apt install openssl` |
| `:874` | `mkdir -p ~/Desktop/gate-m3` | não existe `~/Desktop` | `mkdir -p ~/gate-m3` |
| `:891` | `Copie os dois para ~/Desktop/gate-m3/segredos.txt` | idem | `~/gate-m3/segredos.txt` |
| `:902` | `em ~/Desktop/gate-m3/segredos.txt também` | idem | `~/gate-m3/segredos.txt` |
| `:1042` | "Desligue o Wi-Fi **pelo menu do macOS** no meio de uma partida" | menu inexistente | Configurações rápidas do ChromeOS |
| `:1260` | `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version` | caminho só-macOS | `chrome://version` — o Chrome do ChromeOS **não** é um executável alcançável do container |
| `:1498` | "cole com `Cmd+V` (macOS) / `Ctrl+Shift+V` (terminal Linux)" | **já cobre Linux** | nenhuma mudança — é o único ponto do arquivo que já está portado |
| `:636`, `:727`, `:1626`, `:1767` | `Ctrl+Shift+F12` | a top row do Chromebook não tem F12 físico na maioria dos modelos | ligar "tratar teclas da linha superior como teclas de função"; ou o botão **RESET** da UI; ou `curl -s -X POST localhost:3000/api/session/reset`. Ver risco A5 e teste C16 |

### 8.1. O que **não** precisa mudar

Três coisas que a pesquisa levantou como suspeitas e que a bancada limpou:

- **`lsof` com múltiplas portas** (`:84`) — **já corrigido** em `7263ba1`, junto com
  `scripts/kill-all.sh:15`. Ver §2.3 e §3.1.
- **`vite --open`** (Bloco 2.2, `:193`) — não precisa de mudança de arquivo. Basta usar
  `npm run dev:player` em vez de `npm run dev:game` e navegar à mão, ou encaminhar a 5173 e deixar o
  `--open` funcionar. Ver §2.5.
- **`ps -o pid,pgid,command -ax`** (`scripts/kill-all.sh:28`, Bloco 7.2) e **`xargs -r`** — testados no
  Linux e funcionam, com saída equivalente. `xargs -r` é GNU e é nativo aqui.

O saldo: a seção "Problemas comuns no macOS" (Bloco 9) fica aprox. metade obsoleta e aprox. metade
substituída por problemas novos e diferentes. Se alguém for portar o `specs/12`, esse bloco é o que dá
mais trabalho e o que menos se aproveita.

---

## 9. Referência cruzada

| Assunto | Onde está decidido |
|---|---|
| Requisito mínimo da máquina do estande | [Spec 08 §3](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) |
| O que fazer se o Crostini **não** puder ser habilitado (B1) | [Spec 08 §7](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) |
| Por que a Camada L é local e o `agy` não vai para a nuvem | [Spec 08 §1.1](./08_DEPLOYMENT_TOPOLOGY_AND_CLOUD_SPLIT.md) |
| Frame rate e o efeito da cadência de tiro | [Spec 09 §5.9](./09_GAME_BALANCE_AND_DEV_MODE.md) |
| Scripts de operação ausentes (`reset_booth.sh`, `setup_monitors.sh`) — **U4** | [Spec 06 §3.1 e §3.5](./06_RELIABILITY_FAILOVER_AND_SECURITY_SPEC.md) |
| Hotkey de reset que não sobe ao nível do SO — **D11** | [Spec 01 §4.2](./01_BOOTH_AND_EXPERIENCE_SPEC.md) |
| Falhas de teste esperadas e itens adiados | [Spec 11](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md) |
| Blocos de teste citados aqui (19.5, 19.6, 20.2, 20.4, 20.5, 21.6, 24.1) | [Spec 12](./12_MANUAL_TEST_PLAN_MAC.md) |
