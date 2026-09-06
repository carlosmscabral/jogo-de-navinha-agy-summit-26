/**
 * Modelo de dados do Firestore — Spec 05 §4 e Spec 08 §6.3.
 *
 * As três formas de documento são declaradas uma única vez, aqui, e importadas
 * tanto pelo escritor (`cloud-api`, Tarefa C3) quanto pelo leitor
 * (`leaderboard-app`, Tarefa C6). Nenhum pacote declara sua própria cópia — é
 * isso que faz o compilador, e não uma revisão humana, pegar deriva de schema.
 */
import type { ScoreBreakdown, MatchTelemetry, ShipSpecification } from './ship.js';

/** Banco Firestore nomeado. Nunca o (default). Spec 08 §6.3. */
export const DATABASE_ID = 'jogo-navinha';

/**
 * Versão da forma dos documentos. Nasce em 1 e sobe quando um campo muda de
 * significado ou some. Custa um inteiro por documento e evita ter que adivinhar,
 * depois do evento, qual forma um documento tem. Spec 05 §4.1.
 */
export const SCHEMA_VERSION = 1;

/** Documento em /matches/{match_id}. `match_id` é a chave: reenviar é idempotente. */
export interface MatchDocument {
  schema_version: number;
  /** UUID v4. Nunca timestamp — duas estações colidiriam. Spec 05 §4.1. */
  match_id: string;
  pilot_id: string;
  callsign: string;
  company_raw: string;
  company_canonical: string;
  company_confidence: number;
  final_score: number;
  score_breakdown: ScoreBreakdown;
  telemetry: MatchTelemetry;
  ship_spec_snapshot: ShipSpecification;
  /** ISO 8601 no cliente. O servidor sobrescreve com FieldValue.serverTimestamp(). */
  created_at: string;
  /**
   * Relógio do estande no momento em que a partida terminou, preservado porque
   * `created_at` acima é sobrescrito pela hora de INGESTÃO. A distinção só aparece quando um
   * booth fica offline e drena a fila depois: sem este campo, partidas de meia hora atrás
   * entram no topo de "recentes" e podem disparar uma celebração de recorde velho. O telão
   * ordena o ticker por aqui, com fallback para `created_at`.
   *
   * Opcional: partidas já no Firestore não têm, e o SQLite de um daemon atualizado pode ter
   * partidas enfileiradas de antes desta mudança.
   */
  played_at?: string;
  /**
   * Qual estande produziu a partida. Injetado pelo daemon (nunca pelo navegador — valor vindo
   * do cliente não é autenticado e permitiria atribuir dados de uma estação à outra), a partir
   * de `BOOTH_STATION_ID` ou do hostname da máquina.
   *
   * Opcional pelo mesmo motivo de `played_at`: exigi-lo rejeitaria toda partida bufferizada
   * antes do upgrade, e uma partida sem rótulo é melhor que uma partida perdida.
   */
  station_id?: string;
  /** Marcado quando a canonicalização por modelo ainda não rodou (Spec 05 §3.2). */
  needs_company_review?: boolean;
  /**
   * Marcado por uma correção do painel de admin (Tarefa C7). Anular exclui a partida de
   * todos os agregados recalculados (`company_rankings`), mas o documento nunca é apagado —
   * `DELETE` destruiria a evidência de que a partida existiu, o que importa se alguém
   * contestar uma pontuação durante o evento. Isso continua valendo para o fluxo normal de
   * correção de um evento ao vivo: anular é o único mecanismo ali. Exceção deliberada,
   * separada (Tarefa C9): `deleteMatch`/`POST /v1/admin/matches/bulk` com `action: 'delete'`
   * apaga o documento de verdade e é explicitamente irreversível — existe só para limpar
   * dados de teste (placares de antes de correções, empresas fictícias) antes do evento,
   * não para corrigir uma partida real.
   */
  voided?: boolean;
  /**
   * Cartão SVG autocontido da nave, gerado FORA do fluxo do jogo pelo serviço `cardgen`
   * (Eventarc → Cloud Run) a partir de `ship_spec_snapshot`. Redundante por desenho: os dados
   * de origem continuam aqui e o campo pode ser regerado a qualquer momento a partir deles.
   * Existe para que um consumidor futuro — em qualquer linguagem, ou um painel de BI — mostre a
   * nave sem importar código nosso nem conhecer o contrato do viewBox.
   *
   * Ausente até o `cardgen` rodar, e ausente para sempre se ele nunca rodar: nada no jogo, na
   * ingestão ou no placar lê este campo.
   */
  ship_card_svg?: string;
  /** `SHIP_CARD_VERSION` usada para gerar `ship_card_svg`. Ausente = nunca gerado. */
  ship_card_version?: number;
}

