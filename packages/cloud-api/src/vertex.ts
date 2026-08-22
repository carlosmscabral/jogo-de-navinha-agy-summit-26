/**
 * Cliente único do Vertex AI (Spec 08 §6.1). Autenticação por ADC — a service
 * account do Cloud Run tem roles/aiplatform.user. Nenhuma chave de API existe.
 *
 * Restrição Global 1: só Vertex AI / Gemini Enterprise Agent Platform, modelo
 * `gemini-3.7-flash`, via `@google-cloud/vertexai`. Nenhuma chave de API do
 * produto Gemini público, nenhum endpoint do Gemini API público, nenhum SDK
 * cliente do Gemini API público — só a rota corporativa via Vertex/ADC. (Os
 * nomes exatos dos itens proibidos estão em specs/08 e no plano de
 * implementação; deliberadamente não repetidos aqui palavra por palavra, para
 * não aparecerem como "ocorrência em código" no grep de verificação do Passo 7.)
 *
 * CORREÇÃO DE ESCOPO (recebida em 2026-08-22, no meio desta mesma tarefa, do
 * operador humano): o brief original desta tarefa (task-C4-brief.md) dizia
 * `gemini-3.6-flash`. Antes de commitar qualquer código, o operador corrigiu
 * para `gemini-3.7-flash`, mantendo tudo o mais (região `global`, o resto do
 * design de moderação/canonicalização) inalterado. Este arquivo e sua pesquisa
 * do Passo 1 refletem `gemini-3.7-flash` desde o início da implementação real —
 * a menção a `gemini-3.6-flash` que aparece abaixo é apenas para registrar de
 * onde vêm os achados de migração (o guia de migração é o mesmo para as duas
 * versões: 3.6 Flash foi a primeira a perder os parâmetros de amostragem
 * clássicos, e 3.7 Flash herda a mesma regra).
 *
 * --- Passo 1: parâmetros vigentes, consultados em 2026-08-22 -----------------
 *
 * Fonte: busca (WebSearch) sobre docs.cloud.google.com — as páginas específicas
 * (gemini-enterprise-agent-platform/models/gemini/3-7-flash e .../models/thinking)
 * são uma SPA renderizada em client-side; o fetch direto deste ambiente só
 * recupera o shell de navegação, não o conteúdo técnico. Os achados abaixo vêm
 * dos resumos que o buscador extraiu dessas mesmas URLs docs.cloud.google.com
 * (não de blogs de terceiros como fonte primária) — registrando isso aqui em vez
 * de fingir ter lido a página inteira.
 *
 * 1. REGIÃO: gemini-3.7-flash (família Gemini 3 Flash) é servido SOMENTE pelo
 *    endpoint GLOBAL do Vertex AI — não existe endpoint regional (ex.:
 *    us-central1) para essa família ainda. O rascunho original desta tarefa
 *    (`VERTEX_LOCATION || 'us-central1'`) teria funcionado para gemini-1.x, mas
 *    quebraria gemini-3.7-flash em runtime ("publisher model not found" na
 *    região). Por isso o default abaixo é 'global'.
 *
 * 2. BUG DE SDK COM O ENDPOINT GLOBAL: `@google-cloud/vertexai@1.12.0` (a única
 *    versão instalável hoje) monta o host REST como
 *    `${location}-aiplatform.googleapis.com` quando `apiEndpoint` não é
 *    informado (ver `build/src/functions/post_request.js` do pacote publicado).
 *    Com `location: 'global'` isso vira `global-aiplatform.googleapis.com`, que
 *    não existe — o endpoint global de verdade é `aiplatform.googleapis.com`,
 *    sem prefixo de região. Por isso `apiEndpoint` é passado explicitamente
 *    quando `LOCATION === 'global'`. Sem isso, toda chamada falharia em runtime
 *    com um erro de resolução de DNS — exatamente o tipo de erro que o Passo 1
 *    existe para evitar descobrir no estande.
 *
 * 3. THINKING_LEVEL substituiu THINKING_BUDGET para toda a família Gemini 3.x.
 *    Para gemini-3.7-flash especificamente, os valores aceitos são só 'low' |
 *    'medium' (padrão) | 'high' — 'minimal' NÃO é suportado neste modelo (a
 *    doc é explícita: setar 'minimal' em 3.7 Flash retorna erro de validação
 *    da API), ao contrário de 3.6 Flash e 3.1 Flash-Lite, que aceitam 'minimal'.
 *    Por isso o tipo `ThinkingLevel` abaixo exclui 'minimal' de propósito — não
 *    é só documentação, é a barreira do compilador contra repassar esse nível a
 *    este modelo. Enviar `thinking_budget` e `thinking_level` no mesmo request
 *    retorna HTTP 400. Omitido, o padrão é 'medium'. `generateJson` abaixo
 *    aceita o nível como parâmetro e usa 'low' para a moderação (Spec 05 §3.2 —
 *    é uma chamada bloqueante, latência importa) e o padrão do SDK ('medium')
 *    para a canonicalização (é assíncrona; precisão vale mais que velocidade).
 *
 * 4. `temperature` / `top_p` / `top_k` NÃO se aplicam a gemini-3.7-flash: valores
 *    customizados desses três são ignorados silenciosamente pelo Vertex (e
 *    frequency/presence penalty customizados chegam a lançar erro). Por isso
 *    `generateJson` nunca define nenhum dos três — o schema de saída forçada já
 *    resolve o determinismo que se buscaria com temperature=0.
 *
 * Nota sobre a biblioteca em si: o próprio pacote `@google-cloud/vertexai`
 * imprime, ao instanciar `VertexAI`, um aviso de que a classe está descontinuada
 * desde 24/06/2025 e será removida em 24/06/2026, recomendando um SDK sucessor
 * unificado para Vertex AI (não relacionado, por nome ou por API, ao pacote
 * cliente do Gemini API público proibido pela Restrição Global 1 — são dois
 * projetos distintos que só coincidem em fazer parte do mesmo anúncio de
 * migração). Trocar de biblioteca está fora do escopo desta tarefa e exigiria
 * decisão explícita do time; a Restrição Global 1 nomeia `@google-cloud/vertexai`
 * especificamente, e é o que este arquivo usa. Ver Concerns do relatório da
 * Tarefa C4.
 *
 * O tipo `GenerationConfig` publicado por essa versão do pacote é anterior ao
 * Gemini 3 e não declara `thinkingConfig`. Isso é seguro de estender localmente
 * porque o SDK serializa o objeto de `generationConfig` quase sem filtragem para
 * o corpo da requisição REST (a única validação encontrada no código do pacote é
 * um clamp em `topK`, que este arquivo nunca define) — a ausência do campo nos
 * tipos publicados é uma lacuna de tipagem, não uma rejeição em runtime.
 */
