import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../constants/balance.js';
import { buildShipSpecSchema } from './gen-schema.js';
import versioned from './ship_spec.schema.json' with { type: 'json' };

describe('ship_spec.schema.json', () => {
  it('é idêntico ao que o gerador produz — rode `npm run gen:schema`', () => {
    assert.deepEqual(buildShipSpecSchema(), versioned);
  });

  it('deriva cada faixa numérica de BALANCE.ranges', () => {
    const schema: any = buildShipSpecSchema();
    for (const [fieldPath, range] of Object.entries(BALANCE.ranges)) {
      const node = fieldPath.split('.').reduce((acc: any, key) => acc?.properties?.[key], schema);
      assert.ok(node, `campo ${fieldPath} ausente do schema gerado`);
      assert.equal(node.minimum, range.min, `${fieldPath}.minimum`);
      assert.equal(node.maximum, range.max, `${fieldPath}.maximum`);
      assert.equal(node.type, range.integer ? 'integer' : 'number', `${fieldPath}.type`);
    }
  });

  it('não oferece nenhum valor de enum que a engine ignore', () => {
    const schema: any = buildShipSpecSchema();
    const secondaryTypes = schema.properties.weapons.properties.secondary.properties.type.enum;
    assert.ok(!secondaryTypes.includes('drone_escort'),
      'drone_escort não tem implementação na engine — ver Spec 09 §2.4');
  });
});
