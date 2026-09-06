# 15 — Runbook do evento: dois estandes

> **Para quem é:** quem vai montar, abrir, operar e fechar os **dois** estandes do AGY Summit 2026.
> Documento de execução, não de explicação. Cada passo tem comando e critério objetivo. Para o
> porquê das coisas, [`14_INSTALLATION_GUIDE.md`](./14_INSTALLATION_GUIDE.md) e as specs `01`–`09`.
>
> **Premissas:** dois Mac M1, um por estande, cada um com seu próprio daemon, seu próprio
> `/tmp/booth_session` e seu próprio SQLite. Os dois compartilham **uma** API de ingestão, **um**
> Firestore e **um** placar.

---

## 0. Valores fixos

Confira, não assuma — o §2 tem os comandos que provam cada linha.

| Item | Valor |
| :--- | :--- |
| Projeto GCP | `vibe-cabral` (compartilhado com outras aplicações) |
| Região | `southamerica-east1` |
| Banco Firestore | `jogo-navinha` — **nomeado**, nunca o `(default)` |
| API de ingestão | `https://jogo-navinha-api-yozowz6hla-rj.a.run.app` |
| Painel de admin | `<API>/admin` |
| Telão | `https://jogo-navinha-telao.web.app` |
| Segredo do estande | `booth-ingest-token` (Secret Manager) |
| Segredo do painel | `admin-panel-password` (Secret Manager) |
| Estande A | `BOOTH_STATION_ID=booth-a` |
| Estande B | `BOOTH_STATION_ID=booth-b` |

Atalhos usados no documento inteiro:

```bash
export BASE=https://jogo-navinha-api-yozowz6hla-rj.a.run.app
export SENHA=$(gcloud secrets versions access latest --secret=admin-panel-password --project=vibe-cabral)
export TOKEN=$(gcloud secrets versions access latest --secret=booth-ingest-token --project=vibe-cabral)
```

No painel, qualquer usuário serve; só a senha é checada — `curl -u admin:"$SENHA"`.

---

## 1. Zero → Mac pronto

**Faça tudo nos dois Macs.** A única coisa que difere entre eles é uma linha do `.env` (§1.7).

### 1.1 Sistema

```bash
xcode-select --install                 # git + toolchain; pule se já responde `git --version`
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node@22 jq
brew install --cask iterm2 google-chrome
node -v && npm -v && jq --version      # esperado: v22.x, npm 10+ , jq 1.6+
```

Node pelo instalador oficial ou pelo Homebrew — **não use `nvm`**. `lsof` já vem no macOS.

### 1.2 `gcloud` (só no Mac que você usa para operar)

```bash
brew install --cask google-cloud-sdk
gcloud auth login
gcloud config set project vibe-cabral
gcloud auth application-default login    # necessário para os scripts do repo
```

**Nenhum arquivo de chave de service account pode existir em nenhum dos Macs.** A única credencial
de nuvem do estande é o `BOOTH_INGEST_TOKEN` no `.env`.

### 1.3 `agy`

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"     # deixe a linha no ~/.zshrc
agy --version                            # esperado: 1.1.23 ou superior — ANOTE
agy --help 2>&1 | grep -- '--prompt-interactive'   # tem que casar
```

Se a máquina já tem `agy`, pule a instalação e só confira a versão.

### 1.4 Autenticar o `agy` no sabor Vertex

Rode `agy` uma vez e faça o login pelo navegador. Depois:

```bash
jq '.gcp' ~/.gemini/antigravity-cli/settings.json
# esperado: { "project": "vibe-cabral", "location": "global" }
```

**Nunca com chave de API.** Sabor Vertex AI / Gemini Enterprise, `gemini-3.7-flash`, região `global`.

### 1.5 Pré-aprovar o diretório da sessão — **obrigatório**

```bash
S=~/.gemini/antigravity-cli/settings.json
jq '.trustedWorkspaces = ((.trustedWorkspaces // []) + ["/tmp/booth_session"] | unique)' "$S" > "$S.tmp" \
  && mv "$S.tmp" "$S"
