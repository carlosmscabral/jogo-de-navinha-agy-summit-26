import { describe, it } from 'node:test';
import assert from 'node:assert';
import { startModeration } from './pending-moderation.js';
import type { RemoteVerdict } from './remote-moderation.js';

const silent = () => {};

/** Uma moderação que só resolve quando o teste mandar — é assim que se observa "ainda em voo". */
function deferredModerate() {
  let release!: (v: RemoteVerdict) => void;
  const gate = new Promise<RemoteVerdict>((resolve) => { release = resolve; });
  let calls = 0;
  return {
    fn: (_callsign: string) => { calls++; return gate; },
    release,
    get calls() { return calls; }
  };
}

describe('startModeration — camada 2 fora do caminho crítico', () => {
  it('devolve o provisório na hora, sem esperar a camada 2', async () => {
    // Este é o teste que justifica o módulo existir. Se ele passar a falhar, alguém pôs a
    // camada 2 de volta no caminho crítico e o visitante voltou a esperar até 8s na tela de
    // cadastro por um veredito que só importa minutos depois.
    const deferred = deferredModerate();
    const pending = startModeration('CYBER_ACE', true, {
      moderate: deferred.fn, placeholder: () => 'PILOTO_111', warn: silent
    });

    assert.strictEqual(pending.provisional, 'CYBER_ACE');
    assert.strictEqual(deferred.calls, 1, 'a camada 2 tem que ter sido disparada');

    // Nada de await em `final` ainda: a chamada acima já retornou com a moderação em voo.
    deferred.release({ verdict: 'allow' });
    assert.strictEqual(await pending.final, 'CYBER_ACE');
  });

  it('troca por placeholder quando a camada 2 reprova', async () => {
    const pending = startModeration('CEO_LADRAO', true, {
      moderate: async () => ({ verdict: 'block', reason: 'termo pejorativo' }),
      placeholder: () => 'PILOTO_222',
      warn: silent
    });
    assert.strictEqual(await pending.final, 'PILOTO_222');
  });

  it('mantém o nome quando a camada 2 está indisponível — fail-open de transporte', async () => {
    // Spec 08 §6.2: "o Vertex está inalcançável" é o oposto de "o modelo está em dúvida". Um
    // estande sem internet não pode parar de receber visitantes, e a camada 1 já aprovou.
    const pending = startModeration('NOVA_RIDER', true, {
      moderate: async () => ({ verdict: 'unavailable' }),
      placeholder: () => 'PILOTO_333',
      warn: silent
    });
    assert.strictEqual(await pending.final, 'NOVA_RIDER');
  });

  it('não consulta a camada 2 quando a camada 1 já reprovou', async () => {
    // O provisório já É um placeholder seguro por construção; perguntar de novo só gastaria rede.
    let called = false;
    const pending = startModeration('PILOTO_869', false, {
      moderate: async () => { called = true; return { verdict: 'allow' }; },
      placeholder: () => 'PILOTO_444',
      warn: silent
    });
    assert.strictEqual(await pending.final, 'PILOTO_869');
    assert.strictEqual(called, false);
  });

  it('não rejeita nem perde a partida se a camada 2 lançar', async () => {
    // `final` é aguardado dentro do POST /api/matches. Uma rejeição aqui derrubaria a gravação
    // da partida — o visitante perderia o SCORE por um problema de moderação, que é uma troca
    // absurda. Fail-open: a camada 1 já tinha aprovado este nome.
    const pending = startModeration('GHOST_WING', true, {
      moderate: async () => { throw new Error('boom'); },
      placeholder: () => 'PILOTO_555',
      warn: silent
    });
    assert.strictEqual(await pending.final, 'GHOST_WING');
  });

  it('o placeholder da camada 2 é indistinguível do da camada 1 no telão', async () => {
    const pending = startModeration('SEU_PATETA', true, {
      moderate: async () => ({ verdict: 'block', reason: 'pejorativo' }),
      placeholder: () => `PILOTO_${666}`,
      warn: silent
    });
    assert.match(await pending.final, /^PILOTO_\d{3}$/);
  });
});
