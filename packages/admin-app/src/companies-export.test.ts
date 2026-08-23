import { describe, it, expect } from 'vitest';
import { toCompaniesFileJson } from './companies-export.js';

describe('toCompaniesFileJson', () => {
  it('produz o mesmo shape de config/companies.json ({ companies: string[] })', () => {
    const json = toCompaniesFileJson(['Google', 'Nubank']);
    const parsed = JSON.parse(json) as { companies: string[] };
    expect(parsed).toEqual({ companies: ['Google', 'Nubank'] });
  });

  it('não inclui o campo _comment do arquivo original', () => {
    const json = toCompaniesFileJson(['Google']);
    expect(json).not.toContain('_comment');
  });
});
