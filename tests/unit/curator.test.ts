/**
 * Pure-function coverage for src/lib/curator.ts's `parseCandidateFieldTargetRef`
 * and `flagFieldKey` (Task 34 review gap: malformed targetRef must return `null`, never throw —
 * a throw here would 500 the whole `/curator/queue/{id}` route for any
 * flag_item whose targetRef doesn't match the expected shape, e.g. data from
 * a future target type or a hand-edited row). No DB access needed — this is
 * a plain regex match, but `src/lib/curator.ts` imports `../db/client` at
 * module scope, so DATABASE_URL must still be set for the import to succeed
 * (see tests/routes/curator.test.ts's identical guard).
 */
import { describe, it, expect } from 'vitest';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

import { flagFieldKey, parseCandidateFieldTargetRef } from '../../src/lib/curator';

describe('src/lib/curator.ts — parseCandidateFieldTargetRef', () => {
  it('parses a well-formed candidate_field targetRef', () => {
    expect(parseCandidateFieldTargetRef('candidate:42:cases')).toEqual({ candidateId: 42, fieldKey: 'cases' });
  });

  it('parses a fieldKey that itself contains colons (the `.+` tail is greedy)', () => {
    expect(parseCandidateFieldTargetRef('candidate:42:some:weird:key')).toEqual({
      candidateId: 42,
      fieldKey: 'some:weird:key',
    });
  });

  it.each([
    ['candidate:abc:cases', 'non-numeric candidate id'],
    ['candidate:12', 'missing the fieldKey segment (ward_field-arity, not candidate_field)'],
    ['ward:5:name', 'wrong prefix — a ward_field targetRef, not candidate_field'],
    ['', 'empty string'],
    ['garbage', 'no colons at all'],
  ])('returns null (never throws) for %s — %s', (input) => {
    expect(() => parseCandidateFieldTargetRef(input)).not.toThrow();
    expect(parseCandidateFieldTargetRef(input)).toBeNull();
  });
});

describe('src/lib/curator.ts — flagFieldKey', () => {
  it("gives the flagged field of a candidate's flag", () => {
    expect(flagFieldKey('candidate_field', 'candidate:42:assets')).toBe('assets');
  });

  it.each([
    ['candidate_field', 'garbage', 'a candidate flag whose reference does not parse'],
    ['ward_field', 'ward:5:name', 'an old ward-field row'],
    ['ward_issue', 'ward_issue:9', 'an old ward-issue row'],
    ['ward_issue', 'candidate:42:assets', 'a candidate-shaped reference on another target type'],
  ] as const)('gives null for %s %s — %s', (targetType, targetRef, _why) => {
    expect(flagFieldKey(targetType, targetRef)).toBeNull();
  });
});
