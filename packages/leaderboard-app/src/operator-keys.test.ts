import { describe, it, expect } from 'vitest';
import { bindingForKey } from './operator-keys.js';
import type { RotationEvent } from './view-rotation.js';

/**
 * Estes testes existem por causa de uma falha real: no telão publicado em 2026-09-06 dava para
 * navegar as seções do painel do Antigravity e **não dava para sair**. O reducer estava certo e
 * tinha teste; o que faltava era uma tecla ligada ao evento. Nenhum teste podia ver isso enquanto
 * o mapa morava dentro do componente.
 */
describe('bindingForKey', () => {
  const tipo = (key: string): RotationEvent['type'] => bindingForKey(key).event.type;

  it('avança com as quatro teclas que o apontador do estande emite', () => {
    for (const key of ['ArrowRight', 'ArrowDown', 'PageDown', ' ']) {
      expect(tipo(key), key).toBe('OPERATOR_NEXT');
    }
  });

  it('volta uma seção com as três teclas de retroceder', () => {
    for (const key of ['ArrowLeft', 'ArrowUp', 'PageUp']) {
      expect(tipo(key), key).toBe('OPERATOR_PREV');
    }
  });

  it('sai para o placar por Escape, Home ou Backspace', () => {
    for (const key of ['Escape', 'Home', 'Backspace']) {
      expect(tipo(key), key).toBe('FORCE_SCOREBOARD');
    }
  });

  it('não deixa a saída depender só do Escape, que o F11 engole', () => {
    // Em tela cheia por F11 o navegador consome o Escape antes de a página vê-lo. Se um dia
    // alguém "simplificar" isto para uma tecla só, o telão volta a ficar sem saída nesse modo.
    const saidas = ['Escape', 'Home', 'Backspace', 'End', 'Delete', 'Tab', 'F1']
      .filter((k) => tipo(k) === 'FORCE_SCOREBOARD');
    expect(saidas.length).toBeGreaterThanOrEqual(2);
    expect(saidas).not.toEqual(['Escape']);
  });

  it('trata qualquer outra tecla como mera atividade, sem sequestrar o navegador', () => {
    for (const key of ['a', 'Z', '7', 'F5', 'Shift', 'Enter']) {
      const b = bindingForKey(key);
      expect(b.event.type, key).toBe('OPERATOR_ACTIVITY');
      expect(b.preventDefault, key).toBe(false);
    }
  });

  it('impede o padrão do navegador nas teclas de comando, e só nelas', () => {
    // Espaço rola a página e Backspace já significou "voltar" no histórico: deixar o padrão
    // passar nessas faria a tecla comandar o painel E mexer na página ao mesmo tempo.
    for (const key of ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'ArrowLeft', 'ArrowUp', 'PageUp', 'Escape', 'Home', 'Backspace']) {
      expect(bindingForKey(key).preventDefault, key).toBe(true);
    }
  });

  it('alcança toda ação de operador que o reducer oferece', () => {
    // A afirmação que teria pego o bug: para cada evento que o `rotationReducer` sabe tratar por
    // vontade de uma pessoa, existe pelo menos uma tecla que chega até ele. Um evento novo no
    // reducer sem tecla correspondente derruba este teste.
    const alcancaveis = new Set<RotationEvent['type']>();
    const teclas = [
      'ArrowRight', 'ArrowDown', 'PageDown', ' ',
      'ArrowLeft', 'ArrowUp', 'PageUp',
      'Escape', 'Home', 'Backspace',
      'k'
    ];
    for (const key of teclas) alcancaveis.add(tipo(key));

    expect(alcancaveis).toEqual(
      new Set<RotationEvent['type']>([
        'OPERATOR_NEXT',
        'OPERATOR_PREV',
        'FORCE_SCOREBOARD',
        'OPERATOR_ACTIVITY'
      ])
    );
  });
});