jq -r '.trustedWorkspaces | index("/tmp/booth_session")' "$S"   # esperado: um número, não null
```

Sem isso, o primeiro visitante do dia encara *"Do you trust the contents of this project?"* e o
terminal fica parado esperando tecla.

### 1.6 Clonar e construir

```bash
git clone <URL do repositório> ~/jogo-de-navinha-agy-summit-26
cd ~/jogo-de-navinha-agy-summit-26
npm install          # node_modules ≈ 607 MB
npm run build        # OBRIGATÓRIO na primeira vez — sem isto os MCPs não existem em dist/
```

Se for fazer deploy deste Mac, crie também o `.firebaserc` (é gitignorado):

```bash
cp .firebaserc.example .firebaserc
```

### 1.7 `.env` do daemon — **a única linha que difere entre os Macs**

```bash
cp packages/daemon/.env.example packages/daemon/.env
```

Edite `packages/daemon/.env` e preencha exatamente três linhas:

| Linha | Mac do estande A | Mac do estande B |
| :--- | :--- | :--- |
| `BOOTH_STATION_ID=` | `booth-a` | `booth-b` |
| `BOOTH_CLOUD_API_BASE=` | a URL da API | a mesma URL |
| `BOOTH_INGEST_TOKEN=` | o valor de `booth-ingest-token` | o mesmo valor |

O resto do arquivo fica como veio. O `.env` é gitignorado — sobrevive a `git pull`.

### 1.8 macOS: impedir que a máquina durma ou interrompa

```bash
sudo pmset -a displaysleep 0 sleep 0 disksleep 0
```

E na interface:

- **Ajustes → Tela bloqueada:** desativar protetor de tela e "Exigir senha".
- **Ajustes → Foco:** ligar "Não perturbe" permanente (notificação por cima do jogo é ruído na foto).
- **Ajustes → Geral → Atualização de software:** desligar atualização automática (um reboot no meio
  do evento custa o estande inteiro).
- Volume no nível certo e testado antes de abrir.
- Mac na tomada. Não confie na bateria.

### 1.9 As três telas de cada estande

| Tela | O quê | Como abrir |
| :--- | :--- | :--- |
| 1 — cockpit | o jogo, `localhost:3000` | `open -na "Google Chrome" --args --kiosk --app=http://localhost:3000 --user-data-dir=/tmp/booth-chrome` |
| 2 — terminal | supervisor do `agy` | iTerm2 em tela cheia (`Cmd+Enter`), fonte grande, `npm run start:terminal` |
| 3 — TV | o telão | `open -na "Google Chrome" --args --kiosk --app=https://jogo-navinha-telao.web.app --user-data-dir=/tmp/telao-chrome` |

Uma TV por estande, mostrando o **mesmo** placar agregado dos dois.

---

## 2. Conferir o que está no ar

Rode antes de qualquer coisa. Se todos os critérios passarem, **não redeploye** — o deploy atual
serve.

```bash
# 1. o serviço existe e responde
gcloud run services list --region=southamerica-east1 --project=vibe-cabral
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/v1/health"          # 200

# 2. a URL do §0 é mesmo a atual
gcloud run services describe jogo-navinha-api --region=southamerica-east1 \
  --project=vibe-cabral --format='value(status.url, status.latestReadyRevisionName)'

# 3. o painel exige senha e a senha funciona
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/admin"              # 401
curl -s -u admin:"$SENHA" "$BASE/v1/admin/health" | jq '.stationActivity'

# 4. o token do estande funciona e o catálogo vem do Firestore
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/v1/companies" \
  | jq '{source, version, n: (.companies|length)}'                  # source: "firestore"

# 5. banco nomeado no ar
gcloud firestore databases list --project=vibe-cabral | grep jogo-navinha

# 6. gatilho do cartão SVG vivo
gcloud eventarc triggers list --location=southamerica-east1 --project=vibe-cabral

# 7. telão no ar
curl -s -o /dev/null -w '%{http_code}\n' https://jogo-navinha-telao.web.app   # 200
```

**Quando redeployar** (`npm run deploy:gcp`, idempotente):

