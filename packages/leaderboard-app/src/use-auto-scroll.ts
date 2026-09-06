import { useEffect, useRef, type RefObject } from 'react';
import { scrollOffsetAt } from './auto-scroll.js';

/**
 * A cola entre `scrollOffsetAt` (pura, testada em `auto-scroll.test.ts`) e o DOM.
 *
 * Fina de propósito: é ela que NÃO pode ser testada neste pacote — sem jsdom não há
 * `ResizeObserver`, `requestAnimationFrame` nem layout — então nenhuma decisão mora aqui. Tudo o
 * que ela faz é medir, chamar a função pura e escrever o resultado.
 *
 * `transform: translateY`, e não `scrollTop`: o primeiro é composto pela GPU e não força um
 * recálculo de layout a cada quadro. O telão pode acabar rodando num Chromebook, e 60 quadros por
 * segundo de reflow numa lista de 20 cards seria visível.
 *
 * O elemento referenciado é a LISTA; quem recorta é o pai (`overflow-hidden`, que os dois painéis
 * já tinham). Transformar não altera `scrollHeight`, então o `ResizeObserver` não realimenta.
 *
 * @param enabled `false` congela e zera o deslocamento — é o que acontece quando a visão educativa
 *   está no ar e não há razão nenhuma para animar uma lista fora da tela.
 */
export function useAutoScroll<T extends HTMLElement>(enabled: boolean): RefObject<T> {
  const ref = useRef<T>(null);
  const overflowRef = useRef(0);

  // Medição, separada da animação: a lista cresce ao longo do evento (3 pilotos viram 20) e a
  // janela pode mudar de tamanho, mas nada disso deve reiniciar o ciclo da rolagem.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.parentElement;

    const measure = () => {
      const visivel = parent ? parent.clientHeight : el.clientHeight;
      overflowRef.current = Math.max(0, el.scrollHeight - visivel);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (parent) observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const semMovimento =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!enabled || semMovimento) {
      el.style.transform = '';
      return;
    }

    let frame = 0;
    const inicio = performance.now();
    const passo = (agora: number) => {
      el.style.transform = `translateY(-${scrollOffsetAt(agora - inicio, overflowRef.current)}px)`;
      frame = requestAnimationFrame(passo);
    };
    frame = requestAnimationFrame(passo);

    return () => {
      cancelAnimationFrame(frame);
      el.style.transform = '';
    };
  }, [enabled]);

  return ref;
}