/** Documento em /pilots/{pilot_id}. Spec 05 §4.2. */
export interface PilotDocument {
  schema_version: number;
  pilot_id: string;
  callsign: string;
  company_canonical: string;
  /** ISO 8601 no cliente. O servidor sobrescreve com FieldValue.serverTimestamp(). */
  created_at: string;
  best_score: number;
  matches_played: number;
}

/** Documento em /company_rankings/{company_canonical}. Spec 05 §4.3. */
export interface CompanyRankingDocument {
  schema_version: number;
  company_canonical: string;
  total_score: number;
  pilots_count: number;
  top_individual_score: number;
  /** ISO 8601 no cliente. O servidor sobrescreve com FieldValue.serverTimestamp(). */
  last_updated: string;
}

/**
 * Documento único em /companies/catalog — a FONTE ÚNICA do catálogo de empresas.
 *
 * Já foi só a cópia que o painel de admin editava, com `config/companies.json` de cada estande
 * como fonte de verdade offline e uma reconciliação manual entre os dois. Isso caiu quando o
 * evento passou a ter dois estandes contra o mesmo placar: `company_canonical` é o ID do
 * documento em `company_rankings`, então catálogos divergentes racham a mesma empresa em dois
 * rankings — e de forma silenciosa, porque grafias diferentes resolvem com confiança ALTA nos
 * dois lados, nenhuma é marcada para revisão e a varredura de canonicalização nunca as vê.
 *
 * Hoje este documento é lido pela canonicalização e servido aos daemons por `GET /v1/companies`;
 * o arquivo em disco virou semente de primeiro boot e rede de segurança para o estande sem rede.
 */
export interface CompanyCatalogDocument {
  schema_version: number;
  companies: string[];
  /** ISO 8601 no cliente. O servidor sobrescreve com FieldValue.serverTimestamp(). */
  updated_at: string;
  /**
   * Incrementada a cada gravação. Serve a dois propósitos:
   * 1. Concorrência otimista no `PUT` — dois operadores no painel ao mesmo tempo não podem
   *    mais fazer o segundo salvar por cima do primeiro sem saber (era `.set()` puro).
   * 2. Barateia o pull dos daemons: o estande só reaplica o catálogo quando a versão mudou.
   *
   * Ausente nos documentos gravados antes desta mudança; tratar como 1.
   */
  version?: number;
}

/**
 * Nome de campo checado pelo compilador, para as consultas do Firestore.
 * `orderBy(field<MatchDocument>('final_score'), 'desc')` quebra o build se o
 * campo for renomeado; `orderBy('final_score', 'desc')` compila e falha no evento.
 */
export function field<T>(name: keyof T & string): string {
  return name;
}

/**
 * Campos que uma correção manual de partida (Tarefa C7, `PATCH /v1/admin/matches/:id`) pode
 * tocar. Tudo opcional: o operador manda só o que muda. Declarado uma única vez aqui (revisão
 * final Fase C, Minor 10) — antes disso, `packages/cloud-api/src/admin.ts` e
 * `packages/admin-app/src/api.ts` tinham cada um sua própria cópia idêntica, exatamente o
 * tipo de deriva que este arquivo existe para o compilador pegar em vez de uma revisão humana.
 */
export interface MatchCorrection {
  callsign?: string;
  company_canonical?: string;
  final_score?: number;
  voided?: boolean;
}
