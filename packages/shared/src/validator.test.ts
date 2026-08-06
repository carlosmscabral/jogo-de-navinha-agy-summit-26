import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_PRESETS } from './constants/fallback-presets.js';
import { validateShipSpecification } from './validator.js';

describe('ShipSpecification Validator', () => {
  it('should validate all fallback presets successfully', () => {
    for (const [name, preset] of Object.entries(FALLBACK_PRESETS)) {
      const result = validateShipSpecification(preset);
      assert.equal(result.isValid, true, `Preset ${name} should be valid. Errors: ${result.errors?.join(', ')}`);
    }
  });

  it('should reject invalid ship specs with missing fields or invalid bounds', () => {
    const invalidSpec = {
      pilot: { callsign: '' }, // missing fields
      attributes: { max_hp: 99 } // exceeds max 5
    };
    const result = validateShipSpecification(invalidSpec);
    assert.equal(result.isValid, false);
    assert.ok((result.errors?.length || 0) > 0);
  });
});
