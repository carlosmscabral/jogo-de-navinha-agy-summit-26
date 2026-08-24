# Spec 08: Topologia de Implantação — Divisão Local vs. Google Cloud

> **Status:** DECISÕES DE PROVISIONAMENTO FECHADAS — 2026-08-22 (revisão de entrada da Fase C).
> Projeto, banco e regiões concretos estão na §6.3.
> **Objetivo:** Decidir o que roda na máquina do estande e o que roda em GCP, sob a restrição de que o
> hardware do evento **não está confirmado** e pode ser um Chromebook simples. Define o modelo de
> credenciais, o consumo de Gemini via Vertex AI, o comportamento sob queda de rede e a contingência
> caso o AGY não possa rodar localmente.
> **Endereça:** D7, U1, U2, e a reversibilidade de P1 (ver [Spec 00](./00_AUDIT_AND_DRIFT_REPORT.md)).

---

## 1. A Restrição Que Governa Tudo

A diretriz é **favorecer a nuvem**. Mas existe um limite físico: o Antigravity CLI é um binário de
linha de comando autenticado, que gera processos-filho stdio (os 3 servidores MCP) e escreve em um
sistema de arquivos compartilhado com eles. Nada disso existe dentro de um navegador.

Portanto a pergunta que define a topologia inteira não é "o que vai para a nuvem?", e sim:

> **Onde o `agy` executa?**

Todo o resto decorre dessa resposta, porque o daemon existe unicamente para gerar o workspace,
observar arquivos e matar o grupo de processos do AGY. **O daemon segue o AGY**; não é uma escolha
independente.

### 1.1. O argumento decisivo: degradação graciosa

Sob a política cloud-first, é tentador mover o AGY também. O contra-argumento é assimétrico:

| Componente na nuvem | Wi-Fi cai durante o evento |
| :--- | :--- |
| Leaderboard, Firestore, Gemini | Estande **continua jogável**; scores acumulam no buffer local e sincronizam depois. |
| **AGY / a Forja** | Estande **morre**. Ninguém constrói nave. Não há degradação possível — a forja É a experiência. |

Wi-Fi de centro de convenções é notoriamente instável. Manter o AGY local não contradiz a política
cloud-first: é o que permite que a política seja segura em todo o resto.

**Decisão: AGY permanece local (Topologia C, §4).** A contingência para hardware incapaz está em §7.

---

## 2. Classificação por Camada

### 2.1. Camada L — Obrigatoriamente local

| Componente | Por quê |
| :--- | :--- |
| Binário `agy` + autenticação | CLI de desktop; precisa de shell real e credencial de usuário. |
| 3 servidores MCP stdio | São processos-filho do AGY e compartilham seu sistema de arquivos. |
| `/tmp/booth_session` + file watcher | O AGY grava nele; observação remota exigiria sincronizar um sistema de arquivos. |
| Session bridge (o daemon atual) | Gera o workspace, observa, e mata o process group. Precisa estar no mesmo host. |
| Navegador Chromium em kiosk + teclado físico | Superfície de interação do visitante. |
| Buffer SQLite | Garantia de que nenhum score se perde offline. |
| **Servir o `player-app`** | Ver §5 — decisão derivada da restrição de rede local do Chrome. |

### 2.2. Camada C — Deve ir para GCP

| Componente | Serviço | Por quê |
| :--- | :--- | :--- |
| Persistência de partidas | Cloud Firestore (Native) | Fonte única entre estações e após o evento. |
| API de gravação | Cloud Run + Firebase Admin SDK | Mantém a credencial privilegiada fora do estande. |
| Moderação semântica de callsign | Cloud Run → Vertex AI | Sem chave de modelo na máquina do estande. |
| Canonicalização de empresa | Cloud Run → Vertex AI | Idem; assíncrona (§6.2). |
| `leaderboard-app` | Firebase Hosting (§5) | Pode ser aberto de qualquer tela, inclusive um Chromebook puro. |
| Painel de administração | Cloud Run, dentro do container da API | Precisa da mesma senha HTTP Basic de `/v1/admin/*` — por isso não vai para o Hosting. |

### 2.3. Diagrama da topologia recomendada