- algum comando acima falhou;
- `source` do item 4 veio `disk` ou `stale-cache` em duas tentativas seguidas;
- há commit novo tocando `packages/cloud-api`, `packages/admin-app`, `packages/leaderboard-app` ou
  `packages/shared` depois da data da revisão do item 2:
  ```bash
  git log -1 --format=%cI -- packages/cloud-api packages/admin-app packages/leaderboard-app packages/shared
  ```

**Se você rotacionar algum segredo:** o Cloud Run resolve `:latest` só na criação da revisão. Rode
`npm run deploy:gcp` de novo **e** atualize o `.env` dos dois Macs.

---

## 3. Véspera — pré-cadastro em massa das empresas

O catálogo canônico vive em `companies/catalog` no Firestore. Os dois estandes o espelham
automaticamente em até 2 minutos, **remoções inclusive**.

### 3.1 A regra que evita o problema todo

Mantenha **três listas idênticas**: `config/companies.json` no repo, o catálogo no Firestore e o que
cada Mac espelhou. Se o disco divergir muito da nuvem, um `npm run reset:db` deixa o Mac com o
catálogo errado e o pull seguinte é **recusado** (§3.4).

### 3.2 Enviar a lista

```bash
$EDITOR /tmp/empresas.txt          # um nome por linha, grafia oficial

# confira o que vai ser enviado
jq -R -s 'split("\n") | map(gsub("^\\s+|\\s+$";"")) | map(select(length>0)) | unique' /tmp/empresas.txt

# versão atual antes de mexer
curl -s -u admin:"$SENHA" "$BASE/v1/admin/companies" | jq '{version, n: (.companies|length)}'

# envia
jq -R -s '{companies: (split("\n") | map(gsub("^\\s+|\\s+$";"")) | map(select(length>0)) | unique)}' /tmp/empresas.txt \
  | curl -s -u admin:"$SENHA" -X PUT "$BASE/v1/admin/companies" \
      -H 'Content-Type: application/json' --data-binary @- | jq
```

A lista sai em ordem alfabética. Lista vazia é recusada pelo servidor, sempre.

Poucos nomes, ou um ajuste de última hora: use o painel → **Empresas** → Adicionar → Salvar.

### 3.3 Conferir que chegou nos dois estandes

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/v1/companies" | jq '{source, version, n:(.companies|length)}'

# em cada Mac, dentro de ≈2 min:
curl -s localhost:3000/api/catalog/status | jq '.catalog'
# esperado: state "ok", MESMA appliedVersion nos dois, companies igual ao n acima
```

### 3.4 A armadilha da poda de 30%

O daemon **recusa** um pull em que mais de 30% das empresas somem de uma vez, e nesse caso **nada é
aplicado** — nem as adições. Se a lista do summit substitui a lista atual em vez de crescer sobre
ela, isso dispara.

Ordem correta, na véspera:

1. Atualize `config/companies.json` com a lista final, commite e `git pull` nos dois Macs.
2. Envie a mesma lista para a nuvem (§3.2).
3. Se ainda assim o log do daemon disser `remoção em massa recusada`:
   ```bash
   # no Mac afetado
   echo 'BOOTH_CATALOG_ALLOW_MASS_REMOVAL=1' >> packages/daemon/.env
   npm run kill:daemon && npm run start:daemon
   # espere um tick, confirme o número:
   curl -s localhost:3000/api/catalog/status | jq '.catalog'
   # APAGUE a linha do .env e reinicie de novo
   ```
4. Não deixe `BOOTH_CATALOG_ALLOW_MASS_REMOVAL=1` ligado durante o evento.

### 3.5 Aliases

Não há nada a fazer. Correções de empresa aprendidas em um estande chegam ao outro pelo mesmo worker
que traz o catálogo.

---

## 4. Véspera — bancos locais, ensaio e limpeza

**Em cada Mac**, nesta ordem:

```bash
cd ~/jogo-de-navinha-agy-summit-26
git pull && npm install && npm run build

