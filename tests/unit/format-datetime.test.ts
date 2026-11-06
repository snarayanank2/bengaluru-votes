import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../../src/lib/format-datetime';

describe('formatDateTime', () => {
  const moment = new Date('2026-11-04T13:16:41.954Z');

  it('prints India time, readable, with no ISO punctuation (en)', () => {
    const text = formatDateTime('en', moment);
    expect(text).toMatch(/4 Nov 2026/);
    expect(text).toMatch(/6:46/);
    expect(text).not.toMatch(/T\d|Z$/);
  });

  it('prints Kannada times on the 24-hour clock, with no Latin AM/PM', () => {
    expect(formatDateTime('kn', moment)).not.toMatch(/\b[AP]M\b/i);
    expect(formatDateTime('kn', moment)).toMatch(/18:46/);
  });

  it('uses the Kannada locale for kn', () => {
    expect(formatDateTime('kn', moment)).not.toBe(formatDateTime('en', moment));
  });
});