```mermaid
graph TD
    subgraph Booth [Camada L - Maquina do Estande]
        subgraph Display1 [Tela 1: Cockpit]
            KIOSK[Chromium Kiosk: player-app servido pelo bridge]
        end
        subgraph Display2 [Tela 2: Forja]
            TERM[Terminal nativo: booth-terminal.sh + agy]
        end
        BRIDGE[Session Bridge :3000]
        MCPS[3 MCP Servers stdio]
        WS[/tmp/booth_session/]
        SQLITE[(SQLite: buffer + catalogo)]
    end

    subgraph TV [Tela 3: TV Publica]
        LEAD[leaderboard-app no Firebase Hosting]
    end

    subgraph GCP [Camada C - Google Cloud]
        RUN[Cloud Run: API de ingestao]
        FS[(Cloud Firestore)]
        VERTEX[Vertex AI: gemini-3.7-flash]
    end

    KIOSK -->|HTTP e WS locais| BRIDGE
    BRIDGE -->|gera workspace| WS
    TERM -->|le workspace, executa tools| MCPS
    MCPS -->|mcp_audit.log| WS
    WS -->|ship_spec.json| BRIDGE
    BRIDGE -->|buffer imediato| SQLITE
    BRIDGE -->|POST autenticado com retry| RUN
    RUN -->|Admin SDK| FS
    RUN -->|moderacao e canonicalizacao| VERTEX
    FS -->|onSnapshot somente leitura| LEAD
```

---

## 3. Requisito Mínimo da Máquina do Estande

Se a Camada L é local, o hardware precisa suportá-la. Este é o pedido a fazer aos organizadores:

- Arquitetura x86_64 ou Apple Silicon, **não ChromeOS puro**.
- 8 GB de RAM ou mais; GPU capaz de WebGL a 60 FPS em 1080p.
- Node.js 20.x ou 22.x LTS e shell real (bash/zsh).
- Permissão para instalar e **autenticar** o `agy`.
- Duas saídas de vídeo (Tela 1 do jogador + Tela 2 da forja). A TV pública **não** precisa sair desta
  máquina — sendo o leaderboard hospedado em GCP, qualquer dispositivo com navegador serve, inclusive
  um Chromebook.

> Um Chromebook sem ambiente Linux (Crostini) habilitado **não atende** a Camada L. Um Chromebook com
> Crostini é tecnicamente possível, mas não recomendado: o container adiciona uma camada de falha e
> desempenho de WebGL sob Crostini é irregular. Se essa for a única opção disponível, aplicar §7.

---

## 4. Alternativas Consideradas

| | **A — Tudo local** | **C — AGY local, resto na nuvem** ✅ | **B — AGY na nuvem** |
| :--- | :--- | :--- | :--- |
| Estado hoje | É o que existe | Alvo | Contingência |
| Hardware exigido | Máquina capaz | Máquina capaz | Só navegador |
| Sobrevive à queda de Wi-Fi | Sim, totalmente | Sim, joga e sincroniza depois | **Não** |
| Dados após o evento | Presos em um SQLite | Firestore | Firestore |
| Credencial sensível no estande | — | Nenhuma | Nenhuma |
| Múltiplas estações | Placar não consolida | Consolida | Consolida |
| Custo de infraestrutura | Zero | Desprezível (§8) | 1 VM por estação |
| Exige reverter P1 | Não | Não | **Sim** |

A Topologia A é o estado atual e falha no requisito de consolidação e de sobrevivência dos dados. A B
é analisada em §7. A **C** é a recomendada.

---

## 5. A Restrição de Rede Local do Chrome (resolvida)

Uma página servida por HTTPS a partir da nuvem que fala com um endereço local esbarra em duas
políticas distintas do Chrome, e a diferença entre elas é o que decide cada caso abaixo:

1. **Mixed content:** uma página HTTPS **não pode** chamar `http://` nem abrir `ws://`. A exceção é
   `localhost`/`127.0.0.1`, tratados como *potentially trustworthy origins*. Um IP de LAN
   (`192.168.x.x`) **não** é exceção: o bloqueio acontece antes de qualquer preflight, e nenhum
   cabeçalho de resposta o desfaz.