curl -s localhost:3000/api/sync/status | jq '.pending'   # tem que ser 0 antes de apagar nada
npm run kill:all
npm run reset:db                                         # pede confirmação
npm run start:daemon                                     # recria o banco do zero
```

Confira no log de boot a linha:

```
[Local Bridge Daemon] Estação: booth-a (origem: env)
```

`origem: env` é o que você quer. `hostname` ou `fallback` significa que o `.env` não foi lido.

```bash
sqlite3 packages/daemon/data/booth_buffer.sqlite 'SELECT COUNT(*) FROM company_aliases;'   # 0
```

Depois faça **um ciclo completo de visitante** em cada estande (§5.9) e, no fim, **apague as partidas
de teste**: painel → Partidas → marcar as caixas → digitar `EXCLUIR` no campo de confirmação →
**Apagar selecionadas**. A tela carrega 100 partidas por busca. Partidas de ensaio com score alto
sequestram a celebração de recorde do primeiro visitante real.

---

## 5. Pre-flight da manhã — por estande

≈10 minutos por Mac. **Todo dia, inclusive no dia 2.** Nenhum item é opcional.

| # | Comando / ação | Critério |
| :--- | :--- | :--- |
| 5.1 | `curl -s -o /dev/null -w '%{http_code}\n' "$BASE/v1/health"` | `200`. Se falhar, é a rede do evento (portal cativo?) |
| 5.2 | `agy --version` | igual ao anotado ontem. Mudou = pode ter deslogado |
| 5.3 | `jq '.gcp' ~/.gemini/antigravity-cli/settings.json` | `{"project":"vibe-cabral","location":"global"}` |
| 5.4 | `jq -r '.trustedWorkspaces \| index("/tmp/booth_session")' ~/.gemini/antigravity-cli/settings.json` | um número, não `null` |
| 5.5 | `npm run start:daemon` e ler o log | `Estação: booth-a (origem: env)` |
| 5.6 | `curl -s localhost:3000/api/sync/status \| jq` | `state` **diferente** de `disabled` e de `auth_failed` |
| 5.7 | `curl -s localhost:3000/api/catalog/status \| jq '.catalog'` | `state: ok`, e **mesma `appliedVersion` nos dois Macs** |
| 5.8 | `npm run start:terminal` + abrir as três telas (§1.9) | terminal na tela de espera, cockpit na atração, telão com o placar |
| 5.9 | **Forja em branco:** ciclo completo de visitante, você mesmo | a nave é **forjada**, não preset (a tela de pré-voo avisa quando é preset) |
| 5.10 | `jq '.build_metadata.selected_mcps' /tmp/booth_session/ship_spec.json` e `wc -l /tmp/booth_session/mcp_audit.log` | lista não vazia; log não vazio |
| 5.11 | Painel → Saúde | os **dois** estandes aparecem, com horário recente |
| 5.12 | Painel → Partidas | apagar as duas partidas do pre-flight |

**5.9 é o item que mais importa.** Um `agy` deslogado não falha de forma visível — ele só entrega
preset de emergência para todo visitante, o dia inteiro. Se saiu preset: refaça o login (§1.4),
confira que `npm run build` rodou desde o último `git pull`, e repita.

---

## 6. Durante o evento

| Situação | Ação |
| :--- | :--- |
| Visitante de empresa que não está na lista | Painel → Empresas → Adicionar → Salvar. Chega nos dois estandes em ≤2 min. **Não** edite `config/companies.json` |
| Nome ofensivo passou | Painel → Partidas → anular |
| Score ou empresa errados | Painel → Partidas → corrigir (os agregados recalculam sozinhos) |
| O `agy` travou | Botão **RESET** na tela 1, ou `curl -s -X POST localhost:3000/api/session/reset` |
| Nada destrava | `npm run kill:all` e suba os dois processos de novo (§1.9) |
| Telão congelado | `Cmd+R` na aba |
| `pending` crescendo em `/api/sync/status` | rede caiu; o backoff vai até 5 min. Reiniciar o daemon zera o backoff. As partidas não se perdem |
| Um estande sumiu do painel → Saúde | O problema é naquele Mac, não na nuvem. Vá até ele |
| Uma empresa apareceu duplicada no ranking | Painel → Partidas → corrigir a grafia errada para a canônica; o alias propaga para os dois estandes |

Não rode `npm run reset:db` com o evento aberto: ele apaga a fila de partidas ainda não enviadas.

---

## 7. Entre o dia 1 e o dia 2

### 7.1 Fechamento do dia 1, em cada Mac

```bash
curl -s localhost:3000/api/sync/status | jq '{state, pending}'
```

**`pending` tem que ser 0.** Se não for, deixe o daemon de pé até drenar (ou reinicie para zerar o
backoff) e só então feche. Depois:

```bash
npm run kill:all          # também limpa /tmp/booth_session
agy --version             # ANOTE para comparar amanhã
```

Deixe os Macs na tomada. Não rode `reset:db`.

### 7.2 Decidir o placar do dia 2

O placar é **cumulativo**: não há corte por data em lugar nenhum.

- **Manter acumulado** (recomendado, e é o default): não faça nada.
- **Zerar para o dia 2:** painel → Partidas → marcar → digitar `EXCLUIR` → **Apagar selecionadas**.
  Apagar recalcula `company_rankings` e `pilots` corretamente e remove o documento da empresa que
  ficar sem partidas. A tela vai 100 por vez. Anote o ranking do dia 1 **antes**.

### 7.3 Limpeza

Apague as partidas de pre-flight e de demonstração do dia 1.

### 7.4 Se houver correção de código para aplicar

```bash
git pull && npm install && npm run build     # nos dois Macs
```

Se a correção tocar `cloud-api`, `admin-app`, `leaderboard-app` ou `shared`, rode também
`npm run deploy:gcp` — e refaça o §2 depois.

### 7.5 O que muda na manhã do dia 2

- **Refaça o §5 inteiro nos dois estandes.** Principalmente o 5.2 e o 5.9: a auto-atualização do
  `agy` já derrubou o login em silêncio de um dia para o outro.
- A busca do painel → Partidas enxerga só as **500 partidas mais recentes**. Com dois estandes e dois
  dias isso passa do total do evento: para corrigir uma partida do dia 1 durante o dia 2, busque pelo
  **`match_id` exato** (esse caminho lê o documento direto e funciona sempre). Busca por callsign, não.
- Confira que os dois estandes voltaram com a **mesma `appliedVersion`** de catálogo (item 5.7).

---

## 8. Encerramento

```bash
# ranking final, para registro
curl -s -u admin:"$SENHA" "$BASE/v1/admin/health" | jq
curl -s -u admin:"$SENHA" "$BASE/v1/admin/matches?limit=200" > partidas-summit.json
```

O `limit` do endpoint é **200** e a janela de varredura é **500** — para o histórico completo, use o
painel → Rankings (que lê `company_rankings` direto) ou um export do Firestore.

Nos Macs: `npm run kill:all`. Nada mais precisa ser desfeito — a nuvem fica de pé e o placar segue
acessível. Para derrubar a infraestrutura, `npm run undeploy:gcp` (ver
[`14 §8`](./14_INSTALLATION_GUIDE.md#8-desinstalar)).

---

## 9. Cartão de bolso

```bash
# subir o estande (dois terminais)
npm run start:daemon
npm run start:terminal

# derrubar tudo
npm run kill:all

# saúde local
curl -s localhost:3000/api/health | jq
curl -s localhost:3000/api/sync/status | jq         # fila de SAÍDA
curl -s localhost:3000/api/catalog/status | jq      # o que a nuvem mandou para cá

# destravar uma sessão
curl -s -X POST localhost:3000/api/session/reset

# nuvem
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/v1/health"
curl -s -u admin:"$SENHA" "$BASE/v1/admin/health" | jq '.stationActivity'
```

| Precisa de | Vá para |
| :--- | :--- |
| Instalar do zero, com explicação | [`14_INSTALLATION_GUIDE.md`](./14_INSTALLATION_GUIDE.md) |
| Testar a fundo antes do evento | [`12_MANUAL_TEST_PLAN_MAC.md`](./12_MANUAL_TEST_PLAN_MAC.md), Bloco 26 |
| Operar o painel no detalhe | [`../USER_GUIDE.md`](../USER_GUIDE.md) |
| Falhas conhecidas | [`11_KNOWN_GAPS_AND_OPEN_ITEMS.md`](./11_KNOWN_GAPS_AND_OPEN_ITEMS.md) |
