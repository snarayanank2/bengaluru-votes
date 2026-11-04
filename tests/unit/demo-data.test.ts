import { describe, it, expect } from 'vitest';
import { isTestCandidate } from '../../src/lib/demo-data';

describe('isTestCandidate', () => {
  it.each([
    [{ slug: 'demo-ward-1001-candidate-1', nameEn: 'Test Candidate 1001-1 (FICTIONAL)' }],
    [{ slug: '2001-n-jayapala', nameEn: 'TEST N. Jayapala' }],
    [{ slug: '2001-test-avvayi', nameEn: 'TEST Avvayi (TEST)' }],
    [{ slug: '4012-satish-reddy-m-test-2023-assembly', nameEn: 'Sathish Reddy M (TEST 2023 Assembly)' }],
  ])('flags %o', (c) => expect(isTestCandidate(c)).toBe(true));

  it.each([
    [{ slug: '1001-a-kumar', nameEn: 'A. Kumar' }],
    [{ slug: '1001-test-kumar', nameEn: 'Test Kumar' }],
    [{ slug: '1001-x', nameEn: undefined }],
  ])('does not flag %o', (c) => expect(isTestCandidate(c)).toBe(false));
});
