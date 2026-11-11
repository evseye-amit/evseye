import { describe, expect, it } from 'vitest';
import { displayRiderName, normalizeRiderName } from '../../src/riders/name.util.js';

describe('rider name utility', () => {
  it('splits a multi-word name into three enabled components', () => {
    const components = normalizeRiderName({ name: 'Ram Kumar Singh Sharma' }, ['firstName', 'middleName', 'lastName']);
    expect(components).toEqual({ firstName: 'Ram', middleName: 'Kumar Singh', lastName: 'Sharma' });
    expect(displayRiderName(components)).toBe('Ram Kumar Singh Sharma');
  });

  it('keeps all preceding words in first name when middle name is disabled', () => {
    expect(normalizeRiderName({ name: 'Ram Kumar Singh Sharma' }, ['firstName', 'lastName']))
      .toEqual({ firstName: 'Ram Kumar Singh', lastName: 'Sharma' });
  });

  it('prefers explicitly supplied components', () => {
    expect(normalizeRiderName({ first_name: 'Ram', last_name: 'Sharma' }, ['firstName', 'lastName']))
      .toEqual({ firstName: 'Ram', lastName: 'Sharma' });
  });
});
