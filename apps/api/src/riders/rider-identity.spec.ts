import { describe, expect, it } from 'vitest';
import {
  RiderIdentityConflictException,
  canonicalizeRiderIdentity,
  riderIdentityConflictField,
  riderIdentityValuesFromMetadata,
} from './rider-identity.js';

describe('rider identity normalization', () => {
  it('trims Aadhaar and trims plus uppercases PAN', () => {
    expect(canonicalizeRiderIdentity('AADHAAR', ' 123456789012 ')).toBe('123456789012');
    expect(canonicalizeRiderIdentity('PAN', ' abcde1234f ')).toBe('ABCDE1234F');
    expect(canonicalizeRiderIdentity('PAN', '   ')).toBeNull();
  });

  it('extracts only non-empty supported metadata fields', () => {
    expect(riderIdentityValuesFromMetadata({ aadhaarNumber: ' ', panNumber: null })).toEqual({});
    expect(riderIdentityValuesFromMetadata({ aadhaarNumber: ' 123456789012 ', panNumber: ' abcde1234f ', other: 'ignore' }))
      .toEqual({ AADHAAR: '123456789012', PAN: 'ABCDE1234F' });
  });
});

describe('rider identity conflict mapping', () => {
  it('maps named database unique targets to field-specific conflicts', () => {
    expect(riderIdentityConflictField({ code: 'P2002', meta: { target: ['clientId', 'aadhaarNumber'] } })).toBe('AADHAAR_NUMBER');
    expect(riderIdentityConflictField({ code: 'P2002', meta: { target: ['clientId', 'panNumber'] } })).toBe('PAN_NUMBER');
    expect(riderIdentityConflictField({ code: 'P2002', meta: { target: ['clientId', 'mobile'] } })).toBeUndefined();
  });

  it('does not echo a duplicate value in the conflict message', () => {
    const value = 'ABCDE1234F';
    const error = new RiderIdentityConflictException('PAN');
    expect(error.message).toContain('PAN');
    expect(error.message).not.toContain(value);
  });
});
