import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import shipSpecSchema from './schema/ship_spec.schema.json' with { type: 'json' };
import { ShipSpecification } from './types/ship.js';

const AjvClass = (Ajv as any).default || Ajv;
const ajv = new AjvClass({ allErrors: true });
const addFormatsFunc = (addFormats as any).default || addFormats;
addFormatsFunc(ajv);

const validateShipSpec = ajv.compile(shipSpecSchema);

export function validateShipSpecification(data: unknown): { isValid: boolean; errors?: string[] } {
  const valid = validateShipSpec(data);
  if (valid) {
    return { isValid: true };
  }
  const errors = validateShipSpec.errors?.map(
    (err: any) => `${err.instancePath || 'root'} ${err.message}`
  ) || ['Unknown validation error'];
  return { isValid: false, errors };
}

export function assertValidShipSpecification(data: unknown): asserts data is ShipSpecification {
  const result = validateShipSpecification(data);
  if (!result.isValid) {
    throw new Error(`Invalid ShipSpecification: ${result.errors?.join(', ')}`);
  }
}
