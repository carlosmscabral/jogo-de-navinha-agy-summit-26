/**
 * Cadência de disparo independente da taxa de quadros.
 *
 * Uma arma só pode disparar num quadro, então o intervalo real entre disparos é sempre arredondado
 * *para cima* até a próxima borda de quadro. O jeito óbvio de marcar o último disparo -- carimbar o
 * instante do quadro, `âncora = agora` -- joga essa sobra fora e recomeça a contagem do zero, então
 * o arredondamento se repete a cada disparo em vez de se cancelar. O erro é sistemático e escala com
 * o tempo de quadro: a `fire_rate` efetiva vira `1 / (⌈intervalo / quadro⌉ × quadro)`, sempre abaixo
 * da nominal, e a máquina mais lenta atira menos.
 *
 * A 60 fps exatos o defeito é invisível para as `fire_rate` que o schema permite ver na prática --
 * 12 disparos/s são 83.33ms, exatamente 5 quadros; 5 disparos/s são 200ms, exatamente 12 quadros --
 * e é por isso que ele sobreviveu até ser medido contra hardware real.
 *
 * Foi medido, não deduzido: nas capturas de conformidade de 2026-08-16 (Spec 09 §5.9) os três
 * presets implicaram o mesmo tempo de quadro, 17.3 a 17.9ms (56 a 58 fps), a partir de dois
 * intervalos nominais diferentes, esticando o TTK do boss entre 4% e 8%.
 *
 * Avançar a âncora em múltiplos exatos do intervalo preserva a sobra, e a cadência de longo prazo
 * volta a ser exatamente `fire_rate` disparos por segundo em qualquer taxa de quadros capaz de
 * sustentá-la.
 */

/**
 * Atraso máximo, em intervalos, que a âncora recupera antes de desistir e reancorar no presente.
 *
 * Sem esse teto, uma pausa longa (aba em segundo plano, breakpoint, `timeScale` do harness) deixaria
 * a âncora dezenas de intervalos atrás e a arma sairia numa rajada de recuperação -- um disparo por
 * quadro -- até alcançar o presente. Com ele, a pausa simplesmente não aconteceu para a arma.
 *
 * Dois intervalos é o menor valor que não interfere no regime normal: em estado estável a âncora
 * fica no máximo um tempo de quadro atrasada, e um tempo de quadro só passa de um intervalo inteiro
 * quando o jogo já está abaixo da própria `fire_rate` em quadros por segundo.
 */
export const CADENCE_RECOVERY_INTERVALS = 2;

/**
 * Decide se a arma pode disparar neste quadro e, se puder, para onde a âncora de cadência vai.
 *
 * Retorna a nova âncora, ou `null` se a arma ainda está em recarga. As duas regras vivem na mesma
 * função de propósito: o motor Phaser e o `combat-model.ts` do simulador precisam concordar sobre
 * *ambas*, e o teste de conformidade compara os dois lado a lado. Duplicar a condição nos dois
 * lugares foi exatamente como o defeito acima nasceu.
 *
 * Uma âncora não-finita (`-Infinity`, usada para "pode disparar já no primeiro quadro") cai no
 * caminho de reancoragem e o primeiro disparo define a fase da cadência.
 */
export function resolveFireCadence(anchorMs: number, nowMs: number, intervalMs: number): number | null {
  const sinceAnchor = nowMs - anchorMs;
  if (sinceAnchor < intervalMs) {
    return null;
  }
  if (!Number.isFinite(sinceAnchor) || sinceAnchor > intervalMs * CADENCE_RECOVERY_INTERVALS) {
    return nowMs;
  }
  return anchorMs + intervalMs;
}
