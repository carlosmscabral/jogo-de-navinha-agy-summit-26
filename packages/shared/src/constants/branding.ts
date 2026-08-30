/**
 * Fonte única do nome do produto voltado ao visitante.
 *
 * Existia um nome diferente em cada canto — `Starfighter` no telão e na tela de atrai,
 * `Space Shooter` no `<title>` do player-app, `Jogo de Navinha` no README e no admin,
 * `Avionics Forge` no subtítulo — e nenhum deles dizia "Antigravity", que é o produto
 * que o estande está demonstrando. Qualquer texto novo apontado ao visitante importa
 * daqui.
 *
 * Cuidado ao mexer: isto é **só** o nome de exibição. Os identificadores de
 * infraestrutura que contêm `jogo-navinha` — o database Firestore (`firebase.json`,
 * `DATABASE_ID` em `types/cloud.ts`), o site de Hosting `jogo-navinha-telao`, o nome do
 * repositório e os nomes de workspace npm — são chaves de recursos já provisionados no
 * `vibe-cabral` e renomeá-los quebraria o deploy. Eles continuam como estão de propósito.
 *
 * Os arquivos `index.html` não conseguem importar TypeScript; lá o valor vai literal,
 * com um comentário apontando para cá.
 */

/** Nome do jogo, como aparece no H1 da tela de atrai e nos títulos de aba. */
export const GAME_NAME = 'GRAVIDADE ZERO';

/** Linha de apoio imediatamente abaixo do nome. Nomeia a tecnologia demonstrada. */
export const GAME_TAGLINE = 'powered by Antigravity';

/** Nome curto do evento, usado entre travessões: `── AGY SUMMIT 26 ──`. */
export const EVENT_NAME = 'AGY SUMMIT 26';

/** `── AGY SUMMIT 26 ──`, já com os travessões, para não repetir a decoração no JSX. */
export const EVENT_BANNER = `── ${EVENT_NAME} ──`;

/**
 * A frase única que abre a sessão do `agy`. Genérica por decisão de produto: a seleção real
 * acontece no Fast-Grill-Me, dentro do terminal, não aqui.
 *
 * No caminho feliz o visitante nunca a digita — `scripts/booth-terminal.sh` a injeta via
 * `agy --prompt-interactive`, o que é o que a Spec 01 §1 ("o fluxo não pode exigir que ninguém
 * digite um comando") de fato pede. A tela 1 a exibe como saída de emergência, para o caso de a
 * injeção falhar no hardware do evento; por isso a frase é curta o bastante para ser digitada à
 * mão. Os dois lados leem esta constante para nunca divergirem.
 */
export const BOOTH_KICKOFF_PROMPT = 'Forje minha nave seguindo o protocolo do AGENTS.md.';
