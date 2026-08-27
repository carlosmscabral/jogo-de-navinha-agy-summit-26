import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../constants/balance.js';
import { FALLBACK_PRESETS } from '../constants/fallback-presets.js';
import { applySynergies } from './synergies.js';

function specWith(synergies: string[]) {
  const base = structuredClone(FALLBACK_PRESETS.striker);
  base.build_metadata.synergies_unlocked = synergies;
  return base;
}

describe('applySynergies', () => {
  it('não altera nada quando nenhuma sinergia foi desbloqueada', () => {
    const spec = specWith([]);
    const r = applySynergies(spec);
    assert.deepEqual(r.applied, []);
    assert.deepEqual(r.attributes, spec.attributes);
    assert.deepEqual(r.weapons, spec.weapons);
  });

  it('Glass Cannon amplifica o dano primário e trava o HP em 2', () => {
    const spec = specWith(['Glass Cannon']);
    const r = applySynergies(spec);
    assert.equal(
      r.weapons.primary.damage,
      spec.weapons.primary.damage * BALANCE.synergies.glass_cannon.primary_damage_factor
    );
    assert.equal(r.attributes.max_hp, BALANCE.synergies.glass_cannon.forced_max_hp);
  });

  it('Glass Cannon nunca ultrapassa o teto de dano do schema, mesmo partindo de um dano já perto do limite', () => {
    // Uma build legítima de Glass Cannon (declarada de verdade, não o default do daemon) com
    // primary.damage já no teto de BALANCE.ranges: 45 * 1.30 = 58.5, acima do próprio teto do
    // schema. A sinergia real não pode produzir uma nave fora da faixa que o schema anuncia.
    const spec = specWith(['Glass Cannon']);
    spec.weapons.primary.damage = BALANCE.ranges['weapons.primary.damage'].max;
    const r = applySynergies(spec);
    assert.ok(
      r.weapons.primary.damage <= BALANCE.ranges['weapons.primary.damage'].max,
      `dano pós-sinergia (${r.weapons.primary.damage}) excedeu o teto do schema`
    );
  });

  it('Titan Fortress eleva HP e garante escudo mínimo', () => {
    const r = applySynergies(specWith(['Titan Fortress']));
    assert.equal(r.attributes.max_hp, BALANCE.synergies.titan_fortress.forced_max_hp);
    assert.ok(r.attributes.shield_capacity >= BALANCE.synergies.titan_fortress.min_shield_capacity);
  });

  it('Ghost Interceptor leva velocidade ao máximo e hitbox ao mínimo', () => {
    const r = applySynergies(specWith(['Ghost Interceptor']));
    assert.equal(r.attributes.speed_px_s, BALANCE.ranges['attributes.speed_px_s'].max);
    assert.equal(r.attributes.hitbox_radius, BALANCE.ranges['attributes.hitbox_radius'].min);
  });

  it('Balanced Ace amplifica tudo sem estourar as faixas', () => {
    const r = applySynergies(specWith(['Balanced Ace']));
    for (const field of ['max_hp', 'shield_capacity', 'speed_px_s'] as const) {
      const range = BALANCE.ranges[`attributes.${field}`];
      assert.ok(r.attributes[field] <= range.max, `${field} estourou o máximo`);
      assert.ok(r.attributes[field] >= range.min, `${field} furou o mínimo`);
    }
  });

  it('ignora nomes de sinergia que a engine não conhece', () => {
    const r = applySynergies(specWith(['Sinergia Inventada Pelo Agente']));
    assert.deepEqual(r.applied, []);
  });

  it('produz naves mensuravelmente diferentes entre sinergias', () => {
    const glass = applySynergies(specWith(['Glass Cannon']));
    const titan = applySynergies(specWith(['Titan Fortress']));
    assert.notEqual(glass.attributes.max_hp, titan.attributes.max_hp);
    assert.notEqual(glass.weapons.primary.damage, titan.weapons.primary.damage);
  });

  it('reconhece o antigo valor padrão do daemon ("Glass Cannon 🔥"), não apenas o nome canônico exato', () => {
    // packages/daemon/src/services/file-watcher.ts's normalizeSpec used to fall back to this
    // literal string whenever the agent omitted synergies_unlocked; the final-review fix round
    // changed that default to `[]` (an unearned synergy must never be granted by default), but
    // any spec that legitimately carries this exact decorated string (e.g. a stale client, or a
    // hand-crafted test fixture) must still match. Exact-string matching against KNOWN would
    // silently drop this and the visitor would lose the synergy (and its score bonus) with zero
    // indication.
    const spec = specWith(['Glass Cannon 🔥']);
    const r = applySynergies(spec);
    assert.deepEqual(r.applied, ['Glass Cannon']);
    assert.equal(
      r.weapons.primary.damage,
      spec.weapons.primary.damage * BALANCE.synergies.glass_cannon.primary_damage_factor
    );
    assert.equal(r.attributes.max_hp, BALANCE.synergies.glass_cannon.forced_max_hp);
  });

  it('reconhece as strings decoradas exibidas pelo builder (emoji + nome + parêntese) para as quatro sinergias', () => {
    // Duas gerações de crachá: as de cima são as que `synergy-preview.ts` produz hoje (derivadas
    // de BALANCE), as de baixo são as literais que ele produzia até 2026-08-27 e que ainda podem
    // chegar num `ship_spec.json` de sessão antiga. As duas precisam casar -- o matcher é
    // deliberadamente por substring do nome canônico, justamente para não depender da decoração.
    const decorated: Record<string, string[]> = {
      'Glass Cannon': ['⚡ Glass Cannon (+30% dano · casco 2)', '⚡ Glass Cannon (+30% DPS)'],
      'Titan Fortress': [
        '🛡️ Titan Fortress (casco 5 · escudo ≥2 · regen 20s)',
        '🛡️ Titan Fortress (+25% Blindagem)'
      ],
      'Ghost Interceptor': [
        '💨 Ghost Interceptor (380 px/s · hitbox 8px)',
        '💨 Ghost Interceptor (+20% Esquiva)'
      ],
      'Balanced Ace': ['🎯 Balanced Ace (+15% em tudo)', '🎯 Balanced Ace (+15% Geral)']
    };
    for (const [canonical, displays] of Object.entries(decorated)) {
      for (const display of displays) {
        const r = applySynergies(specWith([display]));
        assert.deepEqual(r.applied, [canonical], `esperava reconhecer "${display}" como ${canonical}`);
      }
    }
  });
});
