import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseEnvFile, findShadowedKeys, buildShadowWarning } from './env-precedence.js';

describe('parseEnvFile', () => {
  it('lê pares simples e ignora comentário e linha vazia', () => {
    const vars = parseEnvFile('# comentário\n\nA=1\nB=dois\n');
    assert.deepStrictEqual([...vars], [['A', '1'], ['B', 'dois']]);
  });

  it('tira aspas em volta, que são delimitador e não conteúdo', () => {
    const vars = parseEnvFile('A="com aspas"\nB=\'simples\'\n');
    assert.strictEqual(vars.get('A'), 'com aspas');
    assert.strictEqual(vars.get('B'), 'simples');
  });

  it('preserva o = de dentro do valor', () => {
    // Token base64 termina em '=' com frequência; quebrar no último '=' truncaria a credencial
    // e o aviso apontaria uma divergência que não existe.
    const vars = parseEnvFile('BOOTH_INGEST_TOKEN=YWJjZGVm==\n');
    assert.strictEqual(vars.get('BOOTH_INGEST_TOKEN'), 'YWJjZGVm==');
  });

  it('aceita o prefixo export, que quem copia de um shell script deixa para trás', () => {
    const vars = parseEnvFile('export A=1\n');
    assert.strictEqual(vars.get('A'), '1');
  });

  it('ignora linha sem = e chave vazia em vez de inventar entrada', () => {
    const vars = parseEnvFile('lixo\n=semchave\nA=1\n');
    assert.deepStrictEqual([...vars], [['A', '1']]);
  });
});

describe('findShadowedKeys', () => {
  it('acusa a chave que o ambiente sobrescreve com valor diferente', () => {
    const shadowed = findShadowedKeys(
      new Map([['BOOTH_INGEST_TOKEN', 'do-arquivo']]),
      { BOOTH_INGEST_TOKEN: 'do-ambiente' }
    );
    assert.deepStrictEqual(shadowed, [{ key: 'BOOTH_INGEST_TOKEN', winner: 'ambiente' }]);
  });

  it('fica calado quando os dois valores são iguais', () => {
    // Quem venceu é indiferente se o resultado é o mesmo. Avisar aqui só ensinaria o operador
    // a ignorar o aviso.
    const shadowed = findShadowedKeys(
      new Map([['A', 'igual']]),
      { A: 'igual' }
    );
    assert.deepStrictEqual(shadowed, []);
  });

  it('fica calado quando a chave só existe no arquivo — que é o caso normal', () => {
    const shadowed = findShadowedKeys(new Map([['A', '1']]), {});
    assert.deepStrictEqual(shadowed, []);
  });

  it('não acusa chave que só existe no ambiente', () => {
    // O arquivo não promete nada sobre ela, então não há promessa quebrada a relatar.
    const shadowed = findShadowedKeys(new Map(), { PATH: '/usr/bin' });
    assert.deepStrictEqual(shadowed, []);
  });

  it('distingue string vazia de ausente', () => {
    // `BOOTH_INGEST_TOKEN=` exportado vazio é exatamente o caso que desliga a nuvem sem erro
    // nenhum -- é o que mais precisa aparecer, não o que menos.
    const shadowed = findShadowedKeys(new Map([['A', 'valor']]), { A: '' });
    assert.deepStrictEqual(shadowed, [{ key: 'A', winner: 'ambiente' }]);
  });
});

describe('buildShadowWarning', () => {
  it('devolve null quando não há nada a avisar', () => {
    assert.strictEqual(buildShadowWarning([], '/x/.env'), null);
  });

  it('nomeia a chave, o arquivo e o comando de saída', () => {
    const msg = buildShadowWarning(
      [{ key: 'BOOTH_INGEST_TOKEN', winner: 'ambiente' }],
      '/estande/.env'
    );
    assert.match(msg!, /BOOTH_INGEST_TOKEN/);
    assert.match(msg!, /\/estande\/\.env/);
    assert.match(msg!, /unset BOOTH_INGEST_TOKEN/);
  });

  it('NUNCA registra o valor — o token vai para a tela de um terminal em espaço público', () => {
    // Este é o teste que protege a credencial. Se alguém "melhorar" a mensagem mostrando os dois
    // valores para facilitar a comparação, ele quebra, e é para quebrar mesmo.
    const msg = buildShadowWarning(
      [{ key: 'BOOTH_INGEST_TOKEN', winner: 'ambiente' }],
      '/estande/.env'
    );
    assert.doesNotMatch(msg!, /do-arquivo|do-ambiente|segredo/i);
  });

  it('concorda em número quando há mais de uma chave', () => {
    const msg = buildShadowWarning(
      [{ key: 'A', winner: 'ambiente' }, { key: 'B', winner: 'ambiente' }],
      '/x/.env'
    );
    assert.match(msg!, /as variáveis A, B estão exportadas/);
  });
});