2. **Private Network Access / Local Network Access:** requisições de um contexto público para um
   endereço local exigem preflight CORS com `Access-Control-Request-Private-Network` e, em versões
   recentes do Chrome, podem disparar **prompt de permissão ao usuário** — inaceitável em modo kiosk,
   onde não há ninguém para clicar. Só entra em cena quando a política 1 já foi vencida.

**Decisão para o `player-app`:** não apostar nisso. Ele é **servido pelo próprio session bridge** em
`http://localhost:3000`, tornando a origem local e a questão inexistente. É uma mudança pequena
(servir estáticos com `express.static` a partir do build do Vite) que elimina uma classe inteira de
falha em kiosk e ainda remove a necessidade de rodar o dev server do Vite no dia do evento.

**Decisão para o `leaderboard-app` (2026-08-24, durante o Gate M3):** hospedado no **Firebase
Hosting**, e **sem fallback para o bridge local**.

- *Por que Hosting, e não o container do Cloud Run:* a máquina do estande pode não conseguir tocar
  duas telas, então o telão precisa poder rodar em qualquer outra máquina — e ele não fala com a
  API de ingestão, lê o Firestore direto. O `admin-app` está dentro do container por um motivo que
  não se aplica aqui: ele precisa da mesma senha HTTP Basic que protege `/v1/admin/*`.
- *Num site dedicado, não no site padrão do projeto:* `vibe-cabral.web.app` já hospeda outra
  aplicação, e publicar ali a sobrescreveria. O site do telão é nomeado em `firebase.json`
  (`hosting.site` → `jogo-navinha-telao`), criado pelo `deploy.sh` se não existir, e é o único que
  o `undeploy.sh` despublica (`hosting:disable --site`). Ter mais de um site por projeto exige o
  plano Blaze, que este projeto já usa por causa do Cloud Run.
- *Por que sem fallback:* servido por HTTPS de `*.web.app`, a chamada ao bridge é conteúdo misto
  pela política 1 acima — o telão nem chega perto do PNA. Era um caminho que só podia falhar, em
  silêncio, no console de uma TV. No lugar dele, o telão mostra `SEM SINAL` (via
  `snapshot.metadata.fromCache`) mantendo os últimos números na tela. Ver Spec 05 §7.

O bridge continua sendo a fonte do telão numa topologia puramente local (desenvolvimento, ou um
ensaio sem nuvem): as duas fontes são exclusivas e a escolha é feita uma vez, na montagem, pela
presença das `VITE_FIREBASE_*` no bundle.

**Verificação no Gate M3:** Bloco 15 do [plano de teste](./12_MANUAL_TEST_PLAN_MAC.md) — abrir o
telão hospedado, cortar a rede, e confirmar que o selo vira `SEM SINAL` sem esvaziar a tela.

---

## 6. Modelo de Credenciais e Consumo de Gemini

### 6.1. Regra de credenciais

- **Nenhuma chave de API de modelo, em nenhuma hipótese, na máquina do estande.**
- Gemini é consumido **exclusivamente via Vertex AI / Gemini Enterprise Agent Platform**, autenticado
  por ADC. Nunca a variante `ai.google.dev` com `GEMINI_API_KEY`.
- O Cloud Run roda com service account própria, com `roles/aiplatform.user` e acesso de escrita ao
  Firestore. A credencial do Admin SDK nunca sai da nuvem.
- O bridge do estande recebe apenas um **token de ingestão de escopo único**, válido só para o
  endpoint de gravação de partidas. Se a máquina for comprometida ou perdida, o token é revogado sem
  impacto em nada mais.
- Regras do Firestore: escrita negada a todos os clientes; leitura pública apenas em `matches`,
  `pilots` e `company_rankings`. Isso satisfaz o critério da Spec 05 §5.

### 6.2. Mapa de uso do `gemini-3.7-flash`

