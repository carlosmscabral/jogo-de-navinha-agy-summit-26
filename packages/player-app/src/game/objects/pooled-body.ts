import type Phaser from 'phaser';

/**
 * Ciclo de vida dos objetos reciclados por um `Phaser.Physics.Arcade.Group` -- projéteis,
 * mísseis e inimigos.
 *
 * O Arcade Physics do Phaser ignora `gameObject.active` por completo. Conferido no fonte
 * da versão instalada (`node_modules/phaser/src/physics/arcade/World.js`):
 *
 *   - `World.step` integra TODO corpo cujo `body.enable` seja `true`; não há checagem de
 *     `active`. Um objeto só desativado continua se movendo.
 *   - `World.collideSpriteVsGroup` descarta candidatos por `!bodyB.enable ||
 *     bodyB.checkCollision.none`; também não há checagem de `active`. Um objeto só
 *     desativado continua colidindo.
 *
 * Por isso `setActive(false) + setVisible(false)` -- o padrão que este projeto usava em
 * todos os pontos de consumo -- não tirava nada de circulação: sumia da tela e continuava
 * valendo. O sintoma caro foi no boss, cujo corpo tem 300x140px: um projétil "consumido"
 * seguia atravessando esse corpo por ~10 a 15 frames e reentrava no callback do overlap a
 * cada um deles, cobrando `BossOverlord.takeDamage` de novo. Um tiro virava dezenas de
 * acertos e o boss derretia. Ver Spec 09 §5.5.
 */

/**
 * Devolve um objeto ao pool: some da tela E sai da simulação física.
 *
 * `body.stop()` antes de desabilitar zera a velocidade, para que o objeto não volte do pool
 * com o vetor antigo caso algum caminho futuro reative o corpo sem passar por
 * `respawnPooled`.
 */
export function despawnPooled(obj: Phaser.Physics.Arcade.Sprite): void {
  obj.setActive(false);
  obj.setVisible(false);
  const body = obj.body as Phaser.Physics.Arcade.Body | null;
  if (body) {
    body.stop();
    body.enable = false;
  }
}

/**
 * Tira do pool um objeto que `despawnPooled` desligou e o coloca em `(x, y)` com a
 * velocidade dada.
 *
 * Reabilitar o corpo é obrigatório e não acontece sozinho em lugar nenhum: `Group.get()`
 * procura membros por `active === false` e não toca em `body.enable`, e `Body.reset()`
 * apenas para, reposiciona e limpa as flags -- também não reabilita. `reset` vem ANTES de
 * `setVelocity` porque `reset` chama `stop()` internamente e zeraria a velocidade recém
 * atribuída.
 */
export function respawnPooled(
  obj: Phaser.Physics.Arcade.Sprite,
  x: number,
  y: number,
  vx: number,
  vy: number
): void {
  obj.setActive(true);
  obj.setVisible(true);
  const body = obj.body as Phaser.Physics.Arcade.Body | null;
  if (body) {
    body.enable = true;
    body.reset(x, y);
    body.checkCollision.none = false;
  } else {
    obj.setPosition(x, y);
  }
  obj.setVelocity(vx, vy);
}
