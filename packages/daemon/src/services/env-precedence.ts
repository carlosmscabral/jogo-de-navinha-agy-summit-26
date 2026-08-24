/**
 * Avisa quando o `.env` do estande foi carregado mas NÃO está valendo.
 *
 * Node resolve `--env-file`/`--env-file-if-exists` com precedência para o ambiente: uma variável
 * já exportada no shell vence a mesma chave no arquivo, silenciosamente. Isso é documentado e
 * defensável, mas é invisível — o daemon sobe normal, o arquivo está lá, o `grep` mostra o valor
 * certo, e mesmo assim o processo usa outro.
 *
 * Custou uma hora no Gate M3 (2026-08-24, Bloco 13.10): `packages/daemon/.env` dizia
 * `BOOTH_INGEST_TOKEN=lixo-invalido`, a nuvem aceitava exatamente esse valor (verificado com um
 * POST direto), e ainda assim toda sincronização voltava 401. Um `BOOTH_INGEST_TOKEN` exportado
 * naquele terminal estava vencendo o arquivo. Nada em lugar nenhum dizia isso.
 *
 * Às 9h da manhã de um evento, ninguém vai suspeitar de precedência de variável de ambiente. Uma
 * linha no boot troca essa hora de depuração por uma leitura.
 *
 * NUNCA registra valores — só nomes de chave. `BOOTH_INGEST_TOKEN` é credencial, e o log do
 * estande vai para a tela de um terminal em espaço público.
 */

/** Uma chave presente nas duas fontes, com valores diferentes: o arquivo perdeu. */
export interface ShadowedKey {
  key: string;
  /** De onde veio o valor que está valendo. Hoje sempre 'ambiente' — o arquivo nunca vence. */
  winner: 'ambiente';
}

/**
 * Parser deliberadamente pequeno, suficiente para comparação. Não tenta reproduzir cada canto do
 * formato que o Node aceita (multilinha entre aspas, por exemplo): um falso negativo aqui só
 * significa um aviso a menos, nunca um comportamento diferente do daemon. Este módulo não
 * configura nada — ele só observa.
 */
export function parseEnvFile(content: string): Map<string, string> {
  const out = new Map<string, string>();

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!key) continue;

    let value = line.slice(eq + 1).trim();
    // Aspas em volta são delimitador, não conteúdo — mesma leitura que o Node faz.
    if (value.length >= 2 && (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )) {
      value = value.slice(1, -1);
    }

    out.set(key, value);
  }

  return out;
}

/**
 * As chaves em que o arquivo e o ambiente discordam. Chave ausente do ambiente não conta (o
 * arquivo venceu, que é o caso normal), e valores iguais não contam (não há nada a avisar:
 * quem venceu é indiferente).
 */
export function findShadowedKeys(
  fileVars: Map<string, string>,
  env: NodeJS.ProcessEnv
): ShadowedKey[] {
  const shadowed: ShadowedKey[] = [];

  for (const [key, fileValue] of fileVars) {
    const live = env[key];
    if (live !== undefined && live !== fileValue) {
      shadowed.push({ key, winner: 'ambiente' });
    }
  }

  return shadowed;
}

/**
 * A mensagem pronta, ou `null` quando não há nada a dizer. Separada do IO para o teste poder
 * afirmar o texto sem tocar em disco — e porque a redação É o recurso: um aviso que não diz o
 * que fazer vira ruído que o operador aprende a ignorar.
 */
export function buildShadowWarning(shadowed: ShadowedKey[], envPath: string): string | null {
  if (shadowed.length === 0) return null;

  const keys = shadowed.map((s) => s.key).join(', ');
  const plural = shadowed.length > 1;

  return (
    `[Daemon] ATENÇÃO: ${plural ? 'as variáveis' : 'a variável'} ${keys} ` +
    `${plural ? 'estão' : 'está'} exportada${plural ? 's' : ''} no ambiente com valor diferente ` +
    `do que está em ${envPath} — e o ambiente VENCE. ` +
    `Editar o arquivo não muda nada enquanto isso durar. ` +
    `Se você acabou de mexer no arquivo e o comportamento não mudou, é isto: ` +
    `rode 'unset ${shadowed[0].key}' neste terminal e reinicie o daemon.`
  );
}