| Uso | Onde | Bloqueante? | Observação |
| :--- | :--- | :--- | :--- |
| Moderação semântica de callsign (camada 2) | Cloud Run | Sim, com timeout | A camada 1 (regex local) já rodou; se o Vertex não responder, a camada 1 prevalece e o fluxo segue. |
| Canonicalização de empresa | Cloud Run | **Não** | Ver abaixo. |
| Modelo da Forja | O próprio AGY | — | O `gemini-3.7-flash` é o modelo padrão do agente Antigravity; fixar explicitamente na configuração do harness se a CLI permitir. |
| Scoring de qualidade de prompt (L1, opcional) | Cloud Run | Não | Reabilita o requisito perdido; ver Spec 10, Fase E. |

**Sobre o timeout de 600ms da Spec 05 §2.1:** modelos Gemini 3.x têm *thinking* habilitado por padrão,
e 600ms é orçamento agressivo para um round-trip até o Vertex. Em vez de esticar o timeout — o que
atrasaria o SLA de 2m30s — a canonicalização passa a ser **assíncrona**: a partida é gravada
imediatamente com o nome limpo localmente, e um job de backfill reconcilia `company_canonical` depois.
O placar corporativo tolera segundos de atraso; o visitante não tolera esperar.

Os parâmetros exatos da API (valores de `thinking_level`, regiões suportadas) devem ser confirmados na
documentação vigente do Vertex no momento da implementação — a família 3.x removeu
`temperature`/`top_p`/`top_k` e substituiu `thinking_budget` por `thinking_level`.

### 6.3. Recursos concretos — decidido em 2026-08-22

| Recurso | Valor | Por quê |
| :--- | :--- | :--- |
| Projeto GCP | `vibe-cabral` | Já existe, já tem as 6 APIs necessárias habilitadas e ADC configurada. Não há razão para criar outro. |
| Banco Firestore | **nomeado `jogo-navinha`** — não o `(default)` | Ver abaixo. |
| Região do Firestore | `southamerica-east1` | Perto do evento; a latência que importa é a da escrita de ingestão e a do `onSnapshot` do telão. |
| Região do Cloud Run | `southamerica-east1` | Mesma região do Firestore: a escrita de ingestão é o caminho quente. |
| Região do Vertex AI | **`global`** — decidido em 2026-08-22 | Independente das duas acima. |

**Por que um banco nomeado e não o `(default)`.** A Spec 05 §6 termina as regras com
`match /{document=**} { allow read, write: if false; }`. Um ruleset do Firestore é publicado **por
banco**, e `vibe-cabral` já hospeda outras coisas no `(default)` — publicar esse catch-all lá
derrubaria o acesso delas. Um banco nomeado tem ruleset próprio e isola o blast radius por completo.
O custo é operacional e pequeno: o `firebase.json` precisa da forma em array
(`"firestore": [{ "database": "jogo-navinha", "rules": ..., "indexes": ... }]`), e todo cliente Admin
SDK precisa nomear o banco explicitamente ao instanciar — esquecer disso escreve no `(default)` em
silêncio, que é o modo de falha a testar na Tarefa C2.

**Por que a região do Vertex é independente.** Disponibilidade de modelo não segue disponibilidade de
Firestore: `gemini-3.7-flash` não é servido em `southamerica-east1`, e usar a região **`global`**
evita ter que reconfirmar cobertura regional a cada troca de modelo. Isso é aceitável porque nenhuma
das duas chamadas de modelo está no caminho crítico de latência do visitante — a moderação L2 tem
timeout e recai na camada 1 (§6.2), e a canonicalização é assíncrona por desenho. A região do Vertex é
uma variável de ambiente do Cloud Run (`VERTEX_LOCATION`, default `global`), então trocar de região no
futuro não exige um novo deploy de código.

---

## 7. Contingência: se o hardware for um Chromebook simples

Ativar apenas se §3 não for atendível. Move a Camada L para uma VM por estação:

- **`agy`, MCPs, workspace e bridge** migram para uma GCE VM pequena (ou Cloud Workstation) dedicada a
  cada estação de jogo.
- O terminal volta a ser **embutido no navegador** via `xterm.js` sobre WSS — ou seja, **P1 é
  revertido** e as Specs 01 §2.4 e 03 §1 originais voltam a valer, agora por um motivo diferente
  daquele pelo qual foram escritas.
- O WebSocket precisa de afinidade de sessão; Cloud Run com `--session-affinity` ou, preferencialmente,
  uma VM com IP estável por estação.