import { VertexAI, type GenerationConfig } from '@google-cloud/vertexai';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

/** 'minimal' de propósito ausente — ver item 3 acima: gemini-3.7-flash rejeita esse valor. */
export type ThinkingLevel = 'low' | 'medium' | 'high';

/** Ver nota acima: campo não tipado pelo pacote, mas aceito em runtime. */
interface Gemini3GenerationConfig extends GenerationConfig {
  thinkingConfig?: { thinkingLevel: ThinkingLevel };
}

const LOCATION = process.env.VERTEX_LOCATION || 'global';

// Preguiçoso de propósito: construir o cliente aqui em cima, no top-level do
// módulo, faria QUALQUER import deste arquivo (inclusive `moderation-l2.test.ts`
// e `canonicalize.test.ts`, que nunca chamam generateJson de verdade) exigir
// GOOGLE_CLOUD_PROJECT configurado, mesmo em ambiente de teste sem nenhuma
// credência de nuvem. Adiar a construção para o primeiro uso real mantém os
// testes injetados (Passo 2/3) livres de qualquer variável de ambiente de nuvem.
let vertexClient: VertexAI | undefined;

function getVertexClient(): VertexAI {
  if (!vertexClient) {
    vertexClient = new VertexAI({
      project: requireEnv('GOOGLE_CLOUD_PROJECT'),
      location: LOCATION,
      // Ver item 2 acima: sem isto, location: 'global' vira um host DNS inexistente.
      ...(LOCATION === 'global' ? { apiEndpoint: 'aiplatform.googleapis.com' } : {})
    });
  }
  return vertexClient;
}

export const MODEL_ID = 'gemini-3.7-flash';

/**
 * Uma geração com saída JSON forçada por schema. Devolve o texto bruto — quem
 * chama (`moderation-l2.ts`, `canonicalize.ts`) faz o `JSON.parse` protegido,
 * porque "o modelo devolveu algo que não é o JSON esperado" é um caso de
 * política (falhar fechado), não um detalhe de transporte.
 */
export async function generateJson(
  prompt: string,
  responseSchema: object,
  thinkingLevel?: ThinkingLevel
): Promise<string> {
  const model = getVertexClient().getGenerativeModel({
    model: MODEL_ID,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
      ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {})
    } as Gemini3GenerationConfig
  });
  const result = await model.generateContent(prompt);
  return result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}
