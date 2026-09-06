import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasActivePilots } from './company-rankings.js';

describe('hasActivePilots', () => {
  it('aceita empresa com pilotos', () => {
    assert.equal(hasActivePilots({ pilots_count: 1 }), true);
    assert.equal(hasActivePilots({ pilots_count: 42 }), true);
  });

  it('rejeita a casca zerada que a recanonização deixa para trás', () => {
    assert.equal(hasActivePilots({ pilots_count: 0 }), false);
  });

  it('rejeita contagem ausente ou negativa', () => {
    assert.equal(hasActivePilots({ pilots_count: undefined as unknown as number }), false);
    assert.equal(hasActivePilots({ pilots_count: -1 }), false);
  });
});