**Custo real desta contingência, a aceitar conscientemente:**

- A experiência inteira passa a depender da rede. Não há mais degradação graciosa (§1.1).
- Reintroduz `xterm.js` + `node-pty`, removidos em `4e1c75e` e `94d02a2`, junto com os problemas de
  foco de teclado que motivaram a remoção.
- Latência de digitação no terminal fica sujeita à rede do centro de convenções.
- Uma VM por estação de jogo, provisionada e autenticada antes do evento.

Por isso a recomendação é **negociar o hardware antes de aceitar esta contingência**. O pedido de §3 é
modesto e resolve o problema por completo.

---

## 8. Custo Estimado

Para um evento de 1 a 2 dias com ordem de 500 visitantes:

- **Firestore:** ordem de milhares de escritas e leituras. Dentro ou muito próximo do nível gratuito.
- **Cloud Run:** escala a zero fora do evento; alguns milhares de requisições. Centavos.
- **Vertex AI (`gemini-3.7-flash`):** entrada a US$ 1,50/1M tokens e saída a US$ 7,50/1M. Com ≈2
  chamadas curtas por visitante, o total do evento fica na casa de **menos de um dólar**.
- **Contingência §7:** 1 VM por estação, custo dominante desse cenário.

Custo não é fator de decisão aqui; disponibilidade e risco operacional são.

---

## 9. Comportamento Sob Falha de Rede

| Cenário | Resultado |
| :--- | :--- |
| Wi-Fi cai antes da partida | Registro, forja e jogo funcionam normalmente. Moderação recai na camada regex local; empresa usa o catálogo SQLite. |
| Wi-Fi cai durante a partida | Sem impacto. Score grava no SQLite com `synced_to_cloud = 0`. |
| Wi-Fi cai com fila de pendentes | Worker de sincronização (U3) reenvia com backoff exponencial. `match_id` é o ID do documento, e o pre-read transacional da Spec 05 §4.3 é o que impede o agregado de contar em dobro no reenvio. |
| Token de ingestão expirado ou rotacionado | **Não é falha de rede** e não se resolve com retry: o worker marca `auth_failed` e `GET /api/sync/status` expõe isso distinguível de "sem sinal" (Spec 05 §5). Ação do staff é trocar o token, não esperar. |
| Firestore inacessível para a TV | Leaderboard exibe o último snapshot e sinaliza estado degradado. |
| Cloud Run fora do ar | Idêntico à queda de Wi-Fi: buffer local absorve. |
| **AGY falha ou trava** | Timeout de 15s (D2) injeta preset de emergência. Não é uma falha de rede — é a razão pela qual o AGY fica local. |

---

## 10. Critérios de Aceitação

- [ ] Nenhuma credencial de service account ou chave de modelo reside na máquina do estande; apenas um
      token de ingestão de escopo único.
- [ ] Todo consumo de Gemini ocorre via Vertex AI com `gemini-3.7-flash`; nenhuma referência a
      `generativelanguage.googleapis.com` ou `GEMINI_API_KEY` existe no repositório.
- [ ] Nenhum cliente escreve diretamente no Firestore; toda escrita passa pelo Cloud Run (Spec 05 §5).
- [ ] Com o cabo de rede desconectado, um ciclo completo de visitante roda de ponta a ponta e o score
      aparece no Firestore em até 60s após a reconexão, sem duplicação.
- [ ] O `player-app` é servido pelo bridge local e não depende de nenhum dev server no dia do evento.
- [ ] O telão é servido pelo Firebase Hosting e, com a rede cortada, mantém os últimos números na
      tela exibindo `SEM SINAL` — nunca `NUVEM` sobre dados congelados (Bloco 15 do plano de teste).
- [ ] O endereço de cada serviço vem de configuração, não de literal no código (fecha D7).
- [ ] Toda escrita do Admin SDK nomeia o banco `jogo-navinha` explicitamente; o `(default)` de
      `vibe-cabral` permanece intocado, verificável por ele continuar vazio de coleções nossas.
- [ ] As regras publicadas valem para o banco `jogo-navinha` e para nenhum outro.
